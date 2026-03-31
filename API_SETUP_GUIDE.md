# Global Mandate - API Server Setup Guide

This guide provides comprehensive instructions for implementing the API layer to connect your Global Mandate backend with frontend clients.

## 🏗 Architecture Overview

The API server acts as a bridge between your existing game engine and client applications, providing:
- RESTful HTTP endpoints for game actions
- WebSocket connections for real-time updates  
- Authentication middleware
- Request validation and rate limiting
- Integration with existing Redis pub/sub and PostgreSQL

## 📁 Project Structure

```
src/
├── api/
│   ├── server.ts                 // Main API server entry point
│   ├── app.ts                    // Express/Fastify app configuration
│   ├── middleware/
│   │   ├── auth.ts              // JWT authentication middleware
│   │   ├── rateLimit.ts         // API rate limiting
│   │   ├── validation.ts        // Request validation middleware
│   │   ├── cors.ts              // CORS configuration
│   │   └── logging.ts           // Request logging
│   ├── routes/
│   │   ├── index.ts             // Route registration
│   │   ├── auth.ts              // Authentication endpoints
│   │   ├── player.ts            // Player data and operations
│   │   ├── zones.ts             // Map data and zone operations
│   │   ├── units.ts             // Military unit operations
│   │   ├── alliances.ts         // Alliance management
│   │   ├── diplomacy.ts         // Diplomatic operations
│   │   └── admin.ts             // Administrative endpoints
│   ├── websocket/
│   │   ├── server.ts            // WebSocket server setup
│   │   ├── events.ts            // Event type definitions
│   │   ├── handlers.ts          // WebSocket message handlers
│   │   └── rooms.ts             // Room/channel management
│   ├── controllers/
│   │   ├── AuthController.ts    // Authentication logic
│   │   ├── PlayerController.ts  // Player operations
│   │   ├── GameController.ts    // Game state operations
│   │   └── RealtimeController.ts // Real-time event handling
│   ├── services/
│   │   ├── AuthService.ts       // JWT and session management
│   │   ├── GameStateService.ts  // Game state aggregation
│   │   ├── ActionService.ts     // Game action validation/execution
│   │   └── NotificationService.ts // Real-time notifications
│   └── types/
│       ├── api.ts               // API request/response types
│       ├── auth.ts              // Authentication types
│       └── websocket.ts         // WebSocket event types
```

## 🚀 Technology Stack

### Core Framework Choice

**Option A: Express.js (Familiar & Flexible)**
```typescript
// Good for: Rapid development, large ecosystem
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
```

**Option B: Fastify (Performance-focused) - Recommended**
```typescript
// Good for: High performance, built-in validation, TypeScript support
import Fastify from 'fastify';
import fastifyJWT from '@fastify/jwt';
import fastifyWebsocket from '@fastify/websocket';
import fastifyRateLimit from '@fastify/rate-limit';
```

### Dependencies to Add

Update your `package.json`:
```json
{
  "dependencies": {
    // Existing dependencies...
    
    // API Framework (choose one)
    "fastify": "^4.24.3",
    "@fastify/jwt": "^7.2.4",
    "@fastify/websocket": "^8.3.1",
    "@fastify/rate-limit": "^9.1.0",
    "@fastify/cors": "^8.4.2",
    
    // Alternative: Express
    "express": "^4.18.2",
    "jsonwebtoken": "^9.0.2",
    "express-rate-limit": "^7.1.5",
    "cors": "^2.8.5",
    
    // Validation & Security
    "@fastify/helmet": "^11.1.1",
    "zod": "^3.22.4",
    "bcrypt": "^5.1.1",
    "@types/bcrypt": "^5.0.2",
    
    // WebSocket
    "ws": "^8.14.2",
    "@types/ws": "^8.5.9",
    
    // Utilities
    "uuid": "^9.0.1",
    "@types/uuid": "^9.0.7"
  }
}
```

## 🔧 Implementation Steps

### Step 1: Basic Server Setup

