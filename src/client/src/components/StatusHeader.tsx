import type { PlayerStatus } from "../types.js";

interface Props { player: PlayerStatus; }

function fmt(n: number): string { return n.toLocaleString(); }

function net(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(0)}/hr`;
}

function netColor(n: number): string {
  if (n > 0)  return "#4caf50";
  if (n < 0)  return "#f44336";
  return "#888";
}

const S: Record<string, React.CSSProperties> = {
  header: {
    background: "#111",
    borderBottom: "1px solid #2a2a2a",
    padding: "8px 12px",
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    alignItems: "center",
  },
  title: { color: "#e8e8e8", fontSize: 14, letterSpacing: 2, textTransform: "uppercase" },
  divider: { color: "#333", fontSize: 16 },
  group: { display: "flex", gap: 10 },
  resource: { display: "flex", flexDirection: "column", alignItems: "center", minWidth: 56 },
  label: { color: "#666", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 },
  value: { color: "#e8e8e8", fontSize: 13, fontWeight: "bold" },
  netValue: { fontSize: 10 },
  cp: { display: "flex", flexDirection: "column", alignItems: "center" },
  cpBar: { width: 72, height: 5, background: "#222", borderRadius: 3, marginTop: 3, overflow: "hidden" },
  protection: { color: "#ffd54f", fontSize: 11, marginLeft: "auto" },
};

export function StatusHeader({ player }: Props) {
  const cpPct = player.maxCommandPoints > 0
    ? (player.usedCommandPoints / player.maxCommandPoints) * 100
    : 0;

  const protectionMsg = player.newPlayerProtectionEndsAt
    ? `Protected until ${new Date(player.newPlayerProtectionEndsAt).toLocaleTimeString()}`
    : null;

  return (
    <div style={S.header}>
      <span style={S.title}>{player.username}</span>
      <span style={S.divider}>│</span>

      <div style={S.group}>
        {([
          ["⛽ FUEL",    player.fuel,    player.fuelNetPerHour,    "#f57c00"],
          ["🍖 RATIONS", player.rations, player.rationsNetPerHour, "#388e3c"],
          ["⚙️ STEEL",   player.steel,   player.steelNetPerHour,   "#78909c"],
          ["💰 CREDITS", player.credits, player.creditsNetPerHour, "#fdd835"],
        ] as [string, number, number, string][]).map(([label, val, rate, color]) => (
          <div key={label} style={S.resource}>
            <span style={{ ...S.label, color }}>{label}</span>
            <span style={S.value}>{fmt(val)}</span>
            <span style={{ ...S.netValue, color: netColor(rate) }}>{net(rate)}</span>
          </div>
        ))}
      </div>

      <span style={S.divider}>│</span>

      <div style={S.cp}>
        <span style={S.label}>Command Points</span>
        <span style={{ ...S.value, color: cpPct > 80 ? "#f44336" : "#e8e8e8" }}>
          {player.usedCommandPoints} / {player.maxCommandPoints}
        </span>
        <div style={S.cpBar}>
          <div style={{ width: `${cpPct}%`, height: "100%", background: cpPct > 80 ? "#f44336" : "#4caf50", transition: "width 0.3s" }} />
        </div>
      </div>

      {protectionMsg && <span style={S.protection}>⚑ {protectionMsg}</span>}
    </div>
  );
}
