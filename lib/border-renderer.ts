/**
 * border-renderer.ts
 * Generates SVG preview paths and G-code for each of the seven border styles.
 * Requirements: 7.1–7.10, 7.12
 */

// ─── Types & Interfaces ───────────────────────────────────────────────────────

export type BorderStyle =
  | "none"
  | "simple-rect"
  | "rounded-rect"
  | "double-line"
  | "corner-marks"
  | "dashed"
  | "ornamental-corners";

export interface BorderConfig {
  style: BorderStyle;
  margin: number;    // mm, 0–20, default 5
  thickness: number; // passes, 1–5
}

export interface DrawingArea {
  x: number;      // mm offset from paper origin
  y: number;
  width: number;  // mm
  height: number; // mm
}

export interface BorderRenderResult {
  svgPaths: string[];   // SVG <path d="..."> strings for canvas preview
  gcodeLines: string[]; // G-code lines for the border layer
}

export interface PlotterSettings {
  z_draw: number;
  z_hop: number;
  feed_draw: number;
  feed_travel: number;
  canvas_x: number;
  canvas_y: number;
  offset_x: number;
  offset_y: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROUNDED_RECT_RADIUS = 3.0;   // mm — arc corner radius (req 7.4)
const DOUBLE_LINE_GAP = 2.0;       // mm — gap between double-line rects (req 7.5)
const CORNER_MARK_ARM = 8.0;       // mm — L-shaped arm length (req 7.6)
const DASH_LENGTH = 4.0;           // mm — dash length (req 7.7)
const DASH_GAP = 2.0;              // mm — gap between dashes (req 7.7)
const ORNAMENTAL_BOX = 12.0;       // mm — flourish bounding box (req 7.8)
const PASS_OFFSET = 0.3;           // mm — per-pass outward offset (req 7.10)
const SVG_STROKE_WIDTH = "0.3";

// ─── SVG Helper ───────────────────────────────────────────────────────────────

function svgPath(d: string): string {
  return `<path d="${d}" stroke="black" fill="none" stroke-width="${SVG_STROKE_WIDTH}"/>`;
}

// ─── G-code Helpers ───────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toFixed(3);
}

/**
 * Emit a complete G-code pass group for a sequence of (x, y) points.
 * The path is treated as a closed loop (returns to start).
 */
function gcodePassGroup(
  points: Array<[number, number]>,
  settings: PlotterSettings,
  close = true
): string[] {
  const { z_draw, z_hop, feed_draw, feed_travel } = settings;
  const lines: string[] = [];
  if (points.length < 2) return lines;

  const [x0, y0] = points[0];
  lines.push(`G0 X${fmt(x0)} Y${fmt(y0)} F${feed_travel}`);
  lines.push(`G0 Z${fmt(z_draw)} F${feed_travel}`);

  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i];
    lines.push(`G1 X${fmt(x)} Y${fmt(y)} F${feed_draw}`);
  }

  if (close) {
    lines.push(`G1 X${fmt(x0)} Y${fmt(y0)} F${feed_draw}`);
  }

  lines.push(`G0 Z${fmt(z_hop)} F${feed_travel}`);
  return lines;
}

/**
 * Emit a G-code pass group for a rounded rectangle using G2 arc commands.
 */
