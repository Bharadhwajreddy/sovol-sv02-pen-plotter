/**
 * hershey-fonts.ts
 * Hershey single-stroke font glyph renderer for pen plotter text elements.
 *
 * Uses pre-extracted static glyph data (hershey-font-data.json) so this module
 * is safe to import in both server and client contexts — no Node.js 'fs' dependency.
 *
 * Hershey coordinate system: character height = 21 units.
 * Scale factor: sizeMm / 21
 *
 * Requirements: 8.3, 8.4, 8.5, 8.6, 8.8, 8.10
 */

import fontData from "./hershey-font-data.json";

// ─── Types ────────────────────────────────────────────────────────────────────

export type HersheyFontName = "sans" | "script" | "gothic" | "block" | "simplex";

export interface TextRenderResult {
  svgPaths: string[];                             // one SVG <path> string per glyph (× passes)
  boundingBox: { width: number; height: number }; // mm
  unsupportedChars: string[];                     // characters not found in the font
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface GlyphData {
  width: number;
  d: string | null;
}

type FontGlyphs = Record<string, GlyphData>;
type FontDataMap = Record<string, FontGlyphs>;

// ─── Constants ────────────────────────────────────────────────────────────────

const HERSHEY_HEIGHT = 21;   // font coordinate system height in units
const PASS_OFFSET_MM = 0.3;  // mm offset per additional pass

// ─── SVG Path Helpers ─────────────────────────────────────────────────────────

/**
 * Scale and translate an SVG path `d` string.
 * Applies: x' = (x * scale) + tx,  y' = (y * scale) + ty
 *
 * Hershey `d` strings use only M and L commands with integer coordinates,
 * e.g. "M9,1 L1,22 M9,1 L17,22 M4,15 L14,15"
 */
function transformPathD(d: string, scale: number, tx: number, ty: number): string {
  return d.replace(/([ML])\s*([-\d.]+),([-\d.]+)/g, (_match, cmd, xs, ys) => {
    const x = parseFloat(xs) * scale + tx;
    const y = parseFloat(ys) * scale + ty;
    return `${cmd} ${x.toFixed(3)},${y.toFixed(3)}`;
  });
}

function svgPathElement(d: string): string {
  return `<path d="${d}" stroke="black" fill="none" stroke-width="0.3"/>`;
}

// ─── Main Renderer ────────────────────────────────────────────────────────────

/**
 * Render a text string using the specified Hershey font.
 *
 * @param text     - The string to render
 * @param font     - One of the five supported font names
 * @param sizeMm   - Character height in mm (4–50)
 * @param passes   - Stroke-pass count (1–5); each additional pass is offset by 0.3mm in Y
 * @returns TextRenderResult with svgPaths, boundingBox, and unsupportedChars
 */
export function renderText(
  text: string,
  font: HersheyFontName,
  sizeMm: number,
  passes: number
): TextRenderResult {
  const glyphs = (fontData as FontDataMap)[font] ?? {};
  const scale = sizeMm / HERSHEY_HEIGHT;
  const svgPaths: string[] = [];
  const unsupportedChars: string[] = [];

  let cursorX = 0; // cumulative advance in mm

  for (const char of text) {
    // Handle space character
    if (char === " ") {
      const spaceGlyph = glyphs[" "];
      cursorX += (spaceGlyph?.width ?? 6) * scale;
      continue;
    }

    const glyph = glyphs[char];

    if (!glyph || !glyph.d) {
      // Character not in font
      if (!unsupportedChars.includes(char)) {
        unsupportedChars.push(char);
      }
      continue;
    }

    // Emit one path per pass
    for (let pass = 0; pass < passes; pass++) {
      const yOffset = pass * PASS_OFFSET_MM;
      const transformedD = transformPathD(glyph.d, scale, cursorX, yOffset);
      svgPaths.push(svgPathElement(transformedD));
    }

    // Advance cursor by glyph width
    cursorX += glyph.width * scale;
  }

  return {
    svgPaths,
    boundingBox: { width: cursorX, height: sizeMm },
    unsupportedChars,
  };
}
