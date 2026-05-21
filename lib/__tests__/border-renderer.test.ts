// Feature: plotter-studio-upgrade, Property 5: Border Coordinate Bounds
// Feature: plotter-studio-upgrade, Property 6: Border Thickness Pass Count
// Validates: Requirements 7.9, 7.10

/**
 * Property 5: Border Coordinate Bounds
 *   For any drawing area and margin, all G-code X/Y coordinates emitted by renderBorder
 *   must fall within [offset_x - margin - tolerance, offset_x + drawing_width + margin + tolerance]
 *   and [offset_y - margin - tolerance, offset_y + drawing_height + margin + tolerance].
 *
 * Property 6: Border Thickness Pass Count
 *   For "simple-rect" and "rounded-rect" border styles, the number of pen-up moves
 *   (G0 Z{z_hop}) in gcodeLines equals the thickness value.
 *
 * Run: node sovol-pen-plotter/node_modules/.bin/sucrase-node sovol-pen-plotter/lib/__tests__/border-renderer.test.ts
 */

/* eslint-disable @typescript-eslint/no-var-requires */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fc = require("fast-check") as typeof import("fast-check");

import {
  renderBorder,
  BorderStyle,
  BorderConfig,
  DrawingArea,
  PlotterSettings,
} from "../border-renderer";

// ─── Test Settings ────────────────────────────────────────────────────────────

const TEST_SETTINGS: PlotterSettings = {
  z_draw: 0,
  z_hop: 3,
  feed_draw: 1500,
  feed_travel: 3000,
  canvas_x: 200,
  canvas_y: 160,
  offset_x: 40,
  offset_y: 40,
};

const TOLERANCE = 0.001;

// The double-line style intentionally extends DOUBLE_LINE_GAP (2mm) beyond the margin
// on each side (outer rect = inner rect + 2mm per side), per requirement 7.5.
// All other non-"none" styles stay within [offset ± margin].
const DOUBLE_LINE_GAP = 2.0; // mm — matches border-renderer.ts constant

// The ornamental-corners style extends ORNAMENTAL_BOX (12mm) from each corner along the edges,
// per requirement 7.8. When the drawing area is smaller than 12mm, the flourish extends
// beyond the opposite corner. The maximum extension from the corner is ORNAMENTAL_BOX.
const ORNAMENTAL_BOX = 12.0; // mm — matches border-renderer.ts constant