function gcodeRoundedRectPass(
  bx: number, by: number, bx2: number, by2: number,
  r: number,
  settings: PlotterSettings
): string[] {
  const { z_draw, z_hop, feed_draw, feed_travel } = settings;
  const lines: string[] = [];

  lines.push(`G0 X${fmt(bx + r)} Y${fmt(by)} F${feed_travel}`);
  lines.push(`G0 Z${fmt(z_draw)} F${feed_travel}`);

  // Bottom edge →
  lines.push(`G1 X${fmt(bx2 - r)} Y${fmt(by)} F${feed_draw}`);
  // Bottom-right corner arc
  lines.push(`G2 X${fmt(bx2)} Y${fmt(by + r)} I0 J${fmt(r)}`);
  // Right edge ↑
  lines.push(`G1 X${fmt(bx2)} Y${fmt(by2 - r)} F${feed_draw}`);
  // Top-right corner arc
  lines.push(`G2 X${fmt(bx2 - r)} Y${fmt(by2)} I${fmt(-r)} J0`);
  // Top edge ←
  lines.push(`G1 X${fmt(bx + r)} Y${fmt(by2)} F${feed_draw}`);
  // Top-left corner arc
  lines.push(`G2 X${fmt(bx)} Y${fmt(by2 - r)} I0 J${fmt(-r)}`);
  // Left edge ↓
  lines.push(`G1 X${fmt(bx)} Y${fmt(by + r)} F${feed_draw}`);
  // Bottom-left corner arc (close)
  lines.push(`G2 X${fmt(bx + r)} Y${fmt(by)} I${fmt(r)} J0`);

  lines.push(`G0 Z${fmt(z_hop)} F${feed_travel}`);
  return lines;
}

// ─── SVG Path Builders ────────────────────────────────────────────────────────

function svgRect(bx: number, by: number, bx2: number, by2: number): string {
  return svgPath(
    `M ${fmt(bx)},${fmt(by)} L ${fmt(bx2)},${fmt(by)} L ${fmt(bx2)},${fmt(by2)} L ${fmt(bx)},${fmt(by2)} Z`
  );
}

function svgRoundedRect(bx: number, by: number, bx2: number, by2: number, r: number): string {
  return svgPath(
    `M ${fmt(bx + r)},${fmt(by)} ` +
    `L ${fmt(bx2 - r)},${fmt(by)} ` +
    `A ${fmt(r)},${fmt(r)} 0 0 1 ${fmt(bx2)},${fmt(by + r)} ` +
    `L ${fmt(bx2)},${fmt(by2 - r)} ` +
    `A ${fmt(r)},${fmt(r)} 0 0 1 ${fmt(bx2 - r)},${fmt(by2)} ` +
    `L ${fmt(bx + r)},${fmt(by2)} ` +
    `A ${fmt(r)},${fmt(r)} 0 0 1 ${fmt(bx)},${fmt(by2 - r)} ` +
    `L ${fmt(bx)},${fmt(by + r)} ` +
    `A ${fmt(r)},${fmt(r)} 0 0 1 ${fmt(bx + r)},${fmt(by)} Z`
  );
}

// ─── Style Renderers ──────────────────────────────────────────────────────────

/**
 * "none" — returns empty arrays (req 7.2)
 */
function renderNone(): BorderRenderResult {
  return { svgPaths: [], gcodeLines: [] };
}

/**
 * "simple-rect" — single closed rectangular path (req 7.3)
 */
function renderSimpleRect(
  bx: number, by: number, bx2: number, by2: number,
  settings: PlotterSettings,
  thickness: number
): BorderRenderResult {
  const svgPaths: string[] = [];
  const gcodeLines: string[] = [];

  for (let pass = 0; pass < thickness; pass++) {
    const offset = pass * PASS_OFFSET;
    const px = bx - offset;
    const py = by - offset;
    const px2 = bx2 + offset;
    const py2 = by2 + offset;

    svgPaths.push(svgRect(px, py, px2, py2));
    gcodeLines.push(...gcodePassGroup(
      [[px, py], [px2, py], [px2, py2], [px, py2]],
      settings,
      true
    ));
  }

  return { svgPaths, gcodeLines };
}

/**
 * "rounded-rect" — closed rect with G2/G3 arc corners at radius 3mm (req 7.4)
 * Matches the existing generate_border_gcode logic in sketch_to_gcode.py
 */
