// =============================================================
// Modern Combat 4X — Season & Victory Engine
// Covers: Season lifecycle, sector control tracking,
//         victory condition (60% map control), season wipe,
//         Hall of Fame persistence, rewards
// =============================================================

import { PrismaClient } from "@prisma/client";
import { redis, publishPlayerEvent } from "../lib/redis.js";

const prisma = new PrismaClient();

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const VICTORY_CONTROL_THRESHOLD = 0.60;   // 60% of all zones
const SEASON_MAX_DURATION_MS    = 60 * 24 * 3600 * 1000;  // 60 days hard cap
const WIPE_COUNTDOWN_MS         = 24 * 3600 * 1000;       // 24h warning before wipe
const LEADERBOARD_SIZE          = 100;
const TICK_INTERVAL_MS          = 60_000; // re-check victory every 60s

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type SeasonStatus = "ACTIVE" | "VICTORY_COUNTDOWN" | "ENDED";

export interface SeasonState {
  seasonId:        string;
  name:            string;            // e.g. "Season 4 — Iron Curtain"
  startedAt:       number;
  endsAt:          number | null;     // null until winner declared
  hardCapAt:       number;            // startedAt + SEASON_MAX_DURATION_MS
  status:          SeasonStatus;
  winnerId:        string | null;     // player or alliance id
  winnerType:      "PLAYER" | "ALLIANCE" | null;
  winnerName:      string | null;
  countdownEndsAt: number | null;     // when the 24h wipe countdown finishes
  totalZones:      number;            // cached zone count for the season
}

export interface LeaderboardEntry {
  rank:          number;
  playerId:      string;
  playerName:    string;
  allianceTag:   string | null;
  zonesOwned:    number;
  zonesEverOwned: number;
  battlesWon:    number;
  battlesLost:   number;
  creditsEarned: number;
}

export interface SeasonReward {
  rank:        number;
  credits:     number;    // season-end credits bonus
  title:       string;    // cosmetic title awarded
  badgeId:     string;
}

// Season rewards by final rank
const RANK_REWARDS: SeasonReward[] = [
  { rank: 1,  credits: 50_000, title: "Supreme Commander", badgeId: "badge_s1"  },
  { rank: 2,  credits: 30_000, title: "Field Marshal",      badgeId: "badge_s2"  },
  { rank: 3,  credits: 20_000, title: "General",            badgeId: "badge_s3"  },
  { rank: 4,  credits: 10_000, title: "Colonel",            badgeId: "badge_s4"  },
  { rank: 5,  credits: 10_000, title: "Colonel",            badgeId: "badge_s4"  },
  { rank: 10, credits: 5_000,  title: "Major",              badgeId: "badge_s5"  },
  { rank: 25, credits: 2_000,  title: "Captain",            badgeId: "badge_s6"  },
  { rank: 50, credits: 1_000,  title: "Lieutenant",         badgeId: "badge_s7"  },
  { rank: 100,credits: 500,    title: "Veteran",            badgeId: "badge_s8"  },
];

// ─────────────────────────────────────────────
// Redis Keys
// ─────────────────────────────────────────────

const SeasonKeys = {
  currentSeason:   "season:current",
  leaderboard:     (seasonId: string) => `season:${seasonId}:lb`,
  playerStats:     (seasonId: string, playerId: string) => `season:${seasonId}:stats:${playerId}`,
  zoneControlCache: (seasonId: string) => `season:${seasonId}:control`,
  victoryCountdown: "season:victory_countdown",
};

// ─────────────────────────────────────────────
// Season Lifecycle
// ─────────────────────────────────────────────

export async function startNewSeason(name: string): Promise<SeasonState> {
  const now = Date.now();
  const seasonId = `s${now}`;

  const totalZones = await prisma.zone.count();

  const state: SeasonState = {
    seasonId,
    name,
    startedAt:       now,
    endsAt:          null,
    hardCapAt:       now + SEASON_MAX_DURATION_MS,
    status:          "ACTIVE",
    winnerId:        null,
    winnerType:      null,
    winnerName:      null,
    countdownEndsAt: null,
    totalZones,
  };

  await redis.set(SeasonKeys.currentSeason, JSON.stringify(state));
  console.log(`Season started: ${name} (${seasonId}) — ${totalZones} zones in play`);
  return state;
}

