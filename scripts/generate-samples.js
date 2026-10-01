#!/usr/bin/env node
/**
 * 生成示例图片（纯 Node，无第三方依赖）。
 *
 * 用 zlib + 手写 PNG 编码器输出 4 张彩色占位图到 images/。
 * 粒子效果对「高对比 + 饱和色」的图片最友好，所以这些图都是渐变色块而非灰底文字。
 *
 * 用法: node scripts/generate-samples.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 640;
const OUT_DIR = path.join(__dirname, '..', 'images');

/* ---------------- 最小 PNG 编码器 ---------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** rgba: Uint8Array 长度 = w*h*4 */
function encodePNG(rgba, w, h) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    const rowStart = y * (w * 4 + 1);
    raw[rowStart] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, rowStart + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- 绘制工具 ---------------- */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;
const lerpColor = (c1, c2, t) => [
  mix(c1[0], c2[0], t),
  mix(c1[1], c2[1], t),
  mix(c1[2], c2[2], t),
];

function hsl2rgb(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** 加色混合一个带柔边的圆 */
function addDisc(buf, w, h, cx, cy, r, color, strength) {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d > 1) continue;
      const falloff = Math.pow(1 - d, 2) * strength;
      const i = (y * w + x) * 4;
      buf[i] = clamp(buf[i] + color[0] * falloff, 0, 255);
      buf[i + 1] = clamp(buf[i + 1] + color[1] * falloff, 0, 255);
      buf[i + 2] = clamp(buf[i + 2] + color[2] * falloff, 0, 255);
      buf[i + 3] = 255;
    }
  }
}

function newBuffer(w, h) {
  const buf = new Uint8Array(w * h * 4);
  for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
  return buf;
}

/* ---------------- 四张示例图 ---------------- */

/** 1. 极光：平滑多彩渐变 */
function aurora(w, h) {
  const buf = newBuffer(w, h);
  const c1 = [32, 8, 96];
  const c2 = [16, 200, 190];
  const c3 = [250, 90, 200];
  const c4 = [255, 214, 64];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      const wave = 0.5 + 0.5 * Math.sin(u * 6.0 + Math.sin(v * 4.0) * 2.0);
      const t = clamp(v * 0.7 + wave * 0.5, 0, 1);
      let col = lerpColor(c1, c2, t);
      col = lerpColor(col, c3, Math.pow(clamp(1 - v, 0, 1), 2) * wave * 0.8);
      col = lerpColor(col, c4, Math.pow(clamp(v - 0.6, 0, 1) / 0.4, 3) * wave);
      const i = (y * w + x) * 4;
      buf[i] = col[0];
      buf[i + 1] = col[1];
      buf[i + 2] = col[2];
    }
  }
  return buf;
}

/** 2. 气泡：深底 + 彩色光球（加色） */
function bubbles(w, h) {
  const buf = newBuffer(w, h);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 10;
    buf[i + 1] = 12;
    buf[i + 2] = 34;
  }
  // 固定随机数，保证每次生成结果一致
  let seed = 20240607;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let n = 0; n < 46; n++) {
    const hue = rnd();
    const color = hsl2rgb(hue, 0.85, 0.6);
    addDisc(
      buf,
      w,
      h,
      rnd() * w,
      rnd() * h,
      40 + rnd() * 110,
      color,
      0.7 + rnd() * 0.6
    );
  }
  return buf;
}

/** 3. 波浪：横向色带 + 正弦边缘 */
function waves(w, h) {
  const buf = newBuffer(w, h);
  const bands = 9;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const ripple = Math.sin(u * Math.PI * 3 + (y / h) * Math.PI * 4) * (h / bands) * 0.35;
      const band = Math.floor(((y + ripple) / h) * bands);
      const local = ((y + ripple) / h) * bands - band;
      const base = hsl2rgb(band / bands, 0.72, 0.5 + 0.12 * Math.sin(band));
      const edge = 1 - Math.abs(local - 0.5) * 2;
      const col = lerpColor(base, [255, 255, 255], Math.pow(edge, 6) * 0.55);
      const i = (y * w + x) * 4;
      buf[i] = col[0];
      buf[i + 1] = col[1];
      buf[i + 2] = col[2];
    }
  }
  return buf;
}

/** 4. 几何：菱形色块马赛克 */
function geometric(w, h) {
  const buf = newBuffer(w, h);
  const cell = w / 8;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = Math.floor(x / cell);
      const gy = Math.floor(y / cell);
      const fx = (x % cell) / cell;
      const fy = (y % cell) / cell;
      const d = Math.abs(fx - 0.5) + Math.abs(fy - 0.5);
      const inside = d < 0.5;
      const idx = gx + gy * 8;
      const base = hsl2rgb((idx * 0.0618 + gy * 0.07) % 1, 0.8, inside ? 0.56 : 0.16);
      const col = inside
        ? lerpColor(base, [255, 255, 255], (0.5 - d) * 0.5)
        : base;
      const i = (y * w + x) * 4;
      buf[i] = col[0];
      buf[i + 1] = col[1];
      buf[i + 2] = col[2];
    }
  }
  return buf;
}

/* ---------------- 输出 ---------------- */

const IMAGES = [
  ['aurora.png', aurora],
  ['bubbles.png', bubbles],
  ['waves.png', waves],
  ['geometric.png', geometric],
];

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [name, fn] of IMAGES) {
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, encodePNG(fn(SIZE, SIZE), SIZE, SIZE));
  console.log(`生成 ${path.relative(process.cwd(), file)} (${SIZE}x${SIZE})`);
}
console.log(`\n共 ${IMAGES.length} 张示例图片。`);
