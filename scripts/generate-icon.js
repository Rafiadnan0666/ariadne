const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, '../build/icon.svg');
const icoPath = path.join(__dirname, '../build/icon.ico');

const sizes = [16, 24, 32, 48, 64, 128, 256];

async function generateIcon() {
  const svgBuffer = fs.readFileSync(svgPath);
  
  const pngBuffers = await Promise.all(
    sizes.map(size => 
      sharp(svgBuffer)
        .resize(size, size)
        .png()
        .toBuffer()
    )
  );

  // Create ICO file - simple approach: use the largest PNG as base
  // For a proper ICO, we'd need to write the ICO header and directory entries
  // For now, just save the 256x256 PNG as icon.png and let electron-builder handle it
  await sharp(svgBuffer)
    .resize(256, 256)
    .png()
    .toFile(path.join(__dirname, '../build/icon.png'));

  console.log('Generated icon.png');
}

generateIcon().catch(console.error);