// =============================================================
// Global Mandate — Master Timer Service
// Integrates: combat, alliance, diplomacy, season
// =============================================================

import { processDueArrivals, processBuildCompletions, processBattleRounds, processResourceTick }
  from "./timer-service.js";
import { processDueCoordinatedAttacks } from "./alliance.js";
import { processDueTributes, processDueEspionageOps } from "./diplomacy.js";
import {
  checkVictoryCondition,
  checkVictoryCountdownExpiry,
  updateControlCache,
  getCurrentSeason,
  startNewSeason,
} from "./season.js";
import { redis } from "../lib/redis.js";

const FAST_TICK_MS   = 5_000;   // every 5s: arrivals, battles, builds
const MEDIUM_TICK_MS = 15_000;  // every 15s: coord attacks, espionage, tribute
const SLOW_TICK_MS   = 60_000;  // every 60s: victory check, control cache, resource tick

async function fastTick(): Promise<void> {
  const now = Date.now();
  await Promise.allSettled([
    processDueArrivals(now),
    processBattleRounds(now),
    processBuildCompletions(now),
  ]);
}

async function mediumTick(): Promise<void> {
  const now = Date.now();
  await Promise.allSettled([
    processDueCoordinatedAttacks(now),
    processDueTributes(now),
    processDueEspionageOps(now),
  ]);
}

async function slowTick(): Promise<void> {
  const season = await getCurrentSeason();
  if (!season) {
    await startNewSeason("Season 1 — First Strike");
    return;
  }
  await Promise.allSettled([
    checkVictoryCondition(),
    checkVictoryCountdownExpiry(),
    updateControlCache(season.seasonId),
    processResourceTick(),
  ]);
}

async function main(): Promise<void> {
  // Ensure a season is running
  const season = await getCurrentSeason();
  if (!season) {
    console.log("No active season found — starting Season 1");
    await startNewSeason("Season 1 — First Strike");
  }

  console.log("Master timer service started");
  setInterval(() => fastTick().catch(console.error),   FAST_TICK_MS);
  setInterval(() => mediumTick().catch(console.error), MEDIUM_TICK_MS);
  setInterval(() => slowTick().catch(console.error),   SLOW_TICK_MS);
}

main().catch(console.error);
