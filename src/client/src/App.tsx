import { useState, useEffect, useCallback } from "react";
import { register, login, logout, isLoggedIn, getPlayerStatus, getBase, upgradeBuilding, constructBuilding, getTraining, trainUnit, openWs, TOKEN_KEY } from "./api.js";
import type { Building, PlayerStatus, FOB, WsMessage, TrainingUnit } from "./types.js";
import { StatusHeader }   from "./components/StatusHeader.js";
import { BuildingList }   from "./components/BuildingList.js";
import { BuildingDetail } from "./components/BuildingDetail.js";
import { AlertFeed }      from "./components/AlertFeed.js";

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
    tabs: { display: "flex", marginBottom: 24, borderBottom: "1px solid #2a2a2a" },
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

  const addAlert = useCallback((msg: WsMessage) => {
    setAlerts(prev => [...prev.slice(-(MAX_ALERTS - 1)), msg]);
  }, []);

  // Initial data load
  useEffect(() => {
    Promise.all([getPlayerStatus(), getBase(), getTraining()])
      .then(([p, b, t]) => { setPlayer(p); setFob(b.fob); setTraining(t.training); })
      .catch(err => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  // Refresh player status every 30 s
  useEffect(() => {
    const id = setInterval(() => {
      getPlayerStatus().then(setPlayer).catch(() => null);
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  // Poll training queue every 10 s
  useEffect(() => {
    const id = setInterval(() => {
      getTraining().then(t => setTraining(t.training)).catch(() => null);
    }, 10_000);
    return () => clearInterval(id);
  }, []);

  // WebSocket connection
  useEffect(() => {
    const ws = openWs((msg) => {
      addAlert(msg);
      if (["ZONE_CAPTURED", "BATTLE_RESOLVED", "UNIT_ARRIVED"].includes(msg.type)) {
        getPlayerStatus().then(setPlayer).catch(() => null);
      }
      if (msg.type === "BUILDING_UPGRADE_COMPLETED" || msg.type === "BUILDING_CONSTRUCTION_COMPLETED") {
        Promise.all([getPlayerStatus(), getBase()])
          .then(([p, b]) => {
            setPlayer(p);
            setFob(b.fob);
            // Keep selectedBuilding in sync with the refreshed FOB data
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
    });
    return () => ws.close();
  }, [addAlert]);

  const S: Record<string, React.CSSProperties> = {
    shell:   { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" },
    topbar: {
      display: "flex", justifyContent: "flex-end",
      padding: "6px 20px", borderBottom: "1px solid #1a1a1a",
      background: "#0d0d0d",
    },
    logoutBtn: {
      background: "none", border: "none", color: "#444", cursor: "pointer",
      fontSize: 11, fontFamily: "inherit", letterSpacing: 1, textTransform: "uppercase",
    },
    // Row splits the main area into list + detail panes
    contentRow: { flex: 1, display: "flex", overflow: "hidden" },
    // Left pane: narrow when a building is selected, full-width otherwise
    leftPane: {
      display: "flex", flexDirection: "column", overflow: "hidden",
      transition: "width 0.2s ease",
      width: selectedBuilding ? 180 : "100%",
      minWidth: selectedBuilding ? 180 : undefined,
      maxWidth: selectedBuilding ? 180 : undefined,
      borderRight: selectedBuilding ? "1px solid #1a1a1a" : "none",
      flexShrink: 0,
    },
    leftScroll:  { overflowY: "auto", flex: 1 },
    // Right pane: building detail + alert feed
    rightPane:   { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
    rightScroll: { flex: 1, overflowY: "auto" },
    divider:     { borderTop: "1px solid #1a1a1a" },
    error:       { padding: "12px 20px", color: "#f44336", fontSize: 12 },
  };

  if (error) return <div style={S.error}>⚠ {error}</div>;

  return (
    <div style={S.shell}>
      <div style={S.topbar}>
        <button style={S.logoutBtn} onClick={onLogout}>Disconnect</button>
      </div>
      {player && <StatusHeader player={player} />}

      <div style={S.contentRow}>
        {/* Left pane — building list (grid or collapsed) */}
        <div style={S.leftPane}>
          <div style={S.leftScroll}>
            {fob && player && (
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
            )}
          </div>
        </div>

        {/* Right pane — building detail or alert feed */}
        <div style={S.rightPane}>
          <div style={S.rightScroll}>
            {selectedBuilding && player ? (
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
            ) : (
              <>
                <div style={S.divider} />
                <AlertFeed alerts={alerts} />
              </>
            )}
          </div>
          {/* Alert feed always visible below detail when a building is open */}
          {selectedBuilding && (
            <>
              <div style={S.divider} />
              <div style={{ maxHeight: 200, overflowY: "auto" }}>
                <AlertFeed alerts={alerts} />
              </div>
            </>
          )}
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
