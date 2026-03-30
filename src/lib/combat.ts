// =============================================================
// Modern Combat 4X — Unit Stats & Combat Engine
// =============================================================

// ─────────────────────────────────────────────
// Unit stat definitions
// Single source of truth — imported by training service,
// combat service, and the client-side unit card renderer.
// ─────────────────────────────────────────────

export type UnitType =
  | "INFANTRY_GRUNT"
  | "SPECIAL_FORCES"
  | "RANGERS"
  | "MARSOC_ATGM"
  | "APC"
  | "IFV"
  | "LIGHT_TANK"
  | "MAIN_BATTLE_TANK"
  | "HEAVY_ASSAULT"
  | "TRANSPORT_HELICOPTER"
  | "ATTACK_HELICOPTER"
  | "FIGHTER_JET"
  | "STEALTH_BOMBER";

export interface UnitStat {
  displayName:        string;
  tier:               1 | 2 | 3;
  commandPointsCost:  number;
  baseAttack:         number;
  baseDefense:        number;
  speedKmh:           number;
  fuelPerKm:          number;        // 0 for foot infantry
  rationsUpkeepPerHr: number;
  trainingTimeSec:    number;
  trainingCost:       { fuel: number; rations: number; steel: number; credits: number };
  strongAgainst:      UnitType[];
  weakAgainst:        UnitType[];
  // Multipliers applied when this unit fights its counters
  counterBonusMultiplier:   number; // applied to this unit's attack vs strongAgainst
  counterPenaltyMultiplier: number; // applied to this unit's attack vs weakAgainst
  canBypassWalls:     boolean;      // true for air units (Transport Heli insertion)
  requiresAirfield:   boolean;
}

