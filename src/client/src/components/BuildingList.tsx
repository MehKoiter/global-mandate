import { useState, useEffect } from "react";
import type { Building } from "../types.js";

interface Props {
  buildings:  Building[];
  steel:      number;
  credits:    number;
  onUpgrade:  (buildingType: string) => Promise<void>;
}

const BUILDING_LABELS: Record<string, string> = {
  COMMAND_CENTER:     "Command Center",
  COMM_CENTER:        "Comm Center",
  WAREHOUSE:          "Warehouse",
  TOC:                "Tactical Operations Center",
  LIGHT_VEHICLE_SHOP: "Light Vehicle Shop",
  HEAVY_FACTORY:      "Heavy Factory",
  RADIO_TOWER:        "Radio Tower",
  BUNKER:             "Bunker",
  HYDRO_BAY:          "Hydro Bay",
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
};

// Client-side cost preview — mirrors src/lib/buildings.ts formula.
// Enforcement is always server-side; this is display-only.
const UPGRADE_BASE: Record<string, { steel: number; credits: number } | undefined> = {
  COMMAND_CENTER: { steel: 500,  credits: 800  },
  COMM_CENTER:    { steel: 200,  credits: 400  },
  HYDRO_BAY:      { steel: 150,  credits: 300  },
  WAREHOUSE:      { steel: 100,  credits: 200  },
};
const MAX_LEVEL = 10;

function round50(n: number) { return Math.round(n / 50) * 50; }

function upgradeCost(buildingType: string, currentLevel: number) {
  const base = UPGRADE_BASE[buildingType];
  if (!base || currentLevel >= MAX_LEVEL) return null;
  const m = Math.pow(1.5, currentLevel);
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

const S: Record<string, React.CSSProperties> = {
  section:       { padding: "16px 20px" },
  heading:       { color: "#666", fontSize: 11, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 },
  grid:          { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 },
  card: {
    background: "#111", border: "1px solid #222", borderRadius: 3,
    padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4,
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
  upgradeBtn: {
    marginTop: 6, padding: "5px 8px", fontSize: 10, letterSpacing: 1,
    textTransform: "uppercase", fontFamily: "inherit", borderRadius: 2,
    cursor: "pointer", background: "#0d1f0d", border: "1px solid #1a3a1a",
    color: "#4caf50", width: "100%", textAlign: "left",
  },
  upgradeBtnDisabled: {
    background: "#111", border: "1px solid #1e1e1e",
    color: "#333", cursor: "not-allowed",
  },
  costRow:   { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 },
  costChip:  { fontSize: 10, display: "flex", alignItems: "center", gap: 3 },
  costOk:    { color: "#c8c8c8" },
  costShort: { color: "#f44336" },
  costTime:  { color: "#666", fontSize: 10 },
  errMsg:      { color: "#f44336", fontSize: 10, marginTop: 2 },
};

function Countdown({ endsAt }: { endsAt: string }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    function update() {
      const diff = new Date(endsAt).getTime() - Date.now();
      if (diff <= 0) { setRemaining("Done"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const sec = Math.floor((diff % 60000) / 1000);
      setRemaining(`${h}h ${m}m ${sec}s`);
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  return <span style={S.timer}>⬆ Upgrading: {remaining}</span>;
}

export function BuildingList({ buildings, steel, credits, onUpgrade }: Props) {
  const [upgrading,  setUpgrading]  = useState<string | null>(null);
  const [errors,     setErrors]     = useState<Record<string, string>>({});
  const [globalErr,  setGlobalErr]  = useState<string | null>(null);

  const fobBusy = buildings.some(b => b.isUpgrading) || upgrading !== null;

  const sorted = [...buildings].sort((a, b) =>
    (BUILDING_LABELS[a.buildingType] ?? a.buildingType)
      .localeCompare(BUILDING_LABELS[b.buildingType] ?? b.buildingType),
  );

  async function handleUpgrade(buildingType: string) {
    setUpgrading(buildingType);
    setGlobalErr(null);
    setErrors(prev => ({ ...prev, [buildingType]: "" }));
    try {
      await onUpgrade(buildingType);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upgrade failed";
      if (msg.toLowerCase().includes("already upgrading")) {
        setGlobalErr(msg);
      } else {
        setErrors(prev => ({ ...prev, [buildingType]: msg }));
      }
    } finally {
      setUpgrading(null);
    }
  }

  return (
    <div style={S.section}>
      <div style={S.heading}>Forward Operating Base</div>
      {globalErr && (
        <div style={{ color: "#f44336", fontSize: 11, marginBottom: 8 }}>⚠ {globalErr}</div>
      )}
      <div style={S.grid}>
        {sorted.map((b) => {
          const cost     = upgradeCost(b.buildingType, b.level);
          const canAfford = cost
            ? steel >= cost.steel && credits >= cost.credits
            : false;
          const atMax       = !cost;
          const btnDisabled = fobBusy || atMax || !canAfford;

          const extraStyle = b.isUpgrading
            ? S.cardUpgrading
            : !b.isOperational
              ? S.cardOffline
              : {};

          return (
            <div key={b.id} style={{ ...S.card, ...extraStyle }}>
              <div style={S.row}>
                <span style={S.icon}>{BUILDING_ICONS[b.buildingType] ?? "□"}</span>
                <span style={S.name}>{BUILDING_LABELS[b.buildingType] ?? b.buildingType}</span>
                <span style={S.level}>Lvl {b.level}</span>
              </div>

              {b.isUpgrading && b.upgradeEndsAt && <Countdown endsAt={b.upgradeEndsAt} />}
              {!b.isOperational && !b.isUpgrading && (
                <span style={{ ...S.status, color: "#f44336" }}>● OFFLINE</span>
              )}
              {b.isOperational && !b.isUpgrading && (
                <span style={{ ...S.status, color: "#4caf50" }}>● OPERATIONAL</span>
              )}
              {b.maintenanceFuelPerHour > 0 && (
                <span style={S.fuel}>Fuel drain: {b.maintenanceFuelPerHour}/hr</span>
              )}

              {cost && !b.isUpgrading && (
                <>
                  <button
                    style={{ ...S.upgradeBtn, ...(btnDisabled ? S.upgradeBtnDisabled : {}) }}
                    disabled={btnDisabled}
                    onClick={() => handleUpgrade(b.buildingType)}
                  >
                    {upgrading === b.buildingType
                      ? "Starting..."
                      : `⬆ Upgrade to Level ${b.level + 1}`}
                  </button>
                  <div style={S.costRow}>
                    <span style={S.costChip}>
                      <span>⚙️</span>
                      <span style={steel   >= cost.steel   ? S.costOk : S.costShort}>
                        {cost.steel.toLocaleString()} steel
                      </span>
                    </span>
                    <span style={S.costChip}>
                      <span>💰</span>
                      <span style={credits >= cost.credits ? S.costOk : S.costShort}>
                        {cost.credits.toLocaleString()} credits
                      </span>
                    </span>
                    <span style={S.costChip}>
                      <span>⏱</span>
                      <span style={S.costTime}>{cost.time}</span>
                    </span>
                  </div>
                </>
              )}
              {atMax && (
                <span style={{ ...S.status, color: "#555" }}>MAX LEVEL</span>
              )}
              {errors[b.buildingType] && (
                <span style={S.errMsg}>⚠ {errors[b.buildingType]}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