// All non-"none" border styles
const NON_NONE_STYLES: BorderStyle[] = [
  "simple-rect",
  "rounded-rect",
  "double-line",
  "corner-marks",
  "dashed",
  "ornamental-corners",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse all X coordinate values from an array of G-code lines.
 * Matches patterns like: X12.345 or X-12.345
 */
function parseXValues(gcodeLines: string[]): number[] {
  const values: number[] = [];
  const xRegex = /X(-?\d+(?:\.\d+)?)/g;
  for (const line of gcodeLines) {
    let match: RegExpExecArray | null;
    while ((match = xRegex.exec(line)) !== null) {
      values.push(parseFloat(match[1]));
    }
  }
  return values;
}

/**
 * Parse all Y coordinate values from an array of G-code lines.
 * Matches patterns like: Y12.345 or Y-12.345
 */
function parseYValues(gcodeLines: string[]): number[] {
  const values: number[] = [];
  const yRegex = /Y(-?\d+(?:\.\d+)?)/g;
  for (const line of gcodeLines) {
    let match: RegExpExecArray | null;
    while ((match = yRegex.exec(line)) !== null) {
      values.push(parseFloat(match[1]));
    }
  }
  return values;
}

/**
 * Count the number of pen-up moves (G0 Z{z_hop}) in gcodeLines.
 * Each pen-up ends a pass group.
 */
function countPenUpMoves(gcodeLines: string[], zHop: number): number {
  const penUpPattern = `G0 Z${zHop.toFixed(3)}`;
  return gcodeLines.filter((line) => line.startsWith(penUpPattern)).length;
}

// ─── Property 5: Border Coordinate Bounds ────────────────────────────────────

/**
 * **Validates: Requirements 7.9**
 *
 * For every non-"none" border style, all G-code X/Y coordinates must fall within
 * the drawing area bounds extended by the margin (plus floating-point tolerance).
 *
 * Note: "double-line" intentionally extends DOUBLE_LINE_GAP (2mm) beyond the margin
 * on each side (outer rect = inner rect + 2mm per side), per requirement 7.5.
 * "ornamental-corners" extends ORNAMENTAL_BOX (12mm) from each corner, per requirement 7.8.
 * These per-style extensions are accounted for in the bounds check.
 */
function runProperty5(): void {
  fc.assert(
    fc.property(
      // DrawingArea dimensions
      fc.record({
        width: fc.float({ min: 10, max: 200, noNaN: true }),
        height: fc.float({ min: 10, max: 160, noNaN: true }),
      }),
      // Margin
      fc.float({ min: 0, max: 20, noNaN: true }),
      (dims: { width: number; height: number }, margin: number) => {
        const drawingArea: DrawingArea = {
          x: TEST_SETTINGS.offset_x,
          y: TEST_SETTINGS.offset_y,
          width: dims.width,
          height: dims.height,
        };

        for (const style of NON_NONE_STYLES) {
          // Per-style extra bounds beyond [offset ± margin]:
          // - "double-line": outer rect extends DOUBLE_LINE_GAP (2mm) beyond margin (req 7.5)
          // - "ornamental-corners": flourish extends ORNAMENTAL_BOX (12mm) from each corner (req 7.8)
          let extraGap = 0;
          if (style === "double-line") {
            extraGap = DOUBLE_LINE_GAP;
          } else if (style === "ornamental-corners") {
            extraGap = ORNAMENTAL_BOX;
          }

          // Expected coordinate bounds (drawing area ± margin ± extraGap ± tolerance)
          const xMin = TEST_SETTINGS.offset_x - margin - extraGap - TOLERANCE;
          const xMax = TEST_SETTINGS.offset_x + dims.width + margin + extraGap + TOLERANCE;
          const yMin = TEST_SETTINGS.offset_y - margin - extraGap - TOLERANCE;
          const yMax = TEST_SETTINGS.offset_y + dims.height + margin + extraGap + TOLERANCE;

          const config: BorderConfig = {
            style,
            margin,
            thickness: 1,
          };

          const result = renderBorder(config, drawingArea, TEST_SETTINGS);

          // Parse all X and Y values from G-code
          const xValues = parseXValues(result.gcodeLines);
          const yValues = parseYValues(result.gcodeLines);

          // Verify all X values are within bounds
          for (const x of xValues) {
            if (x < xMin || x > xMax) {
              throw new Error(
                `Style "${style}": X value ${x} out of bounds [${xMin}, ${xMax}] ` +
                  `(drawingArea.width=${dims.width}, margin=${margin})`
              );
            }
          }

          // Verify all Y values are within bounds
          for (const y of yValues) {
            if (y < yMin || y > yMax) {
              throw new Error(
                `Style "${style}": Y value ${y} out of bounds [${yMin}, ${yMax}] ` +
                  `(drawingArea.height=${dims.height}, margin=${margin})`
              );
            }
          }
        }

        return true;
      }
    ),
    { numRuns: 200, verbose: false }
  );
}

// ─── Property 6: Border Thickness Pass Count ─────────────────────────────────

/**
 * **Validates: Requirements 7.10**
 *
 * For "simple-rect" and "rounded-rect" border styles, the number of pen-up moves
 * in gcodeLines equals the thickness value (one pass group per thickness unit).
 */
function runProperty6(): void {
  fc.assert(
    fc.property(
      // Border style: only styles with exactly 1 pass group per thickness
      fc.constantFrom("simple-rect" as const, "rounded-rect" as const),
      // Thickness: 1–5 passes
      fc.integer({ min: 1, max: 5 }),
      (style: "simple-rect" | "rounded-rect", thickness: number) => {
        const drawingArea: DrawingArea = {
          x: TEST_SETTINGS.offset_x,
          y: TEST_SETTINGS.offset_y,
          width: 100,
          height: 80,
        };

        const config: BorderConfig = {
          style,
          margin: 5,
          thickness,
        };

        const result = renderBorder(config, drawingArea, TEST_SETTINGS);

        // Count pen-up moves — each ends a pass group
        const penUpCount = countPenUpMoves(result.gcodeLines, TEST_SETTINGS.z_hop);

        if (penUpCount !== thickness) {
          throw new Error(
            `Style "${style}" with thickness=${thickness}: ` +
              `expected ${thickness} pass groups (pen-up moves), got ${penUpCount}`
          );
        }

        return true;
      }
    ),
    { numRuns: 200, verbose: false }
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  let allPassed = true;

  console.log("Running Property 5: Border Coordinate Bounds...");
  try {
    runProperty5();
    console.log("✓ Property 5 passed (200 runs)");
  } catch (err) {
    console.error("✗ Property 5 FAILED:");
    console.error(err);
    allPassed = false;
  }

  console.log("\nRunning Property 6: Border Thickness Pass Count...");
  try {
    runProperty6();
    console.log("✓ Property 6 passed (200 runs)");
  } catch (err) {
    console.error("✗ Property 6 FAILED:");
    console.error(err);
    allPassed = false;
  }

  if (!allPassed) {
    process.exit(1);
  }
}

main();
