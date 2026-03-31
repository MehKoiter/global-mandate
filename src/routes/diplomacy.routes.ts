// =============================================================
// Global Mandate — Diplomacy Routes
// POST /diplomacy/nap/propose, POST /diplomacy/nap/accept
// POST /diplomacy/ceasefire/propose, POST /diplomacy/ceasefire/accept
// POST /diplomacy/trade/propose,     POST /diplomacy/trade/accept
// POST /diplomacy/tribute/propose,   POST /diplomacy/tribute/accept
// POST /diplomacy/espionage/launch
// GET  /diplomacy/agreements
// =============================================================

import type { FastifyInstance } from "fastify";
import {
  proposeNAP,
  acceptNAP,
  proposeCeaseFire,
  acceptCeaseFire,
  proposeTradeAgreement,
  acceptTradeAgreement,
  proposeTribute,
  acceptTribute,
  launchEspionageOp,
  type EspionageOpType,
} from "../services/diplomacy.js";
import { redis } from "../lib/redis.js";

// Redis key mirrors diplomacy.ts DiplomacyKeys.agreement
const agreementKey = (id: string) => `diplo:${id}`;

export async function diplomacyRoutes(fastify: FastifyInstance) {
  // POST /api/v1/diplomacy/nap/propose
  fastify.post<{
    Body: { receiverId: string };
  }>("/diplomacy/nap/propose", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;
    const { receiverId } = req.body;
    if (!receiverId) return reply.status(400).send({ error: "receiverId is required" });

    const agreement = await proposeNAP({ proposerId: playerId, receiverId });
    return reply.status(201).send({ agreement });
  });

  // POST /api/v1/diplomacy/nap/accept
  fastify.post<{
    Body: { agreementId: string };
  }>("/diplomacy/nap/accept", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId }    = req.user;
    const { agreementId } = req.body;
    if (!agreementId) return reply.status(400).send({ error: "agreementId is required" });

    const agreement = await acceptNAP({ agreementId, receiverId: playerId });
    return reply.send({ agreement });
  });

  // POST /api/v1/diplomacy/ceasefire/propose
  fastify.post<{
    Body: { receiverId: string };
  }>("/diplomacy/ceasefire/propose", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;
    const { receiverId } = req.body;
    if (!receiverId) return reply.status(400).send({ error: "receiverId is required" });

    const agreement = await proposeCeaseFire({ proposerId: playerId, receiverId });
    return reply.status(201).send({ agreement });
  });

  // POST /api/v1/diplomacy/ceasefire/accept
  fastify.post<{
    Body: { agreementId: string };
  }>("/diplomacy/ceasefire/accept", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId }    = req.user;
    const { agreementId } = req.body;
    if (!agreementId) return reply.status(400).send({ error: "agreementId is required" });

    const agreement = await acceptCeaseFire({ agreementId, receiverId: playerId });
    return reply.send({ agreement });
  });

  // POST /api/v1/diplomacy/trade/propose
  fastify.post<{
    Body: { receiverId: string; boostPct?: number };
  }>("/diplomacy/trade/propose", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;
    const { receiverId, boostPct } = req.body;
    if (!receiverId) return reply.status(400).send({ error: "receiverId is required" });
    if (boostPct === undefined) return reply.status(400).send({ error: "boostPct is required (5–25)" });

    const agreement = await proposeTradeAgreement({ proposerId: playerId, receiverId, boostPct });
    return reply.status(201).send({ agreement });
  });

  // POST /api/v1/diplomacy/trade/accept
  fastify.post<{
    Body: { agreementId: string };
  }>("/diplomacy/trade/accept", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId }    = req.user;
    const { agreementId } = req.body;
    if (!agreementId) return reply.status(400).send({ error: "agreementId is required" });

    const agreement = await acceptTradeAgreement({ agreementId, receiverId: playerId });
    return reply.send({ agreement });
  });

  // POST /api/v1/diplomacy/tribute/propose
  fastify.post<{
    Body: {
      receiverId:     string;
      fuelPerHour:    number;
      rationsPerHour: number;
      steelPerHour:   number;
      creditsPerHour: number;
      durationHours:  number;
    };
  }>("/diplomacy/tribute/propose", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;
    const { receiverId, fuelPerHour, rationsPerHour, steelPerHour, creditsPerHour, durationHours } = req.body;
    if (!receiverId) return reply.status(400).send({ error: "receiverId is required" });

    const agreement = await proposeTribute({
      payerId:    playerId,
      receiverId,
      fuelPerHour:    fuelPerHour    ?? 0,
      rationsPerHour: rationsPerHour ?? 0,
      steelPerHour:   steelPerHour   ?? 0,
      creditsPerHour: creditsPerHour ?? 0,
      durationHours:  durationHours  ?? 24,
    });
    return reply.status(201).send({ agreement });
  });

  // POST /api/v1/diplomacy/tribute/accept
  fastify.post<{
    Body: { agreementId: string };
  }>("/diplomacy/tribute/accept", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId }    = req.user;
    const { agreementId } = req.body;
    if (!agreementId) return reply.status(400).send({ error: "agreementId is required" });

    const agreement = await acceptTribute({ agreementId, receiverId: playerId });
    return reply.send({ agreement });
  });

  // POST /api/v1/diplomacy/espionage/launch
  fastify.post<{
    Body: { targetId: string; opType: string };
  }>("/diplomacy/espionage/launch", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;
    const { targetId, opType } = req.body;

    if (!targetId || !opType) {
      return reply.status(400).send({ error: "targetId and opType are required" });
    }

    const validOpTypes: EspionageOpType[] = [
      "INTEL_RECON", "SABOTAGE_FACTORY", "DISRUPT_COMMS",
      "STEAL_CREDITS", "ASSASSINATE_SPY",
    ];
    if (!validOpTypes.includes(opType as EspionageOpType)) {
      return reply.status(400).send({ error: "Invalid opType", valid: validOpTypes });
    }

    const op = await launchEspionageOp({
      agentId:  playerId,
      targetId,
      type:     opType as EspionageOpType,
    });
    return reply.status(201).send({ op });
  });

  // GET /api/v1/diplomacy/agreements — list active agreements for this player
  fastify.get("/diplomacy/agreements", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;

    // Agreements are stored in Redis; scan for keys involving this player
    const napKeys      = await redis.keys(`nap:*${playerId}*`);
    const ceasefireKeys = await redis.keys(`ceasefire:*${playerId}*`);
    const tradeKey     = await redis.get(`trade:${playerId}`);

    const naps = await Promise.all(
      napKeys.map(k => redis.get(k)),
    );
    const ceasefires = await Promise.all(
      ceasefireKeys.map(k => redis.get(k)),
    );

    return reply.send({
      naps:        naps.filter(Boolean),
      ceasefires:  ceasefires.filter(Boolean),
      tradeBoostPct: tradeKey ? parseInt(tradeKey) : null,
    });
  });
}
