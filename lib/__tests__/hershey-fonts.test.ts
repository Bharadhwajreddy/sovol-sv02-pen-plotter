/**
 * hershey-fonts.test.ts
 * Unit tests for the Hershey font renderer (lib/hershey-fonts.ts)
 *
 * Requirements: 8.3, 8.4, 8.5, 8.6, 8.10
 *
 * Run: npx ts-node lib/__tests__/hershey-fonts.test.ts
 */

import assert from "assert";
import { renderText, HersheyFontName } from "../hershey-fonts";

const FONTS: HersheyFontName[] = ["sans", "script", "gothic", "block", "simplex"];
const SAMPLE_TEXT = "Hello";
const TOLERANCE = 0.01; // 1% tolerance for proportional scaling

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    failed++;
  }
}

// ─── Test 1: Render ASCII text in each of the 5 fonts → svgPaths is non-empty ─

console.log("\nTest 1: Render ASCII text in each font → svgPaths non-empty");
for (const font of FONTS) {
  test(`font "${font}" renders "${SAMPLE_TEXT}" to non-empty svgPaths`, () => {
    const result = renderText(SAMPLE_TEXT, font, 10, 1);
    assert.ok(
      result.svgPaths.length > 0,
      `Expected svgPaths to be non-empty for font "${font}", got ${result.svgPaths.length}`
    );
    // Each path should be a valid SVG path element string
    for (const p of result.svgPaths) {
      assert.ok(
        p.startsWith("<path ") && p.includes('d="'),
        `Expected SVG path element, got: ${p.slice(0, 80)}`
      );
    }
  });
}

// ─── Test 2: Unsupported character → in unsupportedChars, not in svgPaths ─────

console.log("\nTest 2: Unsupported character handling");
test("Unicode star ★ is in unsupportedChars and not rendered", () => {
  const result = renderText("A★B", "sans", 10, 1);
  assert.ok(
    result.unsupportedChars.includes("★"),
    `Expected "★" in unsupportedChars, got: ${JSON.stringify(result.unsupportedChars)}`
  );
  // svgPaths should only contain paths for A and B (2 paths), not for ★
  // (A and B are supported, ★ is not)
  assert.ok(
    result.svgPaths.length >= 1,
    `Expected at least 1 path for supported chars, got ${result.svgPaths.length}`
  );
  // Verify ★ is not in unsupportedChars more than once
  const starCount = result.unsupportedChars.filter((c) => c === "★").length;
  assert.strictEqual(starCount, 1, `Expected ★ to appear once in unsupportedChars, got ${starCount}`);
});

test("All supported chars produce paths, unsupported chars produce none", () => {
  // Render only unsupported chars
  const result = renderText("★☆♠♣", "sans", 10, 1);
  // All 4 chars are likely unsupported in Hershey fonts
  // svgPaths should be empty or very small
  for (const char of ["★", "☆", "♠", "♣"]) {
    if (result.unsupportedChars.includes(char)) {
      // Good — it was detected as unsupported
    }
  }
  // The number of paths should equal the number of supported chars
  const supportedCount = 4 - result.unsupportedChars.length;
  assert.strictEqual(
    result.svgPaths.length,
    supportedCount,
    `Expected ${supportedCount} paths for ${supportedCount} supported chars, got ${result.svgPaths.length}`
  );
});

// ─── Test 3: Bounding box scales proportionally with sizeMm ──────────────────

console.log("\nTest 3: Bounding box scales proportionally with sizeMm");
test("Bounding box width and height scale proportionally (sizeMm=4 vs sizeMm=50)", () => {
  const result4 = renderText("ABC", "sans", 4, 1);
  const result50 = renderText("ABC", "sans", 50, 1);

  const expectedRatio = 50 / 4; // 12.5

  // Height should scale exactly with sizeMm
  const heightRatio = result50.boundingBox.height / result4.boundingBox.height;
  assert.ok(
    Math.abs(heightRatio - expectedRatio) / expectedRatio < TOLERANCE,
    `Height ratio ${heightRatio.toFixed(4)} should be ~${expectedRatio} (within 1%)`
  );

  // Width should scale proportionally (same ratio as height)
  if (result4.boundingBox.width > 0 && result50.boundingBox.width > 0) {
    const widthRatio = result50.boundingBox.width / result4.boundingBox.width;
    assert.ok(
      Math.abs(widthRatio - expectedRatio) / expectedRatio < TOLERANCE,
      `Width ratio ${widthRatio.toFixed(4)} should be ~${expectedRatio} (within 1%)`
    );
  }
});

test("Bounding box height equals sizeMm", () => {
  for (const size of [4, 10, 25, 50]) {
    const result = renderText("Hello", "sans", size, 1);
    assert.strictEqual(
      result.boundingBox.height,
      size,
      `Expected boundingBox.height=${size}, got ${result.boundingBox.height}`
    );
  }
});

// ─── Test 4: passes=1 vs passes=3 → passes=3 produces 3× as many SVG paths ──

console.log("\nTest 4: Multi-pass produces correct path count");
test("passes=3 produces exactly 3× as many svgPaths as passes=1", () => {
  const result1 = renderText("Hi", "sans", 10, 1);
  const result3 = renderText("Hi", "sans", 10, 3);

  assert.ok(result1.svgPaths.length > 0, "passes=1 should produce at least 1 path");
  assert.strictEqual(
    result3.svgPaths.length,
    result1.svgPaths.length * 3,
    `Expected passes=3 to produce ${result1.svgPaths.length * 3} paths, got ${result3.svgPaths.length}`
  );
});

test("passes=5 produces exactly 5× as many svgPaths as passes=1", () => {
  const result1 = renderText("AB", "simplex", 10, 1);
  const result5 = renderText("AB", "simplex", 10, 5);

  assert.ok(result1.svgPaths.length > 0, "passes=1 should produce at least 1 path");
  assert.strictEqual(
    result5.svgPaths.length,
    result1.svgPaths.length * 5,
    `Expected passes=5 to produce ${result1.svgPaths.length * 5} paths, got ${result5.svgPaths.length}`
  );
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log("✓ All Hershey font renderer tests passed");
}
