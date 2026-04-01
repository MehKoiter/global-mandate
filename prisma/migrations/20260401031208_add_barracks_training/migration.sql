-- AlterEnum
ALTER TYPE "BuildingType" ADD VALUE 'BARRACKS';

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "trainingEndsAt" TIMESTAMP(3);
