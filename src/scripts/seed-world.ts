// =============================================================
// Global Mandate — World Seed Script
// Generates a 10×10 grid of Sectors, each with 7 Zones arranged
// as a tight hex cluster (center + 6 axial neighbours).
//
// Zone layout per sector (axial offsets from sector centre):
//   [0, 0]   → COMMAND        (1 per sector)
//   [1, 0]   → SUPPLY FARM    (rations production)
//   [0, 1]   → SUPPLY WELL    (fuel production)
//   [-1, 1]  → RADIO TOWER A
//   [-1, 0]  → RADIO TOWER B
//   [0, -1]  → CIVILIAN A
//   [1, -1]  → CIVILIAN B
//
// Sector centre in axial hex space = (sectorQ * 8, sectorR * 8)
// Run: npx tsx src/scripts/seed-world.ts
// =============================================================

import { prisma }         from "../lib/prisma.js";
import { noiseToTerrain } from "../lib/terrainNoise.js";
import type { TerrainType } from "../lib/terrainNoise.js";

// ─── Helpers ──────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const NATO = ["Alpha", "Bravo", "Charlie", "Delta", "Echo",
              "Foxtrot", "Golf", "Hotel", "India", "Juliet"];

// ─── Zone cluster layout ───────────────────────────────────────
//
// Each entry: [dq, dr, zoneKind]
// zoneKind drives both name suffix and resource yields.

type ZoneKind =
  | "COMMAND"
  | "SUPPLY_FARM"
  | "SUPPLY_WELL"
  | "RADIO_A"
  | "RADIO_B"
  | "CIVILIAN_A"
  | "CIVILIAN_B";

const CLUSTER: [number, number, ZoneKind][] = [
  [ 0,  0, "COMMAND"    ],
  [ 1,  0, "SUPPLY_FARM"],
  [ 0,  1, "SUPPLY_WELL"],
  [-1,  1, "RADIO_A"    ],
  [-1,  0, "RADIO_B"    ],
  [ 0, -1, "CIVILIAN_A" ],
  [ 1, -1, "CIVILIAN_B" ],
];

function zoneName(sectorLabel: string, kind: ZoneKind): string {
  switch (kind) {
    case "COMMAND":     return `${sectorLabel} Command Post`;
    case "SUPPLY_FARM": return `${sectorLabel} Farmlands`;
    case "SUPPLY_WELL": return `${sectorLabel} Oil Fields`;
    case "RADIO_A":     return `${sectorLabel} Signal Station`;
    case "RADIO_B":     return `${sectorLabel} Relay Post`;
    case "CIVILIAN_A":  return `${sectorLabel} Settlement`;
    case "CIVILIAN_B":  return `${sectorLabel} Outskirts`;
  }
}

interface ZoneYields {
  fuelPerHour:    number;
  rationsPerHour: number;
  steelPerHour:   number;
  creditsPerHour: number;
}

function terrainForKind(kind: ZoneKind, q: number, r: number): TerrainType {
  switch (kind) {
    case "SUPPLY_FARM":
      return Math.sin(q * 3.7 + r * 5.3) > 0.3 ? "PLAINS" : "FOREST";
    case "SUPPLY_WELL":
      return Math.sin(q * 4.1 + r * 6.7) > -0.3 ? "DESERT" : "PLAINS";
    case "RADIO_A":
    case "RADIO_B":
      return Math.sin(q * 5.9 + r * 3.1) > 0.4 ? "MOUNTAIN" : noiseToTerrain(q, r);
    default:
      return noiseToTerrain(q, r);
  }
}

function zoneYields(kind: ZoneKind): ZoneYields {
  switch (kind) {
    case "COMMAND":
      return {
        fuelPerHour:    0,
        rationsPerHour: 0,
        steelPerHour:   rand(8, 15),
        creditsPerHour: rand(15, 25),
      };
    case "SUPPLY_FARM":
      return {
        fuelPerHour:    0,
        rationsPerHour: rand(20, 40),
        steelPerHour:   0,
        creditsPerHour: rand(3, 8),
      };
    case "SUPPLY_WELL":
      return {
        fuelPerHour:    rand(15, 30),
        rationsPerHour: 0,
        steelPerHour:   0,
        creditsPerHour: rand(3, 8),
      };
    case "RADIO_A":
    case "RADIO_B":
      return {
        fuelPerHour:    0,
        rationsPerHour: 0,
        steelPerHour:   0,
        creditsPerHour: rand(10, 20),
      };
    case "CIVILIAN_A":
    case "CIVILIAN_B":
      return {
        fuelPerHour:    0,
        rationsPerHour: rand(5, 10),
        steelPerHour:   0,
        creditsPerHour: rand(8, 15),
      };
  }
}

// ─── Main ──────────────────────────────────────────────────────

async function seed() {
  console.log("Checking existing data...");
  const existingSectors = await prisma.sector.count();
  if (existingSectors > 0) {
    console.log(`Database already contains ${existingSectors} sectors. Aborting to avoid duplicates.`);
    console.log("To reseed, truncate the Sector and Zone tables first.");
    process.exit(0);
  }

  console.log("Seeding 10×10 world map (100 sectors, 700 zones)...");

  let totalZones = 0;

  for (let sr = 0; sr < 10; sr++) {
    for (let sq = 0; sq < 10; sq++) {
      const sectorLabel = `${NATO[sq]}-${sr + 1}`;

      // Sector centre in hex axial space — 8-hex spacing prevents overlap
      const centreQ = sq * 8;
      const centreR = sr * 8;

      const sector = await prisma.sector.create({
        data: {
          name: `Sector ${sectorLabel}`,
          q:    sq,
          r:    sr,
          zones: {
            create: CLUSTER.map(([dq, dr, kind]) => ({
              name:           zoneName(sectorLabel, kind),
              q:              centreQ + dq,
              r:              centreR + dr,
              isConnected:    true,
              terrainType:    terrainForKind(kind, centreQ + dq, centreR + dr),
              ...zoneYields(kind),
            })),
          },
        },
      });

      totalZones += 7;
      process.stdout.write(`\r  Created ${sector.name} — ${totalZones} zones total`);
    }
  }

  console.log(`\n\nDone. Seeded 100 sectors and ${totalZones} zones.`);
  console.log("\nResource summary per zone type:");
  console.log("  COMMAND      — steel 8-15/hr, credits 15-25/hr");
  console.log("  SUPPLY FARM  — rations 20-40/hr, credits 3-8/hr");
  console.log("  SUPPLY WELL  — fuel 15-30/hr, credits 3-8/hr");
  console.log("  RADIO TOWER  — credits 10-20/hr");
  console.log("  CIVILIAN     — rations 5-10/hr, credits 8-15/hr");
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