**src/api/server.ts**
```typescript
import Fastify from 'fastify';
import { createApp } from './app.js';
import { setupWebSocket } from './websocket/server.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = parseInt(process.env.API_PORT || '3000');
const HOST = process.env.API_HOST || 'localhost';

async function start(): Promise<void> {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info'
    }
  });

  // Register app plugins and routes
  await fastify.register(createApp);
  
  // Setup WebSocket server
  await setupWebSocket(fastify);

  try {
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`API Server listening on http://${HOST}:${PORT}`);
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
}

start();
```

**src/api/app.ts**
```typescript
import { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';

// Import route modules
import { authRoutes } from './routes/auth.js';
import { playerRoutes } from './routes/player.js';
import { zoneRoutes } from './routes/zones.js';
import { unitRoutes } from './routes/units.js';
import { allianceRoutes } from './routes/alliances.js';
import { diplomacyRoutes } from './routes/diplomacy.js';

// Import middleware
import { authMiddleware } from './middleware/auth.js';

export async function createApp(fastify: FastifyInstance): Promise<void> {
  // Security middleware
  await fastify.register(helmet);
  
  // CORS configuration
  await fastify.register(cors, {
    origin: process.env.CLIENT_ORIGIN?.split(',') || ['http://localhost:3001'],
    credentials: true
  });

  // Rate limiting
  await fastify.register(rateLimit, {
    max: 100, // requests
    timeWindow: '1 minute'
  });

  // JWT authentication
  await fastify.register(jwt, {
    secret: process.env.JWT_SECRET || 'your-secret-key-change-this'
  });

  // Global error handler
  fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(error);
    reply.status(500).send({
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  });

  // Health check endpoint
  fastify.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Register routes
  await fastify.register(authRoutes, { prefix: '/auth' });
  
  // Protected routes (require authentication)
  await fastify.register(async function(fastify: FastifyInstance) {
    await fastify.register(authMiddleware);
    await fastify.register(playerRoutes, { prefix: '/player' });
    await fastify.register(zoneRoutes, { prefix: '/zones' });
    await fastify.register(unitRoutes, { prefix: '/units' });
    await fastify.register(allianceRoutes, { prefix: '/alliances' });
    await fastify.register(diplomacyRoutes, { prefix: '/diplomacy' });
  });
}
```

### Step 2: Authentication Middleware

**src/api/middleware/auth.ts**
```typescript
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { redis } from '../../lib/redis.js';

const prisma = new PrismaClient();

export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser;
  }
}

export async function authMiddleware(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Verify JWT token
      await request.jwtVerify();
      
      const payload = request.user as any;
      
      // Check if session is still valid in Redis
      const sessionKey = `session:${payload.sub}`;
      const sessionData = await redis.get(sessionKey);
      
      if (!sessionData) {
        return reply.status(401).send({ error: 'Session expired' });
      }

      // Fetch current user data
      const user = await prisma.player.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          username: true,
          email: true,
          lastActiveAt: true
        }
      });

      if (!user) {
        return reply.status(401).send({ error: 'User not found' });
      }

      // Update last active timestamp
      await prisma.player.update({
        where: { id: user.id },
        data: { lastActiveAt: new Date() }
      });

      // Attach user to request
      request.user = {
        id: user.id,
        username: user.username,
        email: user.email
      };

    } catch (error) {
      return reply.status(401).send({ error: 'Invalid token' });
    }
  });
}
```

### Step 3: Core API Routes

**src/api/routes/auth.ts**
```typescript
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { redis } from '../../lib/redis.js';
import bcrypt from 'bcrypt';
import { z } from 'zod';

const prisma = new PrismaClient();

