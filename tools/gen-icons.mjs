import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const png = (w, h, rgba) => {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * (w * 4 + 1) + 1 + x * 4;
      const j = (y * w + x) * 4;
      raw[i] = rgba[j];
      raw[i + 1] = rgba[j + 1];
      raw[i + 2] = rgba[j + 2];
      raw[i + 3] = rgba[j + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const S = 128;
const img = Buffer.alloc(S * S * 4);
const px = (x, y, r, g, b, a = 255) => {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  const m = Math.min(1, a);
  img[i] = Math.round(r * m + img[i] * (1 - m));
  img[i + 1] = Math.round(g * m + img[i + 1] * (1 - m));
  img[i + 2] = Math.round(b * m + img[i + 2] * (1 - m));
  img[i + 3] = Math.max(img[i + 3], a);
};
const inCircle = (x, y, cx, cy, r) => (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
const inRect = (x, y, x1, y1, x2, y2, rad = 8) => {
  const cx = Math.max(x1 + rad, Math.min(x, x2 - rad));
  const cy = Math.max(y1 + rad, Math.min(y, y2 - rad));
  return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= rad * rad || (x >= x1 && x <= x2 && y >= y1 && y <= y2);
};
const inEllipse = (x, y, cx, cy, rx, ry) => {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
};

const RUST = [154, 52, 18];
const CREAM = [254, 243, 199];

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    if (inCircle(x + 0.5, y + 0.5, 64, 64, 58)) px(x, y, RUST[0], RUST[1], RUST[2]);
  }
}

for (let y = 34; y <= 96; y++) {
  for (let x = 36; x <= 92; x++) {
    if (inRect(x + 0.5, y + 0.5, 36, 34, 92, 96, 8)) px(x, y, CREAM[0], CREAM[1], CREAM[2]);
  }
}

const ring = (cx, cy, rx, ry, w) => {
  for (let a = 0; a < 360; a++) {
    const rad = (a * Math.PI) / 180;
    const x = cx + rx * Math.cos(rad);
    const y = cy + ry * Math.sin(rad);
    for (let dx = -w; dx <= w; dx++) {
      for (let dy = -w; dy <= w; dy++) {
        const X = Math.round(x + dx);
        const Y = Math.round(y + dy);
        if (inEllipse(X + 0.5, Y + 0.5, cx, cy, rx + w, ry + w) && !inEllipse(X + 0.5, Y + 0.5, cx, cy, rx - w, ry - w)) {
          px(X, Y, RUST[0], RUST[1], RUST[2]);
        }
      }
    }
  }
};

ring(62, 46, 20, 26, 3);

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const [size, name] of [[16, 'icon16.png'], [48, 'icon48.png'], [128, 'icon128.png']]) {
  const scaled = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.min(S - 1, Math.floor((x * S) / size));
      const sy = Math.min(S - 1, Math.floor((y * S) / size));
      const si = (sy * S + sx) * 4;
      const di = (y * size + x) * 4;
      scaled[di] = img[si];
      scaled[di + 1] = img[si + 1];
      scaled[di + 2] = img[si + 2];
      scaled[di + 3] = img[si + 3];
    }
  }
  fs.writeFileSync(path.join(outDir, name), png(size, size, scaled));
  console.log('icon: ' + path.join(outDir, name));
}