// Copies non-TypeScript runtime assets into dist after tsc.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const assets = [
  ['src/main/ai/context/extraction-script.js', 'dist/main/ai/context/extraction-script.js'],
];

for (const [from, to] of assets) {
  const source = path.join(root, from);
  const target = path.join(root, to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  console.log(`copied ${from} -> ${to}`);
}
