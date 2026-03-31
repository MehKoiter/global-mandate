# Global Mandate

**Global Mandate** is a multiplayer 4X strategy game server built with TypeScript, featuring real-time gameplay, complex alliance systems, and dynamic seasonal competition.

## 🎮 Game Overview

Global Mandate is a turn-based strategy game where players compete for territorial control across a hex-based world map. Players must manage resources, build military units, form alliances, engage in diplomacy, and wage war to achieve victory through controlling 60% of the map.

### Core Mechanics

- **Territory Control**: Capture and defend zones to expand your empire
- **Resource Management**: Manage fuel, rations, steel, and credits
- **Military Strategy**: Train diverse units with rock-paper-scissors combat mechanics
- **Alliance Warfare**: Form alliances, pool command points, launch coordinated attacks
- **Diplomacy**: Negotiate trade agreements, non-aggression pacts, tributes, and espionage
- **Seasonal Competition**: Compete in time-limited seasons with victory conditions and leaderboards

## 🚀 Features

### Game Systems
- **Real-time Movement & Combat**: Units move and battles resolve in real-time with timed rounds
- **Command Points System**: Strategic resource limiting simultaneous operations
- **Zone-based Map**: Hex-grid sectors with zone control mechanics
- **Seasonal Gameplay**: 60-day seasons with victory conditions and seasonal resets
- **Hall of Fame**: Persistent player achievements across seasons

### Alliance System
- **Shared Command Points**: Pool resources for coordinated operations
- **Coordinated Attacks**: Launch synchronized multi-player assaults
- **War Declarations**: Formal alliance vs alliance warfare
- **Member Management**: Hierarchical permissions and roles

### Diplomacy
- **Non-Aggression Pacts**: Temporary peace agreements
- **Trade Agreements**: Resource exchange deals
- **Tribute Systems**: Regular resource payments between players
- **Espionage Operations**: Intel gathering, sabotage, and disruption

### Combat System
- **14 Unit Types**: From infantry to stealth bombers across 3 tiers
- **Counter System**: Rock-paper-scissors unit effectiveness
- **Morale & Health**: Dynamic unit condition affecting performance
- **Zone Defense**: Fortifications and defensive structures

## 🛠 Technology Stack

- **Backend**: Node.js with TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Caching/Queues**: Redis with ioredis
- **Real-time**: Redis pub/sub for game events
- **Architecture**: Timer-driven microservices

### Dependencies

```json
{
  "@prisma/client": "^7.6.0",
  "@types/node": "^25.5.0",
  "dotenv": "^17.3.1",
  "ioredis": "^5.10.1",
  "pg": "^8.20.0",
  "prisma": "^7.6.0",
  "typescript": "^6.0.2"
}
```

## 📋 Prerequisites

- Node.js 18+ 
- PostgreSQL 14+
- Redis 6+
- npm or yarn

## 🚀 Getting Started

### Prerequisites Installation

Before running Global Mandate, you'll need to install these services:

1. **PostgreSQL 14+** - Download from [postgresql.org](https://www.postgresql.org/download/)
2. **Redis 6+** - Download from [redis.io](https://redis.io/download) or use Docker: `docker run -p 6379:6379 redis`
3. **Node.js 18+** - Download from [nodejs.org](https://nodejs.org/)

### Step-by-Step Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/MehKoiter/global-mandate.git
   cd global-mandate
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   
   Create a `.env` file in the root directory:
   ```env
   DATABASE_URL="postgresql://username:password@localhost:5432/global_mandate"
   REDIS_URL="redis://localhost:6379"
   ```
   
   Replace `username`, `password` with your PostgreSQL credentials.

4. **Database Setup**
   
   Create the database and run migrations:
   ```bash
   # Generate Prisma client from schema
   npx prisma generate
   
   # Create database tables
   npx prisma migrate deploy
   
   # Optional: View your database
   npx prisma studio
   ```

5. **Build the TypeScript code**
   ```bash
   npm run build
   ```

6. **Start the game server**
   ```bash
   npm start
   ```

### What You'll See When Running

When the server starts successfully, you'll see:

**✅ Database Connection**
- PostgreSQL connection established
- Redis connection confirmed

**✅ Timer Master Active**
- Fast tick (5s): Processing unit arrivals, battles, building completions
- Medium tick (15s): Alliance attacks, diplomacy, espionage operations
- Slow tick (60s): Victory checks, resource generation, zone control updates

**✅ Real-Time Game Processing**
- Movement queue processing
- Combat resolution
- Alliance coordination
- Diplomatic agreement handling
- Season progression tracking

### Important Note About This Repository

This repository contains **only the backend game server**. Global Mandate is the server-side engine that processes game logic, but to actually play the game you would need:

- **Frontend Client**: Web application, mobile app, or desktop client for player interaction
- **API Layer**: REST or WebSocket endpoints for client-server communication  
- **Authentication System**: Player registration, login, and session management

When you run this server, you're running the "game world simulation" that handles all game mechanics in real-time. Players would connect through a separate client application that communicates with this backend.

### Interacting with the Running Server

While running, you can:
- **Monitor PostgreSQL**: Use `npx prisma studio` to view game data
- **Check Redis**: Use `redis-cli monitor` to see real-time events
- **Extend with APIs**: Add HTTP endpoints to enable client interaction
- **Database Operations**: Query directly to see game state progression

## 🏗 Architecture

### Service Architecture
- **Timer Master**: Central coordinator running multiple tick intervals
- **Timer Service**: Processes queued events (arrivals, battles, builds)
- **Alliance Service**: Handles alliance operations and coordinated attacks
- **Diplomacy Service**: Manages inter-player agreements and espionage
- **Season Service**: Victory tracking, leaderboards, and seasonal resets
- **Combat Engine**: Battle resolution and unit mechanics

### Timer System
The game runs on three timer intervals:
- **Fast Tick (5s)**: Unit arrivals, battle rounds, building completions
- **Medium Tick (15s)**: Coordinated attacks, espionage, tributes
- **Slow Tick (60s)**: Victory checks, zone control updates, resource generation

### Data Layer
- **PostgreSQL**: Persistent game state, player data, historical records
- **Redis**: Event queues, real-time state, pub/sub messaging
- **Prisma**: Type-safe database access with migrations

## 🎯 Game Mechanics

### Victory Conditions
- **Map Control**: First player/alliance to control 60% of zones wins
- **Season Timer**: 60-day maximum season length
- **Victory Countdown**: 24-hour warning before season reset

### Resources
- **Fuel**: Powers vehicle movement and operations
- **Rations**: Unit upkeep and training costs  
- **Steel**: Building construction and heavy unit training
- **Credits**: Universal currency for trades and special operations
- **Command Points**: Limits simultaneous military operations

### Unit Tiers
- **Tier 1**: Basic infantry and light vehicles
- **Tier 2**: Advanced armor and helicopters
- **Tier 3**: Elite units and air superiority

## 🔧 Development

### Scripts
- `npm run build`: Compile TypeScript to JavaScript
- `npm start`: Start the production server
- `npm test`: Run tests (placeholder)

### Database Schema
The Prisma schema defines:
- Player accounts and resources
- Map structure (sectors, zones)
- Unit types and stats
- Alliance memberships
- Battle and movement tracking
- Diplomatic agreements
- Seasonal leaderboards

### Adding Features
1. Update Prisma schema if database changes needed
2. Run `npx prisma migrate dev` to generate migrations
3. Implement service logic in appropriate service file
4. Add to timer processing if time-based functionality needed
5. Update Redis pub/sub events as needed

## 📊 Monitoring

The server publishes events to Redis channels for real-time updates:
- Zone events: `zone:{zoneId}:events`
- Player events: `player:{playerId}:events`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the ISC License.

## 🎮 Game Design

Global Mandate is inspired by classic 4X games with modern real-time elements. The seasonal structure creates regular competition cycles while the alliance system encourages both cooperation and betrayal. The diplomacy system adds layers of strategic depth beyond pure military conquest.

---

*Global Mandate - Where empires rise and fall with each passing season.*