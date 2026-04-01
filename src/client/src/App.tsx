import { useState, useEffect, useCallback } from "react";
import { register, login, logout, isLoggedIn, getPlayerStatus, getBase, upgradeBuilding, openWs, TOKEN_KEY } from "./api.js";
import type { PlayerStatus, FOB, WsMessage } from "./types.js";
import { StatusHeader } from "./components/StatusHeader.js";
import { BuildingList }  from "./components/BuildingList.js";
import { AlertFeed }     from "./components/AlertFeed.js";

// ─── Login screen ──────────────────────────────────────────────

function LoginForm({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register(username, email, password);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
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

  return (
    <div style={S.wrap}>
      <form style={S.box} onSubmit={submit}>
        <div style={S.title}>Global Mandate</div>
        <label style={S.label}>Username<input style={S.input} type="text" value={username} onChange={e => setUsername(e.target.value)} required /></label>
        <label style={S.label}>Email<input style={S.input} type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label style={S.label}>Password<input style={S.input} type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        <button style={S.btn} disabled={loading}>{loading ? "Authenticating..." : "Connect"}</button>
        {error && <div style={S.err}>⚠ {error}</div>}
      </form>
    </div>
  );
}

// ─── Dashboard ─────────────────────────────────────────────────

const MAX_ALERTS = 100;

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [player,  setPlayer]  = useState<PlayerStatus | null>(null);
  const [fob,     setFob]     = useState<FOB | null>(null);
  const [alerts,  setAlerts]  = useState<WsMessage[]>([]);
  const [error,   setError]   = useState<string | null>(null);

  const addAlert = useCallback((msg: WsMessage) => {
    setAlerts(prev => [...prev.slice(-(MAX_ALERTS - 1)), msg]);
  }, []);

  // Initial data load
  useEffect(() => {
    Promise.all([getPlayerStatus(), getBase()])
      .then(([p, b]) => { setPlayer(p); setFob(b.fob); })
      .catch(err => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  // Refresh player status every 30 s
  useEffect(() => {
    const id = setInterval(() => {
      getPlayerStatus().then(setPlayer).catch(() => null);
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  // WebSocket connection
  useEffect(() => {
    const ws = openWs((msg) => {
      addAlert(msg);
      // Refresh player on resource-affecting events
      if (["ZONE_CAPTURED", "BATTLE_RESOLVED", "UNIT_ARRIVED"].includes(msg.type)) {
        getPlayerStatus().then(setPlayer).catch(() => null);
      }
    });
    return () => ws.close();
  }, [addAlert]);

  const S: Record<string, React.CSSProperties> = {
    shell: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" },
    main:  { flex: 1, overflowY: "auto" },
    divider: { borderTop: "1px solid #1a1a1a", margin: "0 0 0" },
    topbar: {
      display: "flex", justifyContent: "flex-end",
      padding: "6px 20px", borderBottom: "1px solid #1a1a1a",
      background: "#0d0d0d",
    },
    logoutBtn: {
      background: "none", border: "none", color: "#444", cursor: "pointer",
      fontSize: 11, fontFamily: "inherit", letterSpacing: 1, textTransform: "uppercase",
    },
    error: { padding: "12px 20px", color: "#f44336", fontSize: 12 },
  };

  if (error) return <div style={S.error}>⚠ {error}</div>;

  return (
    <div style={S.shell}>
      <div style={S.topbar}>
        <button style={S.logoutBtn} onClick={onLogout}>Disconnect</button>
      </div>
      {player && <StatusHeader player={player} />}
      <div style={S.main}>
        {fob && player && (
          <BuildingList
            buildings={fob.buildings}
            steel={player.steel}
            credits={player.credits}
            onUpgrade={async (buildingType) => {
              const { building } = await upgradeBuilding(buildingType);
              setFob(prev => prev && {
                ...prev,
                buildings: prev.buildings.map(b => b.id === building.id ? building : b),
              });
              const updated = await getPlayerStatus();
              setPlayer(updated);
            }}
          />
        )}
        <div style={S.divider} />
        <AlertFeed alerts={alerts} />
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

  // Remove token from URL if present (e.g. redirect from OAuth)
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) setAuthed(true);
  }, []);

  if (!authed) return <LoginForm onLogin={() => setAuthed(true)} />;
  return <Dashboard onLogout={handleLogout} />;
}
