#!/usr/bin/env node
/**
 * 扫描 images/ 目录，生成 images.json 图片列表。
 *
 * 用法: node generate-list.js
 * 支持格式: .jpg .jpeg .png .webp
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const IMAGES_DIR = path.join(ROOT, 'images');
const OUTPUT = path.join(ROOT, 'images.json');
const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function main() {
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    console.log(`已创建目录 ${path.relative(ROOT, IMAGES_DIR)}/（当前为空）`);
  }

  const files = fs
    .readdirSync(IMAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => EXTENSIONS.has(path.extname(name).toLowerCase()))
    // 自然排序：image2 排在 image10 之前
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' }));

  const list = files.map((file) => {
    const stat = fs.statSync(path.join(IMAGES_DIR, file));
    return {
      file,
      name: path.basename(file, path.extname(file)),
      src: `images/${encodeURIComponent(file)}`,
      bytes: stat.size,
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    count: list.length,
    images: list,
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  console.log(`已扫描 ${path.relative(ROOT, IMAGES_DIR)}/ -> ${path.relative(ROOT, OUTPUT)}`);
  if (list.length === 0) {
    console.log('  未找到图片。把 .jpg / .png / .webp 放进 images/ 后重新运行本脚本。');
  } else {
    for (const item of list) console.log(`  ✓ ${item.file} (${(item.bytes / 1024).toFixed(1)} KB)`);
    console.log(`共 ${list.length} 张。`);
  }
}

main();