const RegisterSchema = z.object({
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
  email: z.string().email(),
  password: z.string().min(8).max(100)
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // Register new player
  fastify.post('/register', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { username, email, password } = RegisterSchema.parse(request.body);
      
      // Check if user already exists
      const existingUser = await prisma.player.findFirst({
        where: {
          OR: [
            { email },
            { username }
          ]
        }
      });

      if (existingUser) {
        return reply.status(409).send({
          error: 'User already exists',
          field: existingUser.email === email ? 'email' : 'username'
        });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);

      // Create new player with default resources
      const player = await prisma.player.create({
        data: {
          username,
          email,
          passwordHash,
          fuel: 500,
          rations: 500,
          steel: 500,
          credits: 1000,
          maxCommandPoints: 20,
          usedCommandPoints: 0
        },
        select: {
          id: true,
          username: true,
          email: true,
          createdAt: true
        }
      });

      // Generate JWT token
      const token = fastify.jwt.sign(
        { sub: player.id, username: player.username },
        { expiresIn: '7d' }
      );

      // Create session in Redis (7 days)
      const sessionKey = `session:${player.id}`;
      await redis.setex(sessionKey, 7 * 24 * 3600, JSON.stringify({
        playerId: player.id,
        username: player.username,
        createdAt: Date.now()
      }));

      return reply.send({
        token,
        user: player
      });

    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error.errors
        });
      }
      throw error;
    }
  });

  // Login existing player
  fastify.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { email, password } = LoginSchema.parse(request.body);

      // Find player by email
      const player = await prisma.player.findUnique({
        where: { email },
        select: {
          id: true,
          username: true,
          email: true,
          passwordHash: true,
          lastActiveAt: true
        }
      });

      if (!player) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      // Verify password
      const passwordValid = await bcrypt.compare(password, player.passwordHash);
      if (!passwordValid) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      // Generate JWT token
      const token = fastify.jwt.sign(
        { sub: player.id, username: player.username },
        { expiresIn: '7d' }
      );

      // Create session in Redis
      const sessionKey = `session:${player.id}`;
      await redis.setex(sessionKey, 7 * 24 * 3600, JSON.stringify({
        playerId: player.id,
        username: player.username,
        loginAt: Date.now()
      }));

      return reply.send({
        token,
        user: {
          id: player.id,
          username: player.username,
          email: player.email,
          lastActiveAt: player.lastActiveAt
        }
      });

    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error.errors
        });
      }
      throw error;
    }
  });

  // Logout (invalidate session)
  fastify.post('/logout', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const sessionKey = `session:${request.user.id}`;
    await redis.del(sessionKey);
    
    return reply.send({ message: 'Logged out successfully' });
  });

  // Refresh token
  fastify.post('/refresh', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const newToken = fastify.jwt.sign(
      { sub: request.user.id, username: request.user.username },
      { expiresIn: '7d' }
    );

    return reply.send({ token: newToken });
  });
}
```

**src/api/routes/player.ts**
```typescript
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function playerRoutes(fastify: FastifyInstance): Promise<void> {
  // Get player status and resources
  fastify.get('/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const player = await prisma.player.findUnique({
      where: { id: request.user.id },
      select: {
        id: true,
        username: true,
        fuel: true,
        rations: true,
        steel: true,
        credits: true,
        maxCommandPoints: true,
        usedCommandPoints: true,
        lastActiveAt: true,
        fob: {
          select: {
            id: true,
            level: true,
            zone: {
              select: {
                id: true,
                name: true,
                sector: {
                  select: {
                    name: true,
                    q: true,
                    r: true
                  }
                }
              }
            }
          }
        },
        allianceMember: {
          select: {
            role: true,
            alliance: {
              select: {
                id: true,
                name: true,
                tag: true,
                memberCount: true
              }
            }
          }
        },
        zonesOwned: {
          select: {
            id: true,
            name: true,
            sector: {
              select: {
                name: true,
                q: true,
                r: true
              }
            }
          }
        }
      }
    });

    if (!player) {
      return reply.status(404).send({ error: 'Player not found' });
    }

    return reply.send({
      player,
      commandPoints: {
        used: player.usedCommandPoints,
        max: player.maxCommandPoints,
        available: player.maxCommandPoints - player.usedCommandPoints
      }
    });
  });

  // Get player's units
  fastify.get('/units', async (request: FastifyRequest, reply: FastifyReply) => {
    const units = await prisma.unit.findMany({
      where: { ownerId: request.user.id },
      include: {
        zone: {
          select: {
            id: true,
            name: true,
            sector: {
              select: {
                name: true,
                q: true,
                r: true
              }
            }
          }
        }
      }
    });

    return reply.send({ units });
  });

  // Get player's recent battles
  fastify.get('/battles', async (request: FastifyRequest, reply: FastifyReply) => {
    const battles = await prisma.battle.findMany({
      where: {
        OR: [
          { attackerId: request.user.id },
          { defenderId: request.user.id }
        ]
      },
      include: {
        attacker: { select: { id: true, username: true } },
        defender: { select: { id: true, username: true } },
        zone: {
          select: {
            id: true,
            name: true,
            sector: { select: { name: true, q: true, r: true } }
          }
        }
      },
      orderBy: { startedAt: 'desc' },
      take: 20
    });

    return reply.send({ battles });
  });
}
```

### Step 4: WebSocket Integration

**src/api/websocket/server.ts**
```typescript
import { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { redis } from '../../lib/redis.js';
import { handleWebSocketConnection } from './handlers.js';

export async function setupWebSocket(fastify: FastifyInstance): Promise<void> {
  await fastify.register(websocket);

  fastify.register(async function (fastify) {
    fastify.get('/ws', { websocket: true }, handleWebSocketConnection);
  });

  // Subscribe to Redis channels for game events
  const subscriber = redis.duplicate();
  
  // Subscribe to all player and zone events
  await subscriber.psubscribe('player:*:events', 'zone:*:events');
  
  subscriber.on('pmessage', (pattern, channel, message) => {
    // Broadcast to connected WebSocket clients
    const event = JSON.parse(message);
    broadcastEvent(channel, event);
  });
}

// Global WebSocket connection management
const connections = new Map<string, any>(); // playerId -> WebSocket

export function addConnection(playerId: string, socket: any): void {
  connections.set(playerId, socket);
}

export function removeConnection(playerId: string): void {
  connections.delete(playerId);
}

export function broadcastEvent(channel: string, event: any): void {
  // Extract playerId from channel (e.g., 'player:123:events' -> '123')
  const playerId = channel.split(':')[1];
  const socket = connections.get(playerId);
  
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify({
      type: 'GAME_EVENT',
      channel,
      data: event
    }));
  }
}
```

## 🔐 Security Considerations

### Environment Variables
```env
# Add to your .env file
API_PORT=3000
API_HOST=localhost
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
CLIENT_ORIGIN=http://localhost:3001,https://yourdomain.com
SESSION_SECRET=another-secret-for-sessions
LOG_LEVEL=info
NODE_ENV=development
```

### Rate Limiting Strategy
```typescript
// Different limits for different endpoints
const rateLimitConfigs = {
  auth: { max: 5, timeWindow: '1 minute' },      // Login attempts
  actions: { max: 30, timeWindow: '1 minute' },  // Game actions
  data: { max: 100, timeWindow: '1 minute' }     // Data queries
};
```

### Input Validation
```typescript
// Use Zod schemas for all request validation
const MoveUnitSchema = z.object({
  unitId: z.string().uuid(),
  targetZoneId: z.string().uuid(),
  commandPoints: z.number().min(1).max(20)
});
```

## 📊 Testing Strategy

### Unit Tests
```typescript
// src/api/__tests__/auth.test.ts
import { createApp } from '../app.js';
import Fastify from 'fastify';

describe('Auth Routes', () => {
  let app: any;

  beforeAll(async () => {
    app = Fastify();
    await app.register(createApp);
  });

  test('POST /auth/register - success', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('token');
  });
});
```

### Integration Tests
```typescript
// Test full game action flows
describe('Game Actions Integration', () => {
  test('Move unit between zones', async () => {
    // 1. Create authenticated user
    // 2. Create unit in zone
    // 3. Execute move action via API
    // 4. Verify unit location changed
    // 5. Verify WebSocket event fired
  });
});
```

## 🚀 Deployment Considerations

### Docker Setup
```dockerfile
# Dockerfile.api
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/
COPY prisma/ ./prisma/

EXPOSE 3000
CMD ["node", "dist/api/server.js"]
```

### Environment Separation
```typescript
// Different configs for dev/staging/prod
const config = {
  development: {
    rateLimit: { max: 1000 },
    cors: { origin: true },
    logging: 'debug'
  },
  production: {
    rateLimit: { max: 100 },
    cors: { origin: ['https://yourdomain.com'] },
    logging: 'warn'
  }
};
```

This comprehensive API setup provides the foundation for connecting your Global Mandate backend with any frontend client while maintaining security, performance, and scalability.