// =============================================================
// Global Mandate — Squad Routes
// GET /squads, POST /squads/create, POST /squads/:squadId/deploy,
// POST /squads/:squadId/retreat
// =============================================================

import type { FastifyInstance } from "fastify";
import { prisma }               from "../lib/prisma.js";
import { redis }                from "../lib/redis.js";
import { calculateResources }   from "../lib/resources.js";

const squadUnitsKey = (squadId: string) => `squad:${squadId}:units`;

export async function squadRoutes(fastify: FastifyInstance) {
  // GET /api/v1/squads — list all squads for the authenticated player
  fastify.get("/squads", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;

    const squads = await prisma.squad.findMany({
      where:   { ownerId: playerId },
      include: { currentZone: { select: { id: true, name: true, q: true, r: true } } },
      orderBy: { createdAt: "asc" },
    });

    // Attach unit IDs from Redis
    const squadsWithUnits = await Promise.all(
      squads.map(async (squad) => {
        const raw = await redis.get(squadUnitsKey(squad.id));
        const unitIds: string[] = raw ? (JSON.parse(raw) as string[]) : [];
        return { ...squad, unitIds };
      }),
    );

    return reply.send({ squads: squadsWithUnits });
  });

  // POST /api/v1/squads/create — create a new squad and assign units
  fastify.post<{
    Body: { name: string; unitIds: string[]; rationsToLoad?: number; fuelToLoad?: number };
  }>("/squads/create", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;
    const { name, unitIds, rationsToLoad = 0, fuelToLoad = 0 } = req.body;

    if (!name || !Array.isArray(unitIds) || unitIds.length === 0) {
      return reply.status(400).send({ error: "name and at least one unitId are required" });
    }

    const player = await calculateResources(playerId);
    const fob    = await prisma.fOB.findUnique({ where: { playerId }, select: { id: true } });
    if (!fob) return reply.status(404).send({ error: "FOB not found" });

    // Verify units exist, belong to player, and are IDLE
    const units = await prisma.unit.findMany({
      where: { id: { in: unitIds }, ownerId: playerId, status: "IDLE" },
      select: { id: true },
    });
    if (units.length !== unitIds.length) {
      return reply.status(400).send({ error: "One or more units are invalid, not owned by you, or not IDLE" });
    }

    if (rationsToLoad > player.rations || fuelToLoad > player.fuel) {
      return reply.status(402).send({ error: "Insufficient resources to load into squad" });
    }

    const squad = await prisma.$transaction(async (tx) => {
      const s = await tx.squad.create({
        data: {
          name,
          fobId:       fob.id,
          ownerId:     playerId,
          rationsHeld: rationsToLoad,
          fuelHeld:    fuelToLoad,
        },
      });
      if (rationsToLoad > 0 || fuelToLoad > 0) {
        await tx.player.update({
          where: { id: playerId },
          data: {
            rations: player.rations - rationsToLoad,
            fuel:    player.fuel    - fuelToLoad,
          },
        });
      }
      return s;
    });

    await redis.set(squadUnitsKey(squad.id), JSON.stringify(unitIds));

    return reply.status(201).send({ squad });
  });

  // POST /api/v1/squads/:squadId/deploy — deploy squad to a target zone
  fastify.post<{
    Params: { squadId: string };
    Body:   { destinationZoneId: string };
  }>("/squads/:squadId/deploy", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;
    const { squadId }  = req.params;
    const { destinationZoneId } = req.body;

    if (!destinationZoneId) {
      return reply.status(400).send({ error: "destinationZoneId is required" });
    }

    const squad = await prisma.squad.findUnique({ where: { id: squadId } });
    if (!squad || squad.ownerId !== playerId) {
      return reply.status(404).send({ error: "Squad not found" });
    }
    if (squad.status !== "STAGING") {
      return reply.status(409).send({ error: `Squad cannot be deployed from status ${squad.status}` });
    }

    const zone = await prisma.zone.findUnique({
      where:  { id: destinationZoneId },
      select: { id: true, name: true },
    });
    if (!zone) return reply.status(404).send({ error: "Destination zone not found" });

    await prisma.squad.update({
      where: { id: squadId },
      data:  { status: "DEPLOYED", currentZoneId: destinationZoneId },
    });

    return reply.send({ message: `Squad deployed to ${zone.name}` });
  });

  // POST /api/v1/squads/:squadId/retreat — recall squad back to FOB
  fastify.post<{
    Params: { squadId: string };
  }>("/squads/:squadId/retreat", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;
    const { squadId }  = req.params;

    const squad = await prisma.squad.findUnique({ where: { id: squadId } });
    if (!squad || squad.ownerId !== playerId) {
      return reply.status(404).send({ error: "Squad not found" });
    }
    if (squad.status !== "DEPLOYED") {
      return reply.status(409).send({ error: `Squad cannot retreat from status ${squad.status}` });
    }

    await prisma.squad.update({
      where: { id: squadId },
      data:  { status: "RETREATING" },
    });

    return reply.send({ message: "Squad is retreating to FOB" });
  });
}
