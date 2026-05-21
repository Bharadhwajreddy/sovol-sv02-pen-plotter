const h = require('hersheytext');

// Check the font names we need to map
// sans -> futural (Sans 1-stroke)
// script -> scripts (Script 1-stroke)
// gothic -> gothiceng (Gothic English)
// block -> futuram (Sans medium)
// simplex -> futural (same as sans, or maybe timesr?)

// Let's check each font's name
const fontNames = ['futural', 'futuram', 'gothiceng', 'scripts', 'scriptc', 'timesr', 'timesrb'];
for (const name of fontNames) {
  const font = h.getFontData(name);
  console.log(`${name}: ${font.info['font-family']}, units-per-em: ${font.info['units-per-em']}, horiz-adv-x: ${font.info['horiz-adv-x']}`);
}

// Check SVG fonts
const svgFontNames = ['hershey_sans_1', 'hershey_sans_med', 'hershey_script_1', 'hershey_script_med', 'hershey_goth_english'];
for (const name of svgFontNames) {
  const font = h.getFontData(name);
  console.log(`SVG ${name}: type=${font.type}, info=${JSON.stringify(font.info)}`);
  const charA = font.getChar('A');
  console.log(`  Char A: ${JSON.stringify(charA)}`);
}

// Check the path data format for a hershey font
const font = h.getFontData('futural');
const charA = font.getChar('A');
console.log('\nfutural A path data:', charA.d);
console.log('futural A width:', charA.width);

// Check space character handling
const charSpace = font.getChar(' ');
console.log('Space char:', charSpace);
// Space is at index 0 (charCode 32 - 33 = -1), so it's null
// The horiz-adv-x is the space width
console.log('horiz-adv-x (space width):', font.info['horiz-adv-x']);
