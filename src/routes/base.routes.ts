// =============================================================
// Global Mandate — Base (FOB) Routes
// GET /base, POST /base/upgrade, GET /base/bunker
// =============================================================

import type { FastifyInstance } from "fastify";
import { BuildingType }               from "@prisma/client";
import { prisma }                     from "../lib/prisma.js";
import { calculateResources }         from "../lib/resources.js";
import { recalculateNetFlow }         from "../lib/netflow.js";

// Upgrade costs per building level (indexed by current level → cost to reach next)
const UPGRADE_COST: Record<BuildingType, { steel: number; credits: number; fuel: number }> = {
  COMMAND_CENTER:    { steel: 300, credits: 500, fuel: 100 },
  COMM_CENTER:       { steel: 200, credits: 300, fuel:  50 },
  WAREHOUSE:         { steel: 150, credits: 200, fuel:  30 },
  TOC:               { steel: 250, credits: 400, fuel:  80 },
  LIGHT_VEHICLE_SHOP:{ steel: 400, credits: 600, fuel: 120 },
  HEAVY_FACTORY:     { steel: 600, credits: 900, fuel: 200 },
  RADIO_TOWER:       { steel: 180, credits: 250, fuel:  40 },
  BUNKER:            { steel: 350, credits: 450, fuel:  90 },
  HYDRO_BAY:         { steel: 200, credits: 280, fuel:  60 },
};
const UPGRADE_TIME_S = 3600; // 1 hour per level

export async function baseRoutes(fastify: FastifyInstance) {
  // GET /api/v1/base — returns FOB buildings and their status
  fastify.get("/base", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;
    await calculateResources(playerId);

    const fob = await prisma.fOB.findUnique({
      where:   { playerId },
      include: { buildings: true },
    });
    if (!fob) {
      return reply.status(404).send({
        message: "No FOB found for this player. This should not happen — please re-register.",
      });
    }
    return reply.send({ fob });
  });

  // POST /api/v1/base/upgrade — start a building upgrade
  fastify.post<{
    Body: { buildingType: string };
  }>("/base/upgrade", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;
    const { buildingType } = req.body;

    if (!buildingType) {
      return reply.status(400).send({ error: "buildingType is required" });
    }
    if (!(buildingType in BuildingType)) {
      return reply.status(400).send({ error: "Invalid buildingType" });
    }
    const bType = buildingType as BuildingType;

    const player = await calculateResources(playerId);
    const fob    = await prisma.fOB.findUnique({
      where:   { playerId },
      include: { buildings: true },
    });
    if (!fob) return reply.status(404).send({ error: "FOB not found" });

    const building = fob.buildings.find(b => b.buildingType === bType);
    if (!building) return reply.status(404).send({ error: "Building not found in your FOB" });
    if (building.isUpgrading) return reply.status(409).send({ error: "Building is already upgrading" });

    const cost = UPGRADE_COST[bType];
    if (
      player.steel   < cost.steel   ||
      player.credits < cost.credits ||
      player.fuel    < cost.fuel
    ) {
      return reply.status(402).send({
        error: "Insufficient resources",
        required: cost,
        available: { steel: player.steel, credits: player.credits, fuel: player.fuel },
      });
    }

    const upgradeEndsAt = new Date(Date.now() + UPGRADE_TIME_S * building.level * 1000);

    await prisma.$transaction([
      prisma.player.update({
        where: { id: playerId },
        data: {
          steel:   player.steel   - cost.steel,
          credits: player.credits - cost.credits,
          fuel:    player.fuel    - cost.fuel,
        },
      }),
      prisma.building.update({
        where: { id: building.id },
        data: { isUpgrading: true, upgradeEndsAt },
      }),
    ]);

    return reply.send({ message: "Upgrade started", upgradeEndsAt });
  });

  // GET /api/v1/base/bunker — lists units currently sheltered in the FOB bunker
  fastify.get("/base/bunker", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;

    const fob = await prisma.fOB.findUnique({
      where:  { playerId },
      select: { zoneId: true },
    });
    if (!fob) return reply.status(404).send({ error: "FOB not found" });

    const bunkerSlots = await prisma.bunkerSlot.findMany({
      where:   { zoneId: fob.zoneId },
      include: { unit: { select: { id: true, unitType: true, quantity: true, healthPct: true } } },
      orderBy: { shelterPriority: "desc" },
    });

    return reply.send({ bunkerSlots });
  });
}
