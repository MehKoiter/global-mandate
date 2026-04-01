// =============================================================
// Global Mandate — WebSocket Route
// WS /api/v1/ws?token=<jwt>
//
// On connect: verify JWT from query param, subscribe to:
//   - player:{playerId}:events
//   - zone:{zoneId}:events for all zones the player owns
//
// All Redis pub/sub messages are forwarded to the client as-is.
// =============================================================

import type { FastifyInstance } from "fastify";
import type { WebSocket }       from "ws";
import { Redis }                from "ioredis";
import { prisma }               from "../lib/prisma.js";

export async function wsRoutes(fastify: FastifyInstance) {
  fastify.get("/ws", { websocket: true }, async (socket: WebSocket, req) => {
    const ws = socket;

    // ── Auth via query param ──────────────────────────────────
    const token = (req.query as Record<string, string>)["token"];
    if (!token) {
      ws.send(JSON.stringify({ error: "Missing token" }));
      ws.close();
      return;
    }

    let playerId: string;
    try {
      const decoded = fastify.jwt.verify<{ playerId: string }>(token);
      playerId = decoded.playerId;
    } catch {
      ws.send(JSON.stringify({ error: "Invalid token" }));
      ws.close();
      return;
    }

    // ── Subscribe on a dedicated Redis connection ─────────────
    // Each WS client gets its own subscriber so we can cleanly
    // unsubscribe on disconnect without affecting other clients.
    const subscriber = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

    const playerChannel = `player:${playerId}:events`;
    await subscriber.subscribe(playerChannel);

    // Subscribe to all zones the player currently owns
    const ownedZones = await prisma.zone.findMany({
      where:  { ownerPlayerId: playerId },
      select: { id: true },
    });
    const zoneChannels = ownedZones.map(z => `zone:${z.id}:events`);
    if (zoneChannels.length > 0) {
      await subscriber.subscribe(...zoneChannels);
    }

    // Forward all pub/sub messages to the WebSocket client
    subscriber.on("message", (_channel: string, message: string) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(message);
      }
    });

    ws.send(JSON.stringify({
      type:    "CONNECTED",
      playerId,
      channels: [playerChannel, ...zoneChannels],
      payload: { message: `Listening on ${1 + zoneChannels.length} channel${zoneChannels.length !== 0 ? "s" : ""}` },
      ts:      Date.now(),
    }));

    // ── Client messages ───────────────────────────────────────
    // Clients can request additional zone subscriptions at runtime
    // (e.g., when they navigate to a new zone on the map).
    ws.on("message", async (raw: Buffer) => {
      let msg: { type?: string; zoneId?: string };
      try {
        msg = JSON.parse(raw.toString()) as { type?: string; zoneId?: string };
      } catch {
        return;
      }

      if (msg.type === "SUBSCRIBE_ZONE" && msg.zoneId) {
        const channel = `zone:${msg.zoneId}:events`;
        await subscriber.subscribe(channel);
        ws.send(JSON.stringify({ type: "SUBSCRIBED", channel }));
      }

      if (msg.type === "UNSUBSCRIBE_ZONE" && msg.zoneId) {
        const channel = `zone:${msg.zoneId}:events`;
        await subscriber.unsubscribe(channel);
        ws.send(JSON.stringify({ type: "UNSUBSCRIBED", channel }));
      }
    });

    // ── Cleanup on disconnect ─────────────────────────────────
    ws.on("close", () => {
      subscriber.disconnect();
    });
  });
}
