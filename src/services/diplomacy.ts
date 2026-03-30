// =============================================================
// Global Mandate — Diplomacy System
// Covers: Non-Aggression Pacts, Tribute, Trade Agreements,
//         Cease-Fires, Espionage (Intel ops)
// =============================================================

import { PrismaClient } from "@prisma/client";
import { redis, publishPlayerEvent } from "../lib/redis.js";

const prisma = new PrismaClient();

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const NAP_DURATION_MS       = 7  * 24 * 3600 * 1000;  // 7 days
const CEASE_FIRE_DURATION_MS = 4  * 3600 * 1000;       // 4 hours
const TRIBUTE_INTERVAL_MS   = 3600 * 1000;             // tribute paid hourly
const TRADE_AGREEMENT_MS    = 24 * 3600 * 1000;        // 24-hour trade deals
const ESPIONAGE_COOLDOWN_MS = 6  * 3600 * 1000;        // 6h between spy ops

// ─────────────────────────────────────────────
// Enums & Types
// ─────────────────────────────────────────────

export type DiplomacyStatus = "PENDING" | "ACTIVE" | "EXPIRED" | "BROKEN" | "REJECTED";
export type DiplomacyType   = "NAP" | "CEASE_FIRE" | "TRADE_AGREEMENT" | "TRIBUTE";
export type EspionageOpType =
  | "INTEL_RECON"       // reveals enemy FOB building levels
  | "SABOTAGE_FACTORY"  // halves Steel production for 2h
  | "DISRUPT_COMMS"     // disables enemy notifications for 1h
  | "STEAL_CREDITS"     // steals 5% of target's credits
  | "ASSASSINATE_SPY";  // burns an enemy spy operation in progress

export interface DiplomacyAgreement {
  id:           string;
  type:         DiplomacyType;
  proposerId:   string;   // player or alliance id
  receiverId:   string;
  proposedAt:   number;
  expiresAt:    number | null;
  status:       DiplomacyStatus;
  terms:        DiplomacyTerms;
}

export interface DiplomacyTerms {
  // NAP — no attacks for duration
  napDurationMs?:     number;
  // Tribute — receiver gets resources from proposer every hour
  tributeFuel?:       number;
  tributeRations?:    number;
  tributeSteel?:      number;
  tributeCredits?:    number;
  // Trade — both sides get boosted production for duration
  tradeBoostPct?:     number;   // e.g. 10 = 10% bonus to all production
  tradeDurationMs?:   number;
}

export interface EspionageOp {
  opId:         string;
  type:         EspionageOpType;
  agentId:      string;    // player id
  targetId:     string;    // player id
  startedAt:    number;
  completesAt:  number;
  status:       "IN_PROGRESS" | "SUCCESS" | "FAILED" | "BURNED";
  result?:      Record<string, unknown>;
}

// ─────────────────────────────────────────────
// Redis Keys
// ─────────────────────────────────────────────

const DiplomacyKeys = {
  agreement:     (id: string)                   => `diplo:${id}`,
  activeNAP:     (a: string, b: string)         => `nap:${[a,b].sort().join(":")}`,
  ceaseFire:     (a: string, b: string)         => `ceasefire:${[a,b].sort().join(":")}`,
  tradeBoost:    (playerId: string)             => `trade:${playerId}`,
  tributeQueue:  "queue:tribute",
  espionageOp:   (opId: string)                 => `espionage:${opId}`,
  espionageQueue: "queue:espionage",
  spyCooldown:   (agentId: string, targetId: string) => `spy:cooldown:${agentId}:${targetId}`,
};

// ─────────────────────────────────────────────
// Non-Aggression Pacts (NAP)
// Both sides agree not to attack each other for a fixed duration.
// Attacking while a NAP is active flags the attacker as a
// "Treaty Breaker" — visible on their profile, -20% ally trust.
// ─────────────────────────────────────────────

