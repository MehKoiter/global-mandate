// =============================================================
// Global Mandate — Base (FOB) Routes
// GET /base, POST /base/upgrade, GET /base/bunker
// =============================================================

import type { FastifyInstance } from "fastify";
import { BuildingType }               from "@prisma/client";
import { prisma }                     from "../lib/prisma.js";
import { calculateResources }         from "../lib/resources.js";
import { recalculateNetFlow }         from "../lib/netflow.js";
import { getBuildingUpgradeCost }     from "../lib/buildings.js";
import { publishPlayerEvent }         from "../lib/redis.js";

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

    const anyUpgrading = fob.buildings.some(b => b.isUpgrading);
    if (anyUpgrading) return reply.status(409).send({ error: "Another building is already upgrading" });

    const building = fob.buildings.find(b => b.buildingType === bType);
    if (!building) return reply.status(404).send({ error: "Building not found in your FOB" });

    const cost = getBuildingUpgradeCost(bType, building.level);
    if (!cost) {
      return reply.status(409).send({ error: "Building is already at max level" });
    }

    if (player.steel < cost.steelCost || player.credits < cost.creditCost) {
      return reply.status(402).send({
        error:     "Insufficient resources",
        required:  { steel: cost.steelCost, credits: cost.creditCost },
        available: { steel: player.steel,   credits: player.credits },
      });
    }

    const upgradeEndsAt = new Date(Date.now() + cost.buildTimeMinutes * 60 * 1000);

    const updatedBuilding = await prisma.$transaction(async (tx) => {
      await tx.player.update({
        where: { id: playerId },
        data: {
          steel:   { decrement: cost.steelCost   },
          credits: { decrement: cost.creditCost  },
        },
      });
      return tx.building.update({
        where: { id: building.id },
        data:  { isUpgrading: true, upgradeEndsAt },
      });
    });

    await recalculateNetFlow(playerId);

    await publishPlayerEvent(playerId, "BUILDING_UPGRADE_STARTED", {
      buildingType,
      newLevel:    building.level + 1,
      completesAt: upgradeEndsAt.toISOString(),
      message:     `${buildingType.replace(/_/g, " ")} upgrade to Level ${building.level + 1} started`,
    });

    return reply.send({ building: updatedBuilding, upgradeEndsAt });
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
