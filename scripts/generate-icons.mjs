import sharp from "sharp";
import fs from "node:fs";

// Icona semplice del brand: sagoma del cane 🐶 in bianco su sfondo verde brand,
// con padding per restare leggibile anche mascherata (maskable) su Android e
// nel cerchio automatico di iOS. I motori SVG di questo ambiente renderizzano
// l'emoji come sagoma monocroma (nessun supporto colore), risultato voluto:
// un glifo semplice e ad alto contrasto è comunque un'icona pulita.
const BRAND = "#16a34a";

function svg(size, glyphScale) {
  const glyphSize = Math.round(size * glyphScale);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="${BRAND}"/>
    <text x="50%" y="50%" font-size="${glyphSize}" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">🐶</text>
  </svg>`;
}

const outDir = "public/icons";
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { file: "icon-192.png", size: 192, glyphScale: 0.6 },
  { file: "icon-512.png", size: 512, glyphScale: 0.6 },
  { file: "apple-touch-icon.png", size: 180, glyphScale: 0.62 },
  { file: "maskable-512.png", size: 512, glyphScale: 0.42 },
];

for (const t of targets) {
  await sharp(Buffer.from(svg(t.size, t.glyphScale)))
    .png()
    .toFile(`${outDir}/${t.file}`);
  console.log(`generated ${outDir}/${t.file}`);
}
