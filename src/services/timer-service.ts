// =============================================================
// Global Mandate — Timer Service
// Runs as a standalone Node.js process.
// Polls Redis queues every 5 seconds and dispatches events.
// =============================================================

import { prisma } from "../lib/prisma.js";
import { recalculateNetFlow } from "../lib/netflow.js";
import {
  dequeueDueArrivals,
  dequeueDueBuilds,
  dequeueDueTrains,
  dequeueDueBattleRounds,
  getBattleState,
  setBattleState,
  publishZoneEvent,
  publishPlayerEvent,
  adjustCommandPoints,
} from "../lib/redis.js";
import type { TravelQueueEntry, BuildQueueEntry, TrainQueueEntry } from "../lib/redis.js";
import { resolveBattleRound, UNIT_STATS } from "../lib/combat.js";
import type { CombatUnit, ZoneDefense, UnitType } from "../lib/combat.js";

// Minimal unit shape until `prisma generate` is run with a schema.prisma
type DbUnit = {
  id: string;
  unitType: string;
  quantity: number;
  healthPct: number;
  morale: number;
  ownerId: string;
};


// ─────────────────────────────────────────────
// Movement Arrivals
// ─────────────────────────────────────────────

export async function processDueArrivals(now: number): Promise<void> {
  const due = await dequeueDueArrivals(now);
  for (const entry of due) {
    await handleArrival(entry);
  }
}


async function handleArrival(entry: TravelQueueEntry): Promise<void> {
  const { movementId, unitId, ownerId, destinationZoneId } = entry;

  // Fetch zone and any existing garrison
  const [zone, unit] = await Promise.all([
    prisma.zone.findUnique({ where: { id: destinationZoneId } }),
    prisma.unit.findUnique({ where: { id: unitId } }),
  ]);

  if (!zone || !unit) return;

  // Finalise movement in DB
  await prisma.$transaction([
    prisma.movement.update({ where: { id: movementId }, data: { arrivedAt: new Date() } }),
    prisma.unit.update({
      where: { id: unitId },
      data: { currentZoneId: destinationZoneId, status: "IDLE" },
    }),
  ]);

  // If zone is unowned → claim it
  if (!zone.ownerPlayerId) {
    await prisma.zone.update({
      where: { id: destinationZoneId },
      data: {
        ownerPlayerId: ownerId,
        capturedAt: new Date(),
        consolidationEndsAt: new Date(Date.now() + 3_600_000), // 1hr vulnerability
      },
    });

    await publishZoneEvent(destinationZoneId, "ZONE_CAPTURED", { newOwner: ownerId });
    await publishPlayerEvent(ownerId, "ZONE_CAPTURED", { zoneId: destinationZoneId, zoneName: zone.name });
    return;
  }

  // If zone is enemy-owned → initiate battle
  if (zone.ownerPlayerId !== ownerId) {
    await initiateBattle(ownerId, zone.ownerPlayerId, destinationZoneId);
    return;
  }

  // Friendly zone — unit garrisons
  await prisma.unit.update({ where: { id: unitId }, data: { status: "GARRISONING" } });
  await publishZoneEvent(destinationZoneId, "UNIT_ARRIVED", { unitId, ownerId });
  await publishPlayerEvent(ownerId, "UNIT_ARRIVED", { unitId, zoneId: destinationZoneId });
}

// ─────────────────────────────────────────────
// Battle Initiation
// ─────────────────────────────────────────────

async function initiateBattle(
  attackerPlayerId: string,
  defenderPlayerId: string,
  zoneId: string
): Promise<void> {
  const battle = await prisma.battle.create({
    data: { zoneId, attackerPlayerId, defenderPlayerId },
  });

  const zone = await prisma.zone.findUnique({ where: { id: zoneId } });

  await setBattleState({
    battleId:          battle.id,
    zoneId,
    attackerPlayerId,
    defenderPlayerId,
    currentRound:      0,
    maxRounds:         12,
    attackerMorale:    1.0,
    defenderMorale:    1.0,
    nextRoundAt:       Date.now() + 300_000, // first round in 5 minutes
    status:            "ACTIVE",
  });

  await publishZoneEvent(zoneId, "BATTLE_STARTED", { battleId: battle.id, attackerPlayerId });
  await publishPlayerEvent(defenderPlayerId, "BATTLE_INCOMING", {
    battleId: battle.id,
    zoneId,
    zoneName: zone?.name,
    attackerPlayerId,
  });
}

// ─────────────────────────────────────────────
// Battle Round Resolution
// ─────────────────────────────────────────────