function renderRoundedRect(
  bx: number, by: number, bx2: number, by2: number,
  settings: PlotterSettings,
  thickness: number
): BorderRenderResult {
  const svgPaths: string[] = [];
  const gcodeLines: string[] = [];
  const r = ROUNDED_RECT_RADIUS;

  for (let pass = 0; pass < thickness; pass++) {
    const offset = pass * PASS_OFFSET;
    const px = bx - offset;
    const py = by - offset;
    const px2 = bx2 + offset;
    const py2 = by2 + offset;

    // Ensure radius doesn't exceed half the shorter side
    const effectiveR = Math.min(r, (px2 - px) / 2, (py2 - py) / 2);

    svgPaths.push(svgRoundedRect(px, py, px2, py2, effectiveR));
    gcodeLines.push(...gcodeRoundedRectPass(px, py, px2, py2, effectiveR, settings));
  }

  return { svgPaths, gcodeLines };
}

/**
 * "double-line" — two concentric closed rects, outer 2mm larger than inner (req 7.5)
 */
function renderDoubleLine(
  bx: number, by: number, bx2: number, by2: number,
  settings: PlotterSettings,
  thickness: number
): BorderRenderResult {
  const svgPaths: string[] = [];
  const gcodeLines: string[] = [];

  // Inner rect at base position, outer rect 2mm larger on each side
  const rects: Array<[number, number, number, number]> = [
    [bx, by, bx2, by2],
    [bx - DOUBLE_LINE_GAP, by - DOUBLE_LINE_GAP, bx2 + DOUBLE_LINE_GAP, by2 + DOUBLE_LINE_GAP],
  ];

  for (const [rx, ry, rx2, ry2] of rects) {
    for (let pass = 0; pass < thickness; pass++) {
      const offset = pass * PASS_OFFSET;
      const px = rx - offset;
      const py = ry - offset;
      const px2 = rx2 + offset;
      const py2 = ry2 + offset;

      svgPaths.push(svgRect(px, py, px2, py2));
      gcodeLines.push(...gcodePassGroup(
        [[px, py], [px2, py], [px2, py2], [px, py2]],
        settings,
        true
      ));
    }
  }

  return { svgPaths, gcodeLines };
}

/**
 * "corner-marks" — four L-shaped marks, each arm 8mm × 1mm (req 7.6)
 * No connecting lines between corners.
 */
function renderCornerMarks(
  bx: number, by: number, bx2: number, by2: number,
  settings: PlotterSettings,
  thickness: number
): BorderRenderResult {
  const svgPaths: string[] = [];
  const gcodeLines: string[] = [];
  const arm = CORNER_MARK_ARM;

  // Each corner: two line segments forming an L-shape
  // Corner definitions: [corner x, corner y, x-direction, y-direction]
  const corners: Array<[number, number, 1 | -1, 1 | -1]> = [
    [bx, by, 1, 1],    // bottom-left: arm goes right and up
    [bx2, by, -1, 1],  // bottom-right: arm goes left and up
    [bx2, by2, -1, -1], // top-right: arm goes left and down
    [bx, by2, 1, -1],  // top-left: arm goes right and down
  ];

  for (let pass = 0; pass < thickness; pass++) {
    const offset = pass * PASS_OFFSET;

    for (const [cx, cy, dx, dy] of corners) {
      // Offset corner outward
      const ocx = cx - dx * offset;
      const ocy = cy - dy * offset;

      // Horizontal arm: from corner along x-direction
      const hPoints: Array<[number, number]> = [
        [ocx, ocy],
        [ocx + dx * arm, ocy],
      ];
      // Vertical arm: from corner along y-direction
      const vPoints: Array<[number, number]> = [
        [ocx, ocy],
        [ocx, ocy + dy * arm],
      ];

      // SVG: L-shape as a single path (corner → horizontal end, back to corner → vertical end)
      svgPaths.push(svgPath(
        `M ${fmt(ocx + dx * arm)},${fmt(ocy)} L ${fmt(ocx)},${fmt(ocy)} L ${fmt(ocx)},${fmt(ocy + dy * arm)}`
      ));

      // G-code: two separate strokes (horizontal then vertical)
      gcodeLines.push(...gcodePassGroup(hPoints, settings, false));
      gcodeLines.push(...gcodePassGroup(vPoints, settings, false));
    }
  }

  return { svgPaths, gcodeLines };
}

