import { useState } from "react";
import type { Building } from "../types.js";

interface Props {
  buildings:    Building[];
  steel:        number;
  credits:      number;
  selectedId?:  string;
  onSelect:     (b: Building) => void;
  onConstruct:  (buildingType: string) => Promise<void>;
}

// Buildings that can be constructed (not given at start)
const CONSTRUCTABLE: { buildingType: string; steel: number; credits: number }[] = [
  { buildingType: "BARRACKS", steel: 300, credits: 500 },
];

const BUILDING_LABELS: Record<string, string> = {
  COMMAND_CENTER:     "Command Center",
  COMM_CENTER:        "Communications Center",
  WAREHOUSE:          "Warehouse",
  TOC:                "Tactical Operations Center",
  LIGHT_VEHICLE_SHOP: "Light Vehicle Shop",
  HEAVY_FACTORY:      "Heavy Factory",
  RADIO_TOWER:        "Radio Tower",
  BUNKER:             "Bunker",
  HYDRO_BAY:          "Defense Logistics",
  BARRACKS:           "Barracks",
};

const BUILDING_ORDER: Record<string, number> = {
  COMMAND_CENTER:     0,
  BARRACKS:           1,
  COMM_CENTER:        2,
  HYDRO_BAY:          3,
  WAREHOUSE:          4,
};

const BUILDING_ICONS: Record<string, string> = {
  COMMAND_CENTER:     "▣",
  COMM_CENTER:        "◎",
  WAREHOUSE:          "▦",
  TOC:                "◈",
  LIGHT_VEHICLE_SHOP: "◐",
  HEAVY_FACTORY:      "◼",
  RADIO_TOWER:        "◭",
  BUNKER:             "◬",
  HYDRO_BAY:          "◓",
  BARRACKS:           "⚑",
};

const S: Record<string, React.CSSProperties> = {
  // ── Normal (grid) mode ──────────────────────────────────────
  section:       { padding: "16px 20px" },
  heading:       { color: "#666", fontSize: 11, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 },
  grid:          { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 },
  card: {
    background: "#111", border: "1px solid #222", borderRadius: 3,
    padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4,
    cursor: "pointer",
  },
  cardUpgrading: { borderColor: "#f57c00" },
  cardOffline:   { borderColor: "#333", opacity: 0.6 },
  row:           { display: "flex", justifyContent: "space-between", alignItems: "center" },
  icon:          { fontSize: 16, marginRight: 8 },
  name:          { color: "#c8c8c8", flex: 1 },
  level:         { color: "#666", fontSize: 12 },
  status:        { fontSize: 11, marginTop: 2 },
  timer:         { color: "#f57c00", fontSize: 11 },
  fuel:          { color: "#888", fontSize: 11 },
  errMsg:        { color: "#f44336", fontSize: 10, marginTop: 2 },

  // ── Collapsed (list) mode ───────────────────────────────────
  listSection:   { padding: "12px 8px", display: "flex", flexDirection: "column", gap: 2 },
  listHeading:   { color: "#555", fontSize: 10, textTransform: "uppercase", letterSpacing: 2, marginBottom: 8, paddingLeft: 8 },
  listRow: {
    display: "grid", gridTemplateColumns: "18px 1fr auto",
    alignItems: "start", gap: "0 6px",
    padding: "7px 8px", borderRadius: 2, cursor: "pointer",
    border: "1px solid transparent",
  },
  listRowSelected: {
    background: "#141f14", border: "1px solid #1a3a1a",
  },
  listIcon:      { fontSize: 13, color: "#666", textAlign: "center" as const, paddingTop: 1 },
  listName:      { color: "#c8c8c8", fontSize: 12, lineHeight: 1.4 },
  listMeta:      { display: "flex", alignItems: "center", gap: 4, paddingTop: 1 },
  listLevel:     { color: "#555", fontSize: 10 },
  listDot:       { fontSize: 9 },

  // ── Construct button ────────────────────────────────────────
  upgradeBtn: {
    marginTop: 6, padding: "5px 8px", fontSize: 10, letterSpacing: 1,
    textTransform: "uppercase", fontFamily: "inherit", borderRadius: 2,
    cursor: "pointer", background: "#0d1f0d", border: "1px solid #1a3a1a",
    color: "#4caf50", width: "100%", textAlign: "left" as const,
  },
  upgradeBtnDisabled: {
    background: "#111", border: "1px solid #1e1e1e",
    color: "#333", cursor: "not-allowed",
  },
  costRow:   { display: "flex", gap: 8, flexWrap: "wrap" as const, marginTop: 2 },
  costChip:  { fontSize: 10, display: "flex", alignItems: "center", gap: 3 },
  costOk:    { color: "#c8c8c8" },
  costShort: { color: "#f44336" },
};

