/**
 * generate-test-patterns.ts
 * Generates all test pattern G-code files as static assets.
 * Run with: npx ts-node scripts/generate-test-patterns.ts
 *
 * Machine: Sovol SV02
 * Bed: 280 x 240mm
 * Drawing canvas: 200 x 160mm
 * Origin offset: X=40, Y=40 (leaves room for paper clips)
 * Canvas center: X=140, Y=120
 */

import * as fs from "fs";
import * as path from "path";

// ─── Settings ─────────────────────────────────────────────────────────────────
const S = {
  z_draw: 0.0,
  z_hop: 3.0,
  feed_draw: 1500,
  feed_travel: 3000,
  canvas_x: 200,
  canvas_y: 160,
  offset_x: 40,
  offset_y: 40,
};

// Canvas center — this is where all patterns should be centered
const CX = S.offset_x + S.canvas_x / 2; // 140
const CY = S.offset_y + S.canvas_y / 2; // 120

// ─── G-code helpers ───────────────────────────────────────────────────────────
const header = (title: string) => [
  `; Sovol SV02 Pen Plotter — ${title}`,
  `; Canvas: ${S.canvas_x}x${S.canvas_y}mm  Offset: X${S.offset_x} Y${S.offset_y}`,
  `; Center: X${CX} Y${CY}`,
  ";",
  "G21 ; mm units",
  "G90 ; absolute positioning",
  "G28 X Y ; home X and Y ONLY — never home Z",
  `G0 Z${S.z_hop.toFixed(3)} F${S.feed_travel} ; pen up`,
  "",
];

const footer = () => [
  "",
  "; === FOOTER ===",
  `G0 Z${(S.z_hop + 5).toFixed(3)} F${S.feed_travel} ; raise pen safely`,
  `G0 X${S.offset_x.toFixed(3)} Y${S.offset_y.toFixed(3)} F${S.feed_travel} ; return to origin`,
  "M84 ; disable steppers",
];

const up   = () => `G0 Z${S.z_hop.toFixed(3)} F${S.feed_travel} ; pen up`;
const down = () => `G0 Z${S.z_draw.toFixed(3)} F${S.feed_travel} ; pen down`;
const go   = (x: number, y: number) => `G0 X${x.toFixed(3)} Y${y.toFixed(3)} F${S.feed_travel}`;
const line = (x: number, y: number) => `G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${S.feed_draw}`;
const cw   = (x: number, y: number, i: number, j: number) =>
  `G2 X${x.toFixed(3)} Y${y.toFixed(3)} I${i.toFixed(3)} J${j.toFixed(3)} F${S.feed_draw}`;
const ccw  = (x: number, y: number, i: number, j: number) =>
  `G3 X${x.toFixed(3)} Y${y.toFixed(3)} I${i.toFixed(3)} J${j.toFixed(3)} F${S.feed_draw}`;

// Full circle CW: start at (cx+r, cy), arc back to same point
const circleCW = (cx: number, cy: number, r: number): string[] => [
  go(cx + r, cy),
  down(),
  cw(cx + r, cy, -r, 0) + " ; full circle CW",
  up(),
];

// Stroke: travel to start, pen down, draw points, pen up
const stroke = (pts: [number, number][]): string[] => {
  if (pts.length < 2) return [];
  const out: string[] = [go(pts[0][0], pts[0][1]), down()];
  for (let i = 1; i < pts.length; i++) out.push(line(pts[i][0], pts[i][1]));
  out.push(up());
  return out;
};

function write(filename: string, lines: string[]) {
  const outDir = path.join(__dirname, "../public/test-patterns");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, filename);
  fs.writeFileSync(outPath, lines.join("\n"));
  console.log(`✅ Written: ${filename}`);
}

