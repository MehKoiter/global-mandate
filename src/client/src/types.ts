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
