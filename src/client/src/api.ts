// Typed API helpers — all routes prefixed /api/v1

import type { PlayerStatus, FOB, Sector, Zone, ZoneUnit, ScoutReport } from "./types.js";

export const TOKEN_KEY = "gm_token";

function authHeaders(): HeadersInit {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { ...init, headers: { ...authHeaders(), ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Auth ──────────────────────────────────────────────────────

export interface AvailableStart {
  id:          string;
  name:        string;
  terrainType: string;
  q:           number;
  r:           number;
  sector:      { name: string };
}

export async function getAvailableStarts(): Promise<{ zones: AvailableStart[] }> {
  return apiFetch("/player/available-starts");
}

export async function register(username: string, email: string, password: string, zoneId: string): Promise<string> {
  const data = await apiFetch<{ token: string }>("/player/register", {
    method: "POST",
    body:   JSON.stringify({ username, email, password, zoneId }),
  });
  localStorage.setItem(TOKEN_KEY, data.token);
  return data.token;
}

export async function login(loginId: string, password: string): Promise<string> {
  const data = await apiFetch<{ token: string }>("/player/login", {
    method: "POST",
    body:   JSON.stringify({ login: loginId, password }),
  });
  localStorage.setItem(TOKEN_KEY, data.token);
  return data.token;
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isLoggedIn(): boolean {
  return Boolean(localStorage.getItem(TOKEN_KEY));
}

// ─── Player ────────────────────────────────────────────────────

export async function getPlayerStatus(): Promise<PlayerStatus> {
  return apiFetch<PlayerStatus>("/player/status");
}

// ─── Base ──────────────────────────────────────────────────────

export async function getBase(): Promise<{ fob: FOB }> {
  return apiFetch<{ fob: FOB }>("/base");
}

export async function constructBuilding(buildingType: string): Promise<{ building: FOB["buildings"][number] }> {
  return apiFetch("/base/construct", {
    method: "POST",
    body:   JSON.stringify({ buildingType }),
  });
}

export async function upgradeBuilding(buildingType: string): Promise<{ building: FOB["buildings"][number]; upgradeEndsAt: string }> {
  return apiFetch("/base/upgrade", {
    method: "POST",
    body:   JSON.stringify({ buildingType }),
  });
}

export async function getTraining(): Promise<{ training: import("./types.js").TrainingUnit[] }> {
  return apiFetch("/base/training");
}

export async function trainUnit(unitType: string, quantity: number): Promise<{ unit: import("./types.js").TrainingUnit; trainingEndsAt: string }> {
  return apiFetch("/base/train", {
    method: "POST",
    body:   JSON.stringify({ unitType, quantity }),
  });
}

// ─── Map ───────────────────────────────────────────────────────

export async function getMapSectors(): Promise<{ sectors: Sector[] }> {
  return apiFetch<{ sectors: Sector[] }>("/map/sectors");
}

export async function getZoneDetail(zoneId: string): Promise<{ zone: Zone & { units: ZoneUnit[] } }> {
  return apiFetch<{ zone: Zone & { units: ZoneUnit[] } }>(`/map/zone/${encodeURIComponent(zoneId)}`);
}

export async function getScoutReports(): Promise<{ reports: ScoutReport[] }> {
  return apiFetch<{ reports: ScoutReport[] }>("/map/scout-reports");
}

// ─── WebSocket ─────────────────────────────────────────────────

export function openWs(onMessage: (msg: import("./types.js").WsMessage) => void): WebSocket {
  const token = localStorage.getItem(TOKEN_KEY) ?? "";
  const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/v1/ws?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(wsUrl);

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data as string) as import("./types.js").WsMessage;
      onMessage(msg);
    } catch { /* ignore malformed frames */ }
  };

  return ws;
}