// ─── 1. SMILEY FACE ───────────────────────────────────────────────────────────
function genSmiley() {
  const lines: string[] = [...header("Smiley Face Test")];
  lines.push("; Tests: arc drawing, pen pressure, circle accuracy");
  lines.push("; Expected: round face, symmetrical eyes, SMILE (not frown)");
  lines.push("");

  // Face circle r=40
  lines.push("; Face (r=40mm, centered on canvas)");
  lines.push(...circleCW(CX, CY, 40));
  lines.push("");

  // Left eye: center at CX-15, CY+12, r=5
  lines.push("; Left eye");
  lines.push(...circleCW(CX - 15, CY + 12, 5));
  lines.push("");

  // Right eye: center at CX+15, CY+12, r=5
  lines.push("; Right eye");
  lines.push(...circleCW(CX + 15, CY + 12, 5));
  lines.push("");

  // Smile: arc from (CX-18, CY-8) to (CX+18, CY-8) curving DOWN (toward lower Y)
  // In plotter coords Y increases upward, so smile curves toward lower Y values
  // G2 (CW) with center below the arc = smile shape
  // Center of smile arc: (CX, CY-8-12) = (CX, CY-20)
  // I = cx_arc - start_x = CX - (CX-18) = 18
  // J = cy_arc - start_y = (CY-20) - (CY-8) = -12
  lines.push("; Smile arc (G2 CW = curves downward = happy smile)");
  lines.push(go(CX - 18, CY - 8));
  lines.push(down());
  lines.push(cw(CX + 18, CY - 8, 18, -12) + " ; smile");
  lines.push(up());
  lines.push("");

  // Left eyebrow (slight upward tilt)
  lines.push("; Left eyebrow");
  lines.push(...stroke([[CX - 23, CY + 22], [CX - 7, CY + 24]]));
  lines.push("");

  // Right eyebrow
  lines.push("; Right eyebrow");
  lines.push(...stroke([[CX + 7, CY + 24], [CX + 23, CY + 22]]));
  lines.push("");

  lines.push(...footer());
  write("test_smiley.gcode", lines);
}

// ─── 2. SQUARE MAZE ───────────────────────────────────────────────────────────
function genMaze() {
  const cell = 20;
  const cols = 5, rows = 5;
  const totalW = cols * cell; // 100mm
  const totalH = rows * cell; // 100mm
  // Center the maze on canvas
  const mx = CX - totalW / 2; // 90
  const my = CY - totalH / 2; // 70

  const lines: string[] = [...header("Square Maze Test")];
  lines.push("; Tests: corner accuracy, straight line consistency, 90° precision");
  lines.push("; Expected: sharp corners, even grid spacing");
  lines.push("");

  // Outer border
  lines.push("; Outer border");
  lines.push(go(mx, my));
  lines.push(down());
  lines.push(line(mx + totalW, my));
  lines.push(line(mx + totalW, my + totalH));
  lines.push(line(mx, my + totalH));
  lines.push(line(mx, my));
  lines.push(up());
  lines.push("");

  // Internal walls
  const walls: [number, number, 'h' | 'v'][] = [
    [0,1,'h'],[1,1,'h'],[3,1,'h'],[4,1,'h'],
    [0,2,'h'],[2,2,'h'],[3,2,'h'],
    [1,3,'h'],[2,3,'h'],[4,3,'h'],
    [0,4,'h'],[3,4,'h'],
    [0,0,'v'],[2,0,'v'],[3,0,'v'],
    [1,1,'v'],[3,1,'v'],
    [0,2,'v'],[2,2,'v'],[4,2,'v'],
    [1,3,'v'],[3,3,'v'],
    [0,4,'v'],[2,4,'v'],
  ];

  lines.push("; Internal walls");
  for (const [col, row, dir] of walls) {
    let x1: number, y1: number, x2: number, y2: number;
    if (dir === 'h') {
      x1 = mx + col * cell; y1 = my + row * cell;
      x2 = x1 + cell;       y2 = y1;
    } else {
      x1 = mx + (col + 1) * cell; y1 = my + row * cell;
      x2 = x1;                    y2 = y1 + cell;
    }
    lines.push(...stroke([[x1, y1], [x2, y2]]));
  }

  lines.push(...footer());
  write("test_square_maze.gcode", lines);
}