export const UNIT_STATS: Record<UnitType, UnitStat> = {
  INFANTRY_GRUNT: {
    displayName: "Infantry squad",
    tier: 1,
    commandPointsCost: 1,
    baseAttack: 30,
    baseDefense: 25,
    speedKmh: 5,
    fuelPerKm: 0,
    rationsUpkeepPerHr: 1,
    trainingTimeSec: 300,
    trainingCost: { fuel: 0, rations: 20, steel: 0, credits: 50 },
    strongAgainst: ["APC"],
    weakAgainst: ["IFV", "LIGHT_TANK", "MAIN_BATTLE_TANK", "HEAVY_ASSAULT"],
    counterBonusMultiplier: 1.3,
    counterPenaltyMultiplier: 0.6,
    canBypassWalls: false,
    requiresAirfield: false,
  },
  SPECIAL_FORCES: {
    displayName: "Special Forces",
    tier: 2,
    commandPointsCost: 3,
    baseAttack: 60,
    baseDefense: 40,
    speedKmh: 8,
    fuelPerKm: 0,
    rationsUpkeepPerHr: 2,
    trainingTimeSec: 1800,
    trainingCost: { fuel: 0, rations: 60, steel: 20, credits: 200 },
    strongAgainst: ["INFANTRY_GRUNT", "APC"],
    weakAgainst: ["MAIN_BATTLE_TANK", "HEAVY_ASSAULT"],
    counterBonusMultiplier: 1.4,
    counterPenaltyMultiplier: 0.5,
    canBypassWalls: false,
    requiresAirfield: false,
  },
  RANGERS: {
    displayName: "Army Rangers",
    tier: 2,
    commandPointsCost: 4,
    baseAttack: 75,
    baseDefense: 50,
    speedKmh: 10,
    fuelPerKm: 0,
    rationsUpkeepPerHr: 2,
    trainingTimeSec: 2700,
    trainingCost: { fuel: 0, rations: 80, steel: 30, credits: 300 },
    strongAgainst: ["INFANTRY_GRUNT", "SPECIAL_FORCES", "APC"],
    weakAgainst: ["MAIN_BATTLE_TANK", "ATTACK_HELICOPTER"],
    counterBonusMultiplier: 1.35,
    counterPenaltyMultiplier: 0.55,
    canBypassWalls: false,
    requiresAirfield: false,
  },
  MARSOC_ATGM: {
    displayName: "MARSOC + ATGM team",
    tier: 3,
    commandPointsCost: 5,
    baseAttack: 100,
    baseDefense: 45,
    speedKmh: 8,
    fuelPerKm: 0,
    rationsUpkeepPerHr: 3,
    trainingTimeSec: 3600,
    trainingCost: { fuel: 20, rations: 100, steel: 60, credits: 500 },
    strongAgainst: ["APC", "IFV", "LIGHT_TANK", "MAIN_BATTLE_TANK", "HEAVY_ASSAULT"],
    weakAgainst: ["INFANTRY_GRUNT", "SPECIAL_FORCES", "RANGERS"],
    counterBonusMultiplier: 1.8,
    counterPenaltyMultiplier: 0.4,
    canBypassWalls: false,
    requiresAirfield: false,
  },
  APC: {
    displayName: "Armored Personnel Carrier",
    tier: 1,
    commandPointsCost: 3,
    baseAttack: 55,
    baseDefense: 50,
    speedKmh: 70,
    fuelPerKm: 1.2,
    rationsUpkeepPerHr: 0,
    trainingTimeSec: 900,
    trainingCost: { fuel: 40, rations: 0, steel: 80, credits: 200 },
    strongAgainst: ["INFANTRY_GRUNT", "SPECIAL_FORCES"],
    weakAgainst: ["MARSOC_ATGM", "ATTACK_HELICOPTER"],
    counterBonusMultiplier: 1.5,
    counterPenaltyMultiplier: 0.5,
    canBypassWalls: false,
    requiresAirfield: false,
  },
  IFV: {
    displayName: "Infantry Fighting Vehicle",
    tier: 2,
    commandPointsCost: 4,
    baseAttack: 80,
    baseDefense: 75,
    speedKmh: 65,
    fuelPerKm: 1.5,
    rationsUpkeepPerHr: 0,
    trainingTimeSec: 1800,
    trainingCost: { fuel: 60, rations: 0, steel: 120, credits: 400 },
    strongAgainst: ["INFANTRY_GRUNT", "SPECIAL_FORCES", "RANGERS", "APC"],
    weakAgainst: ["MARSOC_ATGM", "LIGHT_TANK", "MAIN_BATTLE_TANK", "ATTACK_HELICOPTER"],
    counterBonusMultiplier: 1.4,
    counterPenaltyMultiplier: 0.55,
    canBypassWalls: false,
    requiresAirfield: false,
  },
  LIGHT_TANK: {
    displayName: "Light tank",
    tier: 2,
    commandPointsCost: 5,
    baseAttack: 110,
    baseDefense: 100,
    speedKmh: 60,
    fuelPerKm: 2.0,
    rationsUpkeepPerHr: 0,
    trainingTimeSec: 2700,
    trainingCost: { fuel: 80, rations: 0, steel: 180, credits: 600 },
    strongAgainst: ["APC", "IFV", "INFANTRY_GRUNT"],
    weakAgainst: ["MARSOC_ATGM", "MAIN_BATTLE_TANK", "ATTACK_HELICOPTER"],
    counterBonusMultiplier: 1.3,
    counterPenaltyMultiplier: 0.6,
    canBypassWalls: false,
    requiresAirfield: false,
  },
  MAIN_BATTLE_TANK: {
    displayName: "M1A2 Abrams (MBT)",
    tier: 3,
    commandPointsCost: 8,
    baseAttack: 220,
    baseDefense: 180,
    speedKmh: 45,
    fuelPerKm: 2.4,
    rationsUpkeepPerHr: 0,
    trainingTimeSec: 5400,
    trainingCost: { fuel: 160, rations: 0, steel: 350, credits: 1200 },
    strongAgainst: ["APC", "IFV", "LIGHT_TANK", "INFANTRY_GRUNT"],
    weakAgainst: ["MARSOC_ATGM", "ATTACK_HELICOPTER"],
    counterBonusMultiplier: 1.5,
    counterPenaltyMultiplier: 0.35,
    canBypassWalls: false,
    requiresAirfield: false,
  },
  HEAVY_ASSAULT: {
    displayName: "Heavy assault platform",
    tier: 3,
    commandPointsCost: 12,
    baseAttack: 320,
    baseDefense: 280,
    speedKmh: 30,
    fuelPerKm: 3.5,
    rationsUpkeepPerHr: 0,
    trainingTimeSec: 10800,
    trainingCost: { fuel: 300, rations: 0, steel: 600, credits: 2500 },
    strongAgainst: ["APC", "IFV", "LIGHT_TANK", "MAIN_BATTLE_TANK", "INFANTRY_GRUNT"],
    weakAgainst: ["MARSOC_ATGM", "ATTACK_HELICOPTER", "STEALTH_BOMBER"],
    counterBonusMultiplier: 1.4,
    counterPenaltyMultiplier: 0.3,
    canBypassWalls: false,
    requiresAirfield: false,
  },
  TRANSPORT_HELICOPTER: {
    displayName: "Transport helicopter",
    tier: 2,
    commandPointsCost: 4,
    baseAttack: 0,    // non-combat — carries infantry over walls
    baseDefense: 30,
    speedKmh: 260,
    fuelPerKm: 3.0,
    rationsUpkeepPerHr: 0,
    trainingTimeSec: 3600,
    trainingCost: { fuel: 200, rations: 0, steel: 150, credits: 800 },
    strongAgainst: [],
    weakAgainst: ["FIGHTER_JET"],
    counterBonusMultiplier: 1.0,
    counterPenaltyMultiplier: 0.2,
    canBypassWalls: true,
    requiresAirfield: true,
  },
  ATTACK_HELICOPTER: {
    displayName: "AH-64 Apache",
    tier: 3,
    commandPointsCost: 10,
    baseAttack: 240,
    baseDefense: 80,
    speedKmh: 270,
    fuelPerKm: 4.0,
    rationsUpkeepPerHr: 0,
    trainingTimeSec: 7200,
    trainingCost: { fuel: 300, rations: 0, steel: 200, credits: 1800 },
    strongAgainst: ["MAIN_BATTLE_TANK", "HEAVY_ASSAULT", "IFV", "LIGHT_TANK", "APC"],
    weakAgainst: ["FIGHTER_JET"],
    counterBonusMultiplier: 1.7,
    counterPenaltyMultiplier: 0.25,
    canBypassWalls: true,
    requiresAirfield: true,
  },
  FIGHTER_JET: {
    displayName: "F-35 multi-role jet",
    tier: 3,
    commandPointsCost: 15,
    baseAttack: 280,
    baseDefense: 100,
    speedKmh: 1800,
    fuelPerKm: 8.0,
    rationsUpkeepPerHr: 0,
    trainingTimeSec: 14400,
    trainingCost: { fuel: 600, rations: 0, steel: 400, credits: 4000 },
    strongAgainst: ["ATTACK_HELICOPTER", "TRANSPORT_HELICOPTER"],
    weakAgainst: [],
    counterBonusMultiplier: 2.0,
    counterPenaltyMultiplier: 1.0,
    canBypassWalls: true,
    requiresAirfield: true,
  },
  STEALTH_BOMBER: {
    displayName: "B-21 Raider (stealth bomber)",
    tier: 3,
    commandPointsCost: 25,
    baseAttack: 500,
    baseDefense: 60,
    speedKmh: 900,
    fuelPerKm: 12.0,
    rationsUpkeepPerHr: 0,
    trainingTimeSec: 86400, // 24 hours
    trainingCost: { fuel: 800, rations: 0, steel: 800, credits: 10000 },
    strongAgainst: ["HEAVY_ASSAULT", "MAIN_BATTLE_TANK", "INFANTRY_GRUNT"],
    weakAgainst: [],
    counterBonusMultiplier: 1.5,
    counterPenaltyMultiplier: 1.0,
    canBypassWalls: true,
    requiresAirfield: true,
  },
};