/**
 * "dashed" — rectangular perimeter broken into 4mm dashes with 2mm gaps (req 7.7)
 */
function renderDashed(
  bx: number, by: number, bx2: number, by2: number,
  settings: PlotterSettings,
  thickness: number
): BorderRenderResult {
  const svgPaths: string[] = [];
  const gcodeLines: string[] = [];

  /**
   * Generate dash segments along a line from (x1,y1) to (x2,y2).
   * Returns array of [start, end] point pairs.
   */
  function dashSegments(
    x1: number, y1: number, x2: number, y2: number
  ): Array<[[number, number], [number, number]]> {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const ux = dx / len;
    const uy = dy / len;
    const period = DASH_LENGTH + DASH_GAP;
    const segments: Array<[[number, number], [number, number]]> = [];

    let t = 0;
    while (t < len) {
      const dashEnd = Math.min(t + DASH_LENGTH, len);
      segments.push([
        [x1 + ux * t, y1 + uy * t],
        [x1 + ux * dashEnd, y1 + uy * dashEnd],
      ]);
      t += period;
    }
    return segments;
  }

  for (let pass = 0; pass < thickness; pass++) {
    const offset = pass * PASS_OFFSET;
    const px = bx - offset;
    const py = by - offset;
    const px2 = bx2 + offset;
    const py2 = by2 + offset;

    // Four sides: bottom, right, top (reversed), left (reversed)
    const sides: Array<[number, number, number, number]> = [
      [px, py, px2, py],   // bottom →
      [px2, py, px2, py2], // right ↑
      [px2, py2, px, py2], // top ←
      [px, py2, px, py],   // left ↓
    ];

    for (const [x1, y1, x2, y2] of sides) {
      const segs = dashSegments(x1, y1, x2, y2);
      for (const [start, end] of segs) {
        svgPaths.push(svgPath(`M ${fmt(start[0])},${fmt(start[1])} L ${fmt(end[0])},${fmt(end[1])}`));
        gcodeLines.push(...gcodePassGroup([start, end], settings, false));
      }
    }
  }

  return { svgPaths, gcodeLines };
}

/**
 * "ornamental-corners" — Bezier flourish at each corner, 12×12mm bounding box (req 7.8)
 */
function renderOrnamentalCorners(
  bx: number, by: number, bx2: number, by2: number,
  settings: PlotterSettings,
  thickness: number
): BorderRenderResult {
  const svgPaths: string[] = [];
  const gcodeLines: string[] = [];
  const box = ORNAMENTAL_BOX;

  // Each corner: a cubic Bezier flourish fitting within 12×12mm
  // Corner definitions: [corner x, corner y, x-direction into corner, y-direction into corner]
  const corners: Array<[number, number, 1 | -1, 1 | -1]> = [
    [bx, by, 1, 1],     // bottom-left
    [bx2, by, -1, 1],   // bottom-right
    [bx2, by2, -1, -1], // top-right
    [bx, by2, 1, -1],   // top-left
  ];

  for (let pass = 0; pass < thickness; pass++) {
    const offset = pass * PASS_OFFSET;

    for (const [cx, cy, dx, dy] of corners) {
      // Offset corner outward
      const ocx = cx - dx * offset;
      const ocy = cy - dy * offset;

      // Flourish: a decorative S-curve within the 12×12mm box at this corner.
      // The curve starts along the horizontal edge, sweeps inward with a Bezier,
      // and ends along the vertical edge.
      const ex = ocx + dx * box;   // horizontal end point
      const ey = ocy + dy * box;   // vertical end point

      // Control points create an S-shaped flourish
      const cp1x = ocx + dx * box * 0.8;
      const cp1y = ocy + dy * box * 0.2;
      const cp2x = ocx + dx * box * 0.2;
      const cp2y = ocy + dy * box * 0.8;

      // Inner decorative loop: small arc near the corner
      const loopR = box * 0.25;
      const loopCx = ocx + dx * loopR;
      const loopCy = ocy + dy * loopR;

      // SVG: main flourish curve + small decorative loop
      const d =
        `M ${fmt(ex)},${fmt(ocy)} ` +
        `C ${fmt(cp1x)},${fmt(cp1y)} ${fmt(cp2x)},${fmt(cp2y)} ${fmt(ocx)},${fmt(ey)} ` +
        `M ${fmt(loopCx)},${fmt(ocy)} ` +
        `Q ${fmt(ocx)},${fmt(ocy)} ${fmt(ocx)},${fmt(loopCy)}`;

      svgPaths.push(svgPath(d));

      // G-code: approximate the Bezier with line segments (20 segments)
      const bezierPoints = approximateCubicBezier(
        [ex, ocy],
        [cp1x, cp1y],
        [cp2x, cp2y],
        [ocx, ey],
        20
      );
      gcodeLines.push(...gcodePassGroup(bezierPoints, settings, false));

      // Small decorative quadratic arc near corner
      const quadPoints = approximateQuadBezier(
        [loopCx, ocy],
        [ocx, ocy],
        [ocx, loopCy],
        10
      );
      gcodeLines.push(...gcodePassGroup(quadPoints, settings, false));
    }
  }

  return { svgPaths, gcodeLines };
}

// ─── Bezier Approximation Helpers ─────────────────────────────────────────────

function approximateCubicBezier(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  steps: number
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x =
      mt * mt * mt * p0[0] +
      3 * mt * mt * t * p1[0] +
      3 * mt * t * t * p2[0] +
      t * t * t * p3[0];
    const y =
      mt * mt * mt * p0[1] +
      3 * mt * mt * t * p1[1] +
      3 * mt * t * t * p2[1] +
      t * t * t * p3[1];
    points.push([x, y]);
  }
  return points;
}

function approximateQuadBezier(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  steps: number
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0];
    const y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1];
    points.push([x, y]);
  }
  return points;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Render a border for the given config, drawing area, and plotter settings.
 * Returns SVG path strings for canvas preview and G-code lines for plotting.
 *
 * Requirements: 7.1–7.10, 7.12
 */
export function renderBorder(
  config: BorderConfig,
  drawingArea: DrawingArea,
  settings: PlotterSettings
): BorderRenderResult {
  const { style, margin, thickness } = config;
  const { x, y, width, height } = drawingArea;

  // Border rectangle coordinates (drawing area ± margin)
  const bx = x - margin;
  const by = y - margin;
  const bx2 = x + width + margin;
  const by2 = y + height + margin;

  // Clamp thickness to valid range
  const passes = Math.max(1, Math.min(5, Math.round(thickness)));

  switch (style) {
    case "none":
      return renderNone();

    case "simple-rect":
      return renderSimpleRect(bx, by, bx2, by2, settings, passes);

    case "rounded-rect":
      return renderRoundedRect(bx, by, bx2, by2, settings, passes);

    case "double-line":
      return renderDoubleLine(bx, by, bx2, by2, settings, passes);

    case "corner-marks":
      return renderCornerMarks(bx, by, bx2, by2, settings, passes);

    case "dashed":
      return renderDashed(bx, by, bx2, by2, settings, passes);

    case "ornamental-corners":
      return renderOrnamentalCorners(bx, by, bx2, by2, settings, passes);

    default:
      // Exhaustive check — TypeScript will catch unhandled cases at compile time
      return renderNone();
  }
}
