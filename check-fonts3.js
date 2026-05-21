const h = require('hersheytext');

// Check the coordinate range for futural characters
const font = h.getFontData('futural');

// Check several characters to understand coordinate system
const chars = ['A', 'B', 'H', 'a', 'g', 'p'];
for (const c of chars) {
  const ch = font.getChar(c);
  if (ch) {
    console.log(`${c}: width=${ch.width}, d="${ch.d}"`);
  }
}

// Check the multiplier used in renderTextSVG
// The source says: const multiplyer = font.type === 'svg' ? 1 : 1.68;
// And offset.left += (char.width * multiplyer) + options.charSpacingAdjust;
// So advance width = char.width * 1.68

// Let's understand the coordinate system:
// Looking at 'A': M9,1 L1,22 M9,1 L17,22 M4,15 L14,15
// Y range: 1 to 22 -> height = 21 units (matches design doc!)
// The design says scale = sizeMm / 21

// Check what the path data looks like - is it "M x,y L x,y" format?
const charA = font.getChar('A');
console.log('\nA path:', charA.d);
// Parse the path
const parts = charA.d.split(' ');
console.log('Parts:', parts);

// Check a lowercase letter
const charLow = font.getChar('a');
if (charLow) console.log('\na path:', charLow.d);

// Check the width values
console.log('\nWidth values for A-Z:');
for (let i = 65; i <= 90; i++) {
  const ch = font.getChar(String.fromCharCode(i));
  if (ch) process.stdout.write(`${String.fromCharCode(i)}:${ch.width} `);
}
console.log();
