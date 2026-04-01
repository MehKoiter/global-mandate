import { useState, useEffect } from "react";
import type { TrainingUnit } from "../types.js";

interface Props {
  barrackLevel:  number;
  training:      TrainingUnit[];
  fuel:          number;
  rations:       number;
  steel:         number;
  credits:       number;
  onTrain:       (unitType: string, quantity: number) => Promise<void>;
}

// ── Infantry units trainable in a Barracks ────────────────────
const INFANTRY_UNITS = [
  {
    unitType:       "INFANTRY_GRUNT",
    displayName:    "Infantry Squad",
    tier:           1,
    unlocksAtLevel: 1,
    cost:           { fuel: 0, rations: 20, steel: 0,  credits: 50  },
    timeSec:        300,
    cp:             1,
    desc:           "Basic infantry. Effective vs APCs.",
  },
  {
    unitType:       "SPECIAL_FORCES",
    displayName:    "Special Forces",
    tier:           2,
    unlocksAtLevel: 2,
    cost:           { fuel: 0, rations: 60, steel: 20, credits: 200 },
    timeSec:        1800,
    cp:             3,
    desc:           "Elite soldiers. Counters grunts and APCs.",
  },
  {
    unitType:       "RANGERS",
    displayName:    "Rangers",
    tier:           2,
    unlocksAtLevel: 5,
    cost:           { fuel: 0, rations: 50, steel: 10, credits: 150 },
    timeSec:        1200,
    cp:             2,
    desc:           "Fast light infantry with high mobility.",
  },
  {
    unitType:       "MARSOC_ATGM",
    displayName:    "MARSOC ATGM",
    tier:           2,
    unlocksAtLevel: 10,
    cost:           { fuel: 0, rations: 40, steel: 30, credits: 180 },
    timeSec:        1500,
    cp:             2,
    desc:           "Anti-tank specialists. Lethal vs armour.",
  },
];

