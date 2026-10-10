// Generates the BNC Presentation app icon (a slide on a stand) as SVG, PNG and ICO.
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'build'), { recursive: true });
mkdirSync(join(root, 'public'), { recursive: true });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3fe0cd"/>
      <stop offset="1" stop-color="#0e6f93"/>
    </linearGradient>
    <linearGradient id="screen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#d4f3ee"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <!-- stand -->
  <rect x="238" y="352" width="36" height="52" fill="#0b4f6a" opacity=".55"/>
  <rect x="174" y="398" width="164" height="22" rx="11" fill="#0b4f6a" opacity=".55"/>
  <!-- screen -->
  <rect x="80" y="130" width="352" height="228" rx="26" fill="#0b4f6a" opacity=".45" transform="translate(0 12)"/>
  <rect x="80" y="118" width="352" height="228" rx="26" fill="url(#screen)"/>
  <!-- title lines -->
  <g stroke="#14a89a" stroke-linecap="round">
    <path d="M122 172h118" stroke-width="16"/>
    <path d="M122 214h90M122 248h108M122 282h70" stroke-width="12" opacity=".55"/>
  </g>
  <!-- bar chart -->
  <rect x="272" y="262" width="34" height="46" rx="7" fill="#14a89a" opacity=".6"/>
  <rect x="318" y="224" width="34" height="84" rx="7" fill="#14a89a"/>
  <rect x="364" y="176" width="34" height="132" rx="7" fill="#ffcf5c"/>
</svg>`;

writeFileSync(join(root, 'build', 'icon.svg'), svg);
writeFileSync(join(root, 'public', 'icon.svg'), svg);

const png = (size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
writeFileSync(join(root, 'build', 'icon.png'), await png(512));
writeFileSync(join(root, 'public', 'icon.png'), await png(256));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const ico = await pngToIco(await Promise.all(sizes.map(png)));
writeFileSync(join(root, 'build', 'icon.ico'), ico);

// macOS icon (.icns): a small container of PNGs. Types: icp4=16, icp5=32, icp6=64, ic07=128, ic08=256, ic09=512, ic10=1024.
const icnsEntries = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
];
const chunks = [];
for (const [type, size] of icnsEntries) {
  const data = await png(size);
  const head = Buffer.alloc(8);
  head.write(type, 0, 'ascii');
  head.writeUInt32BE(8 + data.length, 4);
  chunks.push(head, data);
}
const body = Buffer.concat(chunks);
const icnsHead = Buffer.alloc(8);
icnsHead.write('icns', 0, 'ascii');
icnsHead.writeUInt32BE(8 + body.length, 4);
writeFileSync(join(root, 'build', 'icon.icns'), Buffer.concat([icnsHead, body]));

console.log('icons written to build/ and public/ (png, ico, icns)');
