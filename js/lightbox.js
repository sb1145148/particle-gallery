/**
 * 大图查看器（灯箱）。
 *
 * 在画廊里点任意一张卡片即可放大，用左右方向键 / 两侧按钮 / 底部缩略图条
 * 直接切换图片 —— 不需要回到代码里去换图。
 *
 * 本模块自己创建 DOM，只依赖外部注入的三件事：
 *   getItems()                        当前图片列表
 *   planFor(w, h)                     按原图尺寸算出 canvas 尺寸与粒子间距
 *   buildInstance(host, item, plan)   在容器里创建粒子实例
 */

const REFRESH_MS = 220;

export function createLightbox({ root, getItems, planFor, buildInstance }) {
  let index = -1;
  let instance = null;
  let visible = false;
  let lastFocus = null;
  let renderToken = 0;

  /* ---------- DOM ---------- */

  root.classList.add('lightbox');
  root.hidden = true;
  root.innerHTML = `
    <div class="lb-backdrop" data-close="1"></div>
    <div class="lb-panel" role="dialog" aria-modal="true" aria-label="图片查看">
      <header class="lb-head">
        <span class="lb-name"></span>
        <span class="lb-counter"></span>
        <button type="button" class="lb-close btn" aria-label="关闭">✕ 关闭</button>
      </header>
      <div class="lb-stage">
        <button type="button" class="lb-nav lb-prev" aria-label="上一张">‹</button>
        <div class="lb-host"></div>
        <button type="button" class="lb-nav lb-next" aria-label="下一张">›</button>
      </div>
      <div class="lb-strip" role="tablist" aria-label="切换图片"></div>
    </div>
  `;

  const panel = root.querySelector('.lb-panel');
  const stageHost = root.querySelector('.lb-host');
  const nameEl = root.querySelector('.lb-name');
  const counterEl = root.querySelector('.lb-counter');
  const stripEl = root.querySelector('.lb-strip');
  const prevBtn = root.querySelector('.lb-prev');
  const nextBtn = root.querySelector('.lb-next');
  const closeBtn = root.querySelector('.lb-close');

  /* ---------- 渲染 ---------- */

  function probe(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ ok: true, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ ok: false });
      img.src = src;
    });
  }

  function waitForParticles(target, timeout = 10000) {
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = () => {
        if (target.getParticleCount() > 0) return resolve(true);
        if (performance.now() - start > timeout) return resolve(false);
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  function teardown() {
    if (instance) {
      try {
        instance.destroy();
      } catch {
        /* 忽略销毁异常 */
      }
      instance = null;
    }
    stageHost.innerHTML = '';
  }

  async function render(nextIndex) {
    const items = getItems();
    if (items.length === 0) {
      close();
      return;
    }

    index = ((nextIndex % items.length) + items.length) % items.length;
    const item = items[index];
    const token = ++renderToken;

    nameEl.textContent = item.name || item.file || '未命名';
    counterEl.textContent = `${index + 1} / ${items.length}`;
    prevBtn.disabled = items.length < 2;
    nextBtn.disabled = items.length < 2;
    updateStrip();

    teardown();

    const info = await probe(item.src);
    if (token !== renderToken) return; // 已经被下一次切换取代
    if (!info.ok) {
      stageHost.innerHTML = '<p class="lb-error">这张图片加载失败了。</p>';
      return;
    }

    const plan = planFor(info.width, info.height);
    stageHost.style.setProperty('--lb-ratio', `${plan.width} / ${plan.height}`);
    stageHost.innerHTML = '<span class="lb-loading">粒子生成中…</span>';

    const host = document.createElement('div');
    host.className = 'lb-canvas';
    host.style.aspectRatio = `${plan.width} / ${plan.height}`;
    stageHost.appendChild(host);

    instance = buildInstance(host, item, plan);
    const ready = await waitForParticles(instance);
    if (token !== renderToken) return;

    const loading = stageHost.querySelector('.lb-loading');
    if (loading) loading.remove();
    if (!ready) stageHost.insertAdjacentHTML('beforeend', '<p class="lb-error">粒子生成超时。</p>');
  }

  function updateStrip() {
    const items = getItems();
    [...stripEl.children].forEach((el, i) => {
      el.classList.toggle('is-active', i === index);
      el.setAttribute('aria-selected', String(i === index));
    });
    if (stripEl.children.length !== items.length) buildStrip();
  }

  function buildStrip() {
    const items = getItems();
    stripEl.innerHTML = '';
    items.forEach((item, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lb-thumb';
      btn.setAttribute('role', 'tab');
      btn.title = item.name || item.file;
      const img = document.createElement('img');
      img.src = item.src;
      img.alt = item.name || item.file;
      img.loading = 'lazy';
      btn.appendChild(img);
      btn.addEventListener('click', () => render(i));
      stripEl.appendChild(btn);
    });
    updateStrip();
  }

  /* ---------- 开关 ---------- */

  function onKeyDown(event) {
    if (!visible) return;
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowLeft') render(index - 1);
    else if (event.key === 'ArrowRight') render(index + 1);
    else return;
    event.preventDefault();
  }

  function open(atIndex = 0) {
    const items = getItems();
    if (items.length === 0) return;
    lastFocus = document.activeElement;
    visible = true;
    root.hidden = false;
    document.body.classList.add('lb-open');
    buildStrip();
    render(atIndex);
    closeBtn.focus({ preventScroll: true });
  }

  function close() {
    visible = false;
    renderToken++;
    teardown();
    root.hidden = true;
    document.body.classList.remove('lb-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
  }

  /** 图片列表变化时调用：当前图片被删掉就自动关掉 */
  function refresh() {
    if (!visible) return;
    const items = getItems();
    if (items.length === 0) {
      close();
      return;
    }
    if (index >= items.length) index = items.length - 1;
    buildStrip();
    render(index);
  }

  /* ---------- 事件 ---------- */

  root.addEventListener('click', (event) => {
    if (event.target.dataset.close) close();
  });
  closeBtn.addEventListener('click', close);
  prevBtn.addEventListener('click', () => render(index - 1));
  nextBtn.addEventListener('click', () => render(index + 1));
  document.addEventListener('keydown', onKeyDown);

  // 灯箱开着时窗口尺寸变化，重新算一次粒子（图片可能换了个档位）
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!visible) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => render(index), REFRESH_MS);
  });

  return {
    open,
    close,
    refresh,
    isOpen: () => visible,
    getIndex: () => index,
    /** 给自动化检查用：当前这张大图的粒子实例 */
    getInstance: () => instance,
  };
}