export async function processBattleRounds(now: number): Promise<void> {
  const dueBattleIds = await dequeueDueBattleRounds(now);
  for (const battleId of dueBattleIds) {
    await resolveNextRound(battleId);
  }
}

async function resolveNextRound(battleId: string): Promise<void> {
  const state = await getBattleState(battleId);
  if (!state || state.status === "RESOLVED") return;

  // Load live units for both sides
  const [attackerUnits, defenderUnits, zone] = await Promise.all([
    prisma.unit.findMany({
      where: { ownerId: state.attackerPlayerId, currentZoneId: state.zoneId, status: "IN_BATTLE" },
    }),
    prisma.unit.findMany({
      where: { ownerId: state.defenderPlayerId ?? "", currentZoneId: state.zoneId },
    }),
    prisma.zone.findUnique({ where: { id: state.zoneId } }),
  ]);

  if (!zone) return;

  const atkCombat: CombatUnit[] = (attackerUnits as DbUnit[]).map((u) => ({
    unitType:  u.unitType as UnitType,
    quantity:  u.quantity,
    healthPct: u.healthPct,
    morale:    u.morale,
  }));
  const defCombat: CombatUnit[] = (defenderUnits as DbUnit[]).map((u) => ({
    unitType:  u.unitType as UnitType,
    quantity:  u.quantity,
    healthPct: u.healthPct,
    morale:    u.morale,
  }));
  const zoneDef: ZoneDefense = {
    fortificationLevel: zone.fortificationLevel,
    wallBonus:          zone.wallBonus,
    hasAABattery:       false, // TODO: derive from zone buildings
  };

  if (atkCombat.length === 0) {
    await resolveBattle(battleId, state.zoneId, "DEFENDER_VICTORY", state);
    return;
  }
  if (defCombat.length === 0) {
    await resolveBattle(battleId, state.zoneId, "ATTACKER_VICTORY", state);
    return;
  }

  const { round, battleOver, attackerWins } =
    resolveBattleRound({ attackers: atkCombat, defenders: defCombat, zone: zoneDef });

  const nextRound = state.currentRound + 1;

  // Persist the round
  await prisma.battleRound.create({
    data: {
      battleId,
      roundNumber:         nextRound,
      attackerDamageDealt: round.attackerDamageDealt,
      defenderDamageDealt: round.defenderDamageDealt,
      attackerLosses:      round.attackerLosses,
      defenderLosses:      round.defenderLosses,
      attackerMoraleEnd:   round.attackerMoraleEnd,
      defenderMoraleEnd:   round.defenderMoraleEnd,
    },
  });

  // Apply casualties to DB units
  for (const [unitType, killed] of Object.entries(round.attackerLosses) as Array<[UnitType, number]>) {
    const u = (attackerUnits as DbUnit[]).find((u) => u.unitType === unitType);
    if (u) {
      const newQty = u.quantity - killed;
      if (newQty <= 0) {
        await prisma.unit.delete({ where: { id: u.id } });
        await adjustCommandPoints(state.attackerPlayerId, -UNIT_STATS[unitType]!.commandPointsCost * killed);
      } else {
        await prisma.unit.update({ where: { id: u.id }, data: { quantity: newQty } });
      }
    }
  }
  for (const [unitType, killed] of Object.entries(round.defenderLosses) as Array<[UnitType, number]>) {
    const u = (defenderUnits as DbUnit[]).find((u) => u.unitType === unitType);
    if (u) {
      const newQty = u.quantity - (killed as number);
      if (newQty <= 0) {
        await prisma.unit.delete({ where: { id: u.id } });
      } else {
        await prisma.unit.update({ where: { id: u.id }, data: { quantity: newQty } });
      }
    }
  }

  await publishZoneEvent(state.zoneId, "BATTLE_ROUND", {
    battleId,
    round: nextRound,
    attackerLosses: round.attackerLosses,
    defenderLosses: round.defenderLosses,
  });

  // Check end conditions
  if (battleOver || nextRound >= state.maxRounds) {
    const outcome = battleOver
      ? attackerWins ? "ATTACKER_VICTORY" : "DEFENDER_VICTORY"
      : "DRAW";
    await resolveBattle(battleId, state.zoneId, outcome, state);
  } else {
    // Schedule next round
    await setBattleState({
      ...state,
      currentRound: nextRound,
      attackerMorale: round.attackerMoraleEnd,
      defenderMorale: round.defenderMoraleEnd,
      nextRoundAt: Date.now() + 300_000,
    });
  }
}