export async function getCurrentSeason(): Promise<SeasonState | null> {
  const raw = await redis.get(SeasonKeys.currentSeason);
  return raw ? JSON.parse(raw) : null;
}

// ─────────────────────────────────────────────
// Victory Condition Checker
// Called every 60 seconds by the timer service.
// Checks both individual player control AND alliance combined control.
// ─────────────────────────────────────────────

export async function checkVictoryCondition(): Promise<void> {
  const season = await getCurrentSeason();
  if (!season || season.status !== "ACTIVE") return;

  // Hard cap check — force end if season exceeded max duration
  if (Date.now() >= season.hardCapAt) {
    await triggerVictoryByLeaderboard(season);
    return;
  }

  const totalZones = season.totalZones;
  const threshold  = Math.ceil(totalZones * VICTORY_CONTROL_THRESHOLD);

  // ── Individual player victory check ──
  const topPlayer = await prisma.zone.groupBy({
    by:      ["ownerPlayerId"],
    where:   { ownerPlayerId: { not: null } },
    _count:  { id: true },
    orderBy: { _count: { id: "desc" } },
    take:    1,
  });

  if (topPlayer[0] && topPlayer[0]._count.id >= threshold && topPlayer[0].ownerPlayerId) {
    const player = await prisma.player.findUnique({ where: { id: topPlayer[0].ownerPlayerId } });
    if (player) {
      await beginVictoryCountdown({
        season,
        winnerId:   player.id,
        winnerType: "PLAYER",
        winnerName: player.username,
        zonesOwned: topPlayer[0]._count.id,
      });
      return;
    }
  }

  // ── Alliance combined victory check ──
  // Sum zones owned by all members of each alliance
  const alliances = await prisma.alliance.findMany({
    include: {
      members: {
        include: {
          player: {
            include: {
              _count: { select: { units: false } },  // can't groupBy here — raw query needed
            },
          },
        },
      },
    },
  });

  // Build alliance → zone count map via raw aggregation
  const allianceZoneCounts = await prisma.$queryRaw<{ allianceId: string; zoneCount: bigint }[]>`
    SELECT am."allianceId", COUNT(z.id)::bigint AS "zoneCount"
    FROM "AllianceMember" am
    JOIN "Zone" z ON z."ownerPlayerId" = am."playerId"
    GROUP BY am."allianceId"
    ORDER BY "zoneCount" DESC
    LIMIT 1
  `;

  if (allianceZoneCounts[0] && Number(allianceZoneCounts[0].zoneCount) >= threshold) {
    const alliance = await prisma.alliance.findUnique({
      where: { id: allianceZoneCounts[0].allianceId },
    });
    if (alliance) {
      await beginVictoryCountdown({
        season,
        winnerId:   alliance.id,
        winnerType: "ALLIANCE",
        winnerName: `[${alliance.tag}] ${alliance.name}`,
        zonesOwned: Number(allianceZoneCounts[0].zoneCount),
      });
    }
  }
}

// ─────────────────────────────────────────────
// Victory Countdown
// When a winner is detected, a 24h countdown starts.
// If the winner loses control below threshold during this window,
// the countdown is cancelled — they must hold it.
// ─────────────────────────────────────────────

