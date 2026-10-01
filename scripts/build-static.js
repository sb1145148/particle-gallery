#!/usr/bin/env node
/**
 * 打包成可直接上传的静态站点 -> dist/
 *
 * 只复制运行时真正需要的文件，天然排除 node_modules（粒子引擎已 vendor 进仓库），
 * 所以 dist/ 丢到 GitHub Pages / Netlify / Vercel / 任意静态服务器都能直接跑。
 *
 * 用法: node scripts/build-static.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

/** 需要一起发布的文件 / 目录 */
const ITEMS = [
  'index.html',
  'style.css',
  'main.js',
  'images.json',
  'js',
  'vendor',
  'images',
];

function rmrf(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function copy(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) copy(path.join(src, name), path.join(dest, name));
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function dirSize(target) {
  let total = 0;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

function main() {
  if (!fs.existsSync(path.join(ROOT, 'vendor', 'package-particlefx.es.js'))) {
    console.error('缺少 vendor/package-particlefx.es.js，请先运行：npm run vendor');
    process.exit(1);
  }
  if (!fs.existsSync(path.join(ROOT, 'images.json'))) {
    console.warn('提示：没有 images.json，页面会回退到示例图片列表。');
    console.warn('      想发布自己的图片，请先运行：node generate-list.js\n');
  }

  rmrf(OUT);
  fs.mkdirSync(OUT, { recursive: true });

  for (const item of ITEMS) {
    const src = path.join(ROOT, item);
    if (!fs.existsSync(src)) {
      console.warn(`跳过（不存在）：${item}`);
      continue;
    }
    copy(src, path.join(OUT, item));
    console.log(`  + ${item}`);
  }

  const kb = (dirSize(OUT) / 1024).toFixed(0);
  console.log(`\n打包完成 -> ${path.relative(ROOT, OUT)}/（${kb} KB）`);
  console.log('整个 dist/ 目录即可直接部署，例如：');
  console.log('  · GitHub Pages：把 dist/ 的内容推到仓库分支（或 docs/ 目录）');
  console.log('  · Netlify / Vercel：把 dist/ 拖进部署面板，或设为发布目录');
  console.log('  · 任意静态服务器：上传 dist/ 到网站根目录');
  console.log('  本地预览：npx serve -l 5173 dist   （或 python3 -m http.server 5173 -d dist）');
}

main();
