// =============================================================
// Global Mandate — PixiJS Hex Map
// Renders 700 axial hex zones with pan/zoom and click detection.
// =============================================================

import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Text, TextStyle, Point } from "pixi.js";
import type { Zone, ZoneVisibility } from "../types.js";

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

// ─── Color palette ────────────────────────────────────────────

const COLORS = {
  owned:    { fill: 0x1a3a1a, border: 0x2a5a2a },
  scouted:  { fill: 0x1a1a2a, border: 0x2a2a4a },
  enemy:    { fill: 0x2a1a1a, border: 0x3a1e1e },
  dark:     { fill: 0x0e0e0e, border: 0x1a1a1a },
  fobRing:  0x4caf50,
  selected: 0xfdd835,
} as const;

function hexColors(zone: Zone): { fill: number; border: number } {
  if (zone.visibility === "owned")   return COLORS.owned;
  if (zone.visibility === "scouted") return COLORS.scouted;
  // dark — but we may know there's an enemy owner
  if (zone.ownerPlayerId !== null)   return COLORS.enemy;
  return COLORS.dark;
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
  const containerRef    = useRef<HTMLDivElement>(null);
  const appRef          = useRef<Application | null>(null);
  const worldRef        = useRef<Container | null>(null);
  // Per-zone Graphics objects for O(1) updates
  const hexGfxRef       = useRef<Map<string, Graphics>>(new Map());
  // Stable refs so PixiJS callbacks don't capture stale closures
  const zonesRef        = useRef<Zone[]>(zones);
  const onZoneClickRef  = useRef(onZoneClick);
  const fobZoneIdRef    = useRef(fobZoneId);
  const selectedIdRef   = useRef<string | null>(null);
  const isDraggingRef   = useRef(false);

  // Keep refs in sync with props
  useEffect(() => { zonesRef.current = zones; }, [zones]);
  useEffect(() => { onZoneClickRef.current = onZoneClick; }, [onZoneClick]);
  useEffect(() => { fobZoneIdRef.current = fobZoneId; }, [fobZoneId]);

  // ── Initial PixiJS setup ─────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    let destroyed = false;

    const app = new Application();
    appRef.current = app;

    void app.init({
      resizeTo:        el,
      backgroundColor: 0x0a0a0a,
      antialias:       false,
      resolution:      window.devicePixelRatio || 1,
      autoDensity:     true,
    }).then(() => {
      if (destroyed) { app.destroy(true); return; }
      el.appendChild(app.canvas);
      buildScene(app);
    });

    return () => {
      destroyed = true;
      hexGfxRef.current.clear();
      worldRef.current = null;
      appRef.current   = null;
      app.destroy(true, { children: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // runs once

  // ── Recolor hexes when zone data changes ─────────────────────
  useEffect(() => {
    const gfxMap = hexGfxRef.current;
    if (gfxMap.size === 0) return; // scene not built yet
    for (const zone of zones) {
      const gfx = gfxMap.get(zone.id);
      if (gfx) redrawHex(gfx, zone, zone.id === selectedIdRef.current, zone.id === fobZoneIdRef.current);
    }
  }, [zones]);

  // ─ FOB ring update when fobZoneId changes ───────────────────
  useEffect(() => {
    const gfxMap = hexGfxRef.current;
    if (gfxMap.size === 0) return;
    // Redraw all zones to refresh FOB ring
    for (const zone of zonesRef.current) {
      const gfx = gfxMap.get(zone.id);
      if (gfx) redrawHex(gfx, zone, zone.id === selectedIdRef.current, zone.id === fobZoneId);
    }
  }, [fobZoneId]);

  // ─── Build the initial PixiJS scene ─────────────────────────

  function buildScene(app: Application) {
    const world = new Container();
    worldRef.current = world;
    app.stage.addChild(world);

    // Center view on FOB zone if known, otherwise on world midpoint (q=40, r=40)
    const fobZone = zonesRef.current.find(z => z.id === fobZoneIdRef.current);
    const focusQ  = fobZone ? fobZone.q : 40;
    const focusR  = fobZone ? fobZone.r : 40;
    const focus   = axialToPixel(focusQ, focusR);
    world.position.set(
      app.screen.width  / 2 - focus.x,
      app.screen.height / 2 - focus.y,
    );

    // Draw all hexes
    for (const zone of zonesRef.current) {
      const gfx = createHex(zone);
      world.addChild(gfx);
      hexGfxRef.current.set(zone.id, gfx);
    }

    setupInteractivity(app, world);
  }

  // ─── Draw / redraw a single hex Graphics ────────────────────

  function createHex(zone: Zone): Graphics {
    const gfx = new Graphics();
    gfx.label = zone.id;
    redrawHex(gfx, zone, false, zone.id === fobZoneIdRef.current);
    gfx.interactive = true;
    gfx.cursor      = "pointer";
    return gfx;
  }

  function redrawHex(gfx: Graphics, zone: Zone, selected: boolean, isFob: boolean) {
    const { x, y } = axialToPixel(zone.q, zone.r);
    const { fill, border } = hexColors(zone);
    const borderColor = selected ? COLORS.selected : isFob ? COLORS.fobRing : border;
    const borderWidth = selected || isFob ? 1.5 : 0.5;

    gfx.clear();
    gfx.poly(hexCornerPoints(x, y)).fill(fill).stroke({ color: borderColor, width: borderWidth });

    // Zone name label for visible zones
    if (zone.visibility !== "dark") {
      const label = new Text({
        text:  zone.name.length > 12 ? zone.name.slice(0, 12) : zone.name,
        style: new TextStyle({ fontSize: 6, fill: 0x888888, fontFamily: "monospace" }),
      });
      label.anchor.set(0.5);
      label.position.set(x, y + HEX_SIZE * 0.52);
      label.visible = true; // hidden below zoom 0.6 via world scale check in app.ticker
      gfx.addChild(label);
    }

    // FOB indicator dot
    if (isFob) {
      const dot = new Graphics();
      dot.circle(x, y - 4, 3).fill(COLORS.fobRing);
      gfx.addChild(dot);
    }
  }

  // ─── Pan + zoom interactivity ────────────────────────────────

  function setupInteractivity(app: Application, world: Container) {
    let dragStartScreen = { x: 0, y: 0 };
    let dragStartWorld  = { x: 0, y: 0 };
    let pointerDownPos  = { x: 0, y: 0 };

    app.stage.interactive = true;
    app.stage.hitArea     = app.screen;

    app.stage.on("pointerdown", (e) => {
      isDraggingRef.current = false;
      dragStartScreen = { x: e.global.x, y: e.global.y };
      dragStartWorld  = { x: world.x, y: world.y };
      pointerDownPos  = { x: e.global.x, y: e.global.y };
    });

    app.stage.on("pointermove", (e) => {
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

    app.stage.on("pointerup", () => { isDraggingRef.current = false; });
    app.stage.on("pointerupoutside", () => { isDraggingRef.current = false; });

    // Wire click on each hex via pointerup — fires only if not dragging
    for (const [zoneId, gfx] of hexGfxRef.current) {
      const zone = zonesRef.current.find(z => z.id === zoneId);
      if (!zone) continue;
      gfx.on("pointerup", (e) => {
        e.stopPropagation();
        if (isDraggingRef.current) return;

        // Deselect previous hex
        if (selectedIdRef.current) {
          const prevGfx  = hexGfxRef.current.get(selectedIdRef.current);
          const prevZone = zonesRef.current.find(z => z.id === selectedIdRef.current);
          if (prevGfx && prevZone) {
            redrawHex(prevGfx, prevZone, false, prevZone.id === fobZoneIdRef.current);
          }
        }

        // Select this hex
        selectedIdRef.current = zone.id;
        redrawHex(gfx, zone, true, zone.id === fobZoneIdRef.current);
        onZoneClickRef.current(zone);
      });
    }

    // Zoom toward cursor on scroll
    app.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor   = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newScale = Math.max(0.25, Math.min(5.0, world.scale.x * factor));

      const worldPos    = world.toLocal(new Point(e.offsetX, e.offsetY));
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

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", overflow: "hidden", background: "#0a0a0a" }}
    />
  );
}
