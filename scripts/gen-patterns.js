#!/usr/bin/env node
/**
 * gen-patterns.js — generates all test pattern G-code files
 * Run: node scripts/gen-patterns.js
 */
const fs = require("fs");
const path = require("path");

const S = {
  z_draw: 0.0, z_hop: 3.0,
  feed_draw: 1500, feed_travel: 3000,
  canvas_x: 200, canvas_y: 160,
  offset_x: 40, offset_y: 40,
};

const CX = S.offset_x + S.canvas_x / 2; // 140
const CY = S.offset_y + S.canvas_y / 2; // 120

const f3 = (n) => n.toFixed(3);
const header = (title) => [
  `; Sovol SV02 Pen Plotter — ${title}`,
  `; Canvas: ${S.canvas_x}x${S.canvas_y}mm  Offset: X${S.offset_x} Y${S.offset_y}`,
  `; Canvas center: X${CX} Y${CY}`,
  ";",
  "G21 ; mm units",
  "G90 ; absolute positioning",
  "G28 X Y ; home X and Y ONLY — never home Z",
  `G0 Z${f3(S.z_hop)} F${S.feed_travel} ; pen up`,
  "",
];
const footer = () => [
  "",
  "; === FOOTER ===",
  `G0 Z${f3(S.z_hop + 5)} F${S.feed_travel} ; raise pen safely`,
  `G0 X${f3(S.offset_x)} Y${f3(S.offset_y)} F${S.feed_travel} ; return to origin`,
  "M84 ; disable steppers",
];
const up   = () => `G0 Z${f3(S.z_hop)} F${S.feed_travel} ; pen up`;
const down = () => `G0 Z${f3(S.z_draw)} F${S.feed_travel} ; pen down`;
const go   = (x, y) => `G0 X${f3(x)} Y${f3(y)} F${S.feed_travel}`;
const ln   = (x, y) => `G1 X${f3(x)} Y${f3(y)} F${S.feed_draw}`;
const cw   = (x, y, i, j) => `G2 X${f3(x)} Y${f3(y)} I${f3(i)} J${f3(j)} F${S.feed_draw}`;
const ccw  = (x, y, i, j) => `G3 X${f3(x)} Y${f3(y)} I${f3(i)} J${f3(j)} F${S.feed_draw}`;

const circle = (cx, cy, r) => [
  go(cx + r, cy), down(),
  cw(cx + r, cy, -r, 0) + " ; full circle CW",
  up(),
];

const stroke = (pts) => {
  if (pts.length < 2) return [];
  const out = [go(pts[0][0], pts[0][1]), down()];
  for (let i = 1; i < pts.length; i++) out.push(ln(pts[i][0], pts[i][1]));
  out.push(up());
  return out;
};

const OUT = path.join(__dirname, "../public/test-patterns");
fs.mkdirSync(OUT, { recursive: true });

function write(filename, lines) {
  fs.writeFileSync(path.join(OUT, filename), lines.join("\n"));
  console.log(`✅ ${filename}`);
}

// ─── 1. SMILEY FACE ───────────────────────────────────────────────────────────
function genSmiley() {
  const L = [...header("Smiley Face Test")];
  L.push("; Tests: arc drawing, pen pressure, circle accuracy");
  L.push("");

  // Face
  L.push("; Face circle r=40mm");
  L.push(...circle(CX, CY, 40));
  L.push("");

  // Eyes
  L.push("; Left eye");
  L.push(...circle(CX - 15, CY + 12, 5));
  L.push("");
  L.push("; Right eye");
  L.push(...circle(CX + 15, CY + 12, 5));
  L.push("");

  // Smile: G2 CW arc from left to right, center BELOW the arc = curves downward = smile
  // Start: (CX-18, CY-8), End: (CX+18, CY-8)
  // Arc center: (CX, CY-20)  =>  I = CX-(CX-18)=18, J = (CY-20)-(CY-8)=-12
  L.push("; Smile (G2 CW, curves downward = happy)");
  L.push(go(CX - 18, CY - 8));
  L.push(down());
  L.push(cw(CX + 18, CY - 8, 18, -12) + " ; smile arc");
  L.push(up());
  L.push("");

  // Eyebrows
  L.push("; Left eyebrow");
  L.push(...stroke([[CX - 23, CY + 22], [CX - 7, CY + 24]]));
  L.push("; Right eyebrow");
  L.push(...stroke([[CX + 7, CY + 24], [CX + 23, CY + 22]]));

  L.push(...footer());
  write("test_smiley.gcode", L);
}

