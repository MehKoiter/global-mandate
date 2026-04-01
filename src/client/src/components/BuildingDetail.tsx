import { useState, useEffect } from "react";
import type { Building, TrainingUnit } from "../types.js";
import { BarracksPanel } from "./BarracksPanel.js";

// ── Building metadata ─────────────────────────────────────────

interface BuildingMeta {
  description: string;
  metricLabel: string;
  metricFn:    (level: number) => string | number;
}

const BUILDING_META: Partial<Record<string, BuildingMeta>> = {
  COMMAND_CENTER: {
    description:  "Your C2 hub — the single point of authority over all FOB operations. It synchronizes intelligence, fire support, and maneuver elements across every active theater. Command Points represent your real-time capacity to direct units in the field; exceeding that ceiling degrades operational effectiveness. Every upgrade expands your command span and raises the ceiling on simultaneous force projection.",
    metricLabel:  "Max Command Points",
    metricFn:     (lvl) => lvl * 10,
  },
  COMM_CENTER: {
    description:  "Maintains the encrypted signal mesh that ties your outlying zones back to FOB command. Without an active link, zone commanders operate on stale orders — cutting local production to half yield until contact is restored. Upgrades extend signal reach and harden the network against jamming and infrastructure attrition, keeping your supply chain intact as the front expands.",
    metricLabel:  "Signal Range",
    metricFn:     () => "Coming soon",
  },
  WAREHOUSE: {
    description:  "Your strategic stockpile — hardened storage that buffers the FOB against supply disruptions, raid losses, and demand spikes on the front. Raw materials, munitions, and critical spares are held here until the logistics chain calls for them. Higher levels raise your resource caps across the board, giving you the runway to sustain prolonged operations without drawing down to zero between resupply cycles.",
    metricLabel:  "Storage Capacity",
    metricFn:     () => "Coming soon",
  },
  HYDRO_BAY: {
    description:  "Your forward supply backbone. DLA manages the end-to-end logistics chain — food, fuel, medicine, gear, and spare parts — keeping your forces combat-ready regardless of how far the front pushes. Every upgrade expands throughput and increases local rations production, reducing your dependence on contested supply lines.",
    metricLabel:  "Rations / hr",
    metricFn:     (lvl) => `+${lvl * 5}`,
  },
  BARRACKS: {
    description:  "Your primary ground-force pipeline. Recruits are processed, equipped, and trained here before being assigned to active duty. Throughput is limited by available training slots — each upgrade adds capacity and unlocks access to advanced specializations requiring higher-level instruction cadre. Elite units such as Special Forces and Rangers cannot be fielded until the training program matures to support them.",
    metricLabel:  "Training Slots",
    metricFn:     (lvl) => lvl,
  },
};

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

const UPGRADE_BASE: Record<string, { steel: number; credits: number; maxLevel: number } | undefined> = {
  COMMAND_CENTER: { steel: 500, credits: 800,  maxLevel: 10 },
  COMM_CENTER:    { steel: 200, credits: 400,  maxLevel: 10 },
  HYDRO_BAY:      { steel: 150, credits: 300,  maxLevel: 10 },
  WAREHOUSE:      { steel: 100, credits: 200,  maxLevel: 10 },
  BARRACKS:       { steel: 300, credits: 500,  maxLevel: 10 },
};

function round50(n: number) { return Math.round(n / 50) * 50; }

function upgradeCost(buildingType: string, currentLevel: number) {
  const base = UPGRADE_BASE[buildingType];
  if (!base || currentLevel >= base.maxLevel) return null;
  const m       = Math.pow(1.5, currentLevel);
  const rawMins = 15 * Math.pow(1.25, currentLevel - 1);
  const mins    = Math.round(rawMins);
  return {
    steel:   round50(base.steel   * m),
    credits: round50(base.credits * m),
    time:    mins >= 60
      ? `${Math.floor(mins / 60)}h ${mins % 60 > 0 ? `${mins % 60}m` : ""}`.trim()
      : `${mins}m`,
  };
}

// ── Countdown ─────────────────────────────────────────────────

function Countdown({ endsAt, label }: { endsAt: string; label: string }) {
  const [remaining, setRemaining] = useState("");
  useEffect(() => {
    function update() {
      const diff = new Date(endsAt).getTime() - Date.now();
      if (diff <= 0) { setRemaining("Completing..."); return; }
      const h   = Math.floor(diff / 3600000);
      const m   = Math.floor((diff % 3600000) / 60000);
      const sec = Math.floor((diff % 60000) / 1000);
      setRemaining(h > 0 ? `${h}h ${m}m ${sec}s` : m > 0 ? `${m}m ${sec}s` : `${sec}s`);
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  return <span style={{ color: "#f57c00", fontSize: 12 }}>{label}: {remaining}</span>;
}

// ── Props ─────────────────────────────────────────────────────

interface Props {
  building:  Building;
  steel:     number;
  credits:   number;
  fuel:      number;
  rations:   number;
  training:  TrainingUnit[];
  onUpgrade: (buildingType: string) => Promise<void>;
  onTrain:   (unitType: string, quantity: number) => Promise<void>;
  onBack:    () => void;
}

// ── Styles ────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  container:   { display: "flex", flexDirection: "column", height: "100%", overflowY: "auto" },
  header: {
    padding: "14px 20px", borderBottom: "1px solid #1a1a1a",
    display: "flex", alignItems: "center", gap: 12,
  },
  backBtn: {
    background: "none", border: "none", color: "#555", cursor: "pointer",
    fontSize: 18, fontFamily: "inherit", lineHeight: 1, padding: "0 4px",
  },
  icon:        { fontSize: 22, color: "#888" },
  nameBlock:   { flex: 1, minWidth: 0 },
  name:        { color: "#e8e8e8", fontSize: 15, fontWeight: "bold" },
  levelBadge: {
    display: "inline-block", background: "#1a1a1a", border: "1px solid #2a2a2a",
    color: "#666", fontSize: 10, padding: "2px 6px", borderRadius: 2, marginLeft: 8,
  },
  statusDot:   { fontSize: 11, marginTop: 2 },
  body:        { padding: "20px", display: "flex", flexDirection: "column", gap: 24 },
  section:     { display: "flex", flexDirection: "column", gap: 8 },
  sectionHead: { color: "#555", fontSize: 10, textTransform: "uppercase", letterSpacing: 2 },
  desc:        { color: "#888", fontSize: 13, lineHeight: 1.6 },
  table: {
    borderCollapse: "collapse" as const,
    width: "100%", fontSize: 12,
  },
  th: {
    color: "#555", fontSize: 10, textTransform: "uppercase", letterSpacing: 1,
    padding: "4px 10px", textAlign: "left" as const, borderBottom: "1px solid #1a1a1a",
  },
  td:          { padding: "5px 10px", color: "#888", borderBottom: "1px solid #111" },
  tdCurrent:   { padding: "5px 10px", color: "#c8c8c8", fontWeight: "bold", borderBottom: "1px solid #111", background: "#151515" },
  tdLevel:     { padding: "5px 10px", color: "#555", borderBottom: "1px solid #111" },
  tdLevelCur:  { padding: "5px 10px", color: "#4caf50", fontWeight: "bold", borderBottom: "1px solid #111", background: "#151515" },
  upgradeBtn: {
    padding: "5px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase",
    fontFamily: "inherit", borderRadius: 2, cursor: "pointer",
    background: "#0d1f0d", border: "1px solid #1a3a1a", color: "#4caf50",
    whiteSpace: "nowrap" as const,
  },
  upgradeBtnDisabled: {
    background: "#111", border: "1px solid #1e1e1e", color: "#333", cursor: "not-allowed",
  },
  costRow:   { display: "flex", gap: 12, flexWrap: "wrap" as const, alignItems: "center" },
  costChip:  { fontSize: 11, display: "flex", alignItems: "center", gap: 4 },
  costOk:    { color: "#c8c8c8" },
  costShort: { color: "#f44336" },
  costTime:  { color: "#555" },
  errMsg:    { color: "#f44336", fontSize: 11 },
  divider:   { borderTop: "1px solid #1a1a1a", margin: "0" },
};

// ── Component ─────────────────────────────────────────────────

export function BuildingDetail({ building, steel, credits, fuel, rations, training, onUpgrade, onTrain, onBack }: Props) {
  const [upgrading, setUpgrading] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const meta     = BUILDING_META[building.buildingType];
  const base     = UPGRADE_BASE[building.buildingType];
  const maxLevel = base?.maxLevel ?? 10;
  const cost     = upgradeCost(building.buildingType, building.level);
  const canAfford = cost ? steel >= cost.steel && credits >= cost.credits : false;
  const fobBusy  = building.isUpgrading;

  async function handleUpgrade() {
    setUpgrading(true);
    setError(null);
    try {
      await onUpgrade(building.buildingType);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upgrade failed");
    } finally {
      setUpgrading(false);
    }
  }

  const label      = BUILDING_LABELS[building.buildingType] ?? building.buildingType;
  const icon       = BUILDING_ICONS[building.buildingType] ?? "□";
  const statusColor = building.isOperational ? "#4caf50" : "#f44336";
  const statusText  = building.isUpgrading
    ? "UPGRADING"
    : building.level === 0
      ? "UNDER CONSTRUCTION"
      : building.isOperational ? "OPERATIONAL" : "OFFLINE";

  return (
    <div style={S.container}>
      {/* Header */}
      <div style={S.header}>
        <button style={S.backBtn} onClick={onBack} title="Back to base">←</button>
        <span style={S.icon}>{icon}</span>
        <div style={S.nameBlock}>
          {/* Name row: label + level badge + upgrade button inline */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
            <span style={S.name}>{label}</span>
            {building.level > 0 && <span style={S.levelBadge}>LVL {building.level}</span>}
            {building.level > 0 && !building.isUpgrading && cost && (
              <button
                style={{ ...S.upgradeBtn, ...((fobBusy || !canAfford || upgrading) ? S.upgradeBtnDisabled : {}) }}
                disabled={fobBusy || !canAfford || upgrading}
                onClick={handleUpgrade}
              >
                {upgrading ? "Starting..." : `⬆ LVL ${building.level + 1}`}
              </button>
            )}
            {building.level > 0 && !building.isUpgrading && !cost && (
              <span style={{ color: "#555", fontSize: 10, letterSpacing: 1, textTransform: "uppercase" as const }}>MAX LEVEL</span>
            )}
          </div>
          {/* Status + costs row */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 3, flexWrap: "wrap" as const }}>
            <span style={{ ...S.statusDot, color: building.isUpgrading ? "#f57c00" : statusColor, marginTop: 0 }}>
              ● {statusText}
            </span>
            {!building.isUpgrading && cost && (
              <div style={S.costRow}>
                <span style={S.costChip}>
                  <span>⚙️</span>
                  <span style={steel >= cost.steel ? S.costOk : S.costShort}>{cost.steel.toLocaleString()}</span>
                </span>
                <span style={S.costChip}>
                  <span>💰</span>
                  <span style={credits >= cost.credits ? S.costOk : S.costShort}>{cost.credits.toLocaleString()}</span>
                </span>
                <span style={{ ...S.costChip, ...S.costTime }}><span>⏱</span><span>{cost.time}</span></span>
              </div>
            )}
            {error && <span style={S.errMsg}>⚠ {error}</span>}
          </div>
        </div>
      </div>

      {/* Countdown if upgrading */}
      {building.isUpgrading && building.upgradeEndsAt && (
        <div style={{ padding: "8px 20px", borderBottom: "1px solid #1a1a1a" }}>
          <Countdown
            endsAt={building.upgradeEndsAt}
            label={building.level === 0 ? "⚒ Constructing" : "⬆ Upgrading"}
          />
        </div>
      )}

      <div style={S.body}>

        {/* Description */}
        <div style={S.section}>
          <div style={S.sectionHead}>About</div>
          <div style={S.desc}>
            {meta?.description ?? "No description available for this building."}
          </div>
        </div>

        {/* Metrics table */}
        {building.level > 0 && meta && (
          <div style={S.section}>
            <div style={S.sectionHead}>{meta.metricLabel} by Level</div>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Level</th>
                  <th style={S.th}>{meta.metricLabel}</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: maxLevel }, (_, i) => i + 1).map(lvl => {
                  const isCurrent = lvl === building.level;
                  return (
                    <tr key={lvl}>
                      <td style={isCurrent ? S.tdLevelCur : S.tdLevel}>
                        {isCurrent ? `▶ ${lvl}` : lvl}
                      </td>
                      <td style={isCurrent ? S.tdCurrent : S.td}>
                        {meta.metricFn(lvl)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Barracks: recruitment panel */}
        {building.buildingType === "BARRACKS" && building.level > 0 && building.isOperational && (
          <>
            <div style={S.divider} />
            <BarracksPanel
              barrackLevel={building.level}
              training={training}
              fuel={fuel}
              rations={rations}
              steel={steel}
              credits={credits}
              onTrain={onTrain}
            />
          </>
        )}

      </div>
    </div>
  );
}