// ─── 3. CONCENTRIC CIRCLES ────────────────────────────────────────────────────
function genConcentricCircles() {
  const lines: string[] = [...header("Concentric Circles Test")];
  lines.push("; Tests: arc consistency, motor sync, roundness");
  lines.push(`; All circles centered at X${CX} Y${CY} (canvas center)`);
  lines.push("; Expected: perfectly round, evenly spaced circles");
  lines.push("");

  // 8 circles: r=10 to r=75 (max r=80 but canvas_y/2=80, leave 5mm margin)
  const radii = [10, 20, 30, 40, 50, 60, 70, 75];
  for (const r of radii) {
    lines.push(`; Circle r=${r}mm`);
    lines.push(...circleCW(CX, CY, r));
    lines.push("");
  }

  lines.push(...footer());
  write("test_concentric_circles.gcode", lines);
}

// ─── 4. CALIBRATION CROSS ─────────────────────────────────────────────────────
function genCalibrationCross() {
  const ox = S.offset_x, oy = S.offset_y;
  const ex = ox + S.canvas_x, ey = oy + S.canvas_y;

  const lines: string[] = [...header("Calibration Cross Test")];
  lines.push("; Tests: canvas mapping, coordinate accuracy");
  lines.push(`; Expected: cross spans exactly ${S.canvas_x}x${S.canvas_y}mm`);
  lines.push("; Corner marks should land at exact paper corners");
  lines.push("");

  // Horizontal axis
  lines.push("; Horizontal axis (full width)");
  lines.push(...stroke([[ox, CY], [ex, CY]]));
  lines.push("");

  // Vertical axis
  lines.push("; Vertical axis (full height)");
  lines.push(...stroke([[CX, oy], [CX, ey]]));
  lines.push("");

  // Corner + center marks
  const marks: [number, number, string][] = [
    [ox, oy, "bottom-left"],
    [ex, oy, "bottom-right"],
    [ox, ey, "top-left"],
    [ex, ey, "top-right"],
    [CX, CY, "center"],
  ];
  const d = 4;
  for (const [x, y, label] of marks) {
    lines.push(`; Mark: ${label} (${x},${y})`);
    lines.push(...stroke([[x - d, y], [x + d, y]]));
    lines.push(...stroke([[x, y - d], [x, y + d]]));
    lines.push("");
  }

  // Tick marks every 10mm
  lines.push("; Tick marks — horizontal (every 10mm)");
  for (let x = ox + 10; x < ex; x += 10) {
    lines.push(...stroke([[x, CY - 3], [x, CY + 3]]));
  }
  lines.push("");

  lines.push("; Tick marks — vertical (every 10mm)");
  for (let y = oy + 10; y < ey; y += 10) {
    lines.push(...stroke([[CX - 3, y], [CX + 3, y]]));
  }

  lines.push(...footer());
  write("test_calibration_cross.gcode", lines);
}

// ─── 5. Z-HOP TEST ────────────────────────────────────────────────────────────
function genZhopTest() {
  const lines: string[] = [...header("Z-Hop Test")];
  lines.push("; Tests: Z-hop height — pen must NOT drag between lines");
  lines.push("; Expected: 10 clean separate lines, no drag marks between them");
  lines.push("; If connected: increase Z_HOP in settings (try 4mm or 5mm)");
  lines.push("");

  const gap = 15;
  const lineH = 20;
  const startX = CX - (9 * gap) / 2; // center the 10 lines

  for (let i = 0; i < 10; i++) {
    const x = startX + i * gap;
    lines.push(`; Line ${i + 1}/10`);
    lines.push(...stroke([[x, CY - lineH / 2], [x, CY + lineH / 2]]));
    lines.push("");
  }

  lines.push(...footer());
  write("test_zhop.gcode", lines);
}

