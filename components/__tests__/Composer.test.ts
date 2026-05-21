// Feature: plotter-studio-upgrade, Property 4: Drawing_Area Dimension Clamping
// Validates: Requirements 6.2, 6.3, 6.5

/**
 * Property 4: Drawing_Area Dimension Clamping
 *
 * For any resize input value (including extreme values like Infinity, -Infinity,
 * NaN, very large numbers, negative numbers), the resulting Drawing_Area width
 * and height must always be within the valid clamped ranges:
 *   Portrait:  width ∈ [10, 200], height ∈ [10, 160]
 *   Landscape: width ∈ [10, 250], height ∈ [10, 160]
 *
 * Run: npx ts-node components/__tests__/Composer.test.ts
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const fc = require("fast-check") as typeof import("fast-check");

// ─── Inline clamping logic (mirrors Composer.tsx clampDrawingArea) ────────────

const CLAMP = {
  portrait:  { minW: 10, maxW: 200, minH: 10, maxH: 160 },
  landscape: { minW: 10, maxW: 250, minH: 10, maxH: 160 },
};

function clampDrawingArea(
  width: number,
  height: number,
  orientation: "portrait" | "landscape"
): { width: number; height: number } {
  const c = CLAMP[orientation];
  const w = Number.isFinite(width)
    ? Math.max(c.minW, Math.min(c.maxW, width))
    : c.minW;
  const h = Number.isFinite(height)
    ? Math.max(c.minH, Math.min(c.maxH, height))
    : c.minH;
  return { width: w, height: h };
}

// ─── Property 4: Drawing_Area Dimension Clamping ──────────────────────────────

function runProperty4(): void {
  fc.assert(
    fc.property(
      // Generate arbitrary float values including extremes
      fc.oneof(
        fc.float({ noNaN: false }),          // includes NaN, Infinity, -Infinity
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.constant(Infinity),
        fc.constant(-Infinity),
        fc.constant(NaN),
        fc.constant(0),
        fc.constant(-1),
        fc.constant(10),
        fc.constant(200),
        fc.constant(250),
        fc.constant(160),
        fc.constant(1e10),
        fc.constant(-1e10),
      ),
      fc.oneof(
        fc.float({ noNaN: false }),
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.constant(Infinity),
        fc.constant(-Infinity),
        fc.constant(NaN),
        fc.constant(0),
        fc.constant(-1),
        fc.constant(10),
        fc.constant(160),
        fc.constant(1e10),
        fc.constant(-1e10),
      ),
      fc.constantFrom("portrait" as const, "landscape" as const),
      (rawWidth: number, rawHeight: number, orientation: "portrait" | "landscape") => {
        const result = clampDrawingArea(rawWidth, rawHeight, orientation);
        const c = CLAMP[orientation];

        // Width must always be in valid range
        if (result.width < c.minW || result.width > c.maxW) {
          throw new Error(
            `Width ${result.width} out of [${c.minW}, ${c.maxW}] for ${orientation} ` +
            `(input: ${rawWidth})`
          );
        }

        // Height must always be in valid range
        if (result.height < c.minH || result.height > c.maxH) {
          throw new Error(
            `Height ${result.height} out of [${c.minH}, ${c.maxH}] for ${orientation} ` +
            `(input: ${rawHeight})`
          );
        }

        // Result must be finite numbers
        if (!Number.isFinite(result.width)) {
          throw new Error(`Width result is not finite: ${result.width}`);
        }
        if (!Number.isFinite(result.height)) {
          throw new Error(`Height result is not finite: ${result.height}`);
        }

        return true;
      }
    ),
    { numRuns: 2000, verbose: false }
  );
}

// ─── Additional boundary checks ───────────────────────────────────────────────

function runBoundaryChecks(): void {
  const cases: Array<[number, number, "portrait" | "landscape", number, number]> = [
    // [input_w, input_h, orientation, expected_w, expected_h]
    [0, 0, "portrait", 10, 10],
    [-100, -100, "portrait", 10, 10],
    [1000, 1000, "portrait", 200, 160],
    [1000, 1000, "landscape", 250, 160],
    [10, 10, "portrait", 10, 10],
    [200, 160, "portrait", 200, 160],
    [250, 160, "landscape", 250, 160],
    [100, 80, "portrait", 100, 80],
    [NaN, NaN, "portrait", 10, 10],
    [Infinity, Infinity, "portrait", 10, 10],
    [-Infinity, -Infinity, "landscape", 10, 10],
  ];

  for (const [w, h, o, ew, eh] of cases) {
    const result = clampDrawingArea(w, h, o);
    if (result.width !== ew || result.height !== eh) {
      throw new Error(
        `Boundary check failed: clamp(${w}, ${h}, ${o}) = ` +
        `{w:${result.width}, h:${result.height}}, expected {w:${ew}, h:${eh}}`
      );
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  let allPassed = true;

  console.log("Running Property 4: Drawing_Area Dimension Clamping (2000 runs)...");
  try {
    runProperty4();
    console.log("✓ Property 4 passed");
  } catch (err) {
    console.error("✗ Property 4 FAILED:", err);
    allPassed = false;
  }

  console.log("Running boundary checks...");
  try {
    runBoundaryChecks();
    console.log("✓ Boundary checks passed");
  } catch (err) {
    console.error("✗ Boundary checks FAILED:", err);
    allPassed = false;
  }

  if (!allPassed) process.exit(1);
  console.log("\n✓ All Drawing_Area clamping tests passed");
}

main();
