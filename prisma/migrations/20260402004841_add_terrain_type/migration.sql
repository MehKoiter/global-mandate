-- CreateEnum
CREATE TYPE "TerrainType" AS ENUM ('PLAINS', 'FOREST', 'MOUNTAIN', 'WATER', 'DESERT', 'URBAN');

-- AlterTable
ALTER TABLE "Zone" ADD COLUMN     "terrainType" "TerrainType" NOT NULL DEFAULT 'PLAINS';
