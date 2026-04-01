// =============================================================
// Global Mandate — Map Routes
// GET /map/sectors, GET /map/zone/:zoneId, GET /map/signal
// =============================================================

import type { FastifyInstance } from "fastify";
import { prisma }               from "../lib/prisma.js";

export async function mapRoutes(fastify: FastifyInstance) {
  // GET /api/v1/map/sectors — full sector/zone overview (public production hidden)
  fastify.get("/map/sectors", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;

    const sectors = await prisma.sector.findMany({
      include: {
        zones: {
          select: {
            id:             true,
            name:           true,
            q:              true,
            r:              true,
            ownerPlayerId:  true,
            fortificationLevel: true,
            hasRoad:        true,
            bridgeDestroyed: true,
            isConnected:    true,
            capturedAt:     true,
            // Only expose yield to the owner
            fuelPerHour:    true,
            rationsPerHour: true,
            steelPerHour:   true,
            creditsPerHour: true,
          },
        },
      },
    });

    // Scrub production data from zones the player doesn't own
    const sanitised = sectors.map(sector => ({
      ...sector,
      zones: sector.zones.map(zone => {
        if (zone.ownerPlayerId === playerId) return zone;
        return {
          ...zone,
          fuelPerHour:    null,
          rationsPerHour: null,
          steelPerHour:   null,
          creditsPerHour: null,
        };
      }),
    }));

    return reply.send({ sectors: sanitised });
  });

  // GET /api/v1/map/zone/:zoneId — detailed zone info + units present
  fastify.get<{
    Params: { zoneId: string };
  }>("/map/zone/:zoneId", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;
    const { zoneId }   = req.params;

    const zone = await prisma.zone.findUnique({
      where:   { id: zoneId },
      include: {
        sector: { select: { id: true, name: true } },
        units: {
          where:  { status: { not: "TRAINING" } },
          select: { id: true, unitType: true, quantity: true, healthPct: true, ownerId: true, status: true },
        },
        bunkerSlots: {
          include: { unit: { select: { id: true, unitType: true, quantity: true, ownerId: true } } },
        },
      },
    });

    if (!zone) return reply.status(404).send({ error: "Zone not found" });

    // Units belonging to other players are partially hidden
    const sanitisedUnits = zone.units.map(u => {
      if (u.ownerId === playerId) return u;
      return { id: u.id, unitType: u.unitType, quantity: u.quantity, ownerId: u.ownerId, status: u.status, healthPct: null };
    });

    return reply.send({
      zone: {
        ...zone,
        // Hide yield for zones not owned by requesting player
        fuelPerHour:    zone.ownerPlayerId === playerId ? zone.fuelPerHour    : null,
        rationsPerHour: zone.ownerPlayerId === playerId ? zone.rationsPerHour : null,
        steelPerHour:   zone.ownerPlayerId === playerId ? zone.steelPerHour   : null,
        creditsPerHour: zone.ownerPlayerId === playerId ? zone.creditsPerHour : null,
        units: sanitisedUnits,
      },
    });
  });

  // GET /api/v1/map/scout-reports — active scout reports for the requesting player
  fastify.get("/map/scout-reports", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;

    const reports = await prisma.scoutReport.findMany({
      where:   { scouterId: playerId, expiresAt: { gt: new Date() } },
      orderBy: { reportedAt: "desc" },
    });

    return reply.send({ reports });
  });

  // GET /api/v1/map/signal — all owned zones with their signal chain status
  fastify.get("/map/signal", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;

    const zones = await prisma.zone.findMany({
      where:  { ownerPlayerId: playerId },
      select: {
        id:                true,
        name:              true,
        q:                 true,
        r:                 true,
        isConnected:       true,
        signalSourceZoneId: true,
      },
    });

    return reply.send({ zones });
  });
}
