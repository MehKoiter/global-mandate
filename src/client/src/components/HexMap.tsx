// =============================================================
// Global Mandate — PixiJS Hex Map
// Two-layer rendering:
//   1. Background terrain layer — fills every hex in world range
//      (non-interactive, driven by client-side noise)
//   2. Zone layer — 700 game zones on top with ownership borders
// =============================================================

import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import type { Zone, ZoneVisibility, TerrainType } from "../types.js";

// ─── Hex geometry (pointy-top) ────────────────────────────────

const HEX_SIZE = 24;

function axialToPixel(q: number, r: number): { x: number; y: number } {
  return {
    x: HEX_SIZE * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r),
    y: HEX_SIZE * (3 / 2) * r,
  };
}

function hexCornerPoints(cx: number, cy: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push(cx + HEX_SIZE * Math.cos(angle), cy + HEX_SIZE * Math.sin(angle));
  }
  return pts;
}

// ─── Client-side terrain noise (mirrors src/lib/terrainNoise.ts) ──
// Duplicated here so background hexes need no API call.

function elevation(q: number, r: number): number {
  const x = q * 0.05, y = r * 0.05;
  return (
    Math.sin(x * 1.0 + y * 0.8) * 0.4 +
    Math.sin(x * 2.3 - y * 1.5) * 0.3 +
    Math.sin(x * 0.7 + y * 2.1) * 0.3
  ) * 0.5 + 0.5;
}

function moisture(q: number, r: number): number {
  const x = q * 0.06 + 100, y = r * 0.06 + 100;
  return (
    Math.sin(x * 1.4 + y * 0.6) * 0.4 +
    Math.sin(x * 0.8 - y * 2.0) * 0.3 +
    Math.sin(x * 2.5 + y * 1.1) * 0.3
  ) * 0.5 + 0.5;
}

function riverFactor(q: number, r: number): number {
  const x = q * 0.08 + 50, y = r * 0.04 + 50;
  return Math.abs(Math.sin(x * 1.2 + y * 0.3) * Math.cos(x * 0.4 - y * 1.1));
}

function noiseToTerrain(q: number, r: number): TerrainType {
  const elev  = elevation(q, r);
  const moist = moisture(q, r);
  const river = riverFactor(q, r);
  if (river < 0.06 && elev < 0.6) return "WATER";
  if (elev < 0.25)  return "WATER";
  if (elev > 0.78)  return "MOUNTAIN";
  if (moist < 0.25) return "DESERT";
  if (moist > 0.72) return "FOREST";
  if (moist > 0.45 && moist < 0.62 && Math.sin(q * 7.3 + r * 11.7) > 0.78) return "URBAN";
  return "PLAINS";
}

// ─── Color palettes ───────────────────────────────────────────

// Background hex fills (darker — recede behind zones)
const BG_FILL: Record<TerrainType, number> = {
  PLAINS:   0x1c1a10,
  FOREST:   0x091508,
  MOUNTAIN: 0x181818,
  WATER:    0x080f18,
  DESERT:   0x1e1808,
  URBAN:    0x10101a,
};

// Zone hex fills (brighter — stand out above background)
const ZONE_FILL: Record<TerrainType, number> = {
  PLAINS:   0x2e2b18,
  FOREST:   0x122010,
  MOUNTAIN: 0x252525,
  WATER:    0x0d1a2a,
  DESERT:   0x2e2410,
  URBAN:    0x1a1a2e,
};

// Ownership border colors
const BORDER = {
  owned:    { color: 0x4caf50, width: 1.5 },
  scouted:  { color: 0x2979ff, width: 1.2 },
  enemy:    { color: 0xf44336, width: 1.2 },
  dark:     { color: 0x2a2a2a, width: 0.5 },
  selected: { color: 0xfdd835, width: 2.0 },
  fob:      { color: 0x4caf50, width: 2.0 },
} as const;