// ─────────────────────────────────────────────
// Combat Engine
// ─────────────────────────────────────────────

export interface CombatUnit {
  unitType:  UnitType;
  quantity:  number;
  healthPct: number;
  morale:    number; // 0.5 – 1.0
}

export interface ZoneDefense {
  fortificationLevel: number; // 0–10 → adds level × 15 flat defense
  wallBonus:          number; // additional flat bonus
  hasAABattery:       boolean; // reduces air attack by 35%
}

export interface RoundResult {
  attackerDamageDealt: number;
  defenderDamageDealt: number;
  attackerLosses:      Partial<Record<UnitType, number>>;
  defenderLosses:      Partial<Record<UnitType, number>>;
  attackerMoraleEnd:   number;
  defenderMoraleEnd:   number;
}

/** Compute total effective attack power for a force */
function calcTotalAttack(
  attackers: CombatUnit[],
  defenders: CombatUnit[],
  researchBonuses: Partial<Record<string, boolean>> = {}
): number {
  let total = 0;
  for (const atk of attackers) {
    const stats = UNIT_STATS[atk.unitType];
    for (const def of defenders) {
      const isStrong = stats.strongAgainst.includes(def.unitType);
      const isWeak   = stats.weakAgainst.includes(def.unitType);
      const counterMult = isStrong
        ? stats.counterBonusMultiplier
        : isWeak
        ? stats.counterPenaltyMultiplier
        : 1.0;

      const compositeBonus =
        researchBonuses["COMPOSITE_ARMOR"] &&
        ["MAIN_BATTLE_TANK", "HEAVY_ASSAULT", "LIGHT_TANK"].includes(atk.unitType)
          ? 1.2
          : 1.0;

      total +=
        stats.baseAttack *
        atk.quantity *
        (atk.healthPct / 100) *
        atk.morale *
        counterMult *
        compositeBonus;
    }
  }
  return Math.round(total / Math.max(defenders.length, 1));
}