async function beginVictoryCountdown(params: {
  season:     SeasonState;
  winnerId:   string;
  winnerType: "PLAYER" | "ALLIANCE";
  winnerName: string;
  zonesOwned: number;
}): Promise<void> {
  const { season, winnerId, winnerType, winnerName, zonesOwned } = params;

  // Already counting down for this winner
  const existing = await redis.get(SeasonKeys.victoryCountdown);
  if (existing) {
    const prev = JSON.parse(existing);
    if (prev.winnerId === winnerId) return; // same winner, countdown already running
    // Different winner took the lead — reset
    await cancelVictoryCountdown(season);
  }

  const countdownEndsAt = Date.now() + WIPE_COUNTDOWN_MS;

  const countdownState = { winnerId, winnerType, winnerName, zonesOwned, countdownEndsAt };
  await redis.set(SeasonKeys.victoryCountdown, JSON.stringify(countdownState), "PX", WIPE_COUNTDOWN_MS + 60_000);

  season.status          = "VICTORY_COUNTDOWN";
  season.winnerId        = winnerId;
  season.winnerType      = winnerType;
  season.winnerName      = winnerName;
  season.countdownEndsAt = countdownEndsAt;
  await redis.set(SeasonKeys.currentSeason, JSON.stringify(season));

  // Broadcast world-wide alert
  await broadcastGlobalEvent("VICTORY_COUNTDOWN_STARTED", {
    winnerId, winnerType, winnerName, zonesOwned,
    totalZones:    season.totalZones,
    countdownEndsAt,
    message: `${winnerName} controls ${zonesOwned}/${season.totalZones} zones. 
              Season ends in 24 hours unless they are stopped.`,
  });

  console.log(`Victory countdown: ${winnerName} — ends at ${new Date(countdownEndsAt).toISOString()}`);
}

export async function cancelVictoryCountdown(season: SeasonState): Promise<void> {
  await redis.del(SeasonKeys.victoryCountdown);
  season.status          = "ACTIVE";
  season.winnerId        = null;
  season.winnerType      = null;
  season.winnerName      = null;
  season.countdownEndsAt = null;
  await redis.set(SeasonKeys.currentSeason, JSON.stringify(season));

  await broadcastGlobalEvent("VICTORY_COUNTDOWN_CANCELLED", {
    message: "The leader lost control. The season continues!",
  });
}

/** Called by timer service to check if countdown expired */
export async function checkVictoryCountdownExpiry(): Promise<void> {
  const season = await getCurrentSeason();
  if (!season || season.status !== "VICTORY_COUNTDOWN") return;
  if (!season.countdownEndsAt || Date.now() < season.countdownEndsAt) return;

  // Re-verify winner still holds the threshold
  const totalZones = season.totalZones;
  const threshold  = Math.ceil(totalZones * VICTORY_CONTROL_THRESHOLD);

  let holdsThreshold = false;
  if (season.winnerType === "PLAYER") {
    const count = await prisma.zone.count({ where: { ownerPlayerId: season.winnerId! } });
    holdsThreshold = count >= threshold;
  } else if (season.winnerType === "ALLIANCE") {
    const result = await prisma.$queryRaw<{ zoneCount: bigint }[]>`
      SELECT COUNT(z.id)::bigint AS "zoneCount"
      FROM "AllianceMember" am
      JOIN "Zone" z ON z."ownerPlayerId" = am."playerId"
      WHERE am."allianceId" = ${season.winnerId}
    `;
    holdsThreshold = Number(result[0]?.zoneCount ?? 0) >= threshold;
  }

  if (holdsThreshold) {
    await endSeason(season);
  } else {
    await cancelVictoryCountdown(season);
  }
}

// ─────────────────────────────────────────────
// Season End & Wipe
// ─────────────────────────────────────────────

