/**
 * 粒子画廊 —— 主逻辑
 *
 * 图片来源有两路，在界面上直接管理，不需要改代码：
 *   1. 随项目部署的内置图片：images/ 目录 + images.json（generate-list.js 生成）
 *   2. 用户自己上传的图片：在页面里选文件 / 拖放 / 粘贴，存在浏览器 IndexedDB，刷新不丢
 *
 * 每张卡片 = 一个 package-particlefx 的 ParticleCanvas 实例：
 *   - 粒子颜色直接取自图片像素（库内部用 getImageData 采样）
 *   - 鼠标悬停 -> mouseForce 把粒子从光标推开
 *   - 鼠标移开 -> gravity 把粒子拉回原位（原图位置）
 *   - 点开卡片 -> 大图查看，左右键切换图片
 */

import { listUploads, addUploads, removeUpload, clearUploads, isMemoryOnly } from './js/storage.js';
import { createLightbox } from './js/lightbox.js';

/* vendor/ 里的副本随仓库提交，部署到静态托管时不需要 node_modules */
const LIB_URL = './vendor/package-particlefx.es.js';

/** images.json 缺失时的兜底列表（例如静态托管上忘了跑 generate-list.js） */
const FALLBACK_FILES = ['aurora.png', 'bubbles.png', 'geometric.png', 'waves.png'];

/** 默认参数。名称对应库的真实选项：
 *   force       -> mouseForce  散开力度
 *   returnSpeed -> gravity     回归速度
 *   noise       -> noise       随机抖动
 *   shape       -> particleShape
 *   density     -> 换算成 particleGap（密度越高 gap 越小、粒子越多） */
const DEFAULTS = {
  force: 55,
  returnSpeed: 0.12,
  noise: 2,
  density: 1,
  shape: 'circle',
};

const params = { ...DEFAULTS };

const els = {
  gallery: document.getElementById('gallery'),
  empty: document.getElementById('empty'),
  banner: document.getElementById('banner'),
  count: document.getElementById('count'),
  refresh: document.getElementById('refresh'),
  controls: document.getElementById('controls'),
  controlsToggle: document.getElementById('controls-toggle'),
  reset: document.getElementById('reset'),
  imagesPanel: document.getElementById('images-panel'),
  imagesToggle: document.getElementById('images-toggle'),
  thumbs: document.getElementById('thumbs'),
  fileInput: document.getElementById('file-input'),
  addButtons: [document.getElementById('add-images'), document.getElementById('add-images-2')],
  clearUploads: document.getElementById('clear-uploads'),
  storageNote: document.getElementById('storage-note'),
  dropzone: document.getElementById('dropzone'),
  lightboxRoot: document.getElementById('lightbox'),
};

/** 画廊当前展示的图片（内置 + 上传） */
let items = [];
let builtinItems = [];
let uploadItems = [];
/** 上传图片 id -> objectURL，全生命周期复用同一个 URL，避免反复创建 */
const uploadUrls = new Map();

/** 已创建的实例，刷新时统一销毁 */
let cards = [];
let createParticleCanvas = null;
let lightbox = null;
let loadToken = 0;
let resizeTimer = null;
/** 首屏布局下同屏的卡片数，用于分摊粒子预算 */
let concurrent = 1;
let manifestMissing = false;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* 性能预算：粒子数直接决定每帧开销（实测每粒子约 6~7µs）。
 * 让"同时动画的卡片"共享一份总预算，卡片多的时候自动变稀疏。 */
const TOTAL_BUDGET = { desktop: 14000, mobile: 6500 };
/** canvas 基准边长（图片过大会先等比缩到这个尺寸再采样） */
const MAX_SIDE = { desktop: 480, mobile: 380 };
/** 灯箱里同时只有一张 canvas，可以给更细的粒子 */
const LIGHTBOX_MAX_SIDE = 720;
const LIGHTBOX_BUDGET = 14000;

let bannerTimer = null;