function fmtTime(sec: number): string {
  if (sec < 60)  return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function Countdown({ endsAt }: { endsAt: string }) {
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

  return <span style={S.timer}>⧗ {remaining}</span>;
}

const S: Record<string, React.CSSProperties> = {
  section:    { padding: "0 20px 16px" },
  heading:    { color: "#666", fontSize: 11, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 },
  subheading: { color: "#555", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  grid:       { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 8, marginBottom: 16 },
  card: {
    background: "#111", border: "1px solid #1e1e1e", borderRadius: 3,
    padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4,
  },
  row:        { display: "flex", justifyContent: "space-between", alignItems: "center" },
  name:       { color: "#c8c8c8", fontSize: 13, fontWeight: "bold" },
  tier:       { color: "#444", fontSize: 10 },
  desc:       { color: "#555", fontSize: 11 },
  costRow:    { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 },
  costChip:   { fontSize: 10, display: "flex", alignItems: "center", gap: 3 },
  costOk:     { color: "#c8c8c8" },
  costShort:  { color: "#f44336" },
  qtyRow:     { display: "flex", alignItems: "center", gap: 6, marginTop: 4 },
  qtyBtn: {
    background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#888",
    width: 22, height: 22, cursor: "pointer", fontFamily: "inherit",
    fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center",
    borderRadius: 2,
  },
  qtyVal:     { color: "#c8c8c8", fontSize: 13, minWidth: 20, textAlign: "center" },
  trainBtn: {
    marginTop: 6, padding: "5px 8px", fontSize: 10, letterSpacing: 1,
    textTransform: "uppercase", fontFamily: "inherit", borderRadius: 2,
    cursor: "pointer", background: "#0d1f0d", border: "1px solid #1a3a1a",
    color: "#4caf50", width: "100%", textAlign: "left",
  },
  trainBtnDisabled: { background: "#111", border: "1px solid #1e1e1e", color: "#333", cursor: "not-allowed" },
  errMsg:     { color: "#f44336", fontSize: 10, marginTop: 2 },
  queueCard: {
    background: "#0d1a0d", border: "1px solid #1a3a1a", borderRadius: 3,
    padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center",
  },
  queueName:  { color: "#4caf50", fontSize: 12 },
  queueQty:   { color: "#888", fontSize: 11 },
  timer:      { color: "#f57c00", fontSize: 11 },
  slotInfo:   { color: "#555", fontSize: 11, marginBottom: 10 },
};

export function BarracksPanel({ barrackLevel, training, fuel, rations, steel, credits, onTrain }: Props) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [pending,    setPending]    = useState<string | null>(null);
  const [errors,     setErrors]     = useState<Record<string, string>>({});

  const slotsUsed = training.length;
  const queueFull = slotsUsed >= barrackLevel;

  function qty(unitType: string) { return quantities[unitType] ?? 1; }
  function setQty(unitType: string, n: number) {
    setQuantities(prev => ({ ...prev, [unitType]: Math.max(1, Math.min(50, n)) }));
  }

  async function handleTrain(unitType: string) {
    const q = qty(unitType);
    setPending(unitType);
    setErrors(prev => ({ ...prev, [unitType]: "" }));
    try {
      await onTrain(unitType, q);
    } catch (err) {
      setErrors(prev => ({ ...prev, [unitType]: err instanceof Error ? err.message : "Failed" }));
    } finally {
      setPending(null);
    }
  }

  return (
    <div style={S.section}>
      <div style={S.heading}>Barracks — Level {barrackLevel}</div>
      <div style={S.slotInfo}>Training slots: {slotsUsed} / {barrackLevel} in use</div>

      {training.length > 0 && (
        <>
          <div style={S.subheading}>In Training</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            {training.map(t => {
              const unit = INFANTRY_UNITS.find(u => u.unitType === t.unitType);
              return (
                <div key={t.id} style={S.queueCard}>
                  <span style={S.queueName}>{unit?.displayName ?? t.unitType}</span>
                  <span style={S.queueQty}>×{t.quantity}</span>
                  <Countdown endsAt={t.trainingEndsAt} />
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={S.subheading}>Recruit Infantry</div>
      <div style={S.grid}>
        {INFANTRY_UNITS.map(u => {
          const locked    = barrackLevel < u.unlocksAtLevel;
          const q         = qty(u.unitType);
          const totalCost = {
            fuel:    u.cost.fuel    * q,
            rations: u.cost.rations * q,
            steel:   u.cost.steel   * q,
            credits: u.cost.credits * q,
          };
          const canAfford = fuel    >= totalCost.fuel    &&
                            rations >= totalCost.rations &&
                            steel   >= totalCost.steel   &&
                            credits >= totalCost.credits;
          const disabled  = locked || queueFull || !canAfford || pending !== null;
          const cardStyle = locked ? { ...S.card, opacity: 0.45, borderColor: "#1a1a1a" } : S.card;

          return (
            <div key={u.unitType} style={cardStyle}>
              <div style={S.row}>
                <span style={{ ...S.name, color: locked ? "#444" : "#c8c8c8" }}>
                  {locked ? "🔒 " : ""}{u.displayName}
                </span>
                <span style={S.tier}>T{u.tier} · {u.cp} CP</span>
              </div>
              {locked
                ? <span style={{ ...S.desc, color: "#f57c00" }}>Unlocks at Barracks level {u.unlocksAtLevel}</span>
                : <span style={S.desc}>{u.desc}</span>
              }
              {!locked && (
                <>
                  <div style={S.costRow}>
                    {u.cost.fuel    > 0 && <span style={S.costChip}><span>⛽</span><span style={fuel    >= totalCost.fuel    ? S.costOk : S.costShort}>{totalCost.fuel}</span></span>}
                    {u.cost.rations > 0 && <span style={S.costChip}><span>🍖</span><span style={rations >= totalCost.rations ? S.costOk : S.costShort}>{totalCost.rations}</span></span>}
                    {u.cost.steel   > 0 && <span style={S.costChip}><span>⚙️</span><span style={steel   >= totalCost.steel   ? S.costOk : S.costShort}>{totalCost.steel}</span></span>}
                    {u.cost.credits > 0 && <span style={S.costChip}><span>💰</span><span style={credits >= totalCost.credits ? S.costOk : S.costShort}>{totalCost.credits}</span></span>}
                    <span style={{ ...S.costChip, color: "#555" }}>⏱ {fmtTime(u.timeSec * q)}</span>
                  </div>
                  <div style={S.qtyRow}>
                    <button style={S.qtyBtn} onClick={() => setQty(u.unitType, q - 1)}>−</button>
                    <span style={S.qtyVal}>{q}</span>
                    <button style={S.qtyBtn} onClick={() => setQty(u.unitType, q + 1)}>+</button>
                    <span style={{ color: "#444", fontSize: 10 }}>units</span>
                  </div>
                  <button
                    style={{ ...S.trainBtn, ...(disabled ? S.trainBtnDisabled : {}) }}
                    disabled={disabled}
                    onClick={() => handleTrain(u.unitType)}
                  >
                    {pending === u.unitType ? "Sending..." : queueFull ? "Queue Full" : `⚑ Train ${q}×`}
                  </button>
                  {errors[u.unitType] && <span style={S.errMsg}>⚠ {errors[u.unitType]}</span>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
