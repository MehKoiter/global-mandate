// =============================================================
// Global Mandate — Fastify Server Entry Point
// =============================================================

import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import websocket from "@fastify/websocket";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";

import { registerAuth } from "./middleware/auth.js";
import { getCurrentSeason, startNewSeason } from "./services/season.js";

import { playerRoutes } from "./routes/player.routes.js";
import { baseRoutes }   from "./routes/base.routes.js";
import { squadRoutes }  from "./routes/squad.routes.js";
import { combatRoutes } from "./routes/combat.routes.js";
import { mapRoutes }    from "./routes/map.routes.js";
import { diplomacyRoutes } from "./routes/diplomacy.routes.js";
import { seasonRoutes } from "./routes/season.routes.js";
import { wsRoutes }     from "./routes/ws.routes.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function buildServer() {
  const fastify = Fastify({ logger: true });

  // ── Security ─────────────────────────────────────────────────
  await fastify.register(helmet, { contentSecurityPolicy: false });
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN ?? "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  });
  await fastify.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  // ── Auth ─────────────────────────────────────────────────────
  await fastify.register(jwt, {
    secret: process.env.JWT_SECRET ?? (() => { throw new Error("JWT_SECRET not set"); })(),
  });
  registerAuth(fastify);

  // ── WebSocket ─────────────────────────────────────────────────
  await fastify.register(websocket);

  // ── Routes ───────────────────────────────────────────────────
  await fastify.register(playerRoutes,    { prefix: "/api/v1" });
  await fastify.register(baseRoutes,      { prefix: "/api/v1" });
  await fastify.register(squadRoutes,     { prefix: "/api/v1" });
  await fastify.register(combatRoutes,    { prefix: "/api/v1" });
  await fastify.register(mapRoutes,       { prefix: "/api/v1" });
  await fastify.register(diplomacyRoutes, { prefix: "/api/v1" });
  await fastify.register(seasonRoutes,    { prefix: "/api/v1" });
  await fastify.register(wsRoutes,        { prefix: "/api/v1" });

  return fastify;
}

async function main() {
  const fastify = await buildServer();

  // ── Season bootstrap ─────────────────────────────────────────
  const activeSeason = await getCurrentSeason();
  if (!activeSeason) {
    const seasonName = `Season ${new Date().getFullYear()}-1`;
    await startNewSeason(seasonName);
    fastify.log.info(`Started new season: ${seasonName}`);
  }

  try {
    await fastify.listen({ port: PORT, host: "0.0.0.0" });
    fastify.log.info(`Server listening on port ${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
