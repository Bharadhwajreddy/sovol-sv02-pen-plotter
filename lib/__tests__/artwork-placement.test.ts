// Image placement: the placed artwork must never leave the drawing area.

/**
 * Property 1: Containment
 *   For any artwork, drawing area, and requested position / size / rotation,
 *   constrainPlacement yields a placement whose every stroke point, in machine
 *   coordinates, lies inside the drawing area — so the image is never cut.
 *
 * Property 2: Fit matches /api/process layout
 *   fitPlacement at rotation 0 reproduces the old fit-and-center layout
 *   (X = offset + pad + px*scale, Y = offset + pad + (H - py)*scale).
 *
 * Plus unit checks for parsePathD and artworkFromSvg.
 *
 * Run: node node_modules/.bin/sucrase-node lib/__tests__/artwork-placement.test.ts
 */

/* eslint-disable @typescript-eslint/no-var-requires */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fc = require("fast-check") as typeof import("fast-check");

import {
  Artwork,
  Area,
  Polyline,
  artworkFromSvg,
  computeBounds,
  constrainPlacement,
  fitPlacement,
  parsePathD,
  rotatedExtents,
  toMachine,
} from "../artwork-placement";

const EPS = 1e-6;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const pointArb = fc.tuple(fc.double({ min: -500, max: 1500, noNaN: true }), fc.double({ min: -500, max: 1500, noNaN: true }));
const artworkArb = fc
  .array(fc.array(pointArb, { minLength: 2, maxLength: 8 }), { minLength: 1, maxLength: 6 })
  .map((polylines) => ({ polylines, bounds: computeBounds(polylines)! }) as Artwork);
const areaArb = fc.record({
  x: fc.double({ min: 0, max: 150, noNaN: true }),
  y: fc.double({ min: 0, max: 150, noNaN: true }),
  width: fc.double({ min: 10, max: 280, noNaN: true }),
  height: fc.double({ min: 10, max: 250, noNaN: true }),
});
const placementArb = fc.record({
  cx: fc.double({ min: -1000, max: 1000, noNaN: true }),
  cy: fc.double({ min: -1000, max: 1000, noNaN: true }),
  scale: fc.double({ min: 0.0001, max: 100, noNaN: true }),
  rotation: fc.double({ min: -360, max: 360, noNaN: true }),
});

function checkInside(art: Artwork, area: Area, pl: ReturnType<typeof constrainPlacement>): void {
  for (const line of art.polylines) {
    for (const p of line) {
      const [mx, my] = toMachine(p, art, pl, area);
      const tol = EPS * Math.max(1, area.width, area.height);
      assert(
        mx >= area.x - tol && mx <= area.x + area.width + tol && my >= area.y - tol && my <= area.y + area.height + tol,
        `point (${mx}, ${my}) outside area ${JSON.stringify(area)} for placement ${JSON.stringify(pl)}`,
      );
    }
  }
}

function runContainment(): void {
  fc.assert(
    fc.property(artworkArb, areaArb, placementArb, (art, area, requested) => {
      const pl = constrainPlacement(requested, area, rotatedExtents(art, requested.rotation));
      checkInside(art, area, pl);
      return true;
    }),
    { numRuns: 500 },
  );
}

function runFitMatchesApiLayout(): void {
  fc.assert(
    fc.property(
      fc.integer({ min: 10, max: 1000 }), fc.integer({ min: 10, max: 1000 }), areaArb,
      (imgW, imgH, area) => {
        // Artwork whose bounds are the full image (two diagonal corners)
        const art: Artwork = { polylines: [[[0, 0], [imgW, imgH]]], bounds: { minX: 0, minY: 0, maxX: imgW, maxY: imgH } };
        const pl = fitPlacement(art, area);
        const scale = Math.min(area.width / imgW, area.height / imgH);
        const padX = (area.width - imgW * scale) / 2;
        const padY = (area.height - imgH * scale) / 2;
        for (const [px, py] of art.polylines[0]) {
          const [mx, my] = toMachine([px, py], art, pl, area);
          const ex = area.x + padX + px * scale;
          const ey = area.y + padY + (imgH - py) * scale;
          assert(Math.abs(mx - ex) < 1e-6 && Math.abs(my - ey) < 1e-6, `fit mismatch: got (${mx},${my}) expected (${ex},${ey})`);
        }
        return true;
      },
    ),
    { numRuns: 300 },
  );
}

function runParserChecks(): void {
  const same = (a: Polyline[], b: Polyline[]) =>
    a.length === b.length && a.every((l, i) => l.length === b[i].length && l.every((p, j) => Math.abs(p[0] - b[i][j][0]) < 1e-9 && Math.abs(p[1] - b[i][j][1]) < 1e-9));

  assert(same(parsePathD("M1,2L3,4L5,6"), [[[1, 2], [3, 4], [5, 6]]]), "basic M/L");
  assert(same(parsePathD("M1,2 L3,4 M10,10 L20,20"), [[[1, 2], [3, 4]], [[10, 10], [20, 20]]]), "subpaths are split");
  assert(same(parsePathD("M 0 0 10 0 10 10 Z"), [[[0, 0], [10, 0], [10, 10], [0, 0]]]), "implicit lineto + close");
  assert(same(parsePathD("m1,1 l2,0 v3 h-2"), [[[1, 1], [3, 1], [3, 4], [1, 4]]]), "relative commands");
  const curve = parsePathD("M0,0 C0,10 10,10 10,0");
  assert(curve.length === 1 && curve[0].length === 13, "cubic is flattened");
  assert(Math.abs(curve[0][12][0] - 10) < 1e-9 && Math.abs(curve[0][12][1]) < 1e-9, "cubic ends at its end point");

  const art = artworkFromSvg(`<svg viewBox="0 0 100 50"><path d="M10,5L90,45" stroke="black"/><path d='M20,20L30,30'/></svg>`);
  assert(!!art && art.polylines.length === 2, "artworkFromSvg reads both quote styles");
  assert(art!.bounds.minX === 10 && art!.bounds.maxX === 90 && art!.bounds.minY === 5 && art!.bounds.maxY === 45, "tight bounds");
  assert(artworkFromSvg(`<svg></svg>`) === null, "empty svg has no artwork");
}

function main(): void {
  let allPassed = true;
  const run = (name: string, fn: () => void) => {
    try {
      fn();
      console.log(`✓ ${name}`);
    } catch (err) {
      console.error(`✗ ${name} FAILED:`);
      console.error(err);
      allPassed = false;
    }
  };
  run("Path parsing", runParserChecks);
  run("Property 1: Containment (500 runs)", runContainment);
  run("Property 2: Fit matches /api/process layout (300 runs)", runFitMatchesApiLayout);
  if (!allPassed) process.exit(1);
}

main();
