#!/usr/bin/env node
/**
 * 把 npm 包 package-particlefx 的浏览器版构建产物复制到 vendor/。
 *
 * 为什么需要：部署到静态托管（GitHub Pages / Netlify / Vercel …）时不会上传
 * node_modules，所以页面不能直接 import 里面那个路径。vendor/ 是提交进仓库的，
 * 这样整个项目文件夹就是一个自包含的静态站点。
 *
 * 用法: node scripts/vendor-lib.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PKG = 'package-particlefx';
const SRC = path.join(ROOT, 'node_modules', PKG, 'dist', `${PKG}.es.js`);
const OUT_DIR = path.join(ROOT, 'vendor');
const OUT = path.join(OUT_DIR, `${PKG}.es.js`);

if (!fs.existsSync(SRC)) {
  console.error(`找不到 ${path.relative(ROOT, SRC)}，请先运行 npm install。`);
  process.exit(1);
}

const version = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'node_modules', PKG, 'package.json'), 'utf8')
).version;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.copyFileSync(SRC, OUT);

const header = `/* ${PKG} v${version} — 由 scripts/vendor-lib.js 从 node_modules 复制而来，请勿手改。
 * 上游: https://github.com/Anmol-TheDev/package-particlefx (MIT) */\n`;
fs.writeFileSync(OUT, header + fs.readFileSync(OUT, 'utf8'));

console.log(`已复制 ${PKG} v${version} -> ${path.relative(ROOT, OUT)}`);
