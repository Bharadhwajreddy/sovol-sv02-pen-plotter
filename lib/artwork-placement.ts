/**
 * artwork-placement.ts
 * Geometry for placing the traced image (the "artwork") inside the drawing area:
 * parsing its SVG into polylines, fitting, moving, scaling and rotating it, and
 * keeping it fully inside the drawing area so nothing is ever cut off.
 *
 * Coordinate spaces
 *  - artwork: whatever units the source SVG uses, y pointing down (image orientation)
 *  - local:   mm relative to the drawing area's top-left corner, y pointing down
 *  - page:    mm on the preview sheet, y pointing down  (page = area origin + local)
 *  - machine: plotter mm, y pointing up — the top of the drawing area is at
 *             offset_y + height, matching how /api/process lays out its G-code.
 */

export type Point = [number, number];
export type Polyline = Point[];

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Artwork {
  polylines: Polyline[];
  bounds: Bounds; // tight bounds of all polyline points
}

export interface Placement {
  cx: number;       // centre of the artwork, mm from drawing area left
  cy: number;       // centre of the artwork, mm from drawing area top
  scale: number;    // mm per artwork unit
  rotation: number; // degrees, clockwise as seen on the preview
}

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── SVG parsing ──────────────────────────────────────────────────────────────

/**
 * Parse a path `d` string into polylines. Supports M/L/H/V/Z and cubic/quadratic
 * curves (C/S/Q, flattened), absolute and relative. Every moveto starts a new
 * polyline so separate sub-paths are never joined by a stray line.
 */
export function parsePathD(d: string): Polyline[] {
  const CURVE_STEPS = 12;
  const tokens = d.match(/[MLHVZCSQmlhvzcsq]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  const out: Polyline[] = [];
  let current: Polyline = [];
  let cmd = "";
  let x = 0, y = 0, startX = 0, startY = 0;
  let lastCtrl: Point | null = null; // previous cubic control point, for S
  let i = 0;

  const flush = () => {
    if (current.length >= 2) out.push(current);
    current = [];
  };
  const num = () => parseFloat(tokens[i++]);
  const isNum = (t: string | undefined) => t !== undefined && !/^[A-Za-z]$/.test(t);
  const hasNums = (n: number) => {
    for (let k = 0; k < n; k++) if (!isNum(tokens[i + k])) return false;
    return true;
  };
  const cubic = (c1: Point, c2: Point, end: Point) => {
    if (current.length === 0) current.push([x, y]);
    for (let s = 1; s <= CURVE_STEPS; s++) {
      const t = s / CURVE_STEPS, u = 1 - t;
      current.push([
        u * u * u * x + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0],
        u * u * u * y + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1],
      ]);
    }
    x = end[0]; y = end[1];
  };

  while (i < tokens.length) {
    if (!isNum(tokens[i])) cmd = tokens[i++];
    const prevCtrl = lastCtrl;
    lastCtrl = null;
    switch (cmd) {
      case "C":
      case "c": {
        if (!hasNums(6)) { i++; break; }
        const ox = cmd === "c" ? x : 0, oy = cmd === "c" ? y : 0;
        const c1: Point = [ox + num(), oy + num()];
        const c2: Point = [ox + num(), oy + num()];
        cubic(c1, c2, [ox + num(), oy + num()]);
        lastCtrl = c2;
        break;
      }
      case "S":
      case "s": {
        if (!hasNums(4)) { i++; break; }
        const ox = cmd === "s" ? x : 0, oy = cmd === "s" ? y : 0;
        const c1: Point = prevCtrl ? [2 * x - prevCtrl[0], 2 * y - prevCtrl[1]] : [x, y];
        const c2: Point = [ox + num(), oy + num()];
        cubic(c1, c2, [ox + num(), oy + num()]);
        lastCtrl = c2;
        break;
      }
      case "Q":
      case "q": {
        if (!hasNums(4)) { i++; break; }
        const ox = cmd === "q" ? x : 0, oy = cmd === "q" ? y : 0;
        const q: Point = [ox + num(), oy + num()];
        const end: Point = [ox + num(), oy + num()];
        // Quadratic expressed as a cubic
        cubic([x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)],
              [end[0] + (2 / 3) * (q[0] - end[0]), end[1] + (2 / 3) * (q[1] - end[1])], end);
        break;
      }
      case "M":
      case "m": {
        if (!isNum(tokens[i]) || !isNum(tokens[i + 1])) { i++; break; }
        const nx = num(), ny = num();
        x = cmd === "m" ? x + nx : nx;
        y = cmd === "m" ? y + ny : ny;
        flush();
        current.push([x, y]);
        startX = x; startY = y;
        cmd = cmd === "m" ? "l" : "L"; // implicit lineto for following pairs
        break;
      }
      case "L":
      case "l": {
        if (!isNum(tokens[i]) || !isNum(tokens[i + 1])) { i++; break; }
        const nx = num(), ny = num();
        x = cmd === "l" ? x + nx : nx;
        y = cmd === "l" ? y + ny : ny;
        if (current.length === 0) current.push([startX, startY]);
        current.push([x, y]);
        break;
      }
      case "H":
      case "h": {
        if (!isNum(tokens[i])) { i++; break; }
        const n = num();
        x = cmd === "h" ? x + n : n;
        if (current.length === 0) current.push([startX, startY]);
        current.push([x, y]);
        break;
      }
      case "V":
      case "v": {
        if (!isNum(tokens[i])) { i++; break; }
        const n = num();
        y = cmd === "v" ? y + n : n;
        if (current.length === 0) current.push([startX, startY]);
        current.push([x, y]);
        break;
      }
      case "Z":
      case "z":
        if (current.length > 0) current.push([startX, startY]);
        flush();
        x = startX; y = startY;
        cmd = "";
        break;
      default:
        i++; // unsupported command or stray token
    }
  }
  flush();
  return out;
}

export function computeBounds(polylines: Polyline[]): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const line of polylines) {
    for (const [px, py] of line) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** Extract every <path> of an SVG document as artwork. Returns null if it has no strokes. */
export function artworkFromSvg(svg: string): Artwork | null {
  const polylines: Polyline[] = [];
  const re = /<path\b[^>]*?\sd\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    polylines.push(...parsePathD(m[2] ?? m[3] ?? ""));
  }
  const bounds = computeBounds(polylines);
  return bounds ? { polylines, bounds } : null;
}

/** Artwork with no strokes, used to place a raster preview of a known size. */
export function boxArtwork(width: number, height: number): Artwork {
  return { polylines: [], bounds: { minX: 0, minY: 0, maxX: width, maxY: height } };
}

// ─── Transforms ───────────────────────────────────────────────────────────────

export function artworkSize(art: Artwork): { width: number; height: number } {
  // Guard against zero-size artwork (e.g. a single straight line)
  return {
    width: Math.max(art.bounds.maxX - art.bounds.minX, 1e-6),
    height: Math.max(art.bounds.maxY - art.bounds.minY, 1e-6),
  };
}

function artworkCenter(art: Artwork): Point {
  return [(art.bounds.minX + art.bounds.maxX) / 2, (art.bounds.minY + art.bounds.maxY) / 2];
}

/** Artwork point → drawing-area-local mm. */
export function toLocal(p: Point, art: Artwork, pl: Placement): Point {
  const [acx, acy] = artworkCenter(art);
  const rad = (pl.rotation * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = (p[0] - acx) * pl.scale;
  const dy = (p[1] - acy) * pl.scale;
  return [pl.cx + dx * cos - dy * sin, pl.cy + dx * sin + dy * cos];
}

/** SVG transform attribute mapping artwork units to page mm. */
export function svgTransform(art: Artwork, pl: Placement, area: Area): string {
  const [acx, acy] = artworkCenter(art);
  return `translate(${area.x + pl.cx} ${area.y + pl.cy}) rotate(${pl.rotation}) scale(${pl.scale}) translate(${-acx} ${-acy})`;
}

/** Page mm (y down) → machine mm (y up), mirrored within the drawing area. */
export function pageToMachine(p: Point, area: Area): Point {
  return [p[0], 2 * area.y + area.height - p[1]];
}

/** Artwork point → machine mm. */
export function toMachine(p: Point, art: Artwork, pl: Placement, area: Area): Point {
  const [lx, ly] = toLocal(p, art, pl);
  return [area.x + lx, area.y + area.height - ly];
}

// ─── Extents, fitting and constraining ────────────────────────────────────────

export interface Extents {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Extents of the rotated artwork around its centre at scale 1 (artwork units).
 * Uses the real stroke points so a rotated image hugs the area edges exactly.
 */
export function rotatedExtents(art: Artwork, rotation: number): Extents {
  const [acx, acy] = artworkCenter(art);
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const visit = (px: number, py: number) => {
    const dx = px - acx, dy = py - acy;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry;
    if (ry > maxY) maxY = ry;
  };
  if (art.polylines.length > 0) {
    for (const line of art.polylines) for (const [px, py] of line) visit(px, py);
  } else {
    const b = art.bounds;
    visit(b.minX, b.minY); visit(b.maxX, b.minY); visit(b.minX, b.maxY); visit(b.maxX, b.maxY);
  }
  return {
    minX, maxX, minY, maxY,
  };
}

/** Largest scale at which the artwork, at this rotation, fits in the area. */
export function maxScale(ext: Extents, area: Area): number {
  const w = Math.max(ext.maxX - ext.minX, 1e-6);
  const h = Math.max(ext.maxY - ext.minY, 1e-6);
  return Math.min(area.width / w, area.height / h);
}

/** Largest placement that fits, centred in the area, keeping the current rotation. */
export function fitPlacement(art: Artwork, area: Area, rotation = 0, ext = rotatedExtents(art, rotation)): Placement {
  const scale = maxScale(ext, area);
  return {
    scale,
    rotation,
    cx: area.width / 2 - scale * (ext.minX + ext.maxX) / 2,
    cy: area.height / 2 - scale * (ext.minY + ext.maxY) / 2,
  };
}

/**
 * Clamp a placement so the whole artwork stays inside the drawing area:
 * shrink it if it is too big, then slide it back inside if it pokes out.
 */
export function constrainPlacement(pl: Placement, area: Area, ext: Extents): Placement {
  const finite = (n: number, fallback: number) => (Number.isFinite(n) ? n : fallback);
  const limit = maxScale(ext, area);
  const scale = Math.min(Math.max(finite(pl.scale, limit), limit * 0.01), limit);
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi));
  return {
    rotation: finite(pl.rotation, 0),
    scale,
    cx: clamp(finite(pl.cx, area.width / 2), -scale * ext.minX, area.width - scale * ext.maxX),
    cy: clamp(finite(pl.cy, area.height / 2), -scale * ext.minY, area.height - scale * ext.maxY),
  };
}

/** Normalise an angle to (-180, 180]. */
export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}
