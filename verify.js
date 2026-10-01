#!/usr/bin/env node
/**
 * 真实浏览器验收脚本（需要 `npm run dev` 或 `npm start` 已在运行）。
 *
 *   node verify.js [url]
 *
 * 检查项：
 *   1. 页面无 JS 报错 / 无控制台 error
 *   2. images.json 里每张图都生成了 canvas，且 canvas 上确实画出了粒子
 *   3. 鼠标悬停 -> 粒子偏离原位（散开）；鼠标移开 -> 粒子回到原位（重聚）
 *   4. 桌面 / 移动两种视口都不横向溢出
 * 另外会在 screenshots/ 下输出截图，便于人工确认。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const URL = process.argv[2] || 'http://127.0.0.1:5173/';
const SHOT_DIR = path.join(__dirname, 'screenshots', 'verify');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 读取第一张卡片的粒子位移统计。
 * 相对原位(targetX/targetY)的偏离量：mean 反映整体，nearMean 只看光标附近的粒子
 * —— 悬停只会显著推开光标周围的粒子，用全局平均会被远处粒子稀释掉。
 */
async function measure(page) {
  return page.evaluate(() => {
    const cards = window.particleGallery?.getCards?.() || [];
    if (!cards.length) return null;
    const instance = cards[0].instance;
    const particles = instance.getParticles();
    if (!particles.length) return null;
    const mouse = instance.mouse;

    const disp = particles.map((p) => Math.hypot(p.x - p.targetX, p.y - p.targetY));
    const sorted = [...disp].sort((a, b) => a - b);
    const sum = disp.reduce((a, b) => a + b, 0);
    const near = [];
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (Math.hypot(p.targetX - mouse.x, p.targetY - mouse.y) < 120) near.push(disp[i]);
    }
    return {
      count: particles.length,
      mean: sum / disp.length,
      p95: sorted[Math.floor(sorted.length * 0.95)],
      max: sorted[sorted.length - 1],
      movedRatio: disp.filter((d) => d > 8).length / disp.length,
      nearCount: near.length,
      nearMean: near.length ? near.reduce((a, b) => a + b, 0) / near.length : 0,
      mouseActive: mouse.active,
    };
  });
}

/** 等粒子收敛到静止（先等够入场/重建的动画时间，再看两次测量是否几乎不变） */
async function settle(page, tries = 24) {
  let prev = null;
  for (let i = 0; i < tries; i++) {
    const now = await measure(page);
    if (i >= 10 && prev && Math.abs(prev.mean - now.mean) < 0.2) return now;
    prev = now;
    await sleep(300);
  }
  return prev;
}

/** 等页面的自动降密跑完（qualitySteps 连续稳定） */
async function waitForTuning(page) {
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 40 && stable < 3; i++) {
    const steps = await page.evaluate(() => window.particleGallery.getQualitySteps());
    if (steps === last) stable++;
    else {
      stable = 0;
      last = steps;
    }
    await sleep(500);
  }
}

