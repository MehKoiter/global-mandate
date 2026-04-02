// Shared API response types — mirrors the backend route shapes

export interface PlayerStatus {
  id:                    string;
  username:              string;
  fuel:                  number;
  rations:               number;
  steel:                 number;
  credits:               number;
  maxCommandPoints:      number;
  usedCommandPoints:     number;
  fuelNetPerHour:        number;
  rationsNetPerHour:     number;
  steelNetPerHour:       number;
  creditsNetPerHour:     number;
  tutorialStep:          number;
  tutorialComplete:      boolean;
  newPlayerProtectionEndsAt: string | null;
}

export interface Building {
  id:                     string;
  buildingType:           string;
  level:                  number;
  isUpgrading:            boolean;
  upgradeEndsAt:          string | null;
  isOperational:          boolean;
  maintenanceFuelPerHour: number;
}

export interface FOB {
  id:       string;
  zoneId:   string;
  buildings: Building[];
}

export interface TrainingUnit {
  id:             string;
  unitType:       string;
  quantity:       number;
  trainingEndsAt: string;
}

export interface WsMessage {
  type:    string;
  zoneId?: string;
  playerId?: string;
  payload: Record<string, unknown>;
  ts:      number;
}

// ─── Map Types ─────────────────────────────────────────────────

export type ZoneVisibility = "owned" | "scouted" | "dark";
export type TerrainType    = "PLAINS" | "FOREST" | "MOUNTAIN" | "WATER" | "DESERT" | "URBAN";

export interface ZoneUnit {
  id:        string;
  unitType:  string;
  quantity:  number;
  ownerId:   string;
  status:    string;
  healthPct: number | null;
}

export interface Zone {
  id:                 string;
  name:               string;
  sectorId:           string;
  q:                  number;
  r:                  number;
  ownerPlayerId:      string | null;
  fortificationLevel: number;
  hasRoad:            boolean;
  bridgeDestroyed:    boolean;
  isConnected:        boolean;
  capturedAt:         string | null;
  terrainType:        TerrainType;
  fuelPerHour:        number | null;
  rationsPerHour:     number | null;
  steelPerHour:       number | null;
  creditsPerHour:     number | null;
  visibility:         ZoneVisibility;
  units?:             ZoneUnit[];
}

export interface Sector {
  id:    string;
  name:  string;
  q:     number;
  r:     number;
  zones: Omit<Zone, "visibility" | "units">[];
}

export interface ScoutReport {
  id:           string;
  scouterId:    string;
  targetZoneId: string;
  reportedAt:   string;
  unitSnapshot: ZoneUnit[];
  expiresAt:    string;
}
