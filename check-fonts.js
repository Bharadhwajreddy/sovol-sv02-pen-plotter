const h = require('hersheytext');
console.log('Available fonts:', Object.keys(h.fonts));
console.log('SVG fonts:', Object.keys(h.svgFonts));

// Check a sample character from futural (sans)
const font = h.getFontData('futural');
console.log('Font type:', font.type);
console.log('Font info:', font.info);
const charA = font.getChar('A');
console.log('Char A:', JSON.stringify(charA));
const charSpace = font.getChar(' ');
console.log('Char space:', JSON.stringify(charSpace));