export async function proposeNAP(params: {
  proposerId: string;
  receiverId: string;
}): Promise<{ success: boolean; agreementId?: string; error?: string }> {
  const { proposerId, receiverId } = params;

  const existingNAP = await redis.exists(DiplomacyKeys.activeNAP(proposerId, receiverId));
  if (existingNAP) return { success: false, error: "NAP already active with this player." };

  const id = `nap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const agreement: DiplomacyAgreement = {
    id,
    type:       "NAP",
    proposerId,
    receiverId,
    proposedAt: Date.now(),
    expiresAt:  null,   // set on acceptance
    status:     "PENDING",
    terms:      { napDurationMs: NAP_DURATION_MS },
  };

  await redis.set(DiplomacyKeys.agreement(id), JSON.stringify(agreement), "PX", 86_400_000); // 24h to accept
  await publishPlayerEvent(receiverId, "DIPLOMACY_PROPOSAL", {
    type: "NAP", proposerId, agreementId: id,
  });

  return { success: true, agreementId: id };
}

export async function acceptNAP(params: {
  agreementId: string;
  receiverId:  string;
}): Promise<{ success: boolean; error?: string }> {
  const raw = await redis.get(DiplomacyKeys.agreement(params.agreementId));
  if (!raw) return { success: false, error: "Agreement not found or expired." };

  const agreement: DiplomacyAgreement = JSON.parse(raw);
  if (agreement.receiverId !== params.receiverId) return { success: false, error: "Not your proposal." };
  if (agreement.status !== "PENDING") return { success: false, error: "Agreement is no longer pending." };

  const expiresAt = Date.now() + NAP_DURATION_MS;
  agreement.status    = "ACTIVE";
  agreement.expiresAt = expiresAt;

  await redis.set(DiplomacyKeys.agreement(params.agreementId), JSON.stringify(agreement), "PX", NAP_DURATION_MS);
  // Fast-check key used during battle initiation
  await redis.set(DiplomacyKeys.activeNAP(agreement.proposerId, agreement.receiverId), "1", "PX", NAP_DURATION_MS);

  await publishPlayerEvent(agreement.proposerId, "DIPLOMACY_ACCEPTED", {
    type: "NAP", agreementId: params.agreementId, expiresAt,
  });

  return { success: true };
}

/** Check before starting a battle — returns true if blocked by active NAP */
export async function isNAPActive(playerA: string, playerB: string): Promise<boolean> {
  return (await redis.exists(DiplomacyKeys.activeNAP(playerA, playerB))) === 1;
}

/** Called when a player attacks through an active NAP */
export async function breakNAP(attackerId: string, defenderId: string): Promise<void> {
  await redis.del(DiplomacyKeys.activeNAP(attackerId, defenderId));

  // Flag attacker as treaty breaker (72h visible mark)
  await redis.set(`treaty_breaker:${attackerId}`, "1", "PX", 72 * 3600 * 1000);

  await publishPlayerEvent(defenderId, "NAP_BROKEN", {
    breakerId: attackerId,
    message:   "Your Non-Aggression Pact was violated. Attacker is flagged as Treaty Breaker.",
  });
  await publishPlayerEvent(attackerId, "STATUS_FLAGGED", {
    flag: "TREATY_BREAKER", durationHrs: 72,
    message: "You broke a NAP. Other players can see this for 72 hours.",
  });
}

// ─────────────────────────────────────────────
// Cease-Fire
// Short-term truce (4h) — useful mid-war to regroup.
// Either side can propose; either side can break it (with flag).
// ─────────────────────────────────────────────

export async function proposeCeaseFire(params: {
  proposerId: string;
  receiverId: string;
}): Promise<{ success: boolean; agreementId?: string; error?: string }> {
  const { proposerId, receiverId } = params;

  const id = `cf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const agreement: DiplomacyAgreement = {
    id,
    type:       "CEASE_FIRE",
    proposerId,
    receiverId,
    proposedAt: Date.now(),
    expiresAt:  null,
    status:     "PENDING",
    terms:      {},
  };

  await redis.set(DiplomacyKeys.agreement(id), JSON.stringify(agreement), "PX", 1_800_000); // 30min to accept
  await publishPlayerEvent(receiverId, "DIPLOMACY_PROPOSAL", {
    type: "CEASE_FIRE", proposerId, agreementId: id,
  });

  return { success: true, agreementId: id };
}

