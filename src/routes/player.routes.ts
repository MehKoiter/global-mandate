// =============================================================
// Global Mandate — Player Routes
// POST /register, POST /login, GET /player/status
// =============================================================

import type { FastifyInstance } from "fastify";
import { prisma }               from "../lib/prisma.js";
import * as crypto              from "crypto";
import { calculateResources }   from "../lib/resources.js";
import { recalculateNetFlow }   from "../lib/netflow.js";

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(derived), Buffer.from(hash));
}

export async function playerRoutes(fastify: FastifyInstance) {
  // POST /api/v1/player/register
  fastify.post<{
    Body: { username: string; email: string; password: string };
  }>("/player/register", async (req, reply) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return reply.status(400).send({ error: "username, email, and password are required" });
    }
    if (password.length < 8) {
      return reply.status(400).send({ error: "Password must be at least 8 characters" });
    }

    const existing = await prisma.player.findFirst({
      where: { OR: [{ username }, { email }] },
      select: { id: true },
    });
    if (existing) {
      return reply.status(409).send({ error: "Username or email already taken" });
    }

    // Grab the first sector to anchor the FOB zone (world must be seeded)
    const sector = await prisma.sector.findFirst({ select: { id: true } });
    if (!sector) {
      return reply.status(503).send({ error: "World not initialised. Run npm run seed first." });
    }

    const { player } = await prisma.$transaction(async (tx) => {
      const p = await tx.player.create({
        data: { username, email, passwordHash: hashPassword(password) },
        select: { id: true, username: true, createdAt: true },
      });

      const zone = await tx.zone.create({
        data: {
          name:          `${username}'s Command Post`,
          sectorId:      sector.id,
          q:             0,
          r:             0,
          ownerPlayerId: p.id,
          capturedAt:    new Date(),
        },
      });

      await tx.fOB.create({
        data: {
          playerId: p.id,
          zoneId:   zone.id,
          buildings: {
            create: [
              { buildingType: "COMMAND_CENTER" },
              { buildingType: "COMM_CENTER"    },
              { buildingType: "WAREHOUSE"      },
              { buildingType: "HYDRO_BAY"      },
            ],
          },
        },
      });

      return { player: p };
    });

    await recalculateNetFlow(player.id);

    const token = fastify.jwt.sign({ playerId: player.id });
    return reply.status(201).send({ player, token });
  });

  // POST /api/v1/player/login
  fastify.post<{
    Body: { login: string; password: string };
  }>("/player/login", async (req, reply) => {
    const { login: loginId, password } = req.body;

    if (!loginId || !password) {
      return reply.status(400).send({ error: "username/email and password are required" });
    }

    const player = await prisma.player.findFirst({
      where: { OR: [{ email: loginId }, { username: loginId }] },
      select: { id: true, username: true, passwordHash: true },
    });
    if (!player || !verifyPassword(password, player.passwordHash)) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    await prisma.player.update({
      where:  { id: player.id },
      data:   { lastActiveAt: new Date() },
    });

    const token = fastify.jwt.sign({ playerId: player.id });
    return reply.send({ playerId: player.id, username: player.username, token });
  });

  // GET /api/v1/player/status
  fastify.get("/player/status", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { playerId } = req.user;

    const player = await calculateResources(playerId);

    return reply.send({
      id:               player.id,
      username:         player.username,
      fuel:             player.fuel,
      rations:          player.rations,
      steel:            player.steel,
      credits:          player.credits,
      maxCommandPoints: player.maxCommandPoints,
      usedCommandPoints: player.usedCommandPoints,
      fuelNetPerHour:   player.fuelNetPerHour,
      rationsNetPerHour: player.rationsNetPerHour,
      steelNetPerHour:  player.steelNetPerHour,
      creditsNetPerHour: player.creditsNetPerHour,
      tutorialStep:     player.tutorialStep,
      tutorialComplete: player.tutorialComplete,
      newPlayerProtectionEndsAt: player.newPlayerProtectionEndsAt,
    });
  });
}