// ─── 6. TOM CAT ───────────────────────────────────────────────────────────────
function genTomCat() {
  // Simple bold cartoon Tom cat face — centered on canvas
  // All coordinates relative to CX, CY
  const lines: string[] = [...header("Tom Cat")];
  lines.push("; Cartoon: Tom Cat face");
  lines.push("; Tests: complex curves, multiple strokes, character drawing");
  lines.push("");

  const sc = 1.0; // scale factor
  const x = (dx: number) => CX + dx * sc;
  const y = (dy: number) => CY + dy * sc;

  // Head — large oval
  lines.push("; Head oval");
  lines.push(go(x(0), y(45)));
  lines.push(down());
  // Approximate oval with arc segments
  lines.push(ccw(x(38), y(20), 0, -25) + " ; top-right");
  lines.push(ccw(x(40), y(-10), 2, -30) + " ; right");
  lines.push(ccw(x(20), y(-38), -20, -28) + " ; bottom-right");
  lines.push(ccw(x(-20), y(-38), -40, 0) + " ; bottom");
  lines.push(ccw(x(-40), y(-10), -20, 28) + " ; left");
  lines.push(ccw(x(-38), y(20), 2, 30) + " ; top-left");
  lines.push(ccw(x(0), y(45), 38, 25) + " ; top");
  lines.push(up());
  lines.push("");

  // Left ear (triangle)
  lines.push("; Left ear");
  lines.push(...stroke([[x(-35), y(30)], [x(-50), y(60)], [x(-15), y(48)], [x(-35), y(30)]]));
  lines.push("");

  // Right ear (triangle)
  lines.push("; Right ear");
  lines.push(...stroke([[x(35), y(30)], [x(50), y(60)], [x(15), y(48)], [x(35), y(30)]]));
  lines.push("");

  // Left eye (oval)
  lines.push("; Left eye");
  lines.push(...circleCW(x(-15), y(10), 8));
  lines.push("");

  // Right eye (oval)
  lines.push("; Right eye");
  lines.push(...circleCW(x(15), y(10), 8));
  lines.push("");

  // Pupils
  lines.push("; Left pupil");
  lines.push(...circleCW(x(-15), y(10), 3));
  lines.push("; Right pupil");
  lines.push(...circleCW(x(15), y(10), 3));
  lines.push("");

  // Nose (small triangle)
  lines.push("; Nose");
  lines.push(...stroke([[x(-5), y(-5)], [x(5), y(-5)], [x(0), y(-12)], [x(-5), y(-5)]]));
  lines.push("");

  // Mouth — W shape
  lines.push("; Mouth");
  lines.push(...stroke([[x(-18), y(-18)], [x(-8), y(-12)], [x(0), y(-18)], [x(8), y(-12)], [x(18), y(-18)]]));
  lines.push("");

  // Whiskers left
  lines.push("; Whiskers left");
  lines.push(...stroke([[x(-40), y(-5)], [x(-10), y(-3)]]));
  lines.push(...stroke([[x(-40), y(-12)], [x(-10), y(-8)]]));
  lines.push(...stroke([[x(-40), y(-19)], [x(-10), y(-13)]]));
  lines.push("");

  // Whiskers right
  lines.push("; Whiskers right");
  lines.push(...stroke([[x(10), y(-3)], [x(40), y(-5)]]));
  lines.push(...stroke([[x(10), y(-8)], [x(40), y(-12)]]));
  lines.push(...stroke([[x(10), y(-13)], [x(40), y(-19)]]));
  lines.push("");

  lines.push(...footer());
  write("test_tom_cat.gcode", lines);
}

// ─── 7. MICKEY MOUSE ──────────────────────────────────────────────────────────
function genMickeyMouse() {
  const lines: string[] = [...header("Mickey Mouse")];
  lines.push("; Cartoon: Mickey Mouse iconic silhouette");
  lines.push("; Tests: large circles, proportional drawing");
  lines.push("");

  const x = (dx: number) => CX + dx;
  const y = (dy: number) => CY + dy;

  // Head circle
  lines.push("; Head (r=35mm)");
  lines.push(...circleCW(x(0), y(-5), 35));
  lines.push("");

  // Left ear
  lines.push("; Left ear (r=22mm)");
  lines.push(...circleCW(x(-30), y(28), 22));
  lines.push("");

  // Right ear
  lines.push("; Right ear (r=22mm)");
  lines.push(...circleCW(x(30), y(28), 22));
  lines.push("");

  // Left eye
  lines.push("; Left eye");
  lines.push(...circleCW(x(-12), y(2), 6));
  lines.push("");

  // Right eye
  lines.push("; Right eye");
  lines.push(...circleCW(x(12), y(2), 6));
  lines.push("");

  // Nose oval (small)
  lines.push("; Nose");
  lines.push(...circleCW(x(0), y(-10), 5));
  lines.push("");

  // Smile — big happy arc
  // From (CX-20, CY-18) to (CX+20, CY-18) curving down
  lines.push("; Smile");
  lines.push(go(x(-20), y(-18)));
  lines.push(down());
  lines.push(cw(x(20), y(-18), 20, -14) + " ; big smile");
  lines.push(up());
  lines.push("");

  lines.push(...footer());
  write("test_mickey_mouse.gcode", lines);
}

