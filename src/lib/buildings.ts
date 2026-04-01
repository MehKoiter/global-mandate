// =============================================================
// Global Mandate — Building Upgrade Tables
// Cost and time progression for all upgradeable building types.
//
// Formula:
//   cost(level)      = baseCost × 1.5^(level - 1)   (rounded to nearest 50)
//   buildTime(level) = 15min × 1.25^(level - 2)     (level 2 = 15 min baseline)
// =============================================================

import { BuildingType } from "@prisma/client";

// ─── Types ─────────────────────────────────────────────────────

export interface UpgradeCost {
  steelCost:          number;
  creditCost:         number;
  buildTimeMinutes:   number;
}

interface BuildingConfig {
  baseSteel:   number;
  baseCredits: number;
  maxLevel:    number;
}

// ─── Per-building base config ──────────────────────────────────

const BUILDING_CONFIG: Partial<Record<BuildingType, BuildingConfig>> = {
  COMM_CENTER:    { baseSteel: 200,  baseCredits: 400,  maxLevel: 10 },
  COMMAND_CENTER: { baseSteel: 500,  baseCredits: 800,  maxLevel: 10 },
  HYDRO_BAY:      { baseSteel: 150,  baseCredits: 300,  maxLevel: 10 },
  WAREHOUSE:      { baseSteel: 100,  baseCredits: 200,  maxLevel: 10 },
  // Barracks: each level unlocks one additional concurrent training slot
  BARRACKS:       { baseSteel: 300,  baseCredits: 500,  maxLevel: 10 },
};

// ─── Helpers ───────────────────────────────────────────────────

function round50(n: number): number {
  return Math.round(n / 50) * 50;
}

// level 2 = 15 min, each subsequent level ×1.25, rounded to whole minutes
// TEST_FAST_BUILD: set TEST_FAST_BUILD=true in .env to use 10-second build times
const TEST_FAST_BUILD = process.env["TEST_FAST_BUILD"] === "true";

function buildTimeMinutes(level: number): number {
  if (level <= 1) return 0; // level 1 is placed instantly (starter building)
  if (TEST_FAST_BUILD) return 1 / 6; // ~10 seconds
  return Math.round(15 * Math.pow(1.25, level - 2));
}

// ─── Building passive production ──────────────────────────────
// Returns the rations produced per hour by a building at a given level.
// Add other buildings here as their production is defined.
export function getBuildingRationsProduction(buildingType: BuildingType, level: number): number {
  if (buildingType === BuildingType.HYDRO_BAY) {
    return 5 * level; // 5/hr at Lvl 1, 50/hr at Lvl 10
  }
  return 0;
}

// ─── Barracks unit unlock levels ──────────────────────────────
// Maps unitType → minimum Barracks level required to train it.
// Unlocked at level 1 by default (no entry needed).
export const BARRACKS_UNIT_UNLOCK: Partial<Record<string, number>> = {
  SPECIAL_FORCES: 2,
  RANGERS:        5,
  MARSOC_ATGM:    10,
};

// Time to construct a brand-new building from scratch (level 0 → 1)
export function getConstructionTimeMinutes(): number {
  return TEST_FAST_BUILD ? 1 / 6 : 15; // 10 seconds in test, 15 min in prod
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Returns the cost to upgrade FROM currentLevel TO currentLevel+1,
 * or null if the building is already at max level.
 */
export function getBuildingUpgradeCost(
  buildingType: BuildingType,
  currentLevel: number,
): UpgradeCost | null {
  const config = BUILDING_CONFIG[buildingType];
  if (!config) return null;
  if (currentLevel >= config.maxLevel) return null;

  const targetLevel = currentLevel + 1;
  const multiplier  = Math.pow(1.5, currentLevel); // currentLevel = targetLevel - 1

  return {
    steelCost:        round50(config.baseSteel   * multiplier),
    creditCost:       round50(config.baseCredits * multiplier),
    buildTimeMinutes: buildTimeMinutes(targetLevel),
  };
}

/**
 * Returns the maximum upgrade level for a given building type,
 * or null if the building type has no upgrade progression defined.
 */
export function getBuildingMaxLevel(buildingType: BuildingType): number | null {
  return BUILDING_CONFIG[buildingType]?.maxLevel ?? null;
}

// ─── Pre-computed tables (exported for UI display) ─────────────

export type LevelRow = UpgradeCost & { level: number };

/**
 * Returns the full upgrade table for a building type (levels 1→maxLevel),
 * where each row is the cost to reach that level from the previous one.
 */
export function getBuildingUpgradeTable(buildingType: BuildingType): LevelRow[] {
  const config = BUILDING_CONFIG[buildingType];
  if (!config) return [];

  const rows: LevelRow[] = [];
  for (let lvl = 1; lvl < config.maxLevel; lvl++) {
    const cost = getBuildingUpgradeCost(buildingType, lvl);
    if (cost) rows.push({ level: lvl + 1, ...cost });
  }
  return rows;
}
