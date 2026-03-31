// =============================================================
// Global Mandate — Combat Routes
// GET /battles/active, GET /battles/:battleId,
// POST /battles/:battleId/retreat
// =============================================================

import type { FastifyInstance } from "fastify";
import { prisma }               from "../lib/prisma.js";

export async function combatRoutes(fastify: FastifyInstance) {
  // GET /api/v1/battles/active — battles in progress for this player
  fastify.get("/battles/active", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;

    const battles = await prisma.battle.findMany({
      where: {
        resolvedAt: null,
        OR: [
          { attackerPlayerId: playerId },
          { defenderPlayerId: playerId },
        ],
      },
      include: {
        zone:     { select: { id: true, name: true, q: true, r: true } },
        attacker: { select: { id: true, username: true } },
        defender: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return reply.send({ battles });
  });

  // GET /api/v1/battles/:battleId — full battle report
  fastify.get<{
    Params: { battleId: string };
  }>("/battles/:battleId", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;
    const { battleId } = req.params;

    const battle = await prisma.battle.findUnique({
      where:   { id: battleId },
      include: {
        zone:     { select: { id: true, name: true } },
        attacker: { select: { id: true, username: true } },
        defender: { select: { id: true, username: true } },
        rounds:   { orderBy: { roundNumber: "asc" } },
        raidLog:  true,
      },
    });

    if (!battle) return reply.status(404).send({ error: "Battle not found" });

    // Only participants can view the full report
    if (battle.attackerPlayerId !== playerId && battle.defenderPlayerId !== playerId) {
      return reply.status(403).send({ error: "Not a participant in this battle" });
    }

    return reply.send({ battle });
  });

  // POST /api/v1/battles/:battleId/retreat — attacker voluntarily retreats
  fastify.post<{
    Params: { battleId: string };
  }>("/battles/:battleId/retreat", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;
    const { battleId } = req.params;

    const battle = await prisma.battle.findUnique({
      where:  { id: battleId },
      select: { id: true, attackerPlayerId: true, resolvedAt: true },
    });

    if (!battle) return reply.status(404).send({ error: "Battle not found" });
    if (battle.attackerPlayerId !== playerId) {
      return reply.status(403).send({ error: "Only the attacker can retreat" });
    }
    if (battle.resolvedAt) {
      return reply.status(409).send({ error: "Battle is already resolved" });
    }

    await prisma.battle.update({
      where: { id: battleId },
      data: {
        outcome:    "DEFENDER_VICTORY",
        resolvedAt: new Date(),
      },
    });

    return reply.send({ message: "Retreat successful. Battle resolved as Defender Victory." });
  });
}
