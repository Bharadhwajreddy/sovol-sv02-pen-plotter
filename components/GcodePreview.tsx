"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ─── Read-only G-code analysis ────────────────────────────────────────────────
// Parses finished G-code purely for display: draws the pen-down moves exactly as
// the plotter will, and derives distance / time stats. Never modifies the G-code.

export interface GcodeStats {
  strokes: number;      // pen-down events
  drawMm: number;       // pen-down distance
  travelMm: number;     // pen-up XY distance
  lifts: number;        // pen lifts
  seconds: number;      // rough plotting time estimate
  lines: number;
  bytes: number;
}

interface Parsed {
  segs: Float32Array;   // x1,y1,x2,y2 … (pen-down only)
  count: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  stats: GcodeStats;
}

const Z_SPEED_MM_S = 5;      // typical Marlin Z max feed on the SV02
const Z_MOVE_OVERHEAD_S = 0.05;

function num(line: string, key: string): number | null {
  const m = line.match(new RegExp(`${key}(-?\\d*\\.?\\d+)`));
  return m ? parseFloat(m[1]) : null;
}

export function parseGcode(gcode: string): Parsed {
  const lines = gcode.split("\n");

  // Pen-down height = the lowest Z the file moves to
  let minZ = Infinity;
  for (const l of lines) {
    if (l.startsWith("G0 Z") || l.startsWith("G1 Z")) {
      const z = num(l, "Z");
      if (z !== null && z < minZ) minZ = z;
    }
  }

  const segs: number[] = [];
  let x = 0, y = 0, z = Infinity;
  let drawMm = 0, travelMm = 0, seconds = 0, lifts = 0, strokes = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const down = () => z <= minZ + 1e-6;
  const addSeg = (x1: number, y1: number, x2: number, y2: number) => {
    segs.push(x1, y1, x2, y2);
    if (x1 < minX) minX = x1; if (x2 < minX) minX = x2;
    if (y1 < minY) minY = y1; if (y2 < minY) minY = y2;
    if (x1 > maxX) maxX = x1; if (x2 > maxX) maxX = x2;
    if (y1 > maxY) maxY = y1; if (y2 > maxY) maxY = y2;
  };

  for (const raw of lines) {
    const l = raw.split(";")[0].trim();
    if (!l) continue;
    const cmd = l.slice(0, 2);
    if (cmd !== "G0" && cmd !== "G1" && cmd !== "G2" && cmd !== "G3") {
      if (l.startsWith("G28")) { x = 0; y = 0; }
      continue;
    }
    const nx = num(l, "X"), ny = num(l, "Y"), nz = num(l, "Z"), f = num(l, "F");
    if (nz !== null) {
      const wasDown = down();
      seconds += Math.abs(nz - (Number.isFinite(z) ? z : nz)) / Z_SPEED_MM_S + Z_MOVE_OVERHEAD_S;
      z = nz;
      if (!wasDown && down()) strokes++;
      if (wasDown && !down()) lifts++;
    }
    if (nx === null && ny === null) continue;
    const tx = nx ?? x, ty = ny ?? y;
    const feed = (f ?? (cmd === "G0" ? 3000 : 1500)) / 60; // mm/s

    if ((cmd === "G2" || cmd === "G3") && down()) {
      // Arc: centre = start + (I, J); tessellate for the preview
      const i = num(l, "I") ?? 0, j = num(l, "J") ?? 0;
      const cx = x + i, cy = y + j, r = Math.hypot(i, j);
      let a0 = Math.atan2(y - cy, x - cx), a1 = Math.atan2(ty - cy, tx - cx);
      if (cmd === "G2") { while (a1 >= a0) a1 -= Math.PI * 2; } else { while (a1 <= a0) a1 += Math.PI * 2; }
      const n = Math.max(4, Math.ceil(Math.abs(a1 - a0) * r));
      let px = x, py = y;
      for (let k = 1; k <= n; k++) {
        const a = a0 + ((a1 - a0) * k) / n;
        const qx = cx + r * Math.cos(a), qy = cy + r * Math.sin(a);
        addSeg(px, py, qx, qy); px = qx; py = qy;
      }
      const len = Math.abs(a1 - a0) * r;
      drawMm += len; seconds += len / feed;
    } else {
      const len = Math.hypot(tx - x, ty - y);
      if (down() && cmd !== "G0") { addSeg(x, y, tx, ty); drawMm += len; }
      else travelMm += len;
      seconds += len / feed;
    }
    x = tx; y = ty;
  }

  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
  return {
    segs: new Float32Array(segs),
    count: segs.length / 4,
    bounds: { minX, minY, maxX, maxY },
    stats: { strokes, drawMm, travelMm, lifts, seconds, lines: lines.length, bytes: gcode.length },
  };
}

