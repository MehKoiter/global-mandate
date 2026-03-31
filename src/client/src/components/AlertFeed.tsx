import { useEffect, useRef } from "react";
import type { WsMessage } from "../types.js";

interface Props { alerts: WsMessage[]; }

const EVENT_COLORS: Record<string, string> = {
  BATTLE_STARTED:        "#f44336",
  BATTLE_ROUND:          "#ff7043",
  BATTLE_RESOLVED:       "#ff8a65",
  ZONE_CAPTURED:         "#fdd835",
  UNIT_ARRIVED:          "#4caf50",
  FORTIFICATION_CHANGED: "#78909c",
  DIPLOMACY_PROPOSAL:    "#29b6f6",
  DIPLOMACY_ACCEPTED:    "#26c6da",
  NAP_BROKEN:            "#ef5350",
  STATUS_FLAGGED:        "#ef9a9a",
  CONNECTED:             "#555",
};

function eventColor(type: string): string {
  return EVENT_COLORS[type] ?? "#888";
}

function formatPayload(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(payload ?? {})) {
    if (typeof v === "object") continue;
    parts.push(`${k}=${String(v)}`);
  }
  return parts.join("  ");
}

const S: Record<string, React.CSSProperties> = {
  section: { padding: "0 20px 16px" },
  heading: { color: "#666", fontSize: 11, textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 },
  feed: {
    background: "#0d0d0d",
    border: "1px solid #1e1e1e",
    borderRadius: 3,
    height: 260,
    overflowY: "auto",
    padding: "8px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  row:     { display: "flex", gap: 10, alignItems: "baseline" },
  time:    { color: "#444", fontSize: 11, flexShrink: 0, width: 64 },
  badge: {
    fontSize: 10,
    padding: "1px 6px",
    borderRadius: 2,
    flexShrink: 0,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "bold",
    width: 180,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  detail:  { color: "#666", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  empty:   { color: "#333", fontStyle: "italic", fontSize: 12, textAlign: "center", marginTop: 24 },
};

export function AlertFeed({ alerts }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [alerts]);

  return (
    <div style={S.section}>
      <div style={S.heading}>Live Event Feed {alerts.length > 0 && `(${alerts.length})`}</div>
      <div style={S.feed}>
        {alerts.length === 0 && <div style={S.empty}>Awaiting events...</div>}
        {alerts.map((msg, i) => {
          const color = eventColor(msg.type);
          const time = new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
          return (
            <div key={i} style={S.row}>
              <span style={S.time}>{time}</span>
              <span style={{ ...S.badge, background: color + "22", color }}>
                {msg.type}
              </span>
              <span style={S.detail}>{formatPayload(msg.payload)}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
