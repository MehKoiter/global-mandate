-- CreateEnum
CREATE TYPE "BuildingType" AS ENUM ('COMMAND_CENTER', 'COMM_CENTER', 'WAREHOUSE', 'TOC', 'LIGHT_VEHICLE_SHOP', 'HEAVY_FACTORY', 'RADIO_TOWER', 'BUNKER', 'HYDRO_BAY');

-- CreateEnum
CREATE TYPE "SquadStatus" AS ENUM ('STAGING', 'DEPLOYED', 'IN_COMBAT', 'RETREATING', 'RETURNING');

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fuel" INTEGER NOT NULL DEFAULT 500,
    "rations" INTEGER NOT NULL DEFAULT 500,
    "steel" INTEGER NOT NULL DEFAULT 500,
    "credits" INTEGER NOT NULL DEFAULT 1000,
    "maxCommandPoints" INTEGER NOT NULL DEFAULT 20,
    "usedCommandPoints" INTEGER NOT NULL DEFAULT 0,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tutorialStep" INTEGER NOT NULL DEFAULT 0,
    "tutorialComplete" BOOLEAN NOT NULL DEFAULT false,
    "newPlayerProtectionEndsAt" TIMESTAMP(3),
    "lastResourceCalculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fuelNetPerHour" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rationsNetPerHour" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "steelNetPerHour" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "creditsNetPerHour" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sector" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "q" INTEGER NOT NULL,
    "r" INTEGER NOT NULL,

    CONSTRAINT "Sector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,
    "q" INTEGER NOT NULL,
    "r" INTEGER NOT NULL,
    "ownerPlayerId" TEXT,
    "capturedAt" TIMESTAMP(3),
    "consolidationEndsAt" TIMESTAMP(3),
    "fortificationLevel" INTEGER NOT NULL DEFAULT 0,
    "wallBonus" INTEGER NOT NULL DEFAULT 0,
    "fuelPerHour" INTEGER NOT NULL DEFAULT 0,
    "rationsPerHour" INTEGER NOT NULL DEFAULT 0,
    "steelPerHour" INTEGER NOT NULL DEFAULT 0,
    "creditsPerHour" INTEGER NOT NULL DEFAULT 0,
    "hasRoad" BOOLEAN NOT NULL DEFAULT false,
    "bridgeDestroyed" BOOLEAN NOT NULL DEFAULT false,
    "isConnected" BOOLEAN NOT NULL DEFAULT true,
    "signalSourceZoneId" TEXT,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FOB" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,

    CONSTRAINT "FOB_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Building" (
    "id" TEXT NOT NULL,
    "fobId" TEXT NOT NULL,
    "buildingType" "BuildingType" NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "isUpgrading" BOOLEAN NOT NULL DEFAULT false,
    "upgradeEndsAt" TIMESTAMP(3),
    "isOperational" BOOLEAN NOT NULL DEFAULT true,
    "maintenanceFuelPerHour" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "healthPct" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "morale" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "currentZoneId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "cargoCapacity" INTEGER NOT NULL DEFAULT 0,
    "cargoUsed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Squad" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fobId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "currentZoneId" TEXT,
    "status" "SquadStatus" NOT NULL DEFAULT 'STAGING',
    "rationsHeld" INTEGER NOT NULL DEFAULT 0,
    "fuelHeld" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Squad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BunkerSlot" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "shelterPriority" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BunkerSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Movement" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "originZoneId" TEXT NOT NULL,
    "destinationZoneId" TEXT NOT NULL,
    "departedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "arrivalAt" TIMESTAMP(3) NOT NULL,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "arrivedAt" TIMESTAMP(3),

    CONSTRAINT "Movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoutReport" (
    "id" TEXT NOT NULL,
    "scouterId" TEXT NOT NULL,
    "targetZoneId" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unitSnapshot" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoutReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Battle" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "attackerPlayerId" TEXT NOT NULL,
    "defenderPlayerId" TEXT,
    "outcome" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "zoneCaptured" BOOLEAN NOT NULL DEFAULT false,
    "fuelSpoils" INTEGER NOT NULL DEFAULT 0,
    "steelSpoils" INTEGER NOT NULL DEFAULT 0,
    "rationsSpoils" INTEGER NOT NULL DEFAULT 0,
    "creditsSpoils" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Battle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BattleRound" (
    "id" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "attackerDamageDealt" INTEGER NOT NULL,
    "defenderDamageDealt" INTEGER NOT NULL,
    "attackerLosses" JSONB NOT NULL,
    "defenderLosses" JSONB NOT NULL,
    "attackerMoraleEnd" DOUBLE PRECISION NOT NULL,
    "defenderMoraleEnd" DOUBLE PRECISION NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BattleRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaidLog" (
    "id" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "attackerPlayerId" TEXT NOT NULL,
    "defenderPlayerId" TEXT NOT NULL,
    "steelSiphoned" INTEGER NOT NULL DEFAULT 0,
    "fuelSiphoned" INTEGER NOT NULL DEFAULT 0,
    "rationsSiphoned" INTEGER NOT NULL DEFAULT 0,
    "creditsSiphoned" INTEGER NOT NULL DEFAULT 0,
    "cargoCapacityUsed" INTEGER NOT NULL DEFAULT 0,
    "survivalFloor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaidLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceTransaction" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fuel" INTEGER NOT NULL DEFAULT 0,
    "rations" INTEGER NOT NULL DEFAULT 0,
    "steel" INTEGER NOT NULL DEFAULT 0,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alliance" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllianceMember" (
    "id" TEXT NOT NULL,
    "allianceId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllianceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HallOfFame" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "seasonName" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "allianceTag" TEXT,
    "zonesOwned" INTEGER NOT NULL,
    "battlesWon" INTEGER NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "HallOfFame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Player_username_key" ON "Player"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Player_email_key" ON "Player"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Sector_q_r_key" ON "Sector"("q", "r");

-- CreateIndex
CREATE INDEX "Zone_ownerPlayerId_idx" ON "Zone"("ownerPlayerId");

-- CreateIndex
CREATE INDEX "Zone_sectorId_idx" ON "Zone"("sectorId");

-- CreateIndex
CREATE UNIQUE INDEX "FOB_playerId_key" ON "FOB"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "FOB_zoneId_key" ON "FOB"("zoneId");

-- CreateIndex
CREATE INDEX "Building_fobId_idx" ON "Building"("fobId");

-- CreateIndex
CREATE UNIQUE INDEX "Building_fobId_buildingType_key" ON "Building"("fobId", "buildingType");

-- CreateIndex
CREATE INDEX "Unit_ownerId_idx" ON "Unit"("ownerId");

-- CreateIndex
CREATE INDEX "Unit_currentZoneId_status_idx" ON "Unit"("currentZoneId", "status");

-- CreateIndex
CREATE INDEX "Squad_ownerId_idx" ON "Squad"("ownerId");

-- CreateIndex
CREATE INDEX "Squad_fobId_idx" ON "Squad"("fobId");

-- CreateIndex
CREATE UNIQUE INDEX "BunkerSlot_unitId_key" ON "BunkerSlot"("unitId");

-- CreateIndex
CREATE INDEX "BunkerSlot_zoneId_idx" ON "BunkerSlot"("zoneId");

-- CreateIndex
CREATE INDEX "Movement_unitId_idx" ON "Movement"("unitId");

-- CreateIndex
CREATE INDEX "Movement_destinationZoneId_idx" ON "Movement"("destinationZoneId");

-- CreateIndex
CREATE INDEX "Movement_ownerId_idx" ON "Movement"("ownerId");

-- CreateIndex
CREATE INDEX "ScoutReport_scouterId_idx" ON "ScoutReport"("scouterId");

-- CreateIndex
CREATE INDEX "ScoutReport_targetZoneId_idx" ON "ScoutReport"("targetZoneId");

-- CreateIndex
CREATE INDEX "Battle_zoneId_idx" ON "Battle"("zoneId");

-- CreateIndex
CREATE INDEX "Battle_attackerPlayerId_idx" ON "Battle"("attackerPlayerId");

-- CreateIndex
CREATE INDEX "Battle_outcome_idx" ON "Battle"("outcome");

-- CreateIndex
CREATE INDEX "BattleRound_battleId_idx" ON "BattleRound"("battleId");

-- CreateIndex
CREATE UNIQUE INDEX "RaidLog_battleId_key" ON "RaidLog"("battleId");

-- CreateIndex
CREATE INDEX "RaidLog_attackerPlayerId_idx" ON "RaidLog"("attackerPlayerId");

-- CreateIndex
CREATE INDEX "RaidLog_defenderPlayerId_idx" ON "RaidLog"("defenderPlayerId");

-- CreateIndex
CREATE INDEX "ResourceTransaction_playerId_idx" ON "ResourceTransaction"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "Alliance_name_key" ON "Alliance"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Alliance_tag_key" ON "Alliance"("tag");

-- CreateIndex
CREATE UNIQUE INDEX "AllianceMember_playerId_key" ON "AllianceMember"("playerId");

-- CreateIndex
CREATE INDEX "AllianceMember_allianceId_idx" ON "AllianceMember"("allianceId");

-- CreateIndex
CREATE INDEX "Notification_playerId_isRead_idx" ON "Notification"("playerId", "isRead");

-- CreateIndex
CREATE INDEX "HallOfFame_seasonId_idx" ON "HallOfFame"("seasonId");

-- CreateIndex
CREATE INDEX "HallOfFame_playerId_idx" ON "HallOfFame"("playerId");

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_ownerPlayerId_fkey" FOREIGN KEY ("ownerPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FOB" ADD CONSTRAINT "FOB_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_fobId_fkey" FOREIGN KEY ("fobId") REFERENCES "FOB"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_currentZoneId_fkey" FOREIGN KEY ("currentZoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Squad" ADD CONSTRAINT "Squad_fobId_fkey" FOREIGN KEY ("fobId") REFERENCES "FOB"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Squad" ADD CONSTRAINT "Squad_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Squad" ADD CONSTRAINT "Squad_currentZoneId_fkey" FOREIGN KEY ("currentZoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BunkerSlot" ADD CONSTRAINT "BunkerSlot_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BunkerSlot" ADD CONSTRAINT "BunkerSlot_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movement" ADD CONSTRAINT "Movement_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movement" ADD CONSTRAINT "Movement_destinationZoneId_fkey" FOREIGN KEY ("destinationZoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Battle" ADD CONSTRAINT "Battle_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Battle" ADD CONSTRAINT "Battle_attackerPlayerId_fkey" FOREIGN KEY ("attackerPlayerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Battle" ADD CONSTRAINT "Battle_defenderPlayerId_fkey" FOREIGN KEY ("defenderPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BattleRound" ADD CONSTRAINT "BattleRound_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "Battle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaidLog" ADD CONSTRAINT "RaidLog_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "Battle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllianceMember" ADD CONSTRAINT "AllianceMember_allianceId_fkey" FOREIGN KEY ("allianceId") REFERENCES "Alliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllianceMember" ADD CONSTRAINT "AllianceMember_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HallOfFame" ADD CONSTRAINT "HallOfFame_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
