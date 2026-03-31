// =============================================================
// Global Mandate — Net Resource Flow Calculator
//
// Computes and persists a player's *NetPerHour fields.
// These are the BASE rates under normal operating conditions —
// runtime modifiers (Comm Center offline, CP overload, tutorial slow)
// are intentionally excluded and applied per-tick in resources.ts.
//
// Call recalculateNetFlow(playerId) whenever anything changes that
// affects resource flow: zone captured/lost, unit trained/killed,
// building upgraded, or a trade agreement accepted/expired.
// =============================================================

import { PrismaClient, BuildingType } from "@prisma/client";
import { redis } from "./redis.js";
import { UNIT_STATS, type UnitType } from "./combat.js";

const prisma = new PrismaClient();

// The trade agreement boost key — mirrors diplomacy.ts's DiplomacyKeys.tradeBoost.
// Read directly from Redis here to avoid a lib → services import dependency.
const tradeBoostKey = (playerId: string) => `trade:${playerId}`;

// ─────────────────────────────────────────────
// recalculateNetFlow
// ─────────────────────────────────────────────

/**
 * Recalculate and save a player's net hourly resource rates.
 *
 * Factors applied:
 *   ✓ Zone yields — summed from all owned zones
 *   ✓ Signal Mesh — disconnected zones yield 50% (isConnected = false)
 *   ✓ Trade agreement boost — production multiplier from active Redis key
 *   ✓ Unit upkeep — rations drain from all non-training units
 *   ✓ Building maintenance — fuel drain from operational buildings
 *
 * Factors intentionally NOT applied (handled in resources.ts at calc time):
 *   ✗ Comm Center offline (50% production penalty)
 *   ✗ CP overload (300% drain penalty)
 *   ✗ Tutorial slow mode (50% drain reduction)
 */
export async function recalculateNetFlow(playerId: string): Promise<void> {
  // Fetch all inputs in parallel
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

  if (!player) return;

  // ── Trade agreement boost ─────────────────────────────────────
  // Set by diplomacy.ts when a trade agreement is accepted; expires automatically.
  const tradeRaw             = await redis.get(tradeBoostKey(playerId));
  const tradeBoostMultiplier = tradeRaw ? 1.0 + parseInt(tradeRaw) / 100 : 1.0;

  // ── Zone production — Signal Mesh applied ─────────────────────
  // isConnected = true  → 100% yield
  // isConnected = false → 50%  yield (signal chain broken)
  let fuelProd = 0, rationsProd = 0, steelProd = 0, creditsProd = 0;

  for (const zone of zones) {
    const signalEff  = zone.isConnected ? 1.0 : 0.5;
    fuelProd    += zone.fuelPerHour    * signalEff;
    rationsProd += zone.rationsPerHour * signalEff;
    steelProd   += zone.steelPerHour   * signalEff;
    creditsProd += zone.creditsPerHour * signalEff;
  }

  // Apply trade agreement multiplier to all production
  fuelProd    *= tradeBoostMultiplier;
  rationsProd *= tradeBoostMultiplier;
  steelProd   *= tradeBoostMultiplier;
  creditsProd *= tradeBoostMultiplier;

  // ── Unit upkeep — rations drain ───────────────────────────────
  // Infantry has rationsUpkeepPerHr > 0; vehicles have 0 (they drain fuel in transit only).
  let rationsDrain = 0;
  for (const unit of units) {
    const stats = UNIT_STATS[unit.unitType as UnitType];
    if (stats) rationsDrain += stats.rationsUpkeepPerHr * unit.quantity;
  }

  // ── Building maintenance — fuel drain ─────────────────────────
  // Only operational buildings consume maintenance fuel.
  // Non-operational buildings (isOperational = false) are offline and cost nothing.
  let buildingFuelDrain = 0;
  for (const building of player.fob?.buildings ?? []) {
    if (building.isOperational) {
      buildingFuelDrain += building.maintenanceFuelPerHour;
    }
  }

  // ── Persist net rates ─────────────────────────────────────────
  // steel and credits currently have no consumption sources (no drain).
  await prisma.player.update({
    where: { id: playerId },
    data: {
      fuelNetPerHour:    fuelProd    - buildingFuelDrain,
      rationsNetPerHour: rationsProd - rationsDrain,
      steelNetPerHour:   steelProd,
      creditsNetPerHour: creditsProd,
    },
  });
}
