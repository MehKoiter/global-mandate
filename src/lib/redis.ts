// =============================================================
// Global Mandate — Redis Utilities
// Covers: Travel Queue, Build Queue, Battle Timers, Resource Ticks
// Uses: ioredis
// =============================================================

import { Redis } from "ioredis";

export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

// ─────────────────────────────────────────────
// Key namespacing
// Consistent prefixes prevent collisions between services
// ─────────────────────────────────────────────

export const Keys = {
  // Sorted sets — score = Unix timestamp (ms) of event
  travelQueue:    "queue:travel",       // movement arrivals
  buildQueue:     "queue:build",        // building upgrade completions
  trainQueue:     "queue:train",        // unit training completions
  battleRounds:   "queue:battle",       // next battle round triggers

  // Hashes — live ephemeral state (not persisted to PG)
  movement:       (id: string) => `movement:${id}`,
  battleState:    (id: string) => `battle:${id}`,
  playerCP:       (id: string) => `cp:${id}`,          // used/max CP fast read
  resourceCache:  (id: string) => `resources:${id}`,   // cached balances

  // Pub/Sub channels
  zoneEvents:     (zoneId: string) => `zone:${zoneId}:events`,
  playerEvents:   (playerId: string) => `player:${playerId}:events`,
};

// ─────────────────────────────────────────────
// Travel Queue
// Arrivals are stored in a sorted set scored by arrival timestamp.
// The timer service polls every 5 seconds and processes due arrivals.
// ─────────────────────────────────────────────

export interface TravelQueueEntry {
  movementId:       string;
  unitId:           string;
  ownerId:          string;
  originZoneId:     string;
  destinationZoneId: string;
  arrivalAt:        number; // Unix ms
}

/** Schedule a unit's arrival. Called when movement is created. */
export async function enqueueTravelArrival(entry: TravelQueueEntry): Promise<void> {
  await redis.zadd(
    Keys.travelQueue,
    entry.arrivalAt,
    JSON.stringify(entry)
  );

  // Store full movement state in a hash for fast lookup by movementId
  await redis.hset(Keys.movement(entry.movementId), {
    unitId:            entry.unitId,
    ownerId:           entry.ownerId,
    originZoneId:      entry.originZoneId,
    destinationZoneId: entry.destinationZoneId,
    arrivalAt:         entry.arrivalAt,
    cancelled:         "false",
  });
}

/** Cancel a movement (player recalled units). Marks hash + removes from queue. */
export async function cancelTravelArrival(movementId: string, unitId: string): Promise<void> {
  await redis.hset(Keys.movement(movementId), "cancelled", "true");

  // Remove from sorted set by scanning for entries matching this movementId
  // More efficient: store the raw member string on enqueue so we can ZREM directly
  const members = await redis.zrangebyscore(Keys.travelQueue, "-inf", "+inf");
  for (const member of members) {
    const entry: TravelQueueEntry = JSON.parse(member);
    if (entry.movementId === movementId) {
      await redis.zrem(Keys.travelQueue, member);
      break;
    }
  }
}

/**
 * Dequeue all arrivals due by `now`.
 * Called by the timer service on a 5-second interval.
 * Uses ZRANGEBYSCORE + ZREMRANGEBYSCORE in a pipeline for atomicity.
 */
export async function dequeueDueArrivals(now: number): Promise<TravelQueueEntry[]> {
  const pipeline = redis.pipeline();
  pipeline.zrangebyscore(Keys.travelQueue, "-inf", now);
  pipeline.zremrangebyscore(Keys.travelQueue, "-inf", now);
  const results = await pipeline.exec();

  if (!results || !results[0] || results[0][0]) return [];
  const members = results[0][1] as string[];
  return members.map((m) => JSON.parse(m) as TravelQueueEntry);
}

// ─────────────────────────────────────────────
// Build Queue
// Same sorted-set pattern as travel, scored by completion timestamp.
// ─────────────────────────────────────────────

export interface BuildQueueEntry {
  buildingId:   string;
  fobId:        string;
  playerId:     string;
  buildingType: string;
  newLevel:     number;
  completesAt:  number; // Unix ms
}

export async function enqueueBuildCompletion(entry: BuildQueueEntry): Promise<void> {
  await redis.zadd(Keys.buildQueue, entry.completesAt, JSON.stringify(entry));
}

