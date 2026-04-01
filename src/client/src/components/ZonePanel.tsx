// =============================================================
// Global Mandate — Zone Detail Panel
// Slides up from the bottom when a zone is selected on the map.
// =============================================================

import { useEffect, useState } from "react";
import { getZoneDetail }        from "../api.js";
import type { Zone, ZoneUnit }  from "../types.js";

interface Props {
  zone:     Zone | null;
  playerId: string;
  onClose:  () => void;
}

const UNIT_LABELS: Record<string, string> = {
  INFANTRY_GRUNT:    "Infantry",
  SPECIAL_FORCES:    "Special Forces",
  RANGERS:           "Rangers",
  MARSOC_ATGM:       "MARSOC ATGM",
  LIGHT_VEHICLE:     "Light Vehicle",
  MAIN_BATTLE_TANK:  "Main Battle Tank",
  HEAVY_ASSAULT:     "Heavy Assault",
  LIGHT_TANK:        "Light Tank",
  ATTACK_HELICOPTER: "Attack Helicopter",
  TRANSPORT_HELICOPTER: "Transport Helicopter",
};

const S: Record<string, React.CSSProperties> = {
  panel: {
    position:   "absolute",
    bottom:     0,
    left:       0,
    right:      0,
    maxHeight:  "38vh",
    background: "#0f0f0f",
    borderTop:  "1px solid #222",
    zIndex:     10,
    overflowY:  "auto",
    transition: "transform 0.22s ease",
  },
  inner:     { padding: "14px 20px 18px" },
  header:    { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  name:      { color: "#e8e8e8", fontSize: 15, fontWeight: "bold" },
  owner:     { color: "#555", fontSize: 11, marginTop: 2 },
  closeBtn: {
    background: "none", border: "none", color: "#444", cursor: "pointer",
    fontSize: 18, fontFamily: "inherit", lineHeight: 1, padding: "0 2px",
  },
  sectionHead: { color: "#555", fontSize: 10, textTransform: "uppercase", letterSpacing: 2, marginBottom: 6, marginTop: 12 },
  grid:        { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 },
  chip: {
    background: "#141414", border: "1px solid #222", borderRadius: 2,
    padding: "6px 10px", display: "flex", flexDirection: "column", gap: 2,
  },
  chipLabel: { color: "#555", fontSize: 9, textTransform: "uppercase", letterSpacing: 1 },
  chipValue: { color: "#c8c8c8", fontSize: 13 },
  unitRow:   { display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #141414" },
  unitName:  { color: "#888", fontSize: 12 },
  unitQty:   { color: "#c8c8c8", fontSize: 12 },
  tagRow:    { display: "flex", gap: 8, flexWrap: "wrap" as const, marginTop: 4 },
  tag: {
    background: "#141414", border: "1px solid #1e1e1e", borderRadius: 2,
    padding: "2px 8px", fontSize: 10, color: "#666",
  },
  tagGreen:  { border: "1px solid #1a3a1a", color: "#4caf50" },
  tagOrange: { border: "1px solid #3a2a00", color: "#f57c00" },
  tagRed:    { border: "1px solid #3a1a1a", color: "#f44336" },
};

export function ZonePanel({ zone, playerId, onClose }: Props) {
  const [liveUnits, setLiveUnits] = useState<ZoneUnit[] | null>(null);
  const [loading,   setLoading]   = useState(false);

  // Fetch live units when zone changes
  useEffect(() => {
    if (!zone || zone.visibility === "dark") {
      setLiveUnits(null);
      return;
    }
    setLiveUnits(null);
    setLoading(true);
    getZoneDetail(zone.id)
      .then(data => setLiveUnits(data.zone.units ?? []))
      .catch(() => setLiveUnits([]))
      .finally(() => setLoading(false));
  }, [zone?.id]);

  const visible     = zone !== null;
  const units       = liveUnits ?? zone?.units ?? [];
  const canSeeInfo  = zone && zone.visibility !== "dark";
  const isOwned     = zone?.visibility === "owned";
  const ownerLabel  = zone?.ownerPlayerId
    ? (zone.ownerPlayerId === playerId ? "You" : "Enemy")
    : "Unoccupied";

  return (
    <div style={{ ...S.panel, transform: visible ? "translateY(0)" : "translateY(100%)" }}>
      {zone && (
        <div style={S.inner}>
          {/* Header */}
          <div style={S.header}>
            <div>
              <div style={S.name}>{zone.name}</div>
              <div style={S.owner}>
                {ownerLabel}
                {zone.capturedAt && isOwned && (
                  <span style={{ marginLeft: 8, color: "#333" }}>
                    Captured {new Date(zone.capturedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
            <button style={S.closeBtn} onClick={onClose}>×</button>
          </div>

          {/* Resource yields */}
          {canSeeInfo && (zone.fuelPerHour !== null || zone.rationsPerHour !== null || zone.steelPerHour !== null || zone.creditsPerHour !== null) && (
            <>
              <div style={S.sectionHead}>Resource Yields</div>
              <div style={S.grid}>
                {zone.fuelPerHour    !== null && <div style={S.chip}><span style={S.chipLabel}>Fuel</span><span style={S.chipValue}>+{zone.fuelPerHour}/hr</span></div>}
                {zone.rationsPerHour !== null && <div style={S.chip}><span style={S.chipLabel}>Rations</span><span style={S.chipValue}>+{zone.rationsPerHour}/hr</span></div>}
                {zone.steelPerHour   !== null && <div style={S.chip}><span style={S.chipLabel}>Steel</span><span style={S.chipValue}>+{zone.steelPerHour}/hr</span></div>}
                {zone.creditsPerHour !== null && <div style={S.chip}><span style={S.chipLabel}>Credits</span><span style={S.chipValue}>+{zone.creditsPerHour}/hr</span></div>}
              </div>
            </>
          )}

          {/* Units */}
          {canSeeInfo && (
            <>
              <div style={S.sectionHead}>Units Present</div>
              {loading && <div style={{ color: "#444", fontSize: 12 }}>Loading...</div>}
              {!loading && units.length === 0 && <div style={{ color: "#333", fontSize: 12 }}>No units</div>}
              {!loading && units.map(u => (
                <div key={u.id} style={S.unitRow}>
                  <span style={S.unitName}>{UNIT_LABELS[u.unitType] ?? u.unitType}</span>
                  <span style={S.unitQty}>
                    ×{u.quantity}
                    {u.healthPct !== null && u.healthPct < 100 && (
                      <span style={{ color: "#f57c00", marginLeft: 6 }}>{u.healthPct}%</span>
                    )}
                  </span>
                </div>
              ))}
            </>
          )}

          {/* Zone properties (owned only) */}
          {isOwned && (
            <>
              <div style={S.sectionHead}>Zone Status</div>
              <div style={S.tagRow}>
                <span style={{ ...S.tag, ...(zone.isConnected ? S.tagGreen : S.tagRed) }}>
                  {zone.isConnected ? "● Signal Connected" : "● Signal Lost"}
                </span>
                {zone.fortificationLevel > 0 && (
                  <span style={{ ...S.tag, ...S.tagOrange }}>
                    ⚑ Fort {zone.fortificationLevel}
                  </span>
                )}
                {zone.hasRoad && <span style={S.tag}>🛣 Road</span>}
                {zone.bridgeDestroyed && <span style={{ ...S.tag, ...S.tagRed }}>✕ Bridge Destroyed</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