/** 采样 1.5s 的 requestAnimationFrame 帧率 */
/** 采样 requestAnimationFrame 帧率；取两次里较好的一次，避免容器偶发卡顿误判 */
async function measureFps(page, ms = 1800, rounds = 2) {
  let best = 0;
  for (let i = 0; i < rounds; i++) {
    const fps = await page.evaluate(
      (duration) =>
        new Promise((resolve) => {
          let frames = 0;
          const start = performance.now();
          const tick = () => {
            frames++;
            if (performance.now() - start < duration) requestAnimationFrame(tick);
            else resolve((frames * 1000) / (performance.now() - start));
          };
          requestAnimationFrame(tick);
        }),
      ms
    );
    best = Math.max(best, fps);
  }
  return Math.round(best);
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('requestfailed', (req) => consoleErrors.push(`请求失败 ${req.url()}: ${req.failure()?.errorText}`));

  const failures = [];
  const check = (label, ok, detail = '') => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures.push(label);
  };

  console.log(`\n[1/5] 打开 ${URL}`);
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });

  const expected = await page.evaluate(async () => {
    const res = await fetch('images.json', { cache: 'no-store' });
    const data = await res.json();
    return Array.isArray(data) ? data.length : data.count;
  });
  console.log(`  images.json 声明 ${expected} 张图片`);

  await page.waitForFunction(
    (n) => (window.particleGallery?.getCards?.() || []).length >= n,
    expected,
    { timeout: 30000 }
  );
  // 等粒子完成初始化（图片解码 + getImageData）
  await page.waitForFunction(
    () => {
      const cards = window.particleGallery?.getCards?.() || [];
      return cards.length > 0 && cards.every((c) => c.instance.getParticleCount() > 0);
    },
    null,
    { timeout: 30000 }
  );
  await sleep(600);

  console.log('\n[2/8] 结构检查');
  const structural = await page.evaluate(() => {
    const cards = window.particleGallery.getCards();
    return cards.map((c) => {
      const canvas = c.instance.canvas;
      const rect = canvas.getBoundingClientRect();
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0;
      const step = 4 * 17; // 抽样，避免遍历全部像素
      for (let i = 3; i < data.length; i += step) if (data[i] > 0) painted++;
      return {
        name: c.item.name,
        particles: c.instance.getParticleCount(),
        w: canvas.width,
        h: canvas.height,
        cssW: Math.round(rect.width),
        cssH: Math.round(rect.height),
        paintedSamples: painted,
        aspect: +(c.item.name ? (canvas.width / canvas.height).toFixed(3) : 0),
      };
    });
  });
  for (const s of structural) {
    console.log(
      `  · ${s.name}: canvas ${s.w}×${s.h} (显示 ${s.cssW}×${s.cssH}), ${s.particles} 粒子, 采样命中 ${s.paintedSamples}`
    );
  }
  check('卡片数量与 images.json 一致', structural.length === expected, `${structural.length}/${expected}`);
  check(
    '每张卡片都有粒子',
    structural.every((s) => s.particles > 500)
  );
  check(
    'canvas 上确实绘制了粒子',
    structural.every((s) => s.paintedSamples > 200)
  );
  check(
    'canvas 未被 CSS 拉伸变形',
    structural.every((s) => Math.abs(s.cssW / s.cssH - s.w / s.h) < 0.06)
  );

  console.log('\n[3/8] 交互检查：悬停散开 / 移开重聚');

  // 先等页面的自动降密跑完，否则基线测量会和重建粒子打架
  await waitForTuning(page);

  const idle = await settle(page);
  console.log(
    `  静止基线：mean=${idle.mean.toFixed(2)} p95=${idle.p95.toFixed(2)} 光标附近(${idle.nearCount})mean=${idle.nearMean.toFixed(2)}`
  );

  const box = await page.evaluate(() => {
    const canvas = window.particleGallery.getCards()[0].instance.canvas;
    const r = canvas.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;

  // 模拟真实悬停：光标在卡片内小幅移动后停在中心
  for (const [dx, dy] of [
    [-40, -30],
    [30, -10],
    [0, 20],
    [0, 0],
  ]) {
    await page.mouse.move(cx + dx, cy + dy);
    await sleep(120);
  }
  await sleep(900);
  const hovered = await measure(page);
  const animatingDuringHover = await page.evaluate(() => window.particleGallery.getAnimating());
  console.log(
    `  悬停中  ：mean=${hovered.mean.toFixed(2)} p95=${hovered.p95.toFixed(2)} max=${hovered.max.toFixed(2)} 光标附近mean=${hovered.nearMean.toFixed(2)} 位移>8px占比=${(hovered.movedRatio * 100).toFixed(1)}% (mouseActive=${hovered.mouseActive}, 动画中=${animatingDuringHover} 张)`
  );

  await page.screenshot({ path: path.join(SHOT_DIR, 'desktop-hover.png'), fullPage: false });

  // 悬停中（稳态只有被悬停的这张在动画）
  const fpsHover = await measureFps(page, 1800);

  // 对照：把所有卡片都强制唤醒，模拟"没有按需动画优化"的情况
  await page.evaluate(() =>
    window.particleGallery.getCards().forEach((c) => c.instance.startAnimation())
  );
  const fpsAll = await measureFps(page, 1800);
  await page.evaluate(() =>
    window.particleGallery
      .getCards()
      .forEach((c) => {
        if (!c.hovered) c.instance.stopAnimation();
      })
  );

  // 移到页面左上角，触发 canvas 的 mouseleave；等它自动停帧后再测
  await page.mouse.move(5, 5);
  let slept = false;
  for (let i = 0; i < 20; i++) {
    if ((await page.evaluate(() => window.particleGallery.getAnimating())) === 0) {
      slept = true;
      break;
    }
    await sleep(300);
  }
  await sleep(400);
  const returned = await measure(page);
  console.log(
    `  移开后  ：mean=${returned.mean.toFixed(2)} p95=${returned.p95.toFixed(2)} 光标附近mean=${returned.nearMean.toFixed(2)}（已自动停帧=${slept}）`
  );

  const perf = await page.evaluate(() => ({
    steps: window.particleGallery.getQualitySteps(),
    concurrent: window.particleGallery.getConcurrent(),
    animating: window.particleGallery.getAnimating(),
    total: window.particleGallery
      .getCards()
      .reduce((s, c) => s + c.instance.getParticleCount(), 0),
    count: document.getElementById('count').textContent,
  }));
  console.log(
    `  性能：悬停时动画 ${animatingDuringHover} 张卡片、共 ${perf.total} 粒子，自动降密 ${perf.steps} 档`
  );
  console.log(`  帧率：按需动画 ${fpsHover} fps vs 全部卡片一起动 ${fpsAll} fps`);
  console.log(
    `  空闲：鼠标移开后动画中 ${perf.animating} 张（应为 0，即空闲不耗 CPU）`
  );
  console.log(`  状态栏文案：${perf.count}`);

  check('悬停时 mouse.active 为 true', hovered.mouseActive === true);
  check('悬停时只有被悬停的卡片在动画', animatingDuringHover === 1, `${animatingDuringHover} 张`);
  check('空闲时全部停帧', perf.animating === 0, `${perf.animating} 张`);
  check('移开后卡片自动停帧', slept === true);
  check(
    '悬停时光标附近粒子明显被推开',
    hovered.nearMean > Math.max(idle.nearMean * 2, idle.nearMean + 12),
    `nearMean ${idle.nearMean.toFixed(2)} -> ${hovered.nearMean.toFixed(2)}`
  );
  check(
    '悬停时出现成片位移的粒子',
    hovered.movedRatio > idle.movedRatio + 0.02,
    `位移>8px 占比 ${(idle.movedRatio * 100).toFixed(1)}% -> ${(hovered.movedRatio * 100).toFixed(1)}%`
  );
  check(
    '移开后粒子重新聚合',
    returned.mean < Math.max(idle.mean * 1.5, idle.mean + 1) &&
      returned.nearMean < hovered.nearMean * 0.35,
    `nearMean ${hovered.nearMean.toFixed(2)} -> ${returned.nearMean.toFixed(2)}, mean ${idle.mean.toFixed(2)} -> ${returned.mean.toFixed(2)}`
  );
  // 注意：这台容器跑在手机里、且无 GPU（纯软件光栅化），绝对帧率受整机负载影响很大，
  // 所以用"相对提速"作为可靠判据，另加一个很低的绝对下限兜底。
  check(
    '按需动画带来明显提速（悬停 vs 全部卡片）',
    fpsHover > fpsAll * 1.4,
    `${fpsAll} fps -> ${fpsHover} fps`
  );
  check('悬停帧率不低于 15fps（软件光栅化下限）', fpsHover >= 15, `${fpsHover} fps`);

  console.log('\n[4/8] 刷新按钮');
  await page.click('#refresh');
  await page.waitForFunction(
    () => (window.particleGallery?.getCards?.() || []).length > 0,
    null,
    { timeout: 30000 }
  );
  await sleep(800);
  const afterRefresh = await measure(page);
  check('刷新后仍能正常重建粒子', !!afterRefresh && afterRefresh.count > 500, `${afterRefresh?.count} 粒子`);

  await page.screenshot({ path: path.join(SHOT_DIR, 'desktop.png'), fullPage: true });

  console.log('\n[4b/8] 参数面板与实时调参');
  const panel = await page.evaluate(() => {
    const el = document.getElementById('controls');
    return { hidden: el.hidden, visible: el.getBoundingClientRect().height > 0 };
  });
  check('参数面板默认收起', panel.hidden && !panel.visible, JSON.stringify(panel));

  await page.click('#controls-toggle');
  await sleep(200);
  const opened = await page.evaluate(() => {
    const el = document.getElementById('controls');
    return { visible: el.getBoundingClientRect().height > 0, expanded: document.getElementById('controls-toggle').getAttribute('aria-expanded') };
  });
  check('点「参数」后面板展开', opened.visible && opened.expanded === 'true', JSON.stringify(opened));

  // 拖动散开力度，确认参数真的写进了实例
  await page.evaluate(() => {
    const el = document.getElementById('force');
    el.value = '120';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);
  const tuned = await page.evaluate(() => ({
    param: window.particleGallery.params.force,
    applied: window.particleGallery.getCards()[0].instance.getConfig().mouseForce,
    label: document.querySelector('[data-out="force"]').textContent,
  }));
  check('拖动滑块会实时改到粒子引擎', tuned.param === 120 && tuned.applied === 120, JSON.stringify(tuned));

  await page.click('#reset');
  await sleep(300);
  const reset = await page.evaluate(() => ({
    param: window.particleGallery.params.force,
    applied: window.particleGallery.getCards()[0].instance.getConfig().mouseForce,
  }));
  check('「恢复默认」回到默认参数', reset.param === 55 && reset.applied === 55, JSON.stringify(reset));

  await page.click('#controls-toggle');
  await sleep(200);

  console.log('\n[5/8] 移动端视口 (390×844)');
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(URL, { waitUntil: 'load' });
  await mobile.waitForFunction(
    () => {
      const cards = window.particleGallery?.getCards?.() || [];
      return cards.length > 0 && cards.every((c) => c.instance.getParticleCount() > 0);
    },
    null,
    { timeout: 30000 }
  );
  await sleep(500);
  await waitForTuning(mobile);
  await sleep(400);
  const layout = await mobile.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    cols: getComputedStyle(document.getElementById('gallery')).gridTemplateColumns.split(' ').length,
    particles: window.particleGallery.getCards()[0].instance.getParticleCount(),
  }));
  console.log(
    `  scrollWidth=${layout.scrollWidth} innerWidth=${layout.innerWidth} 列数=${layout.cols} 首卡粒子=${layout.particles}`
  );
  check('移动端无横向溢出', layout.scrollWidth <= layout.innerWidth + 1);
  check('移动端为单列布局', layout.cols === 1);
  check('移动端粒子数已自动下调', layout.particles > 300 && layout.particles < 6000);
  await mobile.screenshot({ path: path.join(SHOT_DIR, 'mobile.png'), fullPage: true });
  await mobile.close(); // 后面还有重活，先把这一页关掉省 CPU

  /* ---------------- 图片管理（新增的核心能力） ---------------- */

  const desktop = page;

  console.log('\n[6/8] 图片管理：上传');
  await desktop.click('#images-toggle');
  await sleep(250);
  const panelState = await desktop.evaluate(() => {
    const el = document.getElementById('images-panel');
    return {
      visible: el.getBoundingClientRect().height > 0,
      thumbs: document.querySelectorAll('#thumbs .thumb').length,
      delButtons: document.querySelectorAll('#thumbs .thumb-del').length,
    };
  });
  check(
    '「图片」面板展开并列出全部内置图片',
    panelState.visible && panelState.thumbs === expected,
    JSON.stringify(panelState)
  );
  check('内置图片没有删除按钮', panelState.delButtons === 0, `${panelState.delButtons} 个`);

  const before = await desktop.evaluate(() => window.particleGallery.getItems().length);
  await desktop.setInputFiles('#file-input', [
    path.join(__dirname, 'tests', 'fixtures', 'upload-alpha.png'),
    path.join(__dirname, 'tests', 'fixtures', 'upload-beta.png'),
  ]);
  await desktop.waitForFunction((n) => window.particleGallery.getItems().length === n, before + 2, {
    timeout: 30000,
  });
  await desktop.waitForFunction(
    (n) => {
      const cards = window.particleGallery.getCards();
      return cards.length === n && cards.every((c) => c.instance.getParticleCount() > 0);
    },
    before + 2,
    { timeout: 30000 }
  );
  await sleep(500);

  const uploaded = await desktop.evaluate(() => ({
    items: window.particleGallery.getItems().length,
    uploads: window.particleGallery.getItems().filter((i) => i.source === 'upload').length,
    cards: window.particleGallery.getCards().length,
    thumbs: document.querySelectorAll('#thumbs .thumb').length,
    delButtons: document.querySelectorAll('#thumbs .thumb-del').length,
    flags: document.querySelectorAll('.card .card-flag').length,
    blobSrc: window.particleGallery
      .getItems()
      .every((i) => i.source !== 'upload' || i.src.startsWith('blob:')),
    countText: document.getElementById('count').textContent,
  }));
  console.log(
    `  上传后：items=${uploaded.items} 上传=${uploaded.uploads} 卡片=${uploaded.cards} 缩略图=${uploaded.thumbs}`
  );
  console.log(`  状态栏：${uploaded.countText}`);
  check('上传 2 张后总数正确', uploaded.items === before + 2 && uploaded.uploads === 2);
  check('上传的图片都渲染成了卡片', uploaded.cards === before + 2);
  check('缩略图与图片数量一致', uploaded.thumbs === before + 2);
  check('只有上传的图片可删除', uploaded.delButtons === 2, `${uploaded.delButtons} 个`);
  check('上传卡片带「我的」角标', uploaded.flags === 2, `${uploaded.flags} 个`);
  check('上传图片用的是 blob URL（不经过服务器）', uploaded.blobSrc === true);
  check('状态栏体现了上传数量', /我上传的 2 张/.test(uploaded.countText), uploaded.countText);

  console.log('\n[6b/8] 刷新页面后上传的图片还在（IndexedDB 持久化）');
  await desktop.reload({ waitUntil: 'load' });
  await desktop.waitForFunction(
    (n) => {
      const cards = window.particleGallery?.getCards?.() || [];
      return cards.length === n && cards.every((c) => c.instance.getParticleCount() > 0);
    },
    before + 2,
    { timeout: 40000 }
  );
  const persisted = await desktop.evaluate(() => ({
    uploads: window.particleGallery.getItems().filter((i) => i.source === 'upload').length,
  }));
  check('重载后 2 张上传图片仍在', persisted.uploads === 2, JSON.stringify(persisted));

  console.log('\n[7/8] 大图查看与左右切换');
  await desktop.locator('.card-open').first().click();
  await desktop.waitForSelector('#lightbox:not([hidden])', { timeout: 10000 });
  await desktop.waitForFunction(
    () => {
      const canvas = document.querySelector('#lightbox .lb-canvas canvas');
      return !!canvas && canvas.width > 0;
    },
    null,
    { timeout: 30000 }
  );
  await sleep(400);

  const lbFirst = await desktop.evaluate(() => ({
    name: document.querySelector('.lb-name').textContent,
    counter: document.querySelector('.lb-counter').textContent,
    thumbs: document.querySelectorAll('.lb-thumb').length,
    particles: window.particleGallery.getLightbox().getInstance()?.getParticleCount() ?? 0,
    canvasW: document.querySelector('#lightbox .lb-canvas canvas').width,
  }));
  console.log(
    `  打开：${lbFirst.name} ${lbFirst.counter}，粒子 ${lbFirst.particles}，canvas ${lbFirst.canvasW}px`
  );
  check('点卡片能打开大图', lbFirst.counter === `1 / ${before + 2}`, lbFirst.counter);
  check('大图粒子已生成', lbFirst.particles > 1000, `${lbFirst.particles} 粒子`);
  check('大图用更高清的一档（边长 > 480）', lbFirst.canvasW > 480, `${lbFirst.canvasW}px`);
  check('缩略图条列出了全部图片', lbFirst.thumbs === before + 2, `${lbFirst.thumbs} 张`);

  await desktop.keyboard.press('ArrowRight');
  await desktop.waitForFunction(
    (n) => document.querySelector('.lb-counter').textContent === `2 / ${n}`,
    before + 2,
    { timeout: 10000 }
  );
  await desktop.waitForFunction(
    () => {
      const canvas = document.querySelector('#lightbox .lb-canvas canvas');
      return !!canvas && canvas.width > 0;
    },
    null,
    { timeout: 20000 }
  );
  await sleep(300);
  const lbSecond = await desktop.evaluate(() => ({
    counter: document.querySelector('.lb-counter').textContent,
    particles: window.particleGallery.getLightbox().getInstance()?.getParticleCount() ?? 0,
  }));
  check(
    '按 → 切到下一张并重建粒子',
    lbSecond.counter === `2 / ${before + 2}` && lbSecond.particles > 1000,
    JSON.stringify(lbSecond)
  );

  await desktop.locator('.lb-thumb').last().click();
  await desktop.waitForFunction(
    (n) => document.querySelector('.lb-counter').textContent === `${n} / ${n}`,
    before + 2,
    { timeout: 10000 }
  );
  const lbLast = await desktop.evaluate(() => document.querySelector('.lb-counter').textContent);
  check('点缩略图可直接跳到任意一张', lbLast === `${before + 2} / ${before + 2}`, lbLast);

  await desktop.keyboard.press('Escape');
  await sleep(300);
  const closed = await desktop.evaluate(() => document.getElementById('lightbox').hidden);
  check('Esc 能关闭大图', closed === true);

  console.log('\n[8/8] 删除与清空');
  await desktop.click('#images-toggle'); // 重载后面板是收起的
  await sleep(250);
  await desktop.locator('#thumbs .thumb:has(.thumb-del)').first().locator('.thumb-del').click();
  await desktop.waitForFunction((n) => window.particleGallery.getItems().length === n, before + 1, {
    timeout: 30000,
  });
  await desktop.waitForFunction((n) => window.particleGallery.getCards().length === n, before + 1, {
    timeout: 30000,
  });
  const afterDelete = await desktop.evaluate(() => ({
    uploads: window.particleGallery.getItems().filter((i) => i.source === 'upload').length,
    cards: window.particleGallery.getCards().length,
  }));
  check(
    '删除单张后计数立刻更新',
    afterDelete.uploads === 1 && afterDelete.cards === before + 1,
    JSON.stringify(afterDelete)
  );

  desktop.on('dialog', (dialog) => dialog.accept());
  await desktop.click('#clear-uploads');
  await desktop.waitForFunction(
    () => window.particleGallery.getItems().every((i) => i.source === 'builtin'),
    null,
    { timeout: 30000 }
  );
  // 清空会重建整个画廊，等卡片真的挂载完再断言
  await desktop.waitForFunction((n) => window.particleGallery.getCards().length === n, expected, {
    timeout: 40000,
  });
  await sleep(300);
  const afterClear = await desktop.evaluate(() => ({
    items: window.particleGallery.getItems().length,
    cards: window.particleGallery.getCards().length,
    delButtons: document.querySelectorAll('#thumbs .thumb-del').length,
  }));
  check(
    '清空后只剩内置图片',
    afterClear.items === expected && afterClear.cards === expected,
    JSON.stringify(afterClear)
  );
  check('清空后没有可删除项', afterClear.delButtons === 0);

  await desktop.reload({ waitUntil: 'load' });
  await desktop.waitForFunction(
    (n) => (window.particleGallery?.getCards?.() || []).length === n,
    expected,
    { timeout: 40000 }
  );
  const afterClearReload = await desktop.evaluate(() => window.particleGallery.getItems().length);
  check('删除是持久的（重载后不会复活）', afterClearReload === expected, `${afterClearReload} 张`);

  console.log('\n控制台检查');
  check('无 page error', pageErrors.length === 0, pageErrors.join(' | '));
  check('无 console error', consoleErrors.length === 0, consoleErrors.join(' | '));

  await browser.close();

  console.log(`\n截图已保存到 ${path.relative(process.cwd(), SHOT_DIR)}/`);
  if (failures.length) {
    console.log(`\n失败 ${failures.length} 项：\n - ${failures.join('\n - ')}\n`);
    process.exit(1);
  }
  console.log('\n全部检查通过 ✅\n');
}

main().catch((err) => {
  console.error('验收脚本异常：', err);
  process.exit(1);
});