// ─── 8. ELEPHANT ──────────────────────────────────────────────────────────────
function genElephant() {
  const lines: string[] = [...header("Elephant")];
  lines.push("; Cartoon: Simple cute elephant");
  lines.push("; Tests: mixed curves and straight lines");
  lines.push("");

  const x = (dx: number) => CX + dx;
  const y = (dy: number) => CY + dy;

  // Body — large circle
  lines.push("; Body (r=38mm)");
  lines.push(...circleCW(x(5), y(-10), 38));
  lines.push("");

  // Head — circle
  lines.push("; Head (r=25mm)");
  lines.push(...circleCW(x(-25), y(20), 25));
  lines.push("");

  // Left ear — large oval-ish circle
  lines.push("; Left ear (r=18mm)");
  lines.push(...circleCW(x(-48), y(22), 18));
  lines.push("");

  // Trunk — curved line going down and right
  lines.push("; Trunk");
  lines.push(go(x(-18), y(0)));
  lines.push(down());
  lines.push(line(x(-22), y(-15)));
  lines.push(line(x(-18), y(-30)));
  lines.push(line(x(-8), y(-38)));
  lines.push(line(x(-2), y(-32)));
  lines.push(up());
  lines.push("");

  // Eye
  lines.push("; Eye");
  lines.push(...circleCW(x(-30), y(28), 4));
  lines.push("");

  // Legs — 4 rectangles
  const legW = 14, legH = 22;
  const legPositions = [
    [x(-20), y(-42)],
    [x(-2), y(-44)],
    [x(16), y(-44)],
    [x(34), y(-42)],
  ];
  lines.push("; Legs");
  for (const [lx, ly] of legPositions) {
    lines.push(...stroke([
      [lx, ly],
      [lx + legW, ly],
      [lx + legW, ly - legH],
      [lx, ly - legH],
      [lx, ly],
    ]));
  }
  lines.push("");

  // Tail — curved line
  lines.push("; Tail");
  lines.push(go(x(42), y(5)));
  lines.push(down());
  lines.push(line(x(52), y(15)));
  lines.push(line(x(58), y(10)));
  lines.push(line(x(55), y(0)));
  lines.push(up());
  lines.push("");

  lines.push(...footer());
  write("test_elephant.gcode", lines);
}

// ─── 9. STAR ──────────────────────────────────────────────────────────────────
function genStar() {
  const lines: string[] = [...header("5-Point Star")];
  lines.push("; Tests: diagonal lines, sharp angles, symmetry");
  lines.push("; Expected: perfect 5-point star centered on canvas");
  lines.push("");

  const R = 60; // outer radius
  const r = 25; // inner radius
  const pts: [number, number][] = [];

  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const radius = i % 2 === 0 ? R : r;
    pts.push([CX + radius * Math.cos(angle), CY + radius * Math.sin(angle)]);
  }
  pts.push(pts[0]); // close

  lines.push("; Star outline");
  lines.push(...stroke(pts));
  lines.push("");

  lines.push(...footer());
  write("test_star.gcode", lines);
}

// ─── Run all ──────────────────────────────────────────────────────────────────
console.log(`Canvas center: X${CX} Y${CY}`);
console.log(`Canvas: ${S.canvas_x}x${S.canvas_y}mm  Offset: X${S.offset_x} Y${S.offset_y}`);
console.log("");

genSmiley();
genMaze();
genConcentricCircles();
genCalibrationCross();
genZhopTest();
genTomCat();
genMickeyMouse();
genElephant();
genStar();

console.log("\n✅ All test patterns generated!");
