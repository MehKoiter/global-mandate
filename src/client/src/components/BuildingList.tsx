import { useState, useEffect } from "react";
import type { Building } from "../types.js";

interface Props { buildings: Building[]; }

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

const S: Record<string, React.CSSProperties> = {
  section: { padding: "16px 20px" },
  heading: { color: "#666", fontSize: 11, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 },
  card: {
    background: "#111",
    border: "1px solid #222",
    borderRadius: 3,
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  cardUpgrading: { borderColor: "#f57c00" },
  cardOffline:   { borderColor: "#333", opacity: 0.6 },
  row:    { display: "flex", justifyContent: "space-between", alignItems: "center" },
  icon:   { fontSize: 16, marginRight: 8 },
  name:   { color: "#c8c8c8", flex: 1 },
  level:  { color: "#666", fontSize: 12 },
  status: { fontSize: 11, marginTop: 2 },
  timer:  { color: "#f57c00", fontSize: 11 },
  fuel:   { color: "#888", fontSize: 11 },
};

function Countdown({ endsAt }: { endsAt: string }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    function update() {
      const diff = new Date(endsAt).getTime() - Date.now();
      if (diff <= 0) { setRemaining("Done"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${h}h ${m}m ${s}s`);
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  return <span style={S.timer}>⬆ Upgrading: {remaining}</span>;
}

export function BuildingList({ buildings }: Props) {
  const sorted = [...buildings].sort((a, b) =>
    (BUILDING_LABELS[a.buildingType] ?? a.buildingType)
      .localeCompare(BUILDING_LABELS[b.buildingType] ?? b.buildingType)
  );

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
            </div>
          );
        })}
      </div>
    </div>
  );
}