// Dim a hex color for fog-of-war zones
function dimColor(hex: number, factor: number): number {
  const r = ((hex >> 16) & 0xff) * factor;
  const g = ((hex >>  8) & 0xff) * factor;
  const b = ( hex        & 0xff) * factor;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

function zoneColors(zone: Zone, selected: boolean, isFob: boolean): { fill: number; borderColor: number; borderWidth: number } {
  const base = ZONE_FILL[zone.terrainType];

  if (selected) return { fill: base, borderColor: BORDER.selected.color, borderWidth: BORDER.selected.width };
  if (isFob)    return { fill: base, borderColor: BORDER.fob.color,      borderWidth: BORDER.fob.width };

  if (zone.visibility === "owned")   return { fill: base,             borderColor: BORDER.owned.color,   borderWidth: BORDER.owned.width };
  if (zone.visibility === "scouted") return { fill: base,             borderColor: BORDER.scouted.color, borderWidth: BORDER.scouted.width };
  if (zone.ownerPlayerId !== null)   return { fill: dimColor(base, 0.5), borderColor: BORDER.enemy.color, borderWidth: BORDER.enemy.width };
  return                                    { fill: dimColor(base, 0.4), borderColor: BORDER.dark.color,  borderWidth: BORDER.dark.width };
}

// ─── Props ────────────────────────────────────────────────────

interface HexMapProps {
  zones:       Zone[];
  playerId:    string;
  fobZoneId:   string | null;
  onZoneClick: (zone: Zone) => void;
}

// ─── Component ────────────────────────────────────────────────

export function HexMap({ zones, playerId, fobZoneId, onZoneClick }: HexMapProps) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const appRef         = useRef<Application | null>(null);
  const worldRef       = useRef<Container | null>(null);
  const hexGfxRef      = useRef<Map<string, Graphics>>(new Map());
  const zonesRef       = useRef<Zone[]>(zones);
  const onZoneClickRef = useRef(onZoneClick);
  const fobZoneIdRef   = useRef(fobZoneId);
  const selectedIdRef  = useRef<string | null>(null);
  const isDraggingRef  = useRef(false);

  useEffect(() => { zonesRef.current = zones; },       [zones]);
  useEffect(() => { onZoneClickRef.current = onZoneClick; }, [onZoneClick]);
  useEffect(() => { fobZoneIdRef.current = fobZoneId; }, [fobZoneId]);

  // ── Initial PixiJS setup ─────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    let destroyed   = false;
    let initialized = false;

    const app = new Application();
    appRef.current = app;

    void app.init({
      resizeTo:        el,
      backgroundColor: 0x050505,
      antialias:       false,
      resolution:      window.devicePixelRatio || 1,
      autoDensity:     true,
    }).then(() => {
      initialized = true;
      if (destroyed) { app.destroy(true, { children: true }); return; }
      el.appendChild(app.canvas);
      buildScene(app);
    });

    return () => {
      destroyed = true;
      hexGfxRef.current.clear();
      worldRef.current = null;
      appRef.current   = null;
      if (initialized) app.destroy(true, { children: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Recolor zone hexes when zone data changes ─────────────────
  useEffect(() => {
    const gfxMap = hexGfxRef.current;
    if (gfxMap.size === 0) return;
    for (const zone of zones) {
      const gfx = gfxMap.get(zone.id);
      if (gfx) redrawZoneHex(gfx, zone, zone.id === selectedIdRef.current, zone.id === fobZoneIdRef.current);
    }
  }, [zones]);

  // ── FOB ring update ───────────────────────────────────────────
  useEffect(() => {
    const gfxMap = hexGfxRef.current;
    if (gfxMap.size === 0) return;
    for (const zone of zonesRef.current) {
      const gfx = gfxMap.get(zone.id);
      if (gfx) redrawZoneHex(gfx, zone, zone.id === selectedIdRef.current, zone.id === fobZoneId);
    }
  }, [fobZoneId]);

  // ─── Build scene ─────────────────────────────────────────────

  function buildScene(app: Application) {
    const world = new Container();
    worldRef.current = world;
    app.stage.addChild(world);

    const zs = zonesRef.current;

    // Compute world bounds from zone coordinates
    const minQ = Math.min(...zs.map(z => z.q)) - 2;
    const maxQ = Math.max(...zs.map(z => z.q)) + 2;
    const minR = Math.min(...zs.map(z => z.r)) - 2;
    const maxR = Math.max(...zs.map(z => z.r)) + 2;

    // ── Layer 1: background terrain (non-interactive) ──────────
    // Axial hex coords skew right as r increases (parallelogram effect).
    // Compensate by adjusting qMin/qMax per row so the visual boundary
    // is rectangular: at low r, extend q right; at high r, extend q left.
    const bgContainer = new Container();
    world.addChild(bgContainer);

    for (let r = minR; r <= maxR; r++) {
      const qMin = Math.floor(minQ + (minR - r) / 2);
      const qMax = Math.ceil(maxQ  + (maxR - r) / 2);
      for (let q = qMin; q <= qMax; q++) {
        const terrain = noiseToTerrain(q, r);
        const { x, y } = axialToPixel(q, r);
        const gfx = new Graphics();
        gfx.poly(hexCornerPoints(x, y))
           .fill(BG_FILL[terrain])
           .stroke({ color: 0x000000, width: 0.3 });
        bgContainer.addChild(gfx);
      }
    }

    // ── Layer 2: zone hexes (interactive) ─────────────────────
    const fobId = fobZoneIdRef.current;
    for (const zone of zs) {
      const gfx = new Graphics();
      gfx.label       = zone.id;
      gfx.interactive = true;
      gfx.cursor      = "pointer";
      redrawZoneHex(gfx, zone, false, zone.id === fobId);
      world.addChild(gfx);
      hexGfxRef.current.set(zone.id, gfx);
    }

    // Center on FOB zone (or world midpoint)
    const fobZone = zs.find(z => z.id === fobId);
    const focusQ  = fobZone ? fobZone.q : Math.round((minQ + maxQ) / 2);
    const focusR  = fobZone ? fobZone.r : Math.round((minR + maxR) / 2);
    const focus   = axialToPixel(focusQ, focusR);
    world.position.set(
      app.screen.width  / 2 - focus.x,
      app.screen.height / 2 - focus.y,
    );

    setupInteractivity(app, world);
  }

  // ─── Draw / redraw a single zone hex ────────────────────────

  function redrawZoneHex(gfx: Graphics, zone: Zone, selected: boolean, isFob: boolean) {
    const { x, y } = axialToPixel(zone.q, zone.r);
    const { fill, borderColor, borderWidth } = zoneColors(zone, selected, isFob);

    gfx.clear();
    gfx.poly(hexCornerPoints(x, y))
       .fill(fill)
       .stroke({ color: borderColor, width: borderWidth });

    // Zone name label (visible zones only, shown at zoom ≥ 0.6)
    if (zone.visibility !== "dark") {
      const label = new Text({
        text:  zone.name.length > 12 ? zone.name.slice(0, 12) : zone.name,
        style: new TextStyle({ fontSize: 6, fill: 0xaaaaaa, fontFamily: "monospace" }),
      });
      label.anchor.set(0.5);
      label.position.set(x, y + HEX_SIZE * 0.52);
      gfx.addChild(label);
    }

    // FOB indicator dot
    if (isFob) {
      const dot = new Graphics();
      dot.circle(x, y - 4, 3).fill(0x4caf50);
      gfx.addChild(dot);
    }
  }

  // ─── Pan + zoom interactivity ────────────────────────────────

  function setupInteractivity(app: Application, world: Container) {
    let dragStartScreen = { x: 0, y: 0 };
    let dragStartWorld  = { x: 0, y: 0 };
    let isPointerDown   = false;

    app.stage.interactive = true;
    app.stage.hitArea     = app.screen;

    app.stage.on("pointerdown", (e) => {
      isPointerDown         = true;
      isDraggingRef.current = false;
      dragStartScreen = { x: e.global.x, y: e.global.y };
      dragStartWorld  = { x: world.x, y: world.y };
    });

    app.stage.on("pointermove", (e) => {
      if (!isPointerDown) return;
      const dx = e.global.x - dragStartScreen.x;
      const dy = e.global.y - dragStartScreen.y;
      if (!isDraggingRef.current && Math.sqrt(dx * dx + dy * dy) > 5) {
        isDraggingRef.current = true;
      }
      if (isDraggingRef.current) {
        world.x = dragStartWorld.x + dx;
        world.y = dragStartWorld.y + dy;
      }
    });

    app.stage.on("pointerup",        () => { isPointerDown = false; isDraggingRef.current = false; });
    app.stage.on("pointerupoutside", () => { isPointerDown = false; isDraggingRef.current = false; });

    // Zone click — fires only if not dragging
    for (const [zoneId, gfx] of hexGfxRef.current) {
      const zone = zonesRef.current.find(z => z.id === zoneId);
      if (!zone) continue;
      gfx.on("pointerup", () => {
        if (isDraggingRef.current) return;

        // Deselect previous
        if (selectedIdRef.current) {
          const prevGfx  = hexGfxRef.current.get(selectedIdRef.current);
          const prevZone = zonesRef.current.find(z => z.id === selectedIdRef.current);
          if (prevGfx && prevZone) {
            redrawZoneHex(prevGfx, prevZone, false, prevZone.id === fobZoneIdRef.current);
          }
        }

        selectedIdRef.current = zone.id;
        redrawZoneHex(gfx, zone, true, zone.id === fobZoneIdRef.current);
        onZoneClickRef.current(zone);
      });
    }

    // Zoom toward cursor
    app.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor   = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newScale = Math.max(0.25, Math.min(5.0, world.scale.x * factor));

      const worldPos     = world.toLocal({ x: e.offsetX, y: e.offsetY });
      world.scale.set(newScale);
      const newScreenPos = world.toGlobal(worldPos);
      world.x += e.offsetX - newScreenPos.x;
      world.y += e.offsetY - newScreenPos.y;

      // Toggle zone labels based on zoom level
      const showLabels = newScale >= 0.6;
      for (const gfx of hexGfxRef.current.values()) {
        for (const child of gfx.children) {
          if (child instanceof Text) child.visible = showLabels;
        }
      }
    }, { passive: false });
  }

  function centerOnFob() {
    const app   = appRef.current;
    const world = worldRef.current;
    if (!app || !world) return;
    const fobZone = zonesRef.current.find(z => z.id === fobZoneIdRef.current);
    if (!fobZone) return;
    const { x, y } = axialToPixel(fobZone.q, fobZone.r);
    world.position.set(
      app.screen.width  / 2 - x * world.scale.x,
      app.screen.height / 2 - y * world.scale.y,
    );
    // Also open the building panel
    onZoneClickRef.current(fobZone);
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", overflow: "hidden", background: "#050505" }}
      />
      {fobZoneId && (
        <button
          onClick={centerOnFob}
          style={{
            position: "absolute", bottom: 12, right: 12,
            background: "#0d1a0d", border: "1px solid #2a5a2a",
            color: "#4caf50", fontSize: 11, fontFamily: "inherit",
            letterSpacing: 1, textTransform: "uppercase",
            padding: "6px 12px", cursor: "pointer", borderRadius: 2,
            zIndex: 10,
          }}
        >
          ◎ FOB
        </button>
      )}
    </div>
  );
}