async function triggerVictoryByLeaderboard(season: SeasonState): Promise<void> {
  // Hard cap reached — winner is whoever has most zones
  const topPlayer = await prisma.zone.groupBy({
    by:      ["ownerPlayerId"],
    where:   { ownerPlayerId: { not: null } },
    _count:  { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 1,
  });

  if (topPlayer[0]?.ownerPlayerId) {
    const player = await prisma.player.findUnique({ where: { id: topPlayer[0].ownerPlayerId } });
    if (player) {
      season.winnerId   = player.id;
      season.winnerType = "PLAYER";
      season.winnerName = player.username;
      await redis.set(SeasonKeys.currentSeason, JSON.stringify(season));
    }
  }

  await endSeason(season);
}

export async function endSeason(season: SeasonState): Promise<void> {
  const now  = Date.now();
  season.status = "ENDED";
  season.endsAt = now;
  await redis.set(SeasonKeys.currentSeason, JSON.stringify(season));

  console.log(`Season ended: ${season.name} — Winner: ${season.winnerName}`);

  // 1. Snapshot final leaderboard
  const finalLB = await buildLeaderboard(season.seasonId);

  // 2. Persist to Hall of Fame (Postgres)
  await prisma.$transaction(
    finalLB.slice(0, LEADERBOARD_SIZE).map((entry, i) =>
      prisma.hallOfFame.create({
        data: {
          seasonId:      season.seasonId,
          seasonName:    season.name,
          rank:          i + 1,
          playerId:      entry.playerId,
          playerName:    entry.playerName,
          allianceTag:   entry.allianceTag,
          zonesOwned:    entry.zonesOwned,
          battlesWon:    entry.battlesWon,
          endedAt:       new Date(now),
          isWinner:      entry.playerId === season.winnerId,
        },
      })
    )
  );

  // 3. Distribute rewards
  for (let i = 0; i < finalLB.length; i++) {
    const entry  = finalLB[i];
    const reward = getRewardForRank(i + 1);
    if (!reward) continue;

    await prisma.player.update({
      where: { id: entry.playerId },
      data: {
        credits: { increment: reward.credits },
        // Title and badge would be stored in a cosmetics table (future work)
      },
    });

    await publishPlayerEvent(entry.playerId, "SEASON_REWARD", {
      rank:    i + 1,
      credits: reward.credits,
      title:   reward.title,
      badgeId: reward.badgeId,
    });
  }

  // 4. Broadcast season end
  await broadcastGlobalEvent("SEASON_ENDED", {
    seasonId:    season.seasonId,
    seasonName:  season.name,
    winnerId:    season.winnerId,
    winnerName:  season.winnerName,
    winnerType:  season.winnerType,
    topPlayers:  finalLB.slice(0, 10),
    message:     `Season over! Next season begins in 24 hours.`,
  });

  // 5. Schedule world wipe in 24 hours
  await redis.set("season:pending_wipe", JSON.stringify(season), "PX", 86_400_000);
  setTimeout(() => executeWorldWipe(season.seasonId), 86_400_000);
}

async function executeWorldWipe(oldSeasonId: string): Promise<void> {
  console.log(`Executing world wipe for season ${oldSeasonId}`);

  // Reset all zone ownership
  await prisma.zone.updateMany({
    data: {
      ownerPlayerId:      null,
      capturedAt:         null,
      fortificationLevel: 0,
      wallBonus:          0,
    },
  });

  // Delete all units, movements, battles
  await prisma.$transaction([
    prisma.movement.deleteMany(),
    prisma.battleRound.deleteMany(),
    prisma.battle.deleteMany(),
    prisma.unit.deleteMany(),
  ]);

  // Reset all player buildings to Lvl 1
  await prisma.building.updateMany({ data: { level: 1, isUpgrading: false } });

  // Reset player resources to starting values
  await prisma.player.updateMany({
    data: {
      fuel:              500,
      rations:           500,
      steel:             500,
      credits:           1000,
      maxCommandPoints:  20,
      usedCommandPoints: 0,
    },
  });

  // Clear all Redis game state
  const keysToFlush = [
    "season:current",
    "season:victory_countdown",
    "season:pending_wipe",
    "queue:travel",
    "queue:build",
    "queue:train",
    "queue:battle",
    "queue:tribute",
    "queue:espionage",
    "queue:coord_attacks",
  ];
  await redis.del(...keysToFlush);

  // Start next season
  const seasonNumber = parseInt(oldSeasonId.replace("s", "").slice(0, 4)) + 1;
  await startNewSeason(`Season ${seasonNumber}`);

  await broadcastGlobalEvent("NEW_SEASON_STARTED", {
    message: "A new season has begun. All empires start fresh.",
  });
}

// ─────────────────────────────────────────────
// Leaderboard
// ─────────────────────────────────────────────

export async function buildLeaderboard(seasonId: string): Promise<LeaderboardEntry[]> {
  // Aggregate from DB: zones owned, battles won/lost
  const [zoneOwnership, battleStats] = await Promise.all([
    prisma.zone.groupBy({
      by:      ["ownerPlayerId"],
      where:   { ownerPlayerId: { not: null } },
      _count:  { id: true },
    }),
    prisma.battle.groupBy({
      by:      ["attackerPlayerId"],
      _count:  { id: true },
      where:   { outcome: "ATTACKER_VICTORY" },
    }),
  ]);

  const zoneMap  = new Map(zoneOwnership.map((z) => [z.ownerPlayerId!, z._count.id]));
  const winMap   = new Map(battleStats.map((b)  => [b.attackerPlayerId, b._count.id]));

  const playerIds = [...new Set([...zoneMap.keys()])];
  const players   = await prisma.player.findMany({
    where: { id: { in: playerIds } },
    include: { allianceMember: { include: { alliance: { select: { tag: true } } } } },
  });

  const entries: LeaderboardEntry[] = players.map((p) => ({
    rank:           0,
    playerId:       p.id,
    playerName:     p.username,
    allianceTag:    p.allianceMember?.alliance.tag ?? null,
    zonesOwned:     zoneMap.get(p.id) ?? 0,
    zonesEverOwned: zoneMap.get(p.id) ?? 0,
    battlesWon:     winMap.get(p.id) ?? 0,
    battlesLost:    0,
    creditsEarned:  p.credits,
  }));

  // Sort: primary = zones owned, secondary = battles won
  entries.sort((a, b) =>
    b.zonesOwned - a.zonesOwned || b.battlesWon - a.battlesWon
  );

  entries.forEach((e, i) => { e.rank = i + 1; });

  // Cache in Redis sorted set for fast frontend reads
  const pipeline = redis.pipeline();
  for (const e of entries) {
    pipeline.zadd(SeasonKeys.leaderboard(seasonId), e.zonesOwned, e.playerId);
  }
  await pipeline.exec();

  return entries;
}

export async function getLeaderboardPage(
  seasonId: string,
  page: number = 1,
  pageSize: number = 25
): Promise<{ entries: LeaderboardEntry[]; totalPlayers: number }> {
  const lb = await buildLeaderboard(seasonId);
  const start = (page - 1) * pageSize;
  return {
    entries:      lb.slice(start, start + pageSize),
    totalPlayers: lb.length,
  };
}

// ─────────────────────────────────────────────
// Real-time Control Map
// Cached zone control percentages for the map UI
// ─────────────────────────────────────────────

export async function updateControlCache(seasonId: string): Promise<void> {
  const zones = await prisma.zone.findMany({
    select: { ownerPlayerId: true, sectorId: true },
  });

  const sectorControl: Record<string, Record<string, number>> = {};

  for (const zone of zones) {
    if (!zone.ownerPlayerId) continue;
    if (!sectorControl[zone.sectorId]) sectorControl[zone.sectorId] = {};
    sectorControl[zone.sectorId][zone.ownerPlayerId] =
      (sectorControl[zone.sectorId][zone.ownerPlayerId] ?? 0) + 1;
  }

  await redis.set(
    SeasonKeys.zoneControlCache(seasonId),
    JSON.stringify(sectorControl),
    "EX", 60
  );
}

export async function getControlCache(
  seasonId: string
): Promise<Record<string, Record<string, number>>> {
  const raw = await redis.get(SeasonKeys.zoneControlCache(seasonId));
  return raw ? JSON.parse(raw) : {};
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function getRewardForRank(rank: number): SeasonReward | null {
  // Walk backwards through tier thresholds
  for (let i = RANK_REWARDS.length - 1; i >= 0; i--) {
    if (rank <= RANK_REWARDS[i].rank) return RANK_REWARDS[i];
  }
  return null;
}

async function broadcastGlobalEvent(
  type: string,
  payload: Record<string, unknown>
): Promise<void> {
  await redis.publish("global:events", JSON.stringify({ type, payload, ts: Date.now() }));
}

// ─────────────────────────────────────────────
// Prisma Schema Additions (add these to schema.prisma)
// ─────────────────────────────────────────────
/*
  model HallOfFame {
    id          String   @id @default(uuid())
    seasonId    String
    seasonName  String
    rank        Int
    playerId    String
    playerName  String
    allianceTag String?
    zonesOwned  Int
    battlesWon  Int
    endedAt     DateTime
    isWinner    Boolean  @default(false)

    @@index([seasonId])
    @@index([playerId])
  }
*/
