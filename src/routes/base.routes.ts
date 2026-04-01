// =============================================================
// Global Mandate — Base (FOB) Routes
// GET /base, POST /base/upgrade, GET /base/bunker
// =============================================================

import type { FastifyInstance } from "fastify";
import { BuildingType }               from "@prisma/client";
import { z }                          from "zod";
import { prisma }                     from "../lib/prisma.js";
import { calculateResources }         from "../lib/resources.js";
import { recalculateNetFlow }         from "../lib/netflow.js";
import { getBuildingUpgradeCost, getConstructionTimeMinutes, BARRACKS_UNIT_UNLOCK } from "../lib/buildings.js";
import { publishPlayerEvent, enqueueTrainCompletion, enqueueBuildCompletion } from "../lib/redis.js";
import { UNIT_STATS }                 from "../lib/combat.js";
import type { UnitType }              from "../lib/combat.js";

// ─── Request schemas ───────────────────────────────────────────

const BuildingTypeSchema = z.nativeEnum(BuildingType);

const UpgradeBody   = z.object({ buildingType: BuildingTypeSchema });
const ConstructBody = z.object({ buildingType: BuildingTypeSchema });
const TrainBody     = z.object({
  unitType: z.string().min(1),
  quantity: z.number().int().min(1).max(50).default(1),
});

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
  fastify.post("/base/upgrade", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;
    const parsed = UpgradeBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request", details: parsed.error.flatten() });
    }
    const { buildingType: bType } = parsed.data;

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

    try {
      await enqueueBuildCompletion({
        buildingId:   building.id,
        fobId:        fob.id,
        playerId,
        buildingType: bType,
        newLevel:     building.level + 1,
        completesAt:  upgradeEndsAt.getTime(),
      });
    } catch (err) {
      // Redis is down — rollback the building state so it isn't stuck upgrading forever
      await prisma.building.update({
        where: { id: building.id },
        data:  { isUpgrading: false, upgradeEndsAt: null },
      });
      fastify.log.error({ err, buildingId: building.id }, "Failed to enqueue build job; upgrade rolled back");
      return reply.status(503).send({ error: "Queue unavailable — please try again" });
    }

    await recalculateNetFlow(playerId);

    await publishPlayerEvent(playerId, "BUILDING_UPGRADE_STARTED", {
      buildingType: bType,
      newLevel:     building.level + 1,
      completesAt:  upgradeEndsAt.toISOString(),
      message:      `${bType.replace(/_/g, " ")} upgrade to Level ${building.level + 1} started`,
    });

    return reply.send({ building: updatedBuilding, upgradeEndsAt });
  });

  // POST /api/v1/base/construct — build a new building (not yet in the FOB)
  fastify.post("/base/construct", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;
    const parsed = ConstructBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request", details: parsed.error.flatten() });
    }
    const { buildingType: bType } = parsed.data;

    const cost = getBuildingUpgradeCost(bType, 0); // cost to go from 0 → 1
    if (!cost) return reply.status(400).send({ error: "This building type cannot be constructed" });

    const player = await calculateResources(playerId);
    const fob    = await prisma.fOB.findUnique({
      where:   { playerId },
      include: { buildings: true },
    });
    if (!fob) return reply.status(404).send({ error: "FOB not found" });

    const alreadyBuilt = fob.buildings.some(b => b.buildingType === bType);
    if (alreadyBuilt) return reply.status(409).send({ error: "Building already exists in your FOB" });

    if (player.steel < cost.steelCost || player.credits < cost.creditCost) {
      return reply.status(402).send({
        error:     "Insufficient resources",
        required:  { steel: cost.steelCost, credits: cost.creditCost },
        available: { steel: player.steel,   credits: player.credits  },
      });
    }

    const constructionEndsAt = new Date(Date.now() + getConstructionTimeMinutes() * 60 * 1000);

    const building = await prisma.$transaction(async (tx) => {
      await tx.player.update({
        where: { id: playerId },
        data: {
          steel:   { decrement: cost.steelCost  },
          credits: { decrement: cost.creditCost },
        },
      });
      // level 0 = under construction; timer will set it to 1 on completion
      return tx.building.create({
        data: { fobId: fob.id, buildingType: bType, level: 0, isUpgrading: true, upgradeEndsAt: constructionEndsAt },
      });
    });

    try {
      await enqueueBuildCompletion({
        buildingId:   building.id,
        fobId:        fob.id,
        playerId,
        buildingType: bType,
        newLevel:     1,
        completesAt:  constructionEndsAt.getTime(),
      });
    } catch (err) {
      // Redis is down — delete the building row so the player isn't charged with nothing to show
      await prisma.building.delete({ where: { id: building.id } });
      fastify.log.error({ err, buildingType: bType }, "Failed to enqueue construction job; creation rolled back");
      return reply.status(503).send({ error: "Queue unavailable — please try again" });
    }

    await publishPlayerEvent(playerId, "BUILDING_CONSTRUCTED", {
      buildingType: bType,
      completesAt:  constructionEndsAt.toISOString(),
      message:      `${bType.replace(/_/g, " ")} construction started`,
    });

    return reply.status(201).send({ building, constructionEndsAt });
  });

  // GET /api/v1/base/training — lists units currently in training
  fastify.get("/base/training", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;
    const training = await prisma.unit.findMany({
      where:   { ownerId: playerId, status: "TRAINING" },
      select:  { id: true, unitType: true, quantity: true, trainingEndsAt: true },
      orderBy: { trainingEndsAt: "asc" },
    });
    return reply.send({ training });
  });

  // POST /api/v1/base/train — start training a unit
  fastify.post("/base/train", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;
    const parsed = TrainBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request", details: parsed.error.flatten() });
    }
    const { unitType, quantity } = parsed.data;

    const stats = UNIT_STATS[unitType as UnitType];
    if (!stats) return reply.status(400).send({ error: "Invalid unitType" });
    if (stats.requiresAirfield) return reply.status(400).send({ error: "This unit requires an airfield, not a barracks" });

    const fob = await prisma.fOB.findUnique({
      where:   { playerId },
      include: { buildings: { where: { buildingType: "BARRACKS" } } },
    });
    if (!fob) return reply.status(404).send({ error: "FOB not found" });

    const barracks = fob.buildings[0];
    if (!barracks) return reply.status(409).send({ error: "No Barracks built. Build a Barracks first." });
    if (!barracks.isOperational) return reply.status(409).send({ error: "Barracks is offline" });
    if (barracks.isUpgrading) return reply.status(409).send({ error: "Barracks is being upgraded" });

    const requiredLevel = BARRACKS_UNIT_UNLOCK[unitType] ?? 1;
    if (barracks.level < requiredLevel) {
      return reply.status(409).send({
        error: `${stats.displayName} requires Barracks level ${requiredLevel} (yours is level ${barracks.level})`,
      });
    }

    // Check training queue capacity (barracks level = max concurrent)
    const inTraining = await prisma.unit.count({ where: { ownerId: playerId, status: "TRAINING" } });
    if (inTraining >= barracks.level) {
      return reply.status(409).send({
        error: `Training queue full (${inTraining}/${barracks.level} slots). Upgrade your Barracks for more slots.`,
      });
    }

    const player = await calculateResources(playerId);
    const cost   = stats.trainingCost;
    const totalCost = {
      fuel:    cost.fuel    * quantity,
      rations: cost.rations * quantity,
      steel:   cost.steel   * quantity,
      credits: cost.credits * quantity,
    };

    if (player.fuel    < totalCost.fuel    ||
        player.rations < totalCost.rations ||
        player.steel   < totalCost.steel   ||
        player.credits < totalCost.credits) {
      return reply.status(402).send({ error: "Insufficient resources", required: totalCost });
    }

    const trainingEndsAt = new Date(Date.now() + stats.trainingTimeSec * 1000 * quantity);

    const unit = await prisma.$transaction(async (tx) => {
      await tx.player.update({
        where: { id: playerId },
        data: {
          fuel:    { decrement: totalCost.fuel    },
          rations: { decrement: totalCost.rations },
          steel:   { decrement: totalCost.steel   },
          credits: { decrement: totalCost.credits },
        },
      });
      return tx.unit.create({
        data: {
          ownerId:        playerId,
          unitType,
          quantity,
          status:         "TRAINING",
          trainingEndsAt,
        },
      });
    });

    await enqueueTrainCompletion({
      unitId:      unit.id,
      playerId,
      unitType,
      quantity,
      completesAt: trainingEndsAt.getTime(),
    });

    await publishPlayerEvent(playerId, "UNIT_TRAINING_STARTED", {
      unitType,
      quantity,
      completesAt: trainingEndsAt.toISOString(),
      message: `${quantity}× ${stats.displayName} training started`,
    });

    return reply.status(201).send({ unit, trainingEndsAt });
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