/** Compute total effective defense power for a force + zone */
function calcTotalDefense(
  defenders: CombatUnit[],
  zone: ZoneDefense,
  attackers: CombatUnit[]
): number {
  let unitDefense = defenders.reduce((sum, u) => {
    const stats = UNIT_STATS[u.unitType];
    return sum + stats.baseDefense * u.quantity * (u.healthPct / 100) * u.morale;
  }, 0);

  const fortBonus = zone.fortificationLevel * 15;
  const wallBonus = zone.wallBonus;

  // AA battery reduces air attack power (applied before damage calc)
  const hasAirAttack = attackers.some(u => UNIT_STATS[u.unitType].requiresAirfield);
  const aaBuff = zone.hasAABattery && hasAirAttack ? 50 : 0;

  return Math.round(unitDefense + fortBonus + wallBonus + aaBuff);
}

/** Apply casualties to a force. Max 30% of units can be lost per round. */
function applyCasualties(
  force: CombatUnit[],
  damageTaken: number,
  totalDefense: number
): { updatedForce: CombatUnit[]; losses: Partial<Record<UnitType, number>> } {
  const losses: Partial<Record<UnitType, number>> = {};
  const ratio = Math.min(damageTaken / Math.max(totalDefense, 1), 0.30);

  const updated = force.map((unit) => {
    const killed = Math.floor(unit.quantity * ratio);
    if (killed > 0) losses[unit.unitType] = (losses[unit.unitType] ?? 0) + killed;
    return { ...unit, quantity: unit.quantity - killed };
  }).filter((u) => u.quantity > 0);

  return { updatedForce: updated, losses };
}

