import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  register, login, logout, isLoggedIn,
  getPlayerStatus, getBase, upgradeBuilding, constructBuilding,
  getTraining, trainUnit, openWs,
  getMapSectors, getScoutReports,
  TOKEN_KEY,
} from "./api.js";
import type { Building, PlayerStatus, FOB, WsMessage, TrainingUnit, Zone, ScoutReport } from "./types.js";
import { resolveZoneVisibility } from "./lib/mapVisibility.js";
import { StatusHeader }   from "./components/StatusHeader.js";
import { BuildingList }   from "./components/BuildingList.js";
import { BuildingDetail } from "./components/BuildingDetail.js";
import { AlertFeed }      from "./components/AlertFeed.js";
import { HexMap }         from "./components/HexMap.js";
import { ZonePanel }      from "./components/ZonePanel.js";

// ─── Login screen ──────────────────────────────────────────────

function LoginForm({ onLogin }: { onLogin: () => void }) {
  const [mode,     setMode]     = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [loginId,  setLoginId]  = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);

  function switchMode(next: "login" | "register") {
    setMode(next);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "register") {
        await register(username, loginId, password);
      } else {
        await login(loginId, password);
      }
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === "register" ? "Registration failed" : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  const S: Record<string, React.CSSProperties> = {
    wrap: { height: "100%", display: "flex", alignItems: "center", justifyContent: "center" },
    box: {
      background: "#111", border: "1px solid #2a2a2a", borderRadius: 4,
      padding: "32px 40px", width: 320,
    },
    title: { color: "#e8e8e8", fontSize: 18, textTransform: "uppercase", letterSpacing: 3, marginBottom: 24 },
    tabs:  { display: "flex", marginBottom: 24, borderBottom: "1px solid #2a2a2a" },
    tab: {
      flex: 1, background: "none", border: "none", padding: "8px", fontSize: 11,
      letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit",
    },
    label: { display: "block", color: "#666", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
    input: {
      width: "100%", background: "#0a0a0a", border: "1px solid #2a2a2a",
      color: "#e8e8e8", padding: "8px 10px", fontSize: 13,
      fontFamily: "inherit", borderRadius: 2, marginBottom: 16, outline: "none",
    },
    btn: {
      width: "100%", background: "#1a3a1a", border: "1px solid #2a5a2a",
      color: "#4caf50", padding: "10px", fontSize: 13, letterSpacing: 1,
      textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit",
      borderRadius: 2, opacity: loading ? 0.6 : 1,
    },
    err: { color: "#f44336", fontSize: 12, marginTop: 12 },
  };

  const activeTab:   React.CSSProperties = { color: "#e8e8e8", borderBottom: "2px solid #4caf50" };
  const inactiveTab: React.CSSProperties = { color: "#444" };

  return (
    <div style={S.wrap}>
      <form style={S.box} onSubmit={submit}>
        <div style={S.title}>Global Mandate</div>
        <div style={S.tabs}>
          <button type="button" style={{ ...S.tab, ...(mode === "login"    ? activeTab : inactiveTab) }} onClick={() => switchMode("login")}>Login</button>
          <button type="button" style={{ ...S.tab, ...(mode === "register" ? activeTab : inactiveTab) }} onClick={() => switchMode("register")}>Register</button>
        </div>
        {mode === "register" && (
          <label style={S.label}>Username<input style={S.input} type="text" value={username} onChange={e => setUsername(e.target.value)} required /></label>
        )}
        <label style={S.label}>
          {mode === "login" ? "Username or Email" : "Email"}
          <input style={S.input} type="text" value={loginId} onChange={e => setLoginId(e.target.value)} required />
        </label>
        <label style={S.label}>Password<input style={S.input} type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        <button style={S.btn} disabled={loading}>
          {loading ? "Authenticating..." : mode === "login" ? "Connect" : "Register"}
        </button>
        {error && <div style={S.err}>⚠ {error}</div>}
      </form>
    </div>
  );
}

// ─── Dashboard ─────────────────────────────────────────────────

const MAX_ALERTS = 100;

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [player,           setPlayer]           = useState<PlayerStatus | null>(null);
  const [fob,              setFob]              = useState<FOB | null>(null);
  const [training,         setTraining]         = useState<TrainingUnit[]>([]);
  const [alerts,           setAlerts]           = useState<WsMessage[]>([]);
  const [error,            setError]            = useState<string | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  // Map state
  const [zones,            setZones]            = useState<Zone[]>([]);
  const [selectedZone,     setSelectedZone]     = useState<Zone | null>(null);
  const [showBuildingPanel, setShowBuildingPanel] = useState(false);

  // Stable refs for WS callback closures
  const playerRef       = useRef<PlayerStatus | null>(null);
  const scoutReportsRef = useRef<ScoutReport[]>([]);
  useEffect(() => { playerRef.current = player; }, [player]);

  const addAlert = useCallback((msg: WsMessage) => {
    setAlerts(prev => [...prev.slice(-(MAX_ALERTS - 1)), msg]);
  }, []);

  // ── Rebuild zone visibility whenever zones or player changes ──
  const rawZonesRef = useRef<Omit<Zone, "visibility" | "units">[]>([]);

  function rebuildZones(p: PlayerStatus) {
    const resolved = resolveZoneVisibility(rawZonesRef.current, p.id, scoutReportsRef.current);
    setZones(resolved);
  }

  // Initial data load
  useEffect(() => {
    Promise.all([getPlayerStatus(), getBase(), getTraining(), getMapSectors(), getScoutReports()])
      .then(([p, b, t, m, s]) => {
        setPlayer(p);
        setFob(b.fob);
        setTraining(t.training);
        scoutReportsRef.current = s.reports;
        rawZonesRef.current = m.sectors.flatMap(sec =>
          sec.zones.map(z => ({ ...z, sectorId: sec.id }))
        );
        rebuildZones(p);
      })
      .catch(err => setError(err instanceof Error ? err.message : "Failed to load"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh player status every 30 s
  useEffect(() => {
    const id = setInterval(() => {
      getPlayerStatus().then(p => { setPlayer(p); rebuildZones(p); }).catch(() => null);
    }, 30_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll training queue every 10 s
  useEffect(() => {
    const id = setInterval(() => {
      getTraining().then(t => setTraining(t.training)).catch(() => null);
    }, 10_000);
    return () => clearInterval(id);
  }, []);

  // WebSocket
  useEffect(() => {
    const ws = openWs((msg) => {
      addAlert(msg);

      if (msg.type === "BUILDING_UPGRADE_COMPLETED" || msg.type === "BUILDING_CONSTRUCTION_COMPLETED") {
        Promise.all([getPlayerStatus(), getBase()])
          .then(([p, b]) => {
            setPlayer(p);
            setFob(b.fob);
            setSelectedBuilding(prev =>
              prev ? (b.fob.buildings.find(bl => bl.id === prev.id) ?? prev) : null,
            );
          })
          .catch(() => null);
      }

      if (msg.type === "UNIT_TRAINING_STARTED" || msg.type === "UNIT_TRAINED") {
        Promise.all([getPlayerStatus(), getTraining()])
          .then(([p, t]) => { setPlayer(p); setTraining(t.training); })
          .catch(() => null);
      }

      // Refresh map on zone-affecting events
      if (["ZONE_CAPTURED", "BATTLE_RESOLVED", "UNIT_ARRIVED"].includes(msg.type)) {
        Promise.all([getPlayerStatus(), getMapSectors()])
          .then(([p, m]) => {
            setPlayer(p);
            rawZonesRef.current = m.sectors.flatMap(sec =>
              sec.zones.map(z => ({ ...z, sectorId: sec.id }))
            );
            rebuildZones(p);
          })
          .catch(() => null);
      }
    });
    return () => ws.close();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addAlert]);

  // ── Zone click handler ─────────────────────────────────────────
  function handleZoneClick(zone: Zone) {
    setSelectedZone(zone);
    if (fob && zone.id === fob.zoneId) {
      setShowBuildingPanel(true);
    } else {
      setShowBuildingPanel(false);
      setSelectedBuilding(null);
    }
  }

  // ── Styles ─────────────────────────────────────────────────────
  const S: Record<string, React.CSSProperties> = {
    shell:    { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" },
    topbar: {
      display: "flex", justifyContent: "flex-end",
      padding: "6px 20px", borderBottom: "1px solid #1a1a1a",
      background: "#0d0d0d", flexShrink: 0,
    },
    logoutBtn: {
      background: "none", border: "none", color: "#444", cursor: "pointer",
      fontSize: 11, fontFamily: "inherit", letterSpacing: 1, textTransform: "uppercase",
    },
    mapWrapper: { position: "relative", flex: 1, overflow: "hidden" },
    // FOB building panel — right overlay
    buildingPanel: {
      position: "absolute", top: 0, right: 0, bottom: 0,
      display: "flex", width: 460,
      background: "#0d0d0d", borderLeft: "1px solid #1a1a1a",
      zIndex: 20,
    },
    buildingListCol:   { width: 180, overflowY: "auto", borderRight: "1px solid #111" },
    buildingDetailCol: { flex: 1, overflowY: "auto" },
    // Alert feed — top-right corner overlay
    alertOverlay: {
      position: "absolute", top: 8, width: 300,
      maxHeight: 200, overflowY: "auto", zIndex: 5,
      background: "rgba(10,10,10,0.85)", borderRadius: 2,
    },
    error: { padding: "12px 20px", color: "#f44336", fontSize: 12 },
  };

  if (error) return <div style={S.error}>⚠ {error}</div>;

  const alertRight = showBuildingPanel ? 468 : 8;

  return (
    <div style={S.shell}>
      <div style={S.topbar}>
        <button style={S.logoutBtn} onClick={onLogout}>Disconnect</button>
      </div>

      {player && <StatusHeader player={player} />}

      <div style={S.mapWrapper}>
        {/* Hex map fills the full area */}
        {player && (
          <HexMap
            zones={zones}
            playerId={player.id}
            fobZoneId={fob?.zoneId ?? null}
            onZoneClick={handleZoneClick}
          />
        )}

        {/* FOB building panel — slides in from right when FOB zone selected */}
        {showBuildingPanel && fob && player && (
          <div style={S.buildingPanel}>
            <div style={S.buildingListCol}>
              <BuildingList
                buildings={fob.buildings}
                steel={player.steel}
                credits={player.credits}
                selectedId={selectedBuilding?.id}
                onSelect={setSelectedBuilding}
                onConstruct={async (buildingType) => {
                  const { building } = await constructBuilding(buildingType);
                  setFob(prev => prev && { ...prev, buildings: [...prev.buildings, building] });
                  const updated = await getPlayerStatus();
                  setPlayer(updated);
                }}
              />
            </div>
            {selectedBuilding && (
              <div style={S.buildingDetailCol}>
                <BuildingDetail
                  building={selectedBuilding}
                  steel={player.steel}
                  credits={player.credits}
                  fuel={player.fuel}
                  rations={player.rations}
                  training={training}
                  onUpgrade={async (buildingType) => {
                    const { building } = await upgradeBuilding(buildingType);
                    setFob(prev => prev && {
                      ...prev,
                      buildings: prev.buildings.map(b => b.id === building.id ? building : b),
                    });
                    setSelectedBuilding(building);
                    const updated = await getPlayerStatus();
                    setPlayer(updated);
                  }}
                  onTrain={async (unitType, quantity) => {
                    await trainUnit(unitType, quantity);
                    const [p, t] = await Promise.all([getPlayerStatus(), getTraining()]);
                    setPlayer(p);
                    setTraining(t.training);
                  }}
                  onBack={() => setSelectedBuilding(null)}
                />
              </div>
            )}
          </div>
        )}

        {/* Zone detail panel — slides up from bottom */}
        {player && (
          <ZonePanel
            zone={selectedZone}
            playerId={player.id}
            onClose={() => setSelectedZone(null)}
          />
        )}

        {/* Alert feed — top-right corner overlay */}
        <div style={{ ...S.alertOverlay, right: alertRight }}>
          <AlertFeed alerts={alerts} />
        </div>
      </div>
    </div>
  );
}

// ─── Root ──────────────────────────────────────────────────────

export default function App() {
  const [authed, setAuthed] = useState(isLoggedIn);

  function handleLogout() {
    logout();
    setAuthed(false);
  }

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) setAuthed(true);
  }, []);

  if (!authed) return <LoginForm onLogin={() => setAuthed(true)} />;
  return <Dashboard onLogout={handleLogout} />;
}