export async function acceptCeaseFire(params: {
  agreementId: string;
  receiverId:  string;
}): Promise<{ success: boolean; error?: string }> {
  const raw = await redis.get(DiplomacyKeys.agreement(params.agreementId));
  if (!raw) return { success: false, error: "Agreement not found." };

  const agreement: DiplomacyAgreement = JSON.parse(raw);
  if (agreement.receiverId !== params.receiverId) return { success: false, error: "Not your proposal." };

  const expiresAt = Date.now() + CEASE_FIRE_DURATION_MS;
  agreement.status    = "ACTIVE";
  agreement.expiresAt = expiresAt;

  await redis.set(DiplomacyKeys.agreement(params.agreementId), JSON.stringify(agreement), "PX", CEASE_FIRE_DURATION_MS);
  await redis.set(DiplomacyKeys.ceaseFire(agreement.proposerId, agreement.receiverId), "1", "PX", CEASE_FIRE_DURATION_MS);

  await publishPlayerEvent(agreement.proposerId, "DIPLOMACY_ACCEPTED", {
    type: "CEASE_FIRE", expiresAt,
  });

  return { success: true };
}

export async function isCeaseFireActive(playerA: string, playerB: string): Promise<boolean> {
  return (await redis.exists(DiplomacyKeys.ceaseFire(playerA, playerB))) === 1;
}

// ─────────────────────────────────────────────
// Tribute System
// Weaker player pays a stronger one resources hourly to avoid attacks.
// Proposer sets the terms; receiver accepts or rejects.
// Non-payment auto-breaks the agreement.
// ─────────────────────────────────────────────