async function resolveBattle(
  battleId: string,
  zoneId: string,
  outcome: "ATTACKER_VICTORY" | "DEFENDER_VICTORY" | "DRAW",
  state: Awaited<ReturnType<typeof getBattleState>>
): Promise<void> {
  if (!state) return;

  let spoils = { fuel: 0, steel: 0, rations: 0, credits: 0 };

  if (outcome === "ATTACKER_VICTORY") {
    // Transfer zone ownership
    await prisma.zone.update({
      where: { id: zoneId },
      data: {
        ownerPlayerId: state.attackerPlayerId,
        capturedAt: new Date(),
        fortificationLevel: 0, // reset fortification on capture
        consolidationEndsAt: new Date(Date.now() + 3_600_000),
      },
    });

    // Steal 20% of defender's resources
    const defender = state.defenderPlayerId
      ? await prisma.player.findUnique({ where: { id: state.defenderPlayerId } })
      : null;
    if (defender) {
      spoils = {
        fuel:    Math.floor(defender.fuel * 0.2),
        steel:   Math.floor(defender.steel * 0.2),
        rations: Math.floor(defender.rations * 0.2),
        credits: Math.floor(defender.credits * 0.1),
      };
      await prisma.player.update({
        where: { id: defender.id },
        data: {
          fuel:    { decrement: spoils.fuel },
          steel:   { decrement: spoils.steel },
          rations: { decrement: spoils.rations },
          credits: { decrement: spoils.credits },
        },
      });
      await prisma.player.update({
        where: { id: state.attackerPlayerId },
        data: {
          fuel:    { increment: spoils.fuel },
          steel:   { increment: spoils.steel },
          rations: { increment: spoils.rations },
          credits: { increment: spoils.credits },
        },
      });
    }
  }

  await prisma.battle.update({
    where: { id: battleId },
    data: {
      outcome,
      resolvedAt:    new Date(),
      zoneCaptured:  outcome === "ATTACKER_VICTORY",
      fuelSpoils:    spoils.fuel,
      steelSpoils:   spoils.steel,
      rationsSpoils: spoils.rations,
      creditsSpoils: spoils.credits,
    },
  });

  await setBattleState({ ...state, status: "RESOLVED" });

  await publishZoneEvent(zoneId, "BATTLE_RESOLVED", { battleId, outcome, spoils });
  await publishPlayerEvent(state.attackerPlayerId, "BATTLE_RESOLVED", { battleId, outcome, spoils });
  if (state.defenderPlayerId) {
    await publishPlayerEvent(state.defenderPlayerId, "BATTLE_RESOLVED", { battleId, outcome });
  }
}

// ─────────────────────────────────────────────
// Build Completions
// ─────────────────────────────────────────────

export async function processBuildCompletions(now: number): Promise<void> {
  const due = await dequeueDueBuilds(now);
  for (const entry of due) {
    await handleBuildComplete(entry);
  }

  // Recovery: catch buildings whose Redis entry was lost (e.g. server restart)
  // but are still marked isUpgrading in the DB with a past upgradeEndsAt.
  const orphans = await prisma.building.findMany({
    where: { isUpgrading: true, upgradeEndsAt: { lte: new Date(now) } },
    select: { id: true, buildingType: true, level: true, fob: { select: { playerId: true, id: true } } },
  });
  for (const b of orphans) {
    await handleBuildComplete({
      buildingId:   b.id,
      fobId:        b.fob.id,
      playerId:     b.fob.playerId,
      buildingType: b.buildingType,
      newLevel:     b.level + 1,
      completesAt:  now,
    });
  }
}

async function handleBuildComplete(entry: BuildQueueEntry): Promise<void> {
  await prisma.building.update({
    where: { id: entry.buildingId },
    data: { level: entry.newLevel, isUpgrading: false, upgradeEndsAt: null },
  });

  // If Command Center upgraded → raise player's CP ceiling
  if (entry.buildingType === "COMMAND_CENTER") {
    const newMaxCP = entry.newLevel * 10; // 10 CP per CC level
    await prisma.player.update({
      where: { id: entry.playerId },
      data: { maxCommandPoints: newMaxCP },
    });
  }

  // Recalculate net resource flow so the new building level is reflected
  // in the player's displayed rates (e.g. Hydro Bay rations production).
  await recalculateNetFlow(entry.playerId);

  await publishPlayerEvent(entry.playerId, "BUILDING_UPGRADE_COMPLETED", {
    buildingId:   entry.buildingId,
    buildingType: entry.buildingType,
    newLevel:     entry.newLevel,
    message:      `${entry.buildingType.replace(/_/g, " ")} upgraded to Level ${entry.newLevel}`,
  });
}

