// =============================================================
// Global Mandate — Assign Terrain Script
// One-off script: populates terrainType on all existing zones
// using the deterministic noise function. Safe to re-run.
// Yields, ownership, units — all untouched.
//
// Run: npx tsx src/scripts/assign-terrain.ts
// =============================================================

import { prisma }         from "../lib/prisma.js";
import { noiseToTerrain } from "../lib/terrainNoise.js";

// Zone-kind terrain bias — makes supply zones match their geography.
// Applied instead of pure noise where kind is recognisable from the name.
function kindFromName(name: string): string {
  if (name.includes("Farmlands"))      return "SUPPLY_FARM";
  if (name.includes("Oil Fields"))     return "SUPPLY_WELL";
  if (name.includes("Signal Station")) return "RADIO_A";
  if (name.includes("Relay Post"))     return "RADIO_B";
  return "OTHER";
}

function terrainForZone(q: number, r: number, name: string): ReturnType<typeof noiseToTerrain> {
  const kind = kindFromName(name);
  switch (kind) {
    case "SUPPLY_FARM":
      // Farmland → mostly plains, occasionally forest
      return Math.sin(q * 3.7 + r * 5.3) > 0.3 ? "PLAINS" : "FOREST";
    case "SUPPLY_WELL":
      // Oil fields → mostly desert, occasionally plains
      return Math.sin(q * 4.1 + r * 6.7) > -0.3 ? "DESERT" : "PLAINS";
    case "RADIO_A":
    case "RADIO_B":
      // Radio towers often on high ground
      return Math.sin(q * 5.9 + r * 3.1) > 0.4 ? "MOUNTAIN" : noiseToTerrain(q, r);
    default:
      return noiseToTerrain(q, r);
  }
}

async function main() {
  const zones = await prisma.zone.findMany({ select: { id: true, q: true, r: true, name: true } });
  console.log(`Assigning terrain to ${zones.length} zones...`);

  let count = 0;
  for (const zone of zones) {
    const terrainType = terrainForZone(zone.q, zone.r, zone.name);
    await prisma.zone.update({ where: { id: zone.id }, data: { terrainType } });
    count++;
    if (count % 100 === 0) process.stdout.write(`\r  ${count}/${zones.length}`);
  }

  console.log(`\nDone. ${count} zones updated.`);

  // Summary
  const counts = await prisma.zone.groupBy({ by: ["terrainType"], _count: true });
  console.log("\nTerrain distribution:");
  for (const row of counts) console.log(`  ${row.terrainType.padEnd(10)} ${row._count}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
