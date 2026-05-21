/**
 * extract-hershey-fonts.js
 * Run once with: node scripts/extract-hershey-fonts.js
 * Extracts all glyph data from hersheytext into a static JSON file
 * so hershey-fonts.ts can import it without needing the 'fs' module.
 */

const h = require("hersheytext");
const fs = require("fs");
const path = require("path");

const FONT_MAP = {
  sans: "futural",
  script: "scripts",
  gothic: "gothiceng",
  block: "timesrb",
  simplex: "futuram",
};

// ASCII printable range: 33 (!) to 126 (~), plus space (32)
const CHARS = " " + Array.from({ length: 94 }, (_, i) => String.fromCharCode(i + 33)).join("");

const output = {};

for (const [logicalName, fontKey] of Object.entries(FONT_MAP)) {
  const fontData = h.getFontData(fontKey);
  output[logicalName] = {};

  for (const char of CHARS) {
    if (char === " ") {
      output[logicalName][" "] = { width: 6, d: null };
      continue;
    }
    const glyph = fontData.getChar(char);
    if (glyph && glyph.d) {
      output[logicalName][char] = { width: glyph.width, d: glyph.d };
    }
  }
}

const outPath = path.join(__dirname, "..", "lib", "hershey-font-data.json");
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`Written ${outPath}`);
console.log("Fonts:", Object.keys(output).join(", "));
for (const [name, glyphs] of Object.entries(output)) {
  console.log(`  ${name}: ${Object.keys(glyphs).length} glyphs`);
}