export async function dequeueDueBuilds(now: number): Promise<BuildQueueEntry[]> {
  const pipeline = redis.pipeline();
  pipeline.zrangebyscore(Keys.buildQueue, "-inf", now);
  pipeline.zremrangebyscore(Keys.buildQueue, "-inf", now);
  const results = await pipeline.exec();
  if (!results || !results[0] || results[0][0]) return [];
  return (results[0][1] as string[]).map((m) => JSON.parse(m) as BuildQueueEntry);
}

// ─────────────────────────────────────────────
// Battle State (live round tracking)
// Each active battle has a hash in Redis for the current combat state.
// Rounds resolve every 5 real-world minutes (300,000ms).
// ─────────────────────────────────────────────

export interface BattleStateCache {
  battleId:            string;
  zoneId:              string;
  attackerPlayerId:    string;
  defenderPlayerId:    string | null;
  currentRound:        number;
  maxRounds:           number;  // always 12
  attackerMorale:      number;
  defenderMorale:      number;
  nextRoundAt:         number;  // Unix ms
  status:              "ACTIVE" | "RESOLVED";
}

export async function setBattleState(state: BattleStateCache): Promise<void> {
  await redis.hset(Keys.battleState(state.battleId), {
    ...state,
    defenderPlayerId: state.defenderPlayerId ?? "",
  });
  // Also schedule next round in the battle sorted set
  await redis.zadd(Keys.battleRounds, state.nextRoundAt, state.battleId);
}

export async function getBattleState(battleId: string): Promise<BattleStateCache | null> {
  const raw = await redis.hgetall(Keys.battleState(battleId));
  if (!raw || !raw.battleId) return null;
  return {
    battleId:           raw.battleId,
    zoneId:             raw.zoneId!,
    attackerPlayerId:   raw.attackerPlayerId!,
    defenderPlayerId:   raw.defenderPlayerId || null,
    currentRound:       parseInt(raw.currentRound!),
    maxRounds:          parseInt(raw.maxRounds!),
    attackerMorale:     parseFloat(raw.attackerMorale!),
    defenderMorale:     parseFloat(raw.defenderMorale!),
    nextRoundAt:        parseInt(raw.nextRoundAt!),
    status:             raw.status! as "ACTIVE" | "RESOLVED",
  };
}

export async function dequeueDueBattleRounds(now: number): Promise<string[]> {
  const pipeline = redis.pipeline();
  pipeline.zrangebyscore(Keys.battleRounds, "-inf", now);
  pipeline.zremrangebyscore(Keys.battleRounds, "-inf", now);
  const results = await pipeline.exec();
  if (!results || !results[0] || results[0][0]) return [];
  return results[0][1] as string[];
}

// ─────────────────────────────────────────────
// Command Points cache
// Fast read/write so every unit deploy doesn't need a DB round-trip
// ─────────────────────────────────────────────

export async function setCommandPoints(
  playerId: string,
  used: number,
  max: number
): Promise<void> {
  await redis.hset(Keys.playerCP(playerId), { used, max });
  await redis.expire(Keys.playerCP(playerId), 3600); // 1hr TTL, refreshed on access
}

export async function getCommandPoints(
  playerId: string
): Promise<{ used: number; max: number } | null> {
  const raw = await redis.hgetall(Keys.playerCP(playerId));
  if (!raw?.used) return null;
  return { used: parseInt(raw.used), max: parseInt(raw.max!) };
}

export async function adjustCommandPoints(
  playerId: string,
  delta: number // positive = using CP, negative = freeing CP
): Promise<void> {
  await redis.hincrby(Keys.playerCP(playerId), "used", delta);
}

// ─────────────────────────────────────────────
// Zone Event Pub/Sub
// When a zone changes state (battle starts, unit arrives, captured),
// publish to the zone's channel so all watching clients get live updates.
// ─────────────────────────────────────────────

export type ZoneEventType =
  | "BATTLE_STARTED"
  | "BATTLE_ROUND"
  | "BATTLE_RESOLVED"
  | "UNIT_ARRIVED"
  | "ZONE_CAPTURED"
  | "FORTIFICATION_CHANGED";

export async function publishZoneEvent(
  zoneId: string,
  type: ZoneEventType,
  payload: Record<string, unknown>
): Promise<void> {
  await redis.publish(
    Keys.zoneEvents(zoneId),
    JSON.stringify({ type, zoneId, payload, ts: Date.now() })
  );
}

export async function publishPlayerEvent(
  playerId: string,
  type: string,
  payload: Record<string, unknown>
): Promise<void> {
  await redis.publish(
    Keys.playerEvents(playerId),
    JSON.stringify({ type, playerId, payload, ts: Date.now() })
  );
}
