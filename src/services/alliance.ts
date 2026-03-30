// =============================================================
// Global Mandate — Alliance System
// Covers: Alliance CRUD, shared CP pool, coordinated attacks,
//         alliance war declarations, member permissions
// =============================================================

import { PrismaClient } from "@prisma/client";
import { redis, publishPlayerEvent } from "../lib/redis.js";

const prisma = new PrismaClient();

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const MAX_ALLIANCE_MEMBERS = 20;
const SHARED_CP_PER_MEMBER  = 5;   // each member contributes 5 CP to the pool
const WAR_DECLARATION_COST  = 500; // credits burned to declare war
const PEACE_COOLDOWN_MS     = 24 * 3600 * 1000; // 24h after war ends before re-declaration

// ─────────────────────────────────────────────
// Alliance Redis Keys
// ─────────────────────────────────────────────

const AllianceKeys = {
  sharedCP:      (allianceId: string) => `alliance:${allianceId}:cp`,
  warState:      (allianceId: string) => `alliance:${allianceId}:wars`,
  memberOnline:  (allianceId: string) => `alliance:${allianceId}:online`,
};

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface AllianceCP {
  total:  number;   // sum of all member contributions
  used:   number;   // CP currently committed to coordinated attacks
  free:   number;   // total - used
}

export interface CoordinatedAttack {
  attackId:          string;
  allianceId:        string;
  targetZoneId:      string;
  targetPlayerId:    string | null;
  initiatorPlayerId: string;
  participantIds:    string[];
  cpCommitted:       number;
  launchAt:          number;   // Unix ms — scheduled launch time
  status:            "STAGING" | "LAUNCHED" | "RESOLVED";
}

export interface AllianceWarState {
  warId:          string;
  attackerId:     string;   // alliance id
  defenderId:     string;   // alliance id
  declaredAt:     number;
  endsAt:         number | null;
  attackerScore:  number;   // zones captured from defender
  defenderScore:  number;   // zones recaptured / defenders held
  status:         "ACTIVE" | "PEACE" | "ATTACKER_WIN" | "DEFENDER_WIN";
}

// ─────────────────────────────────────────────
// Alliance CRUD
// ─────────────────────────────────────────────

export async function createAlliance(params: {
  leaderId: string;
  name:     string;
  tag:      string;         // 2–6 uppercase chars e.g. [WOLF]
}): Promise<{ success: boolean; allianceId?: string; error?: string }> {
  const { leaderId, name, tag } = params;

  // Validate tag format
  if (!/^[A-Z0-9]{2,6}$/.test(tag)) {
    return { success: false, error: "Tag must be 2–6 uppercase letters/numbers." };
  }

  // Check leader isn't already in an alliance
  const existing = await prisma.allianceMember.findUnique({ where: { playerId: leaderId } });
  if (existing) return { success: false, error: "Already in an alliance." };

  const alliance = await prisma.$transaction(async (tx: any) => {
    const a = await tx.alliance.create({ data: { name, tag, leaderId } });
    await tx.allianceMember.create({
      data: { allianceId: a.id, playerId: leaderId, role: "LEADER" },
    });
    return a;
  });

  // Seed shared CP pool in Redis
  await initSharedCPPool(alliance.id, [leaderId]);

  return { success: true, allianceId: alliance.id };
}

export async function invitePlayer(params: {
  inviterId:  string;
  inviteeId:  string;
  allianceId: string;
}): Promise<{ success: boolean; error?: string }> {
  const { inviterId, inviteeId, allianceId } = params;

  const [inviter, invitee, memberCount] = await Promise.all([
    prisma.allianceMember.findUnique({ where: { playerId: inviterId } }),
    prisma.allianceMember.findUnique({ where: { playerId: inviteeId } }),
    prisma.allianceMember.count({ where: { allianceId } }),
  ]);

  if (!inviter || inviter.allianceId !== allianceId) {
    return { success: false, error: "Not a member of this alliance." };
  }
  if (!["LEADER", "OFFICER"].includes(inviter.role)) {
    return { success: false, error: "Only leaders and officers can invite." };
  }
  if (invitee) return { success: false, error: "Player already in an alliance." };
  if (memberCount >= MAX_ALLIANCE_MEMBERS) {
    return { success: false, error: `Alliance is full (max ${MAX_ALLIANCE_MEMBERS}).` };
  }

  await publishPlayerEvent(inviteeId, "ALLIANCE_INVITE", { allianceId, inviterId });
  return { success: true };
}