export async function proposeTribute(params: {
  payerId:        string;   // proposer pays
  receiverId:     string;
  fuelPerHour:    number;
  rationsPerHour: number;
  steelPerHour:   number;
  creditsPerHour: number;
  durationHours:  number;
}): Promise<{ success: boolean; agreementId?: string; error?: string }> {
  const { payerId, receiverId, fuelPerHour, rationsPerHour, steelPerHour, creditsPerHour, durationHours } = params;

  if (durationHours < 1 || durationHours > 72) {
    return { success: false, error: "Tribute duration must be 1–72 hours." };
  }

  const id = `tribute_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const expiresAt = Date.now() + durationHours * 3600 * 1000;

  const agreement: DiplomacyAgreement = {
    id,
    type:       "TRIBUTE",
    proposerId: payerId,
    receiverId,
    proposedAt: Date.now(),
    expiresAt,
    status:     "PENDING",
    terms:      {
      tributeFuel:    fuelPerHour,
      tributeRations: rationsPerHour,
      tributeSteel:   steelPerHour,
      tributeCredits: creditsPerHour,
    },
  };

  const ttl = durationHours * 3600 * 1000 + 86_400_000;
  await redis.set(DiplomacyKeys.agreement(id), JSON.stringify(agreement), "PX", ttl);
  await publishPlayerEvent(receiverId, "DIPLOMACY_PROPOSAL", {
    type: "TRIBUTE", proposerId: payerId, agreementId: id, terms: agreement.terms,
  });

  return { success: true, agreementId: id };
}

export async function acceptTribute(params: {
  agreementId: string;
  receiverId:  string;
}): Promise<{ success: boolean; error?: string }> {
  const raw = await redis.get(DiplomacyKeys.agreement(params.agreementId));
  if (!raw) return { success: false, error: "Agreement not found." };

  const agreement: DiplomacyAgreement = JSON.parse(raw);
  if (agreement.receiverId !== params.receiverId) return { success: false, error: "Not your proposal." };

  agreement.status = "ACTIVE";
  await redis.set(DiplomacyKeys.agreement(params.agreementId), JSON.stringify(agreement), "KEEPTTL");

  // Enqueue first tribute payment (1 hour from now)
  await redis.zadd(DiplomacyKeys.tributeQueue, Date.now() + TRIBUTE_INTERVAL_MS, params.agreementId);

  await publishPlayerEvent(agreement.proposerId, "DIPLOMACY_ACCEPTED", {
    type: "TRIBUTE", agreementId: params.agreementId,
  });

  return { success: true };
}

/** Called by timer service every minute — processes due tribute payments */
export async function processDueTributes(now: number): Promise<void> {
  const pipeline = redis.pipeline();
  pipeline.zrangebyscore(DiplomacyKeys.tributeQueue, "-inf", now);
  pipeline.zremrangebyscore(DiplomacyKeys.tributeQueue, "-inf", now);
  const results = await pipeline.exec();
  if (!results?.[0]?.[1]) return;

  const agreementIds = results[0][1] as string[];

  for (const agreementId of agreementIds) {
    const raw = await redis.get(DiplomacyKeys.agreement(agreementId));
    if (!raw) continue;
    const agreement: DiplomacyAgreement = JSON.parse(raw);
    if (agreement.status !== "ACTIVE") continue;

    const { terms } = agreement;
    const payer    = await prisma.player.findUnique({ where: { id: agreement.proposerId } });
    if (!payer) continue;

    // Check payer can afford it
    const canPay =
      (payer.fuel    >= (terms.tributeFuel    ?? 0)) &&
      (payer.rations >= (terms.tributeRations ?? 0)) &&
      (payer.steel   >= (terms.tributeSteel   ?? 0)) &&
      (payer.credits >= (terms.tributeCredits ?? 0));

    if (!canPay) {
      // Break agreement — payer can't pay
      agreement.status = "BROKEN";
      await redis.set(DiplomacyKeys.agreement(agreementId), JSON.stringify(agreement), "KEEPTTL");
      await publishPlayerEvent(agreement.receiverId, "TRIBUTE_BROKEN", {
        agreementId, reason: "Payer ran out of resources.",
      });
      await publishPlayerEvent(agreement.proposerId, "TRIBUTE_BROKEN", {
        agreementId, reason: "You could not afford the tribute payment.",
      });
      continue;
    }

    // Transfer resources
    await prisma.$transaction([
      prisma.player.update({
        where: { id: agreement.proposerId },
        data: {
          fuel:    { decrement: terms.tributeFuel    ?? 0 },
          rations: { decrement: terms.tributeRations ?? 0 },
          steel:   { decrement: terms.tributeSteel   ?? 0 },
          credits: { decrement: terms.tributeCredits ?? 0 },
        },
      }),
      prisma.player.update({
        where: { id: agreement.receiverId },
        data: {
          fuel:    { increment: terms.tributeFuel    ?? 0 },
          rations: { increment: terms.tributeRations ?? 0 },
          steel:   { increment: terms.tributeSteel   ?? 0 },
          credits: { increment: terms.tributeCredits ?? 0 },
        },
      }),
    ]);

    // Re-queue next payment if agreement not expired
    if (agreement.expiresAt && Date.now() < agreement.expiresAt) {
      await redis.zadd(DiplomacyKeys.tributeQueue, now + TRIBUTE_INTERVAL_MS, agreementId);
    } else {
      agreement.status = "EXPIRED";
      await redis.set(DiplomacyKeys.agreement(agreementId), JSON.stringify(agreement), "KEEPTTL");
    }
  }
}

// ─────────────────────────────────────────────
// Trade Agreements
// Boosts both players' resource production for 24h.
// ─────────────────────────────────────────────

export async function proposeTradeAgreement(params: {
  proposerId:   string;
  receiverId:   string;
  boostPct:     number;   // 5–25%
}): Promise<{ success: boolean; agreementId?: string; error?: string }> {
  const { proposerId, receiverId, boostPct } = params;

  if (boostPct < 5 || boostPct > 25) {
    return { success: false, error: "Trade boost must be between 5% and 25%." };
  }

  const id = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const agreement: DiplomacyAgreement = {
    id,
    type:       "TRADE_AGREEMENT",
    proposerId,
    receiverId,
    proposedAt: Date.now(),
    expiresAt:  null,
    status:     "PENDING",
    terms:      { tradeBoostPct: boostPct, tradeDurationMs: TRADE_AGREEMENT_MS },
  };

  await redis.set(DiplomacyKeys.agreement(id), JSON.stringify(agreement), "PX", 86_400_000);
  await publishPlayerEvent(receiverId, "DIPLOMACY_PROPOSAL", {
    type: "TRADE_AGREEMENT", proposerId, agreementId: id, boostPct,
  });

  return { success: true, agreementId: id };
}

export async function acceptTradeAgreement(params: {
  agreementId: string;
  receiverId:  string;
}): Promise<{ success: boolean; error?: string }> {
  const raw = await redis.get(DiplomacyKeys.agreement(params.agreementId));
  if (!raw) return { success: false, error: "Agreement not found." };

  const agreement: DiplomacyAgreement = JSON.parse(raw);
  if (agreement.receiverId !== params.receiverId) return { success: false, error: "Not your proposal." };

  const expiresAt    = Date.now() + TRADE_AGREEMENT_MS;
  agreement.status   = "ACTIVE";
  agreement.expiresAt = expiresAt;

  await redis.set(DiplomacyKeys.agreement(params.agreementId), JSON.stringify(agreement), "PX", TRADE_AGREEMENT_MS);

  // Cache trade boost for resource tick to pick up
  await redis.set(DiplomacyKeys.tradeBoost(agreement.proposerId), String(agreement.terms.tradeBoostPct), "PX", TRADE_AGREEMENT_MS);
  await redis.set(DiplomacyKeys.tradeBoost(agreement.receiverId), String(agreement.terms.tradeBoostPct), "PX", TRADE_AGREEMENT_MS);

  await publishPlayerEvent(agreement.proposerId, "DIPLOMACY_ACCEPTED", {
    type: "TRADE_AGREEMENT", expiresAt, boostPct: agreement.terms.tradeBoostPct,
  });

  return { success: true };
}

/** Returns active trade boost multiplier for a player (1.0 = no boost) */
export async function getTradeBoostMultiplier(playerId: string): Promise<number> {
  const raw = await redis.get(DiplomacyKeys.tradeBoost(playerId));
  if (!raw) return 1.0;
  return 1.0 + parseInt(raw) / 100;
}

// ─────────────────────────────────────────────
// Espionage
// Players can run covert ops against enemies.
// Each op has a success probability and a cooldown.
// Counter-intel (ASSASSINATE_SPY) can burn active ops.
// ─────────────────────────────────────────────

const OP_CONFIGS: Record<EspionageOpType, {
  durationMs:     number;
  creditsCost:    number;
  successChance:  number;  // 0–1
  description:    string;
}> = {
  INTEL_RECON:     { durationMs: 3600_000,  creditsCost: 300,  successChance: 0.85, description: "Reveals enemy FOB building levels." },
  SABOTAGE_FACTORY:{ durationMs: 7200_000,  creditsCost: 600,  successChance: 0.60, description: "Halves Steel production for 2h." },
  DISRUPT_COMMS:   { durationMs: 3600_000,  creditsCost: 400,  successChance: 0.70, description: "Disables enemy push notifications for 1h." },
  STEAL_CREDITS:   { durationMs: 5400_000,  creditsCost: 500,  successChance: 0.55, description: "Steals 5% of target's credits." },
  ASSASSINATE_SPY: { durationMs: 1800_000,  creditsCost: 800,  successChance: 0.65, description: "Burns an enemy op currently in progress." },
};

export async function launchEspionageOp(params: {
  agentId:  string;
  targetId: string;
  type:     EspionageOpType;
}): Promise<{ success: boolean; opId?: string; error?: string }> {
  const { agentId, targetId, type } = params;
  const config = OP_CONFIGS[type];

  // Check cooldown
  const onCooldown = await redis.exists(DiplomacyKeys.spyCooldown(agentId, targetId));
  if (onCooldown) return { success: false, error: "Spy cooldown active against this target." };

  const agent = await prisma.player.findUnique({ where: { id: agentId } });
  if (!agent || agent.credits < config.creditsCost) {
    return { success: false, error: `Requires ${config.creditsCost} credits.` };
  }

  await prisma.player.update({
    where: { id: agentId },
    data:  { credits: { decrement: config.creditsCost } },
  });

  const opId       = `spy_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const completesAt = Date.now() + config.durationMs;

  const op: EspionageOp = {
    opId, type, agentId, targetId,
    startedAt:   Date.now(),
    completesAt,
    status: "IN_PROGRESS",
  };

  await redis.set(DiplomacyKeys.espionageOp(opId), JSON.stringify(op), "PX", config.durationMs + 3_600_000);
  await redis.zadd(DiplomacyKeys.espionageQueue, completesAt, opId);
  await redis.set(DiplomacyKeys.spyCooldown(agentId, targetId), "1", "PX", ESPIONAGE_COOLDOWN_MS);

  return { success: true, opId };
}

