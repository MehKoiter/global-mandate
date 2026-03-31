// =============================================================
// Global Mandate — JWT Auth Middleware
// =============================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import "@fastify/jwt";

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
        await reply.status(401).send({ error: "Unauthorized" });
      }
    },
  );
}
