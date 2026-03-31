// =============================================================
// Global Mandate — Season Routes
// GET /season/status, GET /season/leaderboard
// =============================================================

import type { FastifyInstance } from "fastify";
import {
  getCurrentSeason,
  getLeaderboardPage,
} from "../services/season.js";

export async function seasonRoutes(fastify: FastifyInstance) {
  // GET /api/v1/season/status
  fastify.get("/season/status", {
    preHandler: fastify.authenticate,
  }, async (_req, reply) => {
    const season = await getCurrentSeason();
    if (!season) return reply.status(404).send({ error: "No active season" });
    return reply.send({ season });
  });

  // GET /api/v1/season/leaderboard?page=1&pageSize=20
  fastify.get<{
    Querystring: { page?: string; pageSize?: string };
  }>("/season/leaderboard", {
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const season = await getCurrentSeason();
    if (!season) return reply.status(404).send({ error: "No active season" });

    const page     = Math.max(1, parseInt(req.query.page     ?? "1",  10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize ?? "20", 10)));

    const entries = await getLeaderboardPage(season.seasonId, page, pageSize);
    return reply.send({ seasonId: season.seasonId, page, pageSize, entries });
  });
}