// ─── 2. SQUARE MAZE ───────────────────────────────────────────────────────────
function genMaze() {
  const cell = 20, cols = 5, rows = 5;
  const mx = CX - (cols * cell) / 2;
  const my = CY - (rows * cell) / 2;
  const L = [...header("Square Maze Test")];
  L.push("; Tests: corner accuracy, straight lines, 90° angles");
  L.push("");

  L.push("; Outer border");
  L.push(go(mx, my)); L.push(down());
  L.push(ln(mx + cols*cell, my));
  L.push(ln(mx + cols*cell, my + rows*cell));
  L.push(ln(mx, my + rows*cell));
  L.push(ln(mx, my));
  L.push(up()); L.push("");

  const walls = [
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
  L.push("; Internal walls");
  for (const [col, row, dir] of walls) {
    let x1, y1, x2, y2;
    if (dir === 'h') {
      x1 = mx + col*cell; y1 = my + row*cell; x2 = x1+cell; y2 = y1;
    } else {
      x1 = mx + (col+1)*cell; y1 = my + row*cell; x2 = x1; y2 = y1+cell;
    }
    L.push(...stroke([[x1,y1],[x2,y2]]));
  }
  L.push(...footer());
  write("test_square_maze.gcode", L);
}

// ─── 3. CONCENTRIC CIRCLES ────────────────────────────────────────────────────
function genConcentricCircles() {
  const L = [...header("Concentric Circles Test")];
  L.push(`; All circles centered at X${CX} Y${CY} (canvas center)`);
  L.push("; Tests: arc consistency, motor sync, roundness");
  L.push("");
  for (const r of [10, 20, 30, 40, 50, 60, 70, 75]) {
    L.push(`; Circle r=${r}mm`);
    L.push(...circle(CX, CY, r));
    L.push("");
  }
  L.push(...footer());
  write("test_concentric_circles.gcode", L);
}

// ─── 4. CALIBRATION CROSS ─────────────────────────────────────────────────────
function genCalibrationCross() {
  const ox = S.offset_x, oy = S.offset_y;
  const ex = ox + S.canvas_x, ey = oy + S.canvas_y;
  const L = [...header("Calibration Cross Test")];
  L.push(`; Expected: cross spans exactly ${S.canvas_x}x${S.canvas_y}mm`);
  L.push("");

  L.push("; Horizontal axis");
  L.push(...stroke([[ox, CY], [ex, CY]]));
  L.push("; Vertical axis");
  L.push(...stroke([[CX, oy], [CX, ey]]));
  L.push("");

  for (const [x, y, label] of [[ox,oy,"BL"],[ex,oy,"BR"],[ox,ey,"TL"],[ex,ey,"TR"],[CX,CY,"C"]]) {
    L.push(`; Mark: ${label}`);
    L.push(...stroke([[x-4,y],[x+4,y]]));
    L.push(...stroke([[x,y-4],[x,y+4]]));
  }
  L.push("");

  L.push("; Tick marks H");
  for (let x = ox+10; x < ex; x += 10) L.push(...stroke([[x,CY-3],[x,CY+3]]));
  L.push("; Tick marks V");
  for (let y = oy+10; y < ey; y += 10) L.push(...stroke([[CX-3,y],[CX+3,y]]));

  L.push(...footer());
  write("test_calibration_cross.gcode", L);
}

// ─── 5. Z-HOP TEST ────────────────────────────────────────────────────────────
function genZhopTest() {
  const L = [...header("Z-Hop Test")];
  L.push("; Expected: 10 clean separate lines, NO drag marks between them");
  L.push("");
  const startX = CX - (9 * 15) / 2;
  for (let i = 0; i < 10; i++) {
    const x = startX + i * 15;
    L.push(`; Line ${i+1}/10`);
    L.push(...stroke([[x, CY-10],[x, CY+10]]));
    L.push("");
  }
  L.push(...footer());
  write("test_zhop.gcode", L);
}

// ─── 6. TOM CAT ───────────────────────────────────────────────────────────────
function genTomCat() {
  const L = [...header("Tom Cat")];
  L.push("; Cartoon Tom Cat face — centered on canvas");
  L.push("");
  const x = (dx) => CX + dx;
  const y = (dy) => CY + dy;

  // Head oval — approximate with 4 arcs
  L.push("; Head");
  L.push(go(x(0), y(42)));
  L.push(down());
  L.push(cw(x(35), y(0), 0, -42) + " ; right half top");
  L.push(cw(x(0), y(-38), -35, 0) + " ; right half bottom");
  L.push(cw(x(-35), y(0), 0, 38) + " ; left half bottom");
  L.push(cw(x(0), y(42), 35, 0) + " ; left half top");
  L.push(up());
  L.push("");

  // Ears
  L.push("; Left ear");
  L.push(...stroke([[x(-30),y(28)],[x(-48),y(58)],[x(-12),y(46)],[x(-30),y(28)]]));
  L.push("; Right ear");
  L.push(...stroke([[x(30),y(28)],[x(48),y(58)],[x(12),y(46)],[x(30),y(28)]]));
  L.push("");

  // Eyes
  L.push("; Left eye");
  L.push(...circle(x(-14), y(10), 8));
  L.push("; Right eye");
  L.push(...circle(x(14), y(10), 8));
  L.push("; Left pupil");
  L.push(...circle(x(-14), y(10), 3));
  L.push("; Right pupil");
  L.push(...circle(x(14), y(10), 3));
  L.push("");

  // Nose
  L.push("; Nose");
  L.push(...stroke([[x(-5),y(-5)],[x(5),y(-5)],[x(0),y(-13)],[x(-5),y(-5)]]));
  L.push("");

  // Mouth W-shape
  L.push("; Mouth");
  L.push(...stroke([[x(-18),y(-18)],[x(-8),y(-12)],[x(0),y(-18)],[x(8),y(-12)],[x(18),y(-18)]]));
  L.push("");

  // Whiskers
  L.push("; Whiskers left");
  L.push(...stroke([[x(-38),y(-4)],[x(-10),y(-2)]]));
  L.push(...stroke([[x(-38),y(-11)],[x(-10),y(-8)]]));
  L.push(...stroke([[x(-38),y(-18)],[x(-10),y(-14)]]));
  L.push("; Whiskers right");
  L.push(...stroke([[x(10),y(-2)],[x(38),y(-4)]]));
  L.push(...stroke([[x(10),y(-8)],[x(38),y(-11)]]));
  L.push(...stroke([[x(10),y(-14)],[x(38),y(-18)]]));

  L.push(...footer());
  write("test_tom_cat.gcode", L);
}

// ─── 7. MICKEY MOUSE ──────────────────────────────────────────────────────────
function genMickeyMouse() {
  const L = [...header("Mickey Mouse")];
  L.push("; Iconic Mickey Mouse silhouette — centered on canvas");
  L.push("");
  const x = (dx) => CX + dx;
  const y = (dy) => CY + dy;

  L.push("; Head r=32mm");
  L.push(...circle(x(0), y(-8), 32));
  L.push("; Left ear r=20mm");
  L.push(...circle(x(-28), y(24), 20));
  L.push("; Right ear r=20mm");
  L.push(...circle(x(28), y(24), 20));
  L.push("");

  L.push("; Left eye");
  L.push(...circle(x(-11), y(0), 6));
  L.push("; Right eye");
  L.push(...circle(x(11), y(0), 6));
  L.push("; Nose");
  L.push(...circle(x(0), y(-12), 5));
  L.push("");

  // Big smile
  L.push("; Smile");
  L.push(go(x(-18), y(-18)));
  L.push(down());
  L.push(cw(x(18), y(-18), 18, -12) + " ; big smile");
  L.push(up());

  L.push(...footer());
  write("test_mickey_mouse.gcode", L);
}

// ─── 8. ELEPHANT ──────────────────────────────────────────────────────────────
function genElephant() {
  const L = [...header("Elephant")];
  L.push("; Cute cartoon elephant — centered on canvas");
  L.push("");
  const x = (dx) => CX + dx;
  const y = (dy) => CY + dy;

  // Body
  L.push("; Body r=35mm");
  L.push(...circle(x(8), y(-8), 35));
  L.push("");

  // Head
  L.push("; Head r=22mm");
  L.push(...circle(x(-22), y(18), 22));
  L.push("");

  // Ear
  L.push("; Ear r=16mm");
  L.push(...circle(x(-42), y(20), 16));
  L.push("");

  // Trunk
  L.push("; Trunk");
  L.push(go(x(-16), y(0)));
  L.push(down());
  L.push(ln(x(-20), y(-14)));
  L.push(ln(x(-16), y(-28)));
  L.push(ln(x(-6), y(-35)));
  L.push(ln(x(0), y(-30)));
  L.push(up());
  L.push("");

  // Eye
  L.push("; Eye");
  L.push(...circle(x(-28), y(24), 4));
  L.push("");

  // Legs
  L.push("; Legs");
  for (const lx of [x(-18), x(-2), x(14), x(30)]) {
    const ly = y(-40);
    L.push(...stroke([[lx,ly],[lx+12,ly],[lx+12,ly-18],[lx,ly-18],[lx,ly]]));
  }
  L.push("");

  // Tail
  L.push("; Tail");
  L.push(...stroke([[x(42),y(2)],[x(52),y(12)],[x(58),y(6)],[x(54),y(-2)]]));

  L.push(...footer());
  write("test_elephant.gcode", L);
}

// ─── 9. STAR ──────────────────────────────────────────────────────────────────
function genStar() {
  const L = [...header("5-Point Star")];
  L.push("; Tests: diagonal lines, sharp angles, symmetry");
  L.push("");
  const R = 60, r = 25;
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const radius = i % 2 === 0 ? R : r;
    pts.push([CX + radius * Math.cos(angle), CY + radius * Math.sin(angle)]);
  }
  pts.push(pts[0]);
  L.push("; Star outline");
  L.push(...stroke(pts));
  L.push(...footer());
  write("test_star.gcode", L);
}

// ─── Run all ──────────────────────────────────────────────────────────────────
console.log(`Canvas center: X${CX} Y${CY}`);
genSmiley();
genMaze();
genConcentricCircles();
genCalibrationCross();
genZhopTest();
genTomCat();
genMickeyMouse();
genElephant();
genStar();
console.log("\n✅ All 9 test patterns generated!");
