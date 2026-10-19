"use client";

import { useEffect, useMemo, useRef } from "react";

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

// ─── Canvas preview of what the plotter will draw ─────────────────────────────

export default function GcodePreview({ parsed, ink = "#2547d0" }: { parsed: Parsed; ink?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { bounds } = parsed;
  const pad = 6; // mm of paper around the drawing
  const wMm = bounds.maxX - bounds.minX + pad * 2;
  const hMm = bounds.maxY - bounds.minY + pad * 2;
  const aspect = useMemo(() => wMm / hMm, [wMm, hMm]);

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const draw = () => {
      const cssW = wrap.clientWidth;
      const cssH = cssW / aspect;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const s = (cssW / wMm) * dpr;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = ink;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(0.6, 0.35 * s); // ~0.35mm pen
      ctx.beginPath();
      const { segs, count } = parsed;
      // Machine Y points up → flip for display
      const ox = bounds.minX - pad, oy = bounds.maxY + pad;
      for (let k = 0; k < count; k++) {
        const o = k * 4;
        ctx.moveTo((segs[o] - ox) * s, (oy - segs[o + 1]) * s);
        ctx.lineTo((segs[o + 2] - ox) * s, (oy - segs[o + 3]) * s);
      }
      ctx.stroke();
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [parsed, aspect, wMm, bounds, ink]);

  return (
    <div ref={wrapRef} className="w-full">
      <canvas ref={canvasRef} className="block w-full rounded-md" aria-label="Toolpath preview of the generated G-code" role="img" />
    </div>
  );
}