/** Degrade morale by 0.05 for each round with losses, floor 0.5 */
function degradeMorale(force: CombatUnit[], hadLosses: boolean): CombatUnit[] {
  if (!hadLosses) return force;
  return force.map((u) => ({ ...u, morale: Math.max(0.5, u.morale - 0.05) }));
}

/**
 * Resolve a single battle round.
 * Both sides deal damage simultaneously before casualties are applied.
 */
export function resolveBattleRound(params: {
  attackers:         CombatUnit[];
  defenders:         CombatUnit[];
  zone:              ZoneDefense;
  attackerResearch?: Partial<Record<string, boolean>>;
  defenderResearch?: Partial<Record<string, boolean>>;
}): {
  round:              RoundResult;
  updatedAttackers:   CombatUnit[];
  updatedDefenders:   CombatUnit[];
  battleOver:         boolean;
  attackerWins:       boolean;
} {
  const { attackers, defenders, zone, attackerResearch = {}, defenderResearch = {} } = params;

  const atkPower  = calcTotalAttack(attackers, defenders, attackerResearch);
  const defPower  = calcTotalDefense(defenders, zone, attackers);
  const atkDefPow = calcTotalAttack(defenders, attackers, defenderResearch);
  const atkAtkDef = calcTotalDefense(attackers, { fortificationLevel: 0, wallBonus: 0, hasAABattery: false }, defenders);

  const damageToDefenders = Math.round((atkPower / Math.max(defPower, 1)) * 100);
  const damageToAttackers = Math.round((atkDefPow / Math.max(atkAtkDef, 1)) * 100);

  const { updatedForce: newDef, losses: defLosses } = applyCasualties(defenders, damageToDefenders, defPower);
  const { updatedForce: newAtk, losses: atkLosses } = applyCasualties(attackers, damageToAttackers, atkAtkDef);

  const finalAtk = degradeMorale(newAtk, Object.keys(atkLosses).length > 0);
  const finalDef = degradeMorale(newDef, Object.keys(defLosses).length > 0);

  const atkMorale = finalAtk.length > 0 ? finalAtk[0].morale : 0;
  const defMorale = finalDef.length > 0 ? finalDef[0].morale : 0;

  const attackerWins = finalDef.length === 0;
  const defenderWins = finalAtk.length === 0;

  return {
    round: {
      attackerDamageDealt: damageToDefenders,
      defenderDamageDealt: damageToAttackers,
      attackerLosses:      atkLosses,
      defenderLosses:      defLosses,
      attackerMoraleEnd:   atkMorale,
      defenderMoraleEnd:   defMorale,
    },
    updatedAttackers: finalAtk,
    updatedDefenders: finalDef,
    battleOver:  attackerWins || defenderWins,
    attackerWins: attackerWins && !defenderWins,
  };
}

// ─────────────────────────────────────────────
// Travel Time Calculator
// ─────────────────────────────────────────────

const SECTOR_DISTANCE_KM = 80; // approximate km per sector crossing

export function calcTravelTimeMs(
  unitType: UnitType,
  distanceKm: number,
  hasRoad: boolean,
  bridgeDestroyed: boolean
): number {
  const stats = UNIT_STATS[unitType];
  let speed = stats.speedKmh;

  // Air units ignore roads and bridges
  if (stats.requiresAirfield || unitType === "TRANSPORT_HELICOPTER") {
    return Math.round((distanceKm / speed) * 3600 * 1000);
  }

  // Road bonus for ground units
  if (hasRoad) speed *= 1.4;

  // Destroyed bridge forces a 60km detour
  const effectiveDistance = bridgeDestroyed ? distanceKm + 60 : distanceKm;

  return Math.round((effectiveDistance / speed) * 3600 * 1000);
}

export function calcFuelCost(unitType: UnitType, distanceKm: number): number {
  const stats = UNIT_STATS[unitType];
  return Math.ceil(stats.fuelPerKm * distanceKm);
}
