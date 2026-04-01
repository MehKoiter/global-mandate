import { useEffect, useRef } from "react";
import type { WsMessage } from "../types.js";

interface Props { alerts: WsMessage[]; }

// ── Visual config per event type ──────────────────────────────

interface EventMeta { color: string; label: string; }

const EVENT_META: Record<string, EventMeta> = {
  BUILDING_UPGRADE_STARTED:   { color: "#f57c00", label: "🏗  Upgrade Started"  },
  BUILDING_UPGRADE_COMPLETED: { color: "#4caf50", label: "✅ Upgrade Complete"  },
  BATTLE_STARTED:             { color: "#f44336", label: "⚔  Battle Started"    },
  BATTLE_ROUND:               { color: "#ff7043", label: "⚔  Battle Round"      },
  BATTLE_RESOLVED:            { color: "#ff8a65", label: "⚔  Battle Resolved"   },
  ZONE_CAPTURED:              { color: "#fdd835", label: "🚩 Zone Captured"      },
  UNIT_ARRIVED:               { color: "#4caf50", label: "→  Unit Arrived"       },
  FORTIFICATION_CHANGED:      { color: "#78909c", label: "🛡  Fortified"          },
  DIPLOMACY_PROPOSAL:         { color: "#29b6f6", label: "📜 Proposal"           },
  DIPLOMACY_ACCEPTED:         { color: "#26c6da", label: "🤝 Deal Accepted"      },
  NAP_BROKEN:                 { color: "#ef5350", label: "💥 NAP Broken"         },
  STATUS_FLAGGED:             { color: "#ef9a9a", label: "⚑  Flagged"            },
  CONNECTED:                  { color: "#555",    label: "🔗 Connected"           },
};

function getMeta(type: string): EventMeta {
  return EVENT_META[type] ?? { color: "#888", label: type };
}

// ── Detail text: use message field if present, else fallback ──

// Fields that are internal/noisy and shouldn't be shown raw
const HIDDEN_FIELDS = new Set(["buildingId", "buildingType", "newLevel", "completesAt", "playerId"]);

function formatDetail(type: string, payload: Record<string, unknown>): string {
  if (typeof payload?.message === "string") return payload.message;

  // Type-specific fallbacks for events without a message field
  if (type === "ZONE_CAPTURED") {
    return `Zone ${payload.zoneId ?? ""} captured`;
  }
  if (type === "UNIT_ARRIVED") {
    return `Unit arrived at zone ${payload.zoneId ?? ""}`;
  }

  // Generic: show non-hidden scalar fields
  const parts: string[] = [];
  for (const [k, v] of Object.entries(payload ?? {})) {
    if (HIDDEN_FIELDS.has(k) || typeof v === "object" || v === undefined) continue;
    parts.push(`${k}: ${String(v)}`);
  }
  return parts.join("  ·  ");
}

// ── Styles ────────────────────────────────────────────────────

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
  row:    { display: "flex", gap: 10, alignItems: "baseline" },
  time:   { color: "#444", fontSize: 11, flexShrink: 0, width: 64 },
  badge: {
    fontSize: 10,
    padding: "1px 8px",
    borderRadius: 2,
    flexShrink: 0,
    letterSpacing: 0.5,
    fontWeight: "bold",
    whiteSpace: "nowrap",
  },
  detail: { color: "#888", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  empty:  { color: "#333", fontStyle: "italic", fontSize: 12, textAlign: "center", marginTop: 24 },
};

// ── Component ─────────────────────────────────────────────────

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
          const meta   = getMeta(msg.type);
          const ts     = msg.ts ? new Date(msg.ts) : new Date();
          const time   = ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
          const detail = formatDetail(msg.type, msg.payload);
          return (
            <div key={i} style={S.row}>
              <span style={S.time}>{time}</span>
              <span
                title={msg.type}
                style={{ ...S.badge, background: meta.color + "22", color: meta.color }}
              >
                {meta.label}
              </span>
              {detail && <span style={S.detail}>{detail}</span>}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