export async function acceptInvite(params: {
  playerId:   string;
  allianceId: string;
}): Promise<{ success: boolean; error?: string }> {
  const { playerId, allianceId } = params;

  const existing = await prisma.allianceMember.findUnique({ where: { playerId } });
  if (existing) return { success: false, error: "Already in an alliance." };

  await prisma.allianceMember.create({
    data: { allianceId, playerId, role: "MEMBER" },
  });

  // Recalculate shared CP pool with new member
  const members = await prisma.allianceMember.findMany({
    where: { allianceId }, select: { playerId: true },
  });
  await initSharedCPPool(allianceId, members.map((m: { playerId: string }) => m.playerId));

  await notifyAlliance(allianceId, "MEMBER_JOINED", { playerId });
  return { success: true };
}

export async function leaveAlliance(playerId: string): Promise<{ success: boolean; error?: string }> {
  const member = await prisma.allianceMember.findUnique({ where: { playerId } });
  if (!member) return { success: false, error: "Not in an alliance." };

  if (member.role === "LEADER") {
    // Promote next officer, or disband if no officers
    const nextOfficer = await prisma.allianceMember.findFirst({
      where: { allianceId: member.allianceId, role: "OFFICER" },
    });
    if (nextOfficer) {
      await prisma.allianceMember.update({
        where: { id: nextOfficer.id }, data: { role: "LEADER" },
      });
      await prisma.alliance.update({
        where: { id: member.allianceId }, data: { leaderId: nextOfficer.playerId },
      });
    } else {
      return { success: false, error: "Promote an officer before leaving as leader." };
    }
  }

  await prisma.allianceMember.delete({ where: { playerId } });

  const remaining = await prisma.allianceMember.findMany({
    where: { allianceId: member.allianceId }, select: { playerId: true },
  });
  if (remaining.length === 0) {
    await prisma.alliance.delete({ where: { id: member.allianceId } });
  } else {
    await initSharedCPPool(member.allianceId, remaining.map((m: { playerId: string }) => m.playerId));
  }

  return { success: true };
}

// ─────────────────────────────────────────────
// Shared CP Pool
// Each member contributes SHARED_CP_PER_MEMBER to a pool
// that can be drawn on for coordinated attacks.
// ─────────────────────────────────────────────

async function initSharedCPPool(allianceId: string, memberIds: string[]): Promise<void> {
  const total = memberIds.length * SHARED_CP_PER_MEMBER;
  await redis.hset(AllianceKeys.sharedCP(allianceId), { total, used: 0, free: total });
}

export async function getAllianceCP(allianceId: string): Promise<AllianceCP> {
  const raw = await redis.hgetall(AllianceKeys.sharedCP(allianceId));
  return {
    total: parseInt(raw?.total ?? "0"),
    used:  parseInt(raw?.used  ?? "0"),
    free:  parseInt(raw?.free  ?? "0"),
  };
}

async function reserveAllianceCP(allianceId: string, amount: number): Promise<boolean> {
  const cp = await getAllianceCP(allianceId);
  if (cp.free < amount) return false;
  await redis.hset(AllianceKeys.sharedCP(allianceId), {
    used: cp.used + amount,
    free: cp.free - amount,
  });
  return true;
}

async function releaseAllianceCP(allianceId: string, amount: number): Promise<void> {
  const cp = await getAllianceCP(allianceId);
  await redis.hset(AllianceKeys.sharedCP(allianceId), {
    used: Math.max(0, cp.used - amount),
    free: cp.free + amount,
  });
}

// ─────────────────────────────────────────────
// Coordinated Attacks
// Multiple alliance members stage units into a shared attack
// that launches simultaneously at a scheduled time.
// ─────────────────────────────────────────────

const CoordAttackKeys = {
  staging: (attackId: string) => `coord:${attackId}`,
  queue:   "queue:coord_attacks",
};

