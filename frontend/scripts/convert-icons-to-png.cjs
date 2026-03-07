/**
 * Convert SVG icons to PNG at all required sizes
 * Run: node scripts/convert-icons-to-png.cjs
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');

async function convert() {
  for (const size of SIZES) {
    const svgPath = path.join(ICONS_DIR, `icon-${size}x${size}.svg`);
    const pngPath = path.join(ICONS_DIR, `icon-${size}x${size}.png`);

    if (!fs.existsSync(svgPath)) {
      console.log(`  ⚠ Missing ${svgPath}`);
      continue;
    }

    await sharp(svgPath)
      .resize(size, size)
      .png()
      .toFile(pngPath);

    console.log(`  ✓ ${size}x${size}.png`);
  }

  // Also create the Electron build icons
  const buildDir = path.join(__dirname, '..', 'build');
  const svg512 = path.join(ICONS_DIR, 'icon-512x512.svg');

  // icon.png for Electron (256x256)
  await sharp(svg512).resize(256, 256).png().toFile(path.join(buildDir, 'icon.png'));
  console.log('  ✓ build/icon.png (256x256)');

  // icon.ico (use 256x256 PNG — electron-builder can handle it)
  await sharp(svg512).resize(256, 256).png().toFile(path.join(buildDir, 'icon.ico.png'));
  console.log('  ✓ build/icon.ico.png (256x256 — rename to .ico or use electron-icon-builder)');

  // Create placeholder screenshot images
  await sharp({
    create: { width: 1280, height: 720, channels: 4, background: { r: 15, g: 23, b: 42, alpha: 1 } }
  }).png().toFile(path.join(ICONS_DIR, 'screenshot-wide.png'));
  console.log('  ✓ screenshot-wide.png (1280x720 placeholder)');

  await sharp({
    create: { width: 750, height: 1334, channels: 4, background: { r: 15, g: 23, b: 42, alpha: 1 } }
  }).png().toFile(path.join(ICONS_DIR, 'screenshot-narrow.png'));
  console.log('  ✓ screenshot-narrow.png (750x1334 placeholder)');

  console.log('\n✅ All PNG icons generated!');
}

convert().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
