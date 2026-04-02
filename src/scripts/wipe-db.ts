// =============================================================
// Global Mandate — Wipe Database Script
// Deletes all data from every table in dependency order
// (children before parents to avoid FK violations).
// Schema and migrations are preserved.
//
// Run: npx tsx src/scripts/wipe-db.ts
// =============================================================

import { prisma } from "../lib/prisma.js";

async function wipe() {
  const args = process.argv.slice(2);
  if (!args.includes("--confirm")) {
    console.error("⚠  This will permanently delete ALL data.");
    console.error("   Re-run with --confirm to proceed:");
    console.error("   npx tsx src/scripts/wipe-db.ts --confirm");
    process.exit(1);
  }

  console.log("Wiping database...");

  // Delete in dependency order (leaves first)
  await prisma.hallOfFame.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.allianceMember.deleteMany();
  await prisma.alliance.deleteMany();
  await prisma.resourceTransaction.deleteMany();
  await prisma.raidLog.deleteMany();
  await prisma.battleRound.deleteMany();
  await prisma.battle.deleteMany();
  await prisma.scoutReport.deleteMany();
  await prisma.movement.deleteMany();
  await prisma.bunkerSlot.deleteMany();
  await prisma.squad.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.building.deleteMany();
  await prisma.fOB.deleteMany();
  await prisma.zone.deleteMany();
  await prisma.sector.deleteMany();
  await prisma.player.deleteMany();

  console.log("Done. All tables cleared. Run npm run seed to re-seed the world.");
}

wipe()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