function setBanner(message, kind = 'error') {
  clearTimeout(bannerTimer);
  if (!message) {
    els.banner.hidden = true;
    els.banner.textContent = '';
    els.banner.className = 'banner';
    return;
  }
  els.banner.hidden = false;
  els.banner.textContent = message;
  els.banner.className = `banner is-${kind}`;
  // 提示类消息过一会儿自动消失；报错留着，等用户处理
  if (kind === 'info') bannerTimer = setTimeout(() => setBanner(''), 6000);
}

/* ---------------- 参数计算 ---------------- */

function isNarrow() {
  return window.matchMedia('(max-width: 700px)').matches;
}

/**
 * 估算当前布局下同屏的卡片数量。
 * 网格是 auto-fill + minmax(280px, 1fr)，列数可由容器宽度推算；
 * 行数按卡片高宽（正方形画布 + 标题栏）估算，并计入 IntersectionObserver 的 120px 余量。
 */
function computeConcurrent(totalImages) {
  const galleryWidth = els.gallery.clientWidth || window.innerWidth;
  const gap = parseFloat(getComputedStyle(els.gallery).columnGap) || 14;
  const minColumn = 280;
  const columns = Math.max(1, Math.floor((galleryWidth + gap) / (minColumn + gap)));
  const cardWidth = (galleryWidth - (columns - 1) * gap) / columns;
  const cardHeight = Math.max(cardWidth + 44, 1);
  const rows = clamp(Math.ceil((window.innerHeight + 240) / cardHeight), 1, 4);
  const visible = columns * rows;
  return Math.max(1, Math.min(totalImages > 0 ? totalImages : visible, visible));
}

/**
 * 根据图片原始尺寸推算 canvas 尺寸与粒子间距。
 * 目标：图案看得清、粒子大小适中，同时把单卡粒子数压在一个帧率安全的范围内。
 */
function computePlan(naturalWidth, naturalHeight, override) {
  const narrow = isNarrow();
  const maxSide = override?.maxSide ?? (narrow ? MAX_SIDE.mobile : MAX_SIDE.desktop);
  let budget;
  if (override?.budget) {
    budget = override.budget * params.density;
  } else {
    // 稳态下同时动画的通常只有被悬停的那一张（最多再算上一张正在入场的），按 2 张分摊
    const animating = Math.min(concurrent, 2);
    budget = ((narrow ? TOTAL_BUDGET.mobile : TOTAL_BUDGET.desktop) / animating) * params.density;
  }

  const scale = Math.min(1, maxSide / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(2, Math.round(naturalWidth * scale));
  const height = Math.max(2, Math.round(naturalHeight * scale));

  // 间距越大粒子越大、数量越少（库中粒子尺寸 ≈ particleGap）
  const gap = clamp(Math.round(Math.sqrt((width * height) / budget)), 3, 14);
  const particleCount = Math.floor((width / gap) * (height / gap));

  return { width, height, gap, particleCount };
}

function baseOptions(plan, src) {
  return {
    imageSrc: src,
    width: plan.width,
    height: plan.height,
    particleGap: plan.gap,
    mouseForce: params.force,
    gravity: params.returnSpeed,
    noise: params.noise,
    particleShape: params.shape,
    // 点击画布时的额外冲击，保留库的默认手感
    clickStrength: 120,
  };
}

/* ---------------- 图片探测 ---------------- */

function probeImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({ ok: true, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ ok: false, width: 0, height: 0 });
    img.src = src;
  });
}

/**
 * 等粒子真正建好。
 * package-particlefx 是异步解码图片的（img.onload 之后才 initParticles），
 * 构造完立刻读 getParticleCount() 会拿到 0 —— 必须等一下再统计，否则数字会少算。
 */
function waitForParticles(instance, timeout = 10000) {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      if (instance.getParticleCount() > 0) return resolve(true);
      if (performance.now() - start > timeout) return resolve(false);
      setTimeout(tick, 50);
    };
    tick();
  });
}

/* ---------------- 卡片 ---------------- */

