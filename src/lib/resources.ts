// =============================================================
// Global Mandate — Lazy Resource Evaluation
//
// Resources are NOT calculated on a fixed timer. They are
// calculated ON DEMAND when a player's data is fetched by the API.
//
// Call calculateResources(playerId) at the start of any API handler
// that reads or modifies player resources.
// =============================================================

import { BuildingType } from "@prisma/client";
import { prisma } from "./prisma.js";
import { redis } from "./redis.js";
import { UNIT_STATS, type UnitType } from "./combat.js";

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

/** Base storage cap per resource type, regardless of Warehouse level. */
const WAREHOUSE_BASE_CAPACITY      = 2_000;
/** Additional storage per Warehouse building level. */
const WAREHOUSE_CAPACITY_PER_LEVEL = 1_000;

/**
 * Maximum hours of resource catch-up applied per call.
 * Prevents runaway accumulation after server downtime or long sessions.
 */
const MAX_ELAPSED_HOURS = 24;

// ─────────────────────────────────────────────
// Redis fail-state keys
// Checked by movement and combat services before allowing vehicle actions.
// ─────────────────────────────────────────────

const starvationKey  = (id: string) => `starvation:${id}`;
const fuelStarvedKey = (id: string) => `fuel_starved:${id}`;
const FAIL_FLAG_TTL_S = 7_200; // 2 hours — refreshed on each calculateResources call

// ─────────────────────────────────────────────
// calculateResources
// ─────────────────────────────────────────────

/**
 * Catch-up resource calculation for a single player.
 *
 * Reads player.lastResourceCalculatedAt, computes elapsed time,
 * derives gross production and consumption with all active modifiers,
 * enforces storage caps, detects fail states, and writes results back
 * to Postgres in a single transaction.
 *
 * Returns the updated Player row.
 */