/** Processed by timer service */
export async function processDueEspionageOps(now: number): Promise<void> {
  const pipeline = redis.pipeline();
  pipeline.zrangebyscore(DiplomacyKeys.espionageQueue, "-inf", now);
  pipeline.zremrangebyscore(DiplomacyKeys.espionageQueue, "-inf", now);
  const results = await pipeline.exec();
  if (!results?.[0]?.[1]) return;

  const opIds = results[0][1] as string[];
  for (const opId of opIds) {
    await resolveEspionageOp(opId);
  }
}

async function resolveEspionageOp(opId: string): Promise<void> {
  const raw = await redis.get(DiplomacyKeys.espionageOp(opId));
  if (!raw) return;
  const op: EspionageOp = JSON.parse(raw);
  if (op.status !== "IN_PROGRESS") return;

  const config  = OP_CONFIGS[op.type];
  const success = Math.random() < config.successChance;

  op.status = success ? "SUCCESS" : "FAILED";
  op.result = {};

  if (success) {
    switch (op.type) {
      case "INTEL_RECON": {
        const fob = await prisma.fOB.findUnique({
          where: { playerId: op.targetId },
          include: { buildings: { select: { buildingType: true, level: true } } },
        });
        op.result = { buildings: fob?.buildings ?? [] };
        break;
      }
      case "SABOTAGE_FACTORY": {
        await redis.set(`sabotage:factory:${op.targetId}`, "1", "PX", 7_200_000);
        await publishPlayerEvent(op.targetId, "BASE_SABOTAGED", {
          effect: "Steel production halved for 2 hours.",
        });
        break;
      }
      case "DISRUPT_COMMS": {
        await redis.set(`comms:disrupted:${op.targetId}`, "1", "PX", 3_600_000);
        break;
      }
      case "STEAL_CREDITS": {
        const target = await prisma.player.findUnique({ where: { id: op.targetId } });
        if (target) {
          const stolen = Math.floor(target.credits * 0.05);
          await prisma.$transaction([
            prisma.player.update({ where: { id: op.targetId },  data: { credits: { decrement: stolen } } }),
            prisma.player.update({ where: { id: op.agentId },   data: { credits: { increment: stolen } } }),
          ]);
          op.result = { stolen };
        }
        break;
      }
      case "ASSASSINATE_SPY": {
        // Find an active op by target against agent and burn it
        const queueItems = await redis.zrangebyscore(DiplomacyKeys.espionageQueue, "-inf", "+inf");
        for (const targetOpId of queueItems) {
          const targetRaw = await redis.get(DiplomacyKeys.espionageOp(targetOpId));
          if (!targetRaw) continue;
          const targetOp: EspionageOp = JSON.parse(targetRaw);
          if (targetOp.agentId === op.targetId && targetOp.targetId === op.agentId && targetOp.status === "IN_PROGRESS") {
            targetOp.status = "BURNED";
            await redis.set(DiplomacyKeys.espionageOp(targetOpId), JSON.stringify(targetOp), "KEEPTTL");
            await redis.zrem(DiplomacyKeys.espionageQueue, targetOpId);
            op.result = { burnedOpId: targetOpId };
            await publishPlayerEvent(op.targetId, "SPY_BURNED", { opId: targetOpId });
            break;
          }
        }
        break;
      }
    }
  }

  await redis.set(DiplomacyKeys.espionageOp(opId), JSON.stringify(op), "KEEPTTL");
  await publishPlayerEvent(op.agentId, "ESPIONAGE_COMPLETE", {
    opId, type: op.type, success, result: op.result,
  });
}