export function BuildingList({ buildings, steel, credits, selectedId, onSelect, onConstruct }: Props) {
  const [constructing, setConstructing] = useState<string | null>(null);
  const [errors,       setErrors]       = useState<Record<string, string>>({});

  const sorted = [...buildings].sort((a, b) => {
    const oa = BUILDING_ORDER[a.buildingType] ?? 99;
    const ob = BUILDING_ORDER[b.buildingType] ?? 99;
    if (oa !== ob) return oa - ob;
    return (BUILDING_LABELS[a.buildingType] ?? a.buildingType)
      .localeCompare(BUILDING_LABELS[b.buildingType] ?? b.buildingType);
  });

  const collapsed = selectedId !== undefined;

  // ── Collapsed: compact list ────────────────────────────────────
  if (collapsed) {
    return (
      <div style={S.listSection}>
        <div style={S.listHeading}>FOB</div>
        {sorted.map(b => {
          const isSelected  = b.id === selectedId;
          const dotColor    = b.isUpgrading ? "#f57c00" : b.isOperational ? "#4caf50" : "#f44336";
          return (
            <div
              key={b.id}
              style={{ ...S.listRow, ...(isSelected ? S.listRowSelected : {}) }}
              onClick={() => onSelect(b)}
            >
              <span style={S.listIcon}>{BUILDING_ICONS[b.buildingType] ?? "□"}</span>
              <span style={S.listName}>{BUILDING_LABELS[b.buildingType] ?? b.buildingType}</span>
              <span style={S.listMeta}>
                <span style={{ ...S.listDot, color: dotColor }}>●</span>
                <span style={S.listLevel}>{b.level === 0 ? "–" : `L${b.level}`}</span>
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Normal: grid ───────────────────────────────────────────────
  return (
    <div style={S.section}>
      <div style={S.heading}>Forward Operating Base</div>
      <div style={S.grid}>
        {sorted.map((b) => {
          const extraStyle = b.isUpgrading
            ? S.cardUpgrading
            : !b.isOperational
              ? S.cardOffline
              : {};

          return (
            <div key={b.id} style={{ ...S.card, ...extraStyle }} onClick={() => onSelect(b)}>
              <div style={S.row}>
                <span style={S.icon}>{BUILDING_ICONS[b.buildingType] ?? "□"}</span>
                <span style={S.name}>{BUILDING_LABELS[b.buildingType] ?? b.buildingType}</span>
                <span style={S.level}>{b.level === 0 ? "Building..." : `Lvl ${b.level}`}</span>
              </div>

              {b.isUpgrading && b.upgradeEndsAt && (
                <span style={S.timer}>{b.level === 0 ? "⚒ Constructing..." : "⬆ Upgrading..."}</span>
              )}
              {!b.isOperational && !b.isUpgrading && (
                <span style={{ ...S.status, color: "#f44336" }}>● OFFLINE</span>
              )}
              {b.isOperational && !b.isUpgrading && (
                <span style={{ ...S.status, color: "#4caf50" }}>● OPERATIONAL</span>
              )}
              {b.maintenanceFuelPerHour > 0 && (
                <span style={S.fuel}>Fuel drain: {b.maintenanceFuelPerHour}/hr</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Constructable buildings not yet built */}
      {CONSTRUCTABLE.filter(c => !buildings.some(b => b.buildingType === c.buildingType)).map(c => {
        const canAfford  = steel >= c.steel && credits >= c.credits;
        const btnDisabled = constructing !== null || !canAfford;
        return (
          <div key={c.buildingType} style={{ ...S.card, marginTop: 8, borderColor: "#1a2a1a", cursor: "default" }}>
            <div style={S.row}>
              <span style={S.icon}>{BUILDING_ICONS[c.buildingType] ?? "□"}</span>
              <span style={{ ...S.name, color: "#666" }}>{BUILDING_LABELS[c.buildingType] ?? c.buildingType}</span>
              <span style={{ ...S.level, color: "#333" }}>Not Built</span>
            </div>
            <button
              style={{ ...S.upgradeBtn, ...(btnDisabled ? S.upgradeBtnDisabled : {}) }}
              disabled={btnDisabled}
              onClick={async () => {
                setConstructing(c.buildingType);
                setErrors(prev => ({ ...prev, [c.buildingType]: "" }));
                try { await onConstruct(c.buildingType); }
                catch (err) { setErrors(prev => ({ ...prev, [c.buildingType]: err instanceof Error ? err.message : "Failed" })); }
                finally { setConstructing(null); }
              }}
            >
              {constructing === c.buildingType ? "Building..." : `⚒ Construct`}
            </button>
            <div style={S.costRow}>
              <span style={S.costChip}><span>⚙️</span><span style={steel >= c.steel ? S.costOk : S.costShort}>{c.steel.toLocaleString()} steel</span></span>
              <span style={S.costChip}><span>💰</span><span style={credits >= c.credits ? S.costOk : S.costShort}>{c.credits.toLocaleString()} credits</span></span>
            </div>
            {errors[c.buildingType] && <span style={S.errMsg}>⚠ {errors[c.buildingType]}</span>}
          </div>
        );
      })}
    </div>
  );
}
