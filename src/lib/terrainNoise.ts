// =============================================================
// Global Mandate — Terrain Noise Utility
// Deterministic terrain generation from axial hex coordinates.
// Used by the seed script, the assign-terrain script, and
// (duplicated) in the client HexMap for background rendering.
// =============================================================

export type TerrainType = "PLAINS" | "FOREST" | "MOUNTAIN" | "WATER" | "DESERT" | "URBAN";

// ─── Noise functions ──────────────────────────────────────────
// All use overlapping sine waves at low frequency so adjacent
// hexes have similar values → large coherent biome regions.

function elevation(q: number, r: number): number {
  const x = q * 0.05, y = r * 0.05;
  return (
    Math.sin(x * 1.0 + y * 0.8) * 0.4 +
    Math.sin(x * 2.3 - y * 1.5) * 0.3 +
    Math.sin(x * 0.7 + y * 2.1) * 0.3
  ) * 0.5 + 0.5;
}

function moisture(q: number, r: number): number {
  // Large phase offset ensures independence from elevation
  const x = q * 0.06 + 100, y = r * 0.06 + 100;
  return (
    Math.sin(x * 1.4 + y * 0.6) * 0.4 +
    Math.sin(x * 0.8 - y * 2.0) * 0.3 +
    Math.sin(x * 2.5 + y * 1.1) * 0.3
  ) * 0.5 + 0.5;
}

// abs(sin × cos) creates narrow ridge-valley patterns.
// Low values = valley = river corridor (1–2 hexes wide → bridgeable).
function riverFactor(q: number, r: number): number {
  const x = q * 0.08 + 50, y = r * 0.04 + 50;
  return Math.abs(Math.sin(x * 1.2 + y * 0.3) * Math.cos(x * 0.4 - y * 1.1));
}

// ─── Terrain assignment ───────────────────────────────────────

/**
 * Returns the terrain type for any axial hex coordinate.
 * Deterministic — same (q, r) always returns the same terrain.
 *
 * Biome rules:
 *   WATER    — low-elevation basins (lakes) + narrow river valleys
 *   MOUNTAIN — high elevation → natural barrier between biomes
 *   DESERT   — low moisture (dry regions)
 *   FOREST   — high moisture (wet regions)
 *   PLAINS   — moderate moisture buffer between desert and forest
 *   URBAN    — sparse settlements in moderate-moisture plains
 *
 * Desert and Forest never border directly — they are always separated
 * by PLAINS, MOUNTAIN, or WATER.
 */
export function noiseToTerrain(q: number, r: number): TerrainType {
  const elev  = elevation(q, r);
  const moist = moisture(q, r);
  const river = riverFactor(q, r);

  // Narrow river corridors (1–2 hex wide — bridgeable in future build mechanics)
  if (river < 0.06 && elev < 0.6) return "WATER";

  // Large low-elevation lake basins
  if (elev < 0.25) return "WATER";

  // Mountain ridges — natural separator between incompatible biomes
  if (elev > 0.78) return "MOUNTAIN";

  // Land biomes driven by moisture gradient
  // Desert (dry) and Forest (wet) sit at opposite ends → never adjacent
  if (moist < 0.25) return "DESERT";
  if (moist > 0.72) return "FOREST";

  // Sparse urban in moderate-moisture plains
  if (moist > 0.45 && moist < 0.62 && Math.sin(q * 7.3 + r * 11.7) > 0.78) return "URBAN";

  return "PLAINS";
}
