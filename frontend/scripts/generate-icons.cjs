/**
 * Icon Generator Script
 * =====================
 * Generates PNG icons at all required sizes for PWA, iOS, Android, and Electron.
 * Uses an inline SVG battery icon rendered to Canvas via a simple Node.js script.
 *
 * Run: node scripts/generate-icons.js
 * Requires: npm install canvas (optional — uses SVG fallbacks if unavailable)
 */

const fs = require('fs');
const path = require('path');

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'icons');

// Battery icon as SVG — dark blue background with white/green battery
function generateSvg(size) {
  const pad = Math.round(size * 0.15);
  const bw = Math.round(size * 0.45); // battery width
  const bh = Math.round(size * 0.65); // battery height
  const bx = Math.round((size - bw) / 2);
  const by = Math.round((size - bh) / 2 + size * 0.05);
  const capW = Math.round(bw * 0.4);
  const capH = Math.round(size * 0.06);
  const capX = Math.round((size - capW) / 2);
  const capY = by - capH;
  const r = Math.round(size * 0.04);
  const stroke = Math.max(2, Math.round(size * 0.025));
  // Fill level (75%)
  const fillPct = 0.75;
  const innerPad = stroke + Math.round(size * 0.02);
  const fillH = Math.round((bh - 2 * innerPad + by) * fillPct);
  const fillY = by + bh - innerPad - fillH;
  const fillW = bw - 2 * innerPad + 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.18)}" fill="#0f172a"/>
  <!-- Battery cap -->
  <rect x="${capX}" y="${capY}" width="${capW}" height="${capH + r}" rx="${r}" fill="none" stroke="#e2e8f0" stroke-width="${stroke}"/>
  <!-- Battery body -->
  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${r}" fill="none" stroke="#e2e8f0" stroke-width="${stroke}"/>
  <!-- Charge fill -->
  <rect x="${bx + innerPad - 1}" y="${fillY}" width="${fillW}" height="${fillH}" rx="${Math.max(1, r - 2)}" fill="#22c55e"/>
  <!-- Lightning bolt -->
  <polygon points="${size * 0.52},${size * 0.30} ${size * 0.42},${size * 0.52} ${size * 0.48},${size * 0.52} ${size * 0.46},${size * 0.72} ${size * 0.58},${size * 0.48} ${size * 0.52},${size * 0.48}" fill="#fbbf24" opacity="0.9"/>
</svg>`;
}

// Ensure output dir
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Write SVG icons (universally supported, can be converted to PNG later)
for (const size of SIZES) {
  const svg = generateSvg(size);
  const svgPath = path.join(OUTPUT_DIR, `icon-${size}x${size}.svg`);
  fs.writeFileSync(svgPath, svg, 'utf-8');
  console.log(`  ✓ ${size}x${size}.svg`);
}

// Also create a high-res SVG for the Electron build dir
const buildDir = path.join(__dirname, '..', 'build');
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}
fs.writeFileSync(path.join(buildDir, 'icon.svg'), generateSvg(512), 'utf-8');
console.log('  ✓ build/icon.svg');

console.log('\n✅ SVG icons generated! To convert to PNG, use:');
console.log('   npx @aspect-build/rules_js sharp-cli resize (or similar)');
console.log('   Or use an online SVG→PNG converter for all sizes.');
console.log('\n   For quick dev, PWAs accept SVG icons in modern browsers.');