/**
 * 按需唤醒动画。
 * 粒子效果只在"需要被看见"的时候才烧 CPU：首屏入场播一小段、鼠标悬停时全程播放，
 * 其余时间停帧（canvas 会保留最后一帧，看起来仍是一张粒子画）。
 */
function wake(record, autoSleepMs) {
  clearTimeout(record.sleepTimer);
  record.sleepTimer = null;
  record.awake = true;
  record.instance.startAnimation();
  if (autoSleepMs > 0) {
    record.sleepTimer = setTimeout(() => {
      if (!record.hovered) sleep(record);
    }, autoSleepMs);
  }
}

function sleep(record) {
  clearTimeout(record.sleepTimer);
  record.sleepTimer = null;
  record.awake = false;
  record.instance.stopAnimation();
}

function createCardElement(item, plan) {
  const card = document.createElement('article');
  card.className = 'card';

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'card-open';
  open.title = '放大查看';
  open.setAttribute('aria-label', `放大查看 ${item.name || item.file}`);

  const host = document.createElement('div');
  host.className = 'canvas-host';
  host.style.aspectRatio = `${plan.width} / ${plan.height}`;

  const loading = document.createElement('span');
  loading.className = 'card-loading';
  loading.textContent = '粒子生成中…';
  host.appendChild(loading);
  open.appendChild(host);

  if (item.source === 'upload') {
    const flag = document.createElement('span');
    flag.className = 'card-flag';
    flag.textContent = '我的';
    card.appendChild(flag);
  }

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = item.name || item.file;
  name.title = item.file || item.name;
  const stat = document.createElement('span');
  stat.className = 'stat';
  stat.textContent = `${plan.width}×${plan.height}`;
  meta.append(name, stat);

  card.append(open, meta);

  open.addEventListener('click', () => {
    const at = items.findIndex((it) => it.key === item.key);
    if (at >= 0 && lightbox) lightbox.open(at);
  });

  return { card, host, loading, stat };
}

function mountCard(item) {
  return probeImage(item.src).then(async (info) => {
    if (!info.ok) {
      console.warn(`[粒子画廊] 无法读取图片，已跳过: ${item.src}`);
      return null;
    }

    const plan = computePlan(info.width, info.height);
    const { card, host, loading, stat } = createCardElement(item, plan);

    const instance = createParticleCanvas(host, baseOptions(plan, item.src));

    // 图片解码 + 粒子采样完成后再撤掉占位提示
    const ready = await waitForParticles(instance);
    host.removeChild(loading);
    if (!ready) {
      console.warn(`[粒子画廊] 粒子生成超时: ${item.src}`);
      stat.textContent = `${plan.width}×${plan.height} · 生成超时`;
      els.gallery.appendChild(card);
      instance.destroy();
      return null;
    }

    const record = {
      item,
      host,
      card,
      instance,
      plan,
      natural: { width: info.width, height: info.height },
      stat,
      index: cards.length,
      hovered: false,
      visible: false,
      awake: false,
      sleepTimer: null,
      enterTimer: null,
    };
    cards.push(record);

    // 进入视口：错峰播一小段入场动画后停帧；离开视口：立刻停帧
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            record.visible = true;
            clearTimeout(record.enterTimer);
            record.enterTimer = setTimeout(
              () => {
                if (record.visible && !record.hovered) wake(record, 1500);
              },
              (record.index % 4) * 220
            );
          } else {
            record.visible = false;
            clearTimeout(record.enterTimer);
            sleep(record);
          }
        }
      },
      { rootMargin: '120px' }
    );
    observer.observe(card);
    record.observer = observer;

    // 悬停期间持续动画，移开后留一点时间让粒子聚回原位再停帧
    host.addEventListener('mouseenter', () => {
      record.hovered = true;
      wake(record, 0);
    });
    host.addEventListener('mouseleave', () => {
      record.hovered = false;
      wake(record, 1600);
    });

    // 粒子数此刻已经可靠（上面等到了 getParticleCount() > 0）
    const real = instance.getParticleCount();
    stat.textContent = `${plan.width}×${plan.height} · ${real.toLocaleString('zh-CN')} 粒子`;

    els.gallery.appendChild(card);
    return record;
  });
}