export async function stageCoordinatedAttack(params: {
  initiatorPlayerId: string;
  allianceId:        string;
  targetZoneId:      string;
  launchDelayMs:     number;  // how far in the future to launch (min 10 min)
}): Promise<{ success: boolean; attackId?: string; error?: string }> {
  const { initiatorPlayerId, allianceId, targetZoneId, launchDelayMs } = params;

  if (launchDelayMs < 600_000) {
    return { success: false, error: "Minimum launch delay is 10 minutes." };
  }

  const member = await prisma.allianceMember.findUnique({ where: { playerId: initiatorPlayerId } });
  if (!member || member.allianceId !== allianceId) {
    return { success: false, error: "Not a member of this alliance." };
  }
  if (!["LEADER", "OFFICER"].includes(member.role)) {
    return { success: false, error: "Only leaders and officers can initiate coordinated attacks." };
  }

  const zone = await prisma.zone.findUnique({ where: { id: targetZoneId } });
  if (!zone) return { success: false, error: "Zone not found." };

  const attackId = `coord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const launchAt = Date.now() + launchDelayMs;

  const attack: CoordinatedAttack = {
    attackId,
    allianceId,
    targetZoneId,
    targetPlayerId: zone.ownerPlayerId,
    initiatorPlayerId,
    participantIds: [initiatorPlayerId],
    cpCommitted: 0,
    launchAt,
    status: "STAGING",
  };

  await redis.set(CoordAttackKeys.staging(attackId), JSON.stringify(attack), "PX", launchDelayMs + 3_600_000);
  await redis.zadd(CoordAttackKeys.queue, launchAt, attackId);

  // Notify all alliance members
  await notifyAlliance(allianceId, "COORD_ATTACK_STAGED", {
    attackId, targetZoneId, launchAt, initiatorPlayerId,
  });

  return { success: true, attackId };
}

export async function joinCoordinatedAttack(params: {
  playerId:  string;
  attackId:  string;
  cpContrib: number;
}): Promise<{ success: boolean; error?: string }> {
  const { playerId, attackId, cpContrib } = params;

  const raw = await redis.get(CoordAttackKeys.staging(attackId));
  if (!raw) return { success: false, error: "Attack not found or already launched." };
  const attack: CoordinatedAttack = JSON.parse(raw);

  if (attack.status !== "STAGING") return { success: false, error: "Attack already launched." };
  if (attack.participantIds.includes(playerId)) {
    return { success: false, error: "Already joined this attack." };
  }

  const reserved = await reserveAllianceCP(attack.allianceId, cpContrib);
  if (!reserved) return { success: false, error: "Insufficient alliance CP." };

  attack.participantIds.push(playerId);
  attack.cpCommitted += cpContrib;

  await redis.set(CoordAttackKeys.staging(attackId), JSON.stringify(attack), "KEEPTTL");
  return { success: true };
}

export async function processDueCoordinatedAttacks(now: number): Promise<void> {
  const pipeline = redis.pipeline();
  pipeline.zrangebyscore(CoordAttackKeys.queue, "-inf", now);
  pipeline.zremrangebyscore(CoordAttackKeys.queue, "-inf", now);
  const results = await pipeline.exec();
  if (!results?.[0]?.[1]) return;

  const attackIds = results[0][1] as string[];
  for (const attackId of attackIds) {
    const raw = await redis.get(CoordAttackKeys.staging(attackId));
    if (!raw) continue;
    const attack: CoordinatedAttack = JSON.parse(raw);
    if (attack.status !== "STAGING") continue;

    // Mark launched — individual battle initiations happen per-participant
    attack.status = "LAUNCHED";
    await redis.set(CoordAttackKeys.staging(attackId), JSON.stringify(attack), "KEEPTTL");

    // Notify participants the attack is live
    for (const pid of attack.participantIds) {
      await publishPlayerEvent(pid, "COORD_ATTACK_LAUNCHED", {
        attackId, targetZoneId: attack.targetZoneId,
      });
    }

    // Release reserved CP back to pool now that the attack is live
    await releaseAllianceCP(attack.allianceId, attack.cpCommitted);
  }
}

// ─────────────────────────────────────────────
// Alliance Wars
// Formal war declarations between alliances.
// Zones captured from enemies score war points.
// War ends when one side surrenders or a score threshold is reached.
// ─────────────────────────────────────────────

export async function declareWar(params: {
  attackerAllianceId: string;
  defenderAllianceId: string;
  declaringPlayerId:  string;
}): Promise<{ success: boolean; warId?: string; error?: string }> {
  const { attackerAllianceId, defenderAllianceId, declaringPlayerId } = params;

  const member = await prisma.allianceMember.findUnique({ where: { playerId: declaringPlayerId } });
  if (!member || member.allianceId !== attackerAllianceId || member.role !== "LEADER") {
    return { success: false, error: "Only alliance leaders can declare war." };
  }

  // Check credits cost
  const leader = await prisma.player.findUnique({ where: { id: declaringPlayerId } });
  if (!leader || leader.credits < WAR_DECLARATION_COST) {
    return { success: false, error: `Requires ${WAR_DECLARATION_COST} credits to declare war.` };
  }

  // Check peace cooldown
  const cooldownKey = `war:cooldown:${attackerAllianceId}:${defenderAllianceId}`;
  const onCooldown  = await redis.exists(cooldownKey);
  if (onCooldown) return { success: false, error: "Peace treaty cooldown active (24h)." };

  // Deduct credits
  await prisma.player.update({
    where: { id: declaringPlayerId },
    data: { credits: { decrement: WAR_DECLARATION_COST } },
  });

  const warId = `war_${Date.now()}`;
  const warState: AllianceWarState = {
    warId,
    attackerId:    attackerAllianceId,
    defenderId:    defenderAllianceId,
    declaredAt:    Date.now(),
    endsAt:        null,
    attackerScore: 0,
    defenderScore: 0,
    status:        "ACTIVE",
  };

  await redis.set(AllianceKeys.warState(warId), JSON.stringify(warState));

  // Notify both alliances
  await notifyAlliance(attackerAllianceId, "WAR_DECLARED", { warId, enemyAllianceId: defenderAllianceId });
  await notifyAlliance(defenderAllianceId, "WAR_DECLARED", { warId, enemyAllianceId: attackerAllianceId });

  return { success: true, warId };
}

export async function recordWarCapture(params: {
  warId:       string;
  capturedBy:  "ATTACKER" | "DEFENDER";
  zoneId:      string;
}): Promise<void> {
  const raw = await redis.get(AllianceKeys.warState(params.warId));
  if (!raw) return;
  const war: AllianceWarState = JSON.parse(raw);
  if (war.status !== "ACTIVE") return;

  if (params.capturedBy === "ATTACKER") war.attackerScore += 1;
  else war.defenderScore += 1;

  // Victory condition: first to 10 zone captures wins
  const WIN_THRESHOLD = 10;
  if (war.attackerScore >= WIN_THRESHOLD) {
    war.status = "ATTACKER_WIN";
    war.endsAt = Date.now();
    await endWar(war);
  } else if (war.defenderScore >= WIN_THRESHOLD) {
    war.status = "DEFENDER_WIN";
    war.endsAt = Date.now();
    await endWar(war);
  }

  await redis.set(AllianceKeys.warState(params.warId), JSON.stringify(war));
}

export async function surrenderWar(params: {
  warId:              string;
  surrenderingAlliance: string;
}): Promise<void> {
  const raw = await redis.get(AllianceKeys.warState(params.warId));
  if (!raw) return;
  const war: AllianceWarState = JSON.parse(raw);

  war.status = params.surrenderingAlliance === war.attackerId ? "DEFENDER_WIN" : "ATTACKER_WIN";
  war.endsAt = Date.now();
  await endWar(war);
  await redis.set(AllianceKeys.warState(params.warId), JSON.stringify(war));
}

async function endWar(war: AllianceWarState): Promise<void> {
  // Set peace cooldown
  const cooldownKey = `war:cooldown:${war.attackerId}:${war.defenderId}`;
  await redis.set(cooldownKey, "1", "PX", PEACE_COOLDOWN_MS);

  await notifyAlliance(war.attackerId, "WAR_ENDED", { warId: war.warId, outcome: war.status });
  await notifyAlliance(war.defenderId, "WAR_ENDED", { warId: war.warId, outcome: war.status });
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function notifyAlliance(
  allianceId: string,
  type: string,
  payload: Record<string, unknown>
): Promise<void> {
  const members = await prisma.allianceMember.findMany({
    where: { allianceId }, select: { playerId: true },
  });
  await Promise.all(
    members.map((m: { playerId: string }) => publishPlayerEvent(m.playerId, type, payload))
  );
}

export async function getAllianceRoster(allianceId: string) {
  return prisma.allianceMember.findMany({
    where: { allianceId },
    include: {
      player: {
        select: {
          id: true, username: true, lastActiveAt: true,
          usedCommandPoints: true, maxCommandPoints: true,
        },
      },
    },
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
  });
}
