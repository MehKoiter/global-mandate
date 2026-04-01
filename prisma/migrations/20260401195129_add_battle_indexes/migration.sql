-- CreateIndex
CREATE INDEX "Battle_resolvedAt_attackerPlayerId_idx" ON "Battle"("resolvedAt", "attackerPlayerId");

-- CreateIndex
CREATE INDEX "Battle_resolvedAt_defenderPlayerId_idx" ON "Battle"("resolvedAt", "defenderPlayerId");