/* ---------------- 图片清单 ---------------- */

function toBuiltinItem(raw) {
  const file = raw.file || raw.src;
  return {
    key: `builtin:${file}`,
    source: 'builtin',
    name: raw.name || String(file).replace(/\.[^.]+$/, ''),
    file,
    src: raw.src || `images/${file}`,
  };
}

function fallbackItems() {
  return FALLBACK_FILES.map((file) =>
    toBuiltinItem({ file, name: file.replace(/\.[^.]+$/, ''), src: `images/${file}` })
  );
}

/** 读取随项目部署的图片清单 */
async function loadBuiltinItems() {
  try {
    const res = await fetch(`images.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.images || [];
    builtinItems = list.map(toBuiltinItem);
    manifestMissing = false;
  } catch (err) {
    console.warn('[粒子画廊] 读取 images.json 失败，回退到示例列表', err.message);
    builtinItems = fallbackItems();
    manifestMissing = true;
  }
}

/** 从 IndexedDB 同步用户上传的图片，并为新增的创建 objectURL */
async function syncUploadItems() {
  const records = await listUploads();
  const seen = new Set();
  uploadItems = records.map((record) => {
    seen.add(record.id);
    let url = uploadUrls.get(record.id);
    if (!url) {
      url = URL.createObjectURL(record.blob);
      uploadUrls.set(record.id, url);
    }
    return {
      key: `upload:${record.id}`,
      source: 'upload',
      id: record.id,
      name: record.name,
      file: record.file,
      src: url,
    };
  });
  // 已经删掉的上传图片，回收 objectURL
  for (const [id, url] of uploadUrls) {
    if (!seen.has(id)) {
      URL.revokeObjectURL(url);
      uploadUrls.delete(id);
    }
  }
}

function rebuildItemList() {
  items = [...builtinItems, ...uploadItems];
}

/* ---------------- 主流程 ---------------- */

async function loadGallery() {
  const token = ++loadToken;
  setBanner('');
  els.refresh.classList.add('is-busy');

  for (const record of cards) {
    record.observer?.disconnect();
    clearTimeout(record.enterTimer);
    clearTimeout(record.sleepTimer);
    try {
      record.instance.destroy();
    } catch (err) {
      console.warn('[粒子画廊] 销毁实例失败', err);
    }
  }
  cards = [];
  els.gallery.innerHTML = '';

  if (items.length === 0) {
    els.empty.hidden = false;
    els.count.textContent = '0 张图片';
    return;
  }
  els.empty.hidden = true;

  // 布局已确定，按同屏卡片数分摊粒子预算
  concurrent = computeConcurrent(items.length);
  console.log(
    `[粒子画廊] ${items.length} 张图片（内置 ${builtinItems.length} / 上传 ${uploadItems.length}），同屏 ${concurrent} 张`
  );

  for (const item of items) {
    try {
      await mountCard(item);
    } catch (err) {
      console.error(`[粒子画廊] 渲染失败: ${item.src}`, err);
    }
    if (token !== loadToken) return;
  }

  if (cards.length === 0) {
    setBanner('图片都没能加载出来，请确认格式是有效的 jpg / png / webp / gif。');
  } else if (manifestMissing) {
    setBanner(
      '没找到 images.json，已回退到示例图片列表。若要使用 images/ 里的自带图片，请在项目目录运行 node generate-list.js。',
      'info'
    );
  }
  updateCountText();
}

/** 列表变化（上传 / 删除）后的统一刷新 */
async function reload({ skipBuiltin = true } = {}) {
  if (!skipBuiltin) await loadBuiltinItems();
  await syncUploadItems();
  rebuildItemList();
  renderThumbs();
  updateStorageNote();
  await loadGallery();
  lightbox?.refresh();
}

function updateCountText() {
  const total = cards.reduce((sum, c) => sum + c.instance.getParticleCount(), 0);
  const uploadNote = uploadItems.length ? `（含我上传的 ${uploadItems.length} 张）` : '';
  const tier = qualitySteps > 0 ? ` · 已自动降密 ${qualitySteps} 档` : '';
  els.count.textContent = `${items.length} 张图片${uploadNote} · 共 ${total.toLocaleString('zh-CN')} 粒子${tier}`;
}

function updateStorageNote() {
  if (!els.storageNote) return;
  if (isMemoryOnly()) {
    els.storageNote.textContent = '当前浏览器不允许本地存储，上传的图片在刷新后会丢失。';
    return;
  }
  els.storageNote.textContent = uploadItems.length
    ? `已保存 ${uploadItems.length} 张到本机浏览器`
    : '还没有上传图片';
}

/* ---------------- 图片管理面板 ---------------- */

function renderThumbs() {
  if (!els.thumbs) return;
  els.thumbs.innerHTML = '';

  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'thumbs-empty';
    empty.textContent = '还没有图片，点下面的「选择图片」或把图片拖进页面。';
    els.thumbs.appendChild(empty);
    return;
  }

  for (const item of items) {
    const box = document.createElement('div');
    box.className = 'thumb';

    const img = document.createElement('img');
    img.src = item.src;
    img.alt = item.name || item.file;
    img.loading = 'lazy';

    const badge = document.createElement('span');
    badge.className = `thumb-badge${item.source === 'upload' ? ' is-upload' : ''}`;
    badge.textContent = item.source === 'upload' ? '我的' : '示例';

    const name = document.createElement('span');
    name.className = 'thumb-name';
    name.textContent = item.name || item.file;
    name.title = item.file || item.name;

    box.append(img, badge, name);

    if (item.source === 'upload') {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'thumb-del';
      del.title = `删除 ${item.name}`;
      del.setAttribute('aria-label', `删除 ${item.name}`);
      del.textContent = '✕';
      del.addEventListener('click', () => handleRemoveUpload(item));
      box.appendChild(del);
    }

    els.thumbs.appendChild(box);
  }
}

async function handleRemoveUpload(item) {
  await removeUpload(item.id);
  await reload();
  setBanner(`已删除「${item.name}」。`, 'info');
}

async function handleClearUploads() {
  if (uploadItems.length === 0) {
    setBanner('还没有上传过图片。', 'info');
    return;
  }
  const ok = window.confirm(`确定要删除你上传的 ${uploadItems.length} 张图片吗？此操作不可撤销。`);
  if (!ok) return;
  await clearUploads();
  await reload();
  setBanner('已清空上传的图片。', 'info');
}

async function handleFiles(fileList) {
  const files = [...(fileList || [])].filter(Boolean);
  if (files.length === 0) return;

  els.addButtons.forEach((btn) => btn?.classList.add('is-busy'));
  try {
    const { added, skipped } = await addUploads(files);
    await reload();
    if (added.length) {
      const skipNote = skipped.length
        ? `，跳过 ${skipped.length} 个：${skipped.map((s) => `${s.name}（${s.reason}）`).join('、')}`
        : '';
      setBanner(`已添加 ${added.length} 张图片${skipNote}`, 'info');
    } else if (skipped.length) {
      setBanner(`没有可用的图片：${skipped.map((s) => `${s.name}（${s.reason}）`).join('、')}`);
    }
  } catch (err) {
    console.error('[粒子画廊] 添加图片失败', err);
    setBanner(`添加图片失败：${err.message}`);
  } finally {
    els.addButtons.forEach((btn) => btn?.classList.remove('is-busy'));
  }
}

/* ---------------- 自动画质 ---------------- */

/** 加载后实测帧率，偏低就自动下调粒子预算（最多降 3 次）。
 *  这样在性能较弱的手机 / 无 GPU 环境里也能保持流畅；用户一旦手动调过密度就不再干预。 */
const AUTO_QUALITY = { minFps: 45, maxSteps: 3, factor: 0.65 };
let qualitySteps = 0;
let densityTunedByUser = false;

function sampleFps(ms) {
  return new Promise((resolve) => {
    let frames = 0;
    const start = performance.now();
    const tick = () => {
      frames++;
      const elapsed = performance.now() - start;
      if (elapsed < ms) requestAnimationFrame(tick);
      else resolve((frames * 1000) / elapsed);
    };
    requestAnimationFrame(tick);
  });
}

async function autoTuneQuality() {
  await tuneLoop();
  // 收尾：降密会重建粒子，让可见卡片聚回原位后再停帧，避免停在打散状态
  for (const record of cards) {
    if (record.visible && !record.hovered) wake(record, 1800);
  }
}

async function tuneLoop() {
  for (let step = 0; step < AUTO_QUALITY.maxSteps; step++) {
    if (densityTunedByUser || cards.length === 0 || document.hidden) return;

    // 按"最坏的真实场景"测：同时跑 min(可见卡片, 2) 张
    const load = cards.filter((c) => c.visible).slice(0, 2);
    if (load.length === 0) return;
    for (const record of load) {
      clearTimeout(record.sleepTimer);
      record.sleepTimer = null;
      wake(record, 0);
    }
    const fps = await sampleFps(1200);
    for (const record of load) {
      if (!record.hovered) sleep(record);
    }

    if (fps >= AUTO_QUALITY.minFps) return;
    params.density *= AUTO_QUALITY.factor;
    qualitySteps++;
    applyDensity();
    updateCountText();
    await new Promise((r) => setTimeout(r, 350));
  }
}

/* ---------------- 参数联动 ---------------- */

function syncOutputs() {
  for (const key of ['force', 'returnSpeed', 'noise', 'density']) {
    const out = document.querySelector(`[data-out="${key === 'returnSpeed' ? 'return' : key}"]`);
    if (out) {
      out.textContent = key === 'returnSpeed' ? params[key].toFixed(2) : String(params[key]);
    }
  }
}

function applyLive(patch) {
  Object.assign(params, patch);
  for (const record of cards) {
    record.instance.updateConfig({
      mouseForce: params.force,
      gravity: params.returnSpeed,
      noise: params.noise,
      particleShape: params.shape,
    });
  }
  syncOutputs();
}

/** 密度变化需要重新计算 particleGap（会重建粒子） */
function applyDensity() {
  for (const record of cards) {
    const plan = computePlan(record.natural.width, record.natural.height);
    record.plan = plan;
    record.host.style.aspectRatio = `${plan.width} / ${plan.height}`;
    record.instance.updateConfig({
      width: plan.width,
      height: plan.height,
      particleGap: plan.gap,
    });
    const real = record.instance.getParticleCount();
    if (real > 0) {
      record.stat.textContent = `${plan.width}×${plan.height} · ${real.toLocaleString('zh-CN')} 粒子`;
    }
    // updateConfig 会重建粒子（重新打散），必须让它跑一段动画聚回原位，否则会停在半空
    if (record.visible && !record.hovered) wake(record, 1800);
  }
  updateCountText();
}

/* ---------------- 交互绑定 ---------------- */

function bindPanelToggle(button, panel) {
  if (!button || !panel) return;
  button.addEventListener('click', () => {
    const willOpen = panel.hidden;
    panel.hidden = !willOpen;
    button.setAttribute('aria-expanded', String(willOpen));
  });
}

function bindControls() {
  const bindRange = (id, key, after) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = String(params[key]);
    el.addEventListener('input', () => {
      const value = Number(el.value);
      Object.assign(params, { [key]: value });
      syncOutputs();
      if (after) after();
    });
  };

  bindRange('force', 'force', () => applyLive({}));
  bindRange('return', 'returnSpeed', () => applyLive({}));
  bindRange('noise', 'noise', () => applyLive({}));
  bindRange('density', 'density', () => {
    densityTunedByUser = true;
    applyDensity();
  });

  const shape = document.getElementById('shape');
  if (shape) {
    shape.value = params.shape;
    shape.addEventListener('change', () => applyLive({ shape: shape.value }));
  }

  els.reset?.addEventListener('click', () => {
    Object.assign(params, DEFAULTS);
    densityTunedByUser = false;
    qualitySteps = 0;
    for (const [key, id] of [
      ['force', 'force'],
      ['returnSpeed', 'return'],
      ['noise', 'noise'],
      ['density', 'density'],
    ]) {
      const el = document.getElementById(id);
      if (el) el.value = String(params[key]);
    }
    if (shape) shape.value = params.shape;
    applyLive({});
    applyDensity();
  });

  bindPanelToggle(els.controlsToggle, els.controls);
  syncOutputs();
}

function hasFiles(event) {
  const dt = event.dataTransfer;
  if (!dt) return false;
  return [...(dt.types || [])].includes('Files');
}

function bindUploads() {
  els.addButtons.forEach((btn) => {
    btn?.addEventListener('click', () => els.fileInput?.click());
  });

  els.fileInput?.addEventListener('change', () => {
    // 注意：input.files 是实时集合，必须先拷成数组再清空 value，否则会被一起清掉
    const files = [...els.fileInput.files];
    els.fileInput.value = ''; // 允许重复选择同一个文件
    handleFiles(files);
  });

  els.clearUploads?.addEventListener('click', handleClearUploads);

  // 拖放到页面任意位置
  let dragDepth = 0;
  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth++;
    if (els.dropzone) els.dropzone.hidden = false;
  });
  window.addEventListener('dragover', (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0 && els.dropzone) els.dropzone.hidden = true;
  });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    if (els.dropzone) els.dropzone.hidden = true;
    handleFiles(event.dataTransfer.files);
  });

  // 截图后直接 Ctrl+V 粘贴
  window.addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.files || [])];
    if (files.length === 0) return;
    event.preventDefault();
    handleFiles(files);
  });
}

/* ---------------- 启动 ---------------- */

async function start() {
  try {
    const mod = await import(/* @vite-ignore */ LIB_URL);
    createParticleCanvas = mod.createParticleCanvas;
  } catch (err) {
    console.error('[粒子画廊] 加载 package-particlefx 失败', err);
    setBanner(
      '粒子引擎加载失败：找不到 vendor/package-particlefx.es.js。请确认部署时把 vendor/ 目录一起上传，并且是通过 http(s) 而不是 file:// 打开页面。'
    );
    els.count.textContent = '引擎加载失败';
    return;
  }

  lightbox = createLightbox({
    root: els.lightboxRoot,
    getItems: () => items,
    planFor: (w, h) =>
      computePlan(w, h, { maxSide: LIGHTBOX_MAX_SIDE, budget: LIGHTBOX_BUDGET }),
    buildInstance: (host, item, plan) => createParticleCanvas(host, baseOptions(plan, item.src)),
  });

  bindControls();
  bindPanelToggle(els.imagesToggle, els.imagesPanel);
  bindUploads();

  els.refresh.addEventListener('click', () => reload({ skipBuiltin: false }));

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // 只有影响布局档位的变化才重建粒子，避免拖动窗口时反复重建
      const narrow = isNarrow();
      const nextConcurrent = computeConcurrent(items.length);
      if (narrow !== lastNarrow || nextConcurrent !== concurrent) {
        lastNarrow = narrow;
        concurrent = nextConcurrent;
        applyDensity();
      }
    }, 250);
  });
  let lastNarrow = isNarrow();

  await loadBuiltinItems();
  await syncUploadItems();
  rebuildItemList();
  renderThumbs();
  updateStorageNote();
  await loadGallery();
  await autoTuneQuality();
}

// 便于调试与自动化检查
window.particleGallery = {
  params,
  getCards: () => cards,
  getItems: () => items,
  getConcurrent: () => concurrent,
  getAnimating: () => cards.filter((c) => c.awake).length,
  getQualitySteps: () => qualitySteps,
  reload: () => reload({ skipBuiltin: false }),
  openLightbox: (i) => lightbox?.open(i),
  closeLightbox: () => lightbox?.close(),
  getLightbox: () => lightbox,
};

start();