export function formatDuration(s: number): string {
  const total = Math.round(s / 60);
  if (total < 1) return "< 1 min";
  const h = Math.floor(total / 60), m = total % 60;
  return h > 0 ? `${h} h ${m.toString().padStart(2, "0")} min` : `${m} min`;
}

export function formatDistance(mm: number): string {
  return mm >= 1000 ? `${(mm / 1000).toFixed(1)} m` : `${Math.round(mm)} mm`;
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

type ParsedGcode = ReturnType<typeof parseGcode>;

interface View { scale: number; ox: number; oy: number } // px per mm, machine-mm at left/top edge

function drawToolpath(ctx: CanvasRenderingContext2D, parsed: ParsedGcode, view: View, wPx: number, hPx: number, ink: string, upTo = parsed.count) {
  ctx.fillStyle = "#fffefa";
  ctx.fillRect(0, 0, wPx, hPx);
  ctx.strokeStyle = ink;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(0.7, 0.35 * view.scale); // ~0.35 mm pen
  ctx.beginPath();
  const { segs } = parsed;
  for (let k = 0; k < upTo; k++) {
    const o = k * 4;
    ctx.moveTo((segs[o] - view.ox) * view.scale, (view.oy - segs[o + 1]) * view.scale);
    ctx.lineTo((segs[o + 2] - view.ox) * view.scale, (view.oy - segs[o + 3]) * view.scale);
  }
  ctx.stroke();
}

function fitView(parsed: ParsedGcode, wCss: number, hCss: number, padMm: number): View {
  const { bounds } = parsed;
  const wMm = bounds.maxX - bounds.minX + padMm * 2;
  const hMm = bounds.maxY - bounds.minY + padMm * 2;
  const scale = Math.min(wCss / wMm, hCss / hMm);
  // centre the drawing
  const ox = (bounds.minX + bounds.maxX) / 2 - wCss / scale / 2;
  const oy = (bounds.minY + bounds.maxY) / 2 + hCss / scale / 2;
  return { scale, ox, oy };
}

// ─── Inline preview (with "watch it plot" replay) ─────────────────────────────

export default function GcodePreview({ parsed, ink = "#2442b8", playKey = 0, onPlayEnd }: {
  parsed: ParsedGcode; ink?: string; playKey?: number; onPlayEnd?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const penRef = useRef<HTMLDivElement>(null);
  const pad = 6;
  const { bounds } = parsed;
  const aspect = useMemo(() => (bounds.maxX - bounds.minX + pad * 2) / (bounds.maxY - bounds.minY + pad * 2), [bounds]);

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let raf = 0;
    const setup = () => {
      const cssW = wrap.clientWidth, cssH = cssW / aspect;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`;
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
      const v = fitView(parsed, cssW, cssH, pad);
      return { ctx: canvas.getContext("2d")!, cssW, cssH, dpr, v };
    };
    const full = () => {
      const { ctx, cssW, cssH, dpr, v } = setup();
      drawToolpath(ctx, parsed, { scale: v.scale * dpr, ox: v.ox, oy: v.oy }, cssW * dpr, cssH * dpr, ink);
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (playKey > 0 && !reduce) {
      const { ctx, cssW, cssH, dpr, v } = setup();
      const total = parsed.count;
      const dur = Math.min(10000, Math.max(4500, total / 2));
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / dur);
        const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        const upTo = Math.max(1, Math.floor(total * eased));
        drawToolpath(ctx, parsed, { scale: v.scale * dpr, ox: v.ox, oy: v.oy }, cssW * dpr, cssH * dpr, ink, upTo);
        const pen = penRef.current;
        if (pen) {
          const o = (upTo - 1) * 4;
          pen.style.opacity = p < 1 ? "1" : "0";
          pen.style.transform = `translate(${(parsed.segs[o + 2] - v.ox) * v.scale}px, ${(v.oy - parsed.segs[o + 3]) * v.scale}px)`;
        }
        if (p < 1) raf = requestAnimationFrame(step); else onPlayEnd?.();
      };
      raf = requestAnimationFrame(step);
    } else {
      full();
    }
    const ro = new ResizeObserver(() => { if (!raf) full(); });
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); raf = 0; ro.disconnect(); };
  }, [parsed, aspect, ink, playKey, onPlayEnd]);

  return (
    <div ref={wrapRef} className="relative w-full">
      <canvas ref={canvasRef} className="block w-full rounded-[3px]" aria-label="Toolpath preview of the generated G-code" role="img" />
      <div ref={penRef} className="absolute left-0 top-0 pointer-events-none opacity-0 transition-opacity" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 26 26" style={{ transform: "translate(-2px,-24px)" }}>
          <path d="M2 24 L5 17 L9 21 Z" fill="#26231f" />
          <path d="M5 17 L9 21 L22 8 L18 4 Z" fill="#2f3a8c" stroke="#fffaf0" strokeWidth="0.8" />
          <path d="M18 4 L22 8 L24 6 L20 2 Z" fill="#c9a55c" />
        </svg>
      </div>
    </div>
  );
}

// ─── Full-screen inspector with zoom & pan ────────────────────────────────────

export function GcodeInspector({ parsed, ink = "#2442b8", onClose }: { parsed: ParsedGcode; ink?: string; onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View | null>(null);
  const baseScaleRef = useRef(1);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [zoomPct, setZoomPct] = useState(100);

  const redraw = useCallback(() => {
    const box = boxRef.current, canvas = canvasRef.current, v = viewRef.current;
    if (!box || !canvas || !v) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = box.clientWidth, h = box.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    }
    drawToolpath(canvas.getContext("2d")!, parsed, { scale: v.scale * dpr, ox: v.ox, oy: v.oy }, w * dpr, h * dpr, ink);
    setZoomPct(Math.round((v.scale / baseScaleRef.current) * 100));
  }, [parsed, ink]);

  const fit = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const v = fitView(parsed, box.clientWidth, box.clientHeight, 8);
    baseScaleRef.current = v.scale;
    viewRef.current = v;
    redraw();
  }, [parsed, redraw]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const box = boxRef.current, v = viewRef.current;
    if (!box || !v) return;
    const px = cx ?? box.clientWidth / 2, py = cy ?? box.clientHeight / 2;
    const ns = Math.min(baseScaleRef.current * 16, Math.max(baseScaleRef.current * 0.5, v.scale * factor));
    const mx = v.ox + px / v.scale, my = v.oy - py / v.scale; // mm under cursor
    viewRef.current = { scale: ns, ox: mx - px / ns, oy: my + py / ns };
    redraw();
  }, [redraw]);

  useEffect(() => {
    fit();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") zoomAt(1.25);
      if (e.key === "-") zoomAt(0.8);
      if (e.key === "0") fit();
    };
    const onResize = () => redraw();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("resize", onResize); document.body.style.overflow = ""; };
  }, [fit, zoomAt, redraw, onClose]);

  // Portal to <body> so the inspector sits above the sticky site header
  return createPortal((
    <div className="fixed inset-0 z-[100] flex flex-col ui-fade" style={{ background: "rgba(236,228,214,0.86)", backdropFilter: "blur(10px)" }}
      role="dialog" aria-modal="true" aria-label="Inspect toolpath">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 h-16 border-b" style={{ borderColor: "var(--ui-line)" }}>
        <div>
          <p className="font-serif-display text-lg font-semibold text-tx">Inspect toolpath</p>
          <p className="text-[12px] text-tx3 hidden sm:block">Scroll to zoom · drag to pan · press 0 to fit</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="ui-seg !p-1">
            <button className="ui-seg-btn !h-8 !px-3" onClick={() => zoomAt(0.8)} aria-label="Zoom out">−</button>
            <span className="ui-seg-btn !h-8 !px-2 tabular-nums !text-tx min-w-[64px]" aria-live="polite">{zoomPct}%</span>
            <button className="ui-seg-btn !h-8 !px-3" onClick={() => zoomAt(1.25)} aria-label="Zoom in">+</button>
          </div>
          <button className="ui-btn ui-btn-sm" onClick={fit}>Fit</button>
          <button className="ui-btn ui-btn-sm ui-btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
      <div ref={boxRef} className="relative flex-1 m-3 sm:m-6 ui-paper overflow-hidden touch-none cursor-grab"
        onWheel={(e) => { const r = e.currentTarget.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.15 : 0.87, e.clientX - r.left, e.clientY - r.top); }}
        onPointerDown={(e) => { dragRef.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => {
          const d = dragRef.current, v = viewRef.current;
          if (!d || !v) return;
          viewRef.current = { ...v, ox: v.ox - (e.clientX - d.x) / v.scale, oy: v.oy + (e.clientY - d.y) / v.scale };
          dragRef.current = { x: e.clientX, y: e.clientY };
          redraw();
        }}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}>
        <canvas ref={canvasRef} className="block" />
      </div>
    </div>
), document.body  );
}
