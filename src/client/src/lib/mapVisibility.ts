import type { Zone, ZoneVisibility, ScoutReport } from "../types.js";

type RawZone = Omit<Zone, "visibility" | "units">;

/**
 * Resolves fog-of-war visibility for every zone.
 *
 * Rules:
 *   "owned"   — zone belongs to the current player (full info)
 *   "scouted" — a valid (non-expired) ScoutReport exists for this zone
 *   "dark"    — everything else (only owner identity visible if known)
 */
export function resolveZoneVisibility(
  rawZones:     RawZone[],
  playerId:     string,
  scoutReports: ScoutReport[],
): Zone[] {
  const now = Date.now();

  // Build lookup: zoneId → most recent valid scout report
  const scoutMap = new Map<string, ScoutReport>();
  for (const report of scoutReports) {
    if (new Date(report.expiresAt).getTime() > now) {
      const existing = scoutMap.get(report.targetZoneId);
      if (!existing || report.reportedAt > existing.reportedAt) {
        scoutMap.set(report.targetZoneId, report);
      }
    }
  }

  return rawZones.map((zone): Zone => {
    if (zone.ownerPlayerId === playerId) {
      return { ...zone, visibility: "owned" as ZoneVisibility };
    }

    const report = scoutMap.get(zone.id);
    if (report) {
      return {
        ...zone,
        visibility: "scouted" as ZoneVisibility,
        units:      report.unitSnapshot,
      };
    }

    return { ...zone, visibility: "dark" as ZoneVisibility };
  });
}