export async function calculateResources(playerId: string) {
  const now = new Date();

  // Fetch all data needed for the calculation in parallel
  const [player, zones, units] = await Promise.all([
    prisma.player.findUnique({
      where:   { id: playerId },
      include: { fob: { include: { buildings: true } } },
    }),
    prisma.zone.findMany({
      where:  { ownerPlayerId: playerId },
      select: {
        fuelPerHour: true, rationsPerHour: true,
        steelPerHour: true, creditsPerHour: true,
        isConnected: true,
      },
    }),
    prisma.unit.findMany({
      where:  { ownerId: playerId, status: { not: "TRAINING" } },
      select: { unitType: true, quantity: true },
    }),
  ]);

  if (!player) throw new Error(`Player not found: ${playerId}`);

  // ── Elapsed time ─────────────────────────────────────────────
  const elapsedMs    = now.getTime() - player.lastResourceCalculatedAt.getTime();
  const elapsedHours = Math.min(elapsedMs / 3_600_000, MAX_ELAPSED_HOURS);

  // Skip if called twice in rapid succession — no meaningful time has passed
  if (elapsedHours <= 0) return player;

  const buildings = player.fob?.buildings ?? [];

  // ── Modifier: Comm Center offline → 50% production penalty ───
  const commCenter     = buildings.find(b => b.buildingType === BuildingType.COMM_CENTER);
  const commCenterDown = commCenter !== undefined && !commCenter.isOperational;
  const prodMultiplier = commCenterDown ? 0.5 : 1.0;

  // ── Modifier: CP overload → 300% drain | Tutorial slow → 50% drain ──
  // Both stack multiplicatively.
  // CP overload: player has deployed more units than their Command Center allows.
  // Tutorial slow: eases new players into the economic model.
  const cpOverloaded  = player.usedCommandPoints > player.maxCommandPoints;
  const tutorialSlow  = !player.tutorialComplete;
  let drainMultiplier = 1.0;
  if (cpOverloaded) drainMultiplier *= 3.0;
  if (tutorialSlow) drainMultiplier *= 0.5;

  // ── Zone production ───────────────────────────────────────────
  // Zones with a broken Signal Chain (isConnected = false) yield 50%.
  let fuelProd = 0, rationsProd = 0, steelProd = 0, creditsProd = 0;

  for (const zone of zones) {
    const signalEff  = zone.isConnected ? 1.0 : 0.5;
    fuelProd    += zone.fuelPerHour    * signalEff;
    rationsProd += zone.rationsPerHour * signalEff;
    steelProd   += zone.steelPerHour   * signalEff;
    creditsProd += zone.creditsPerHour * signalEff;
  }

  // Apply Comm Center penalty to all incoming resource rates
  fuelProd    *= prodMultiplier;
  rationsProd *= prodMultiplier;
  steelProd   *= prodMultiplier;
  creditsProd *= prodMultiplier;

  // ── Consumption: unit rations upkeep ─────────────────────────
  let rationsDrain = 0;
  for (const unit of units) {
    const stats = UNIT_STATS[unit.unitType as UnitType];
    if (stats) rationsDrain += stats.rationsUpkeepPerHr * unit.quantity;
  }

  // ── Consumption: building fuel maintenance ────────────────────
  // Only operational buildings draw maintenance fuel.
  let buildingFuelDrain = 0;
  for (const b of buildings) {
    if (b.isOperational) buildingFuelDrain += b.maintenanceFuelPerHour;
  }

  // Apply drain modifiers (CP overload and tutorial slow mode)
  rationsDrain      *= drainMultiplier;
  buildingFuelDrain *= drainMultiplier;

  // ── Net deltas over the elapsed period ────────────────────────
  const deltaFuel    = (fuelProd    - buildingFuelDrain) * elapsedHours;
  const deltaRations = (rationsProd - rationsDrain)      * elapsedHours;
  const deltaSteel   = steelProd                         * elapsedHours;
  const deltaCredits = creditsProd                       * elapsedHours;

  // ── Storage cap (Warehouse level) ────────────────────────────
  const warehouse  = buildings.find(b => b.buildingType === BuildingType.WAREHOUSE);
  const storageCap = WAREHOUSE_BASE_CAPACITY
    + (warehouse?.level ?? 0) * WAREHOUSE_CAPACITY_PER_LEVEL;

  const newFuel    = Math.max(0, Math.min(Math.round(player.fuel    + deltaFuel),    storageCap));
  const newRations = Math.max(0, Math.min(Math.round(player.rations + deltaRations), storageCap));
  const newSteel   = Math.max(0, Math.min(Math.round(player.steel   + deltaSteel),   storageCap));
  const newCredits = Math.max(0, Math.min(Math.round(player.credits + deltaCredits), storageCap));

  // ── Fail state detection ──────────────────────────────────────
  const starvationActive = newRations === 0;
  const fuelStarved      = newFuel    === 0;

  // ── Commit to Postgres ────────────────────────────────────────
  const updated = await prisma.$transaction(async (tx) => {
    return tx.player.update({
      where: { id: playerId },
      data: {
        fuel:                    newFuel,
        rations:                 newRations,
        steel:                   newSteel,
        credits:                 newCredits,
        lastResourceCalculatedAt: now,
      },
    });
  });

  // ── Ephemeral fail-state flags in Redis ───────────────────────
  // These are read by movement and combat validation before allowing
  // vehicle orders. Expire after 2h and are refreshed every call.

  if (starvationActive) {
    await redis.set(starvationKey(playerId), "1", "EX", FAIL_FLAG_TTL_S);
  } else {
    await redis.del(starvationKey(playerId));
  }

  if (fuelStarved) {
    // Vehicle units (fuelPerKm > 0) are grounded until fuel is restored.
    // Movement service checks isFuelStarved() before creating a movement order.
    await redis.set(fuelStarvedKey(playerId), "1", "EX", FAIL_FLAG_TTL_S);
  } else {
    await redis.del(fuelStarvedKey(playerId));
  }

  return updated;
}

// ─────────────────────────────────────────────
// Guard helpers
// Import these in movement and combat services to enforce fail states.
// ─────────────────────────────────────────────

/** True if the player's rations are at zero — infantry attacks are penalised. */
export async function isStarving(playerId: string): Promise<boolean> {
  return (await redis.exists(starvationKey(playerId))) === 1;
}

/**
 * True if the player's fuel is at zero.
 * Movement orders for vehicle units (fuelPerKm > 0) should be rejected.
 */
export async function isFuelStarved(playerId: string): Promise<boolean> {
  return (await redis.exists(fuelStarvedKey(playerId))) === 1;
}
