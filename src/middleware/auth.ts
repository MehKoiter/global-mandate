// =============================================================
// Global Mandate — JWT Auth Middleware
// =============================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import "@fastify/jwt";
import { prisma } from "../lib/prisma.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    user: { playerId: string };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export function registerAuth(fastify: FastifyInstance): void {
  fastify.decorate(
    "authenticate",
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        await req.jwtVerify();
      } catch {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      // Confirm the player still exists — handles wiped DB / deleted accounts
      const exists = await prisma.player.findUnique({
        where:  { id: req.user.playerId },
        select: { id: true },
      });
      if (!exists) {
        return reply.status(401).send({ error: "Session expired — please log in again" });
      }
    },
  );
}