// ─────────────────────────────────────────────
// Resource Production Tick (every 60 seconds)
// ─────────────────────────────────────────────

let lastResourceTick = Date.now();
const RESOURCE_TICK_MS = 60_000;

export async function processResourceTick(): Promise<void> {
  const now = Date.now();
  if (now - lastResourceTick < RESOURCE_TICK_MS) return;
  lastResourceTick = now;

  // Aggregate production per player from owned zones
  const zones = await prisma.zone.findMany({
    where: { ownerPlayerId: { not: null } },
    select: {
      ownerPlayerId: true,
      fuelPerHour:   true,
      rationsPerHour: true,
      steelPerHour:  true,
      creditsPerHour: true,
    },
  });

  const totals: Record<string, { fuel: number; rations: number; steel: number; credits: number }> = {};

  for (const z of zones) {
    if (!z.ownerPlayerId) continue;
    if (!totals[z.ownerPlayerId]) {
      totals[z.ownerPlayerId] = { fuel: 0, rations: 0, steel: 0, credits: 0 };
    }
    // Convert per-hour to per-tick (60s = 1/60th of an hour)
    const t = totals[z.ownerPlayerId]!;
    t.fuel    += Math.floor(z.fuelPerHour / 60);
    t.rations += Math.floor(z.rationsPerHour / 60);
    t.steel   += Math.floor(z.steelPerHour / 60);
    t.credits += Math.floor(z.creditsPerHour / 60);
  }

  // Apply rations upkeep (subtract army cost)
  const allUnits = await prisma.unit.findMany({
    where: { status: { not: "TRAINING" } },
    select: { ownerId: true, unitType: true, quantity: true },
  });
  for (const u of (allUnits as Array<{ ownerId: string; unitType: UnitType; quantity: number }>)) {
    if (!totals[u.ownerId]) totals[u.ownerId] = { fuel: 0, rations: 0, steel: 0, credits: 0 };
    const upkeep = UNIT_STATS[u.unitType]!.rationsUpkeepPerHr;
    totals[u.ownerId]!.rations -= Math.floor((upkeep * u.quantity) / 60);
  }

  // Batch update all players
  await Promise.all(
    Object.entries(totals).map(([playerId, delta]) =>
      prisma.player.update({
        where: { id: playerId },
        data: {
          fuel:    { increment: delta.fuel },
          rations: { increment: delta.rations },
          steel:   { increment: delta.steel },
          credits: { increment: delta.credits },
        },
      })
    )
  );
}

// ─────────────────────────────────────────────
// Training Completions
// ─────────────────────────────────────────────

export async function processDueTrainings(now: number): Promise<void> {
  const due = await dequeueDueTrains(now);
  for (const entry of due) {
    await handleTrainingComplete(entry);
  }

  // Recovery: units stuck in TRAINING with a past trainingEndsAt
  const orphans = await prisma.unit.findMany({
    where: { status: "TRAINING", trainingEndsAt: { lte: new Date(now) } },
    select: { id: true, ownerId: true, unitType: true, quantity: true },
  });
  for (const u of orphans) {
    await handleTrainingComplete({
      unitId:      u.id,
      playerId:    u.ownerId,
      unitType:    u.unitType,
      quantity:    u.quantity,
      completesAt: now,
    });
  }
}

async function handleTrainingComplete(entry: TrainQueueEntry): Promise<void> {
  // DB update is always first and isolated — a Redis failure must never leave
  // the unit stuck in TRAINING status.
  await prisma.unit.update({
    where: { id: entry.unitId },
    data:  { status: "IDLE", trainingEndsAt: null },
  });

  // CP and pub/sub are best-effort — log failures but don't re-throw
  try {
    const cpCost = UNIT_STATS[entry.unitType as UnitType]?.commandPointsCost ?? 0;
    if (cpCost > 0) {
      await adjustCommandPoints(entry.playerId, cpCost * entry.quantity);
    }
  } catch (err) {
    console.error(`[timer] adjustCommandPoints failed for unit ${entry.unitId}:`, err);
  }

  try {
    await publishPlayerEvent(entry.playerId, "UNIT_TRAINED", {
      unitType: entry.unitType,
      quantity: entry.quantity,
      message:  `${entry.quantity}× ${UNIT_STATS[entry.unitType as UnitType]?.displayName ?? entry.unitType} training complete`,
    });
  } catch (err) {
    console.error(`[timer] publishPlayerEvent failed for unit ${entry.unitId}:`, err);
  }
}
