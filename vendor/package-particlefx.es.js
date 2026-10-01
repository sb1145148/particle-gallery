/* package-particlefx v2.0.2 — 由 scripts/vendor-lib.js 从 node_modules 复制而来，请勿手改。
 * 上游: https://github.com/Anmol-TheDev/package-particlefx (MIT) */
const M = {
  fireworks: {
    particleGap: 2,
    mouseForce: 60,
    gravity: 0.1,
    noise: 20,
    clickStrength: 200,
    particleShape: "circle",
    vortexMode: !1
  },
  snow: {
    particleGap: 6,
    mouseForce: 10,
    gravity: 0.02,
    noise: 2,
    clickStrength: 50,
    particleShape: "circle",
    vortexMode: !1
  },
  galaxy: {
    particleGap: 3,
    mouseForce: 10,
    gravity: 0,
    noise: 5,
    clickStrength: 100,
    particleShape: "circle",
    vortexMode: !0
  },
  rain: {
    particleGap: 8,
    mouseForce: 20,
    gravity: 0.2,
    noise: 1,
    clickStrength: 80,
    particleShape: "triangle",
    vortexMode: !1
  }
};
function w() {
  const i = document.createElement("canvas"), t = i.getContext("2d");
  if (!t)
    return "";
  const e = 200;
  i.width = e, i.height = e;
  const a = t.createRadialGradient(
    e / 2,
    e / 2,
    0,
    e / 2,
    e / 2,
    e / 1.4
  );
  a.addColorStop(0, "#667eea"), a.addColorStop(0.3, "#764ba2"), a.addColorStop(0.6, "#f093fb"), a.addColorStop(1, "#f5576c"), t.fillStyle = a, t.fillRect(0, 0, e, e), t.fillStyle = "rgba(255, 255, 255, 0.8)";
  for (let s = 0; s < 30; s++) {
    const n = Math.random() * e, r = Math.random() * e, o = Math.random() * 2 + 0.5;
    t.beginPath(), t.arc(n, r, o, 0, Math.PI * 2), t.fill();
  }
  t.fillStyle = "rgba(255, 255, 255, 0.6)";
  for (let s = 0; s < 10; s++) {
    const n = Math.random() * e, r = Math.random() * e, o = Math.random() * 4 + 1, h = t.createRadialGradient(
      n,
      r,
      0,
      n,
      r,
      o * 3
    );
    h.addColorStop(0, "rgba(255, 255, 255, 0.8)"), h.addColorStop(0.5, "rgba(255, 255, 255, 0.3)"), h.addColorStop(1, "rgba(255, 255, 255, 0)"), t.fillStyle = h, t.beginPath(), t.arc(n, r, o * 3, 0, Math.PI * 2), t.fill(), t.fillStyle = "rgba(255, 255, 255, 0.9)", t.beginPath(), t.arc(n, r, o, 0, Math.PI * 2), t.fill();
  }
  t.fillStyle = "rgba(255, 255, 255, 0.95)", t.font = "bold 32px Arial", t.textAlign = "center", t.textBaseline = "middle", t.shadowColor = "rgba(255, 255, 255, 0.5)", t.shadowBlur = 10, t.shadowOffsetX = 0, t.shadowOffsetY = 0, t.fillText("PFX", e / 2, e / 2), t.strokeStyle = "rgba(255, 255, 255, 0.2)", t.lineWidth = 1, t.beginPath();
  for (let s = 0; s < 8; s++) {
    const n = Math.random() * e, r = Math.random() * e, o = n + (Math.random() - 0.5) * 60, h = r + (Math.random() - 0.5) * 60;
    t.moveTo(n, r), t.lineTo(o, h);
  }
  return t.stroke(), t.shadowColor = "transparent", t.shadowBlur = 0, i.toDataURL();
}
function x(i) {
  if (typeof i == "string") {
    const t = i.match(/^(\d+)(px|vw|vh|%)$/);
    if (t)
      return { value: parseInt(t[1]), unit: t[2] };
  }
  return { value: i, unit: "px" };
}
function y(i, t) {
  const { value: e, unit: a } = x(i);
  return a === "vw" ? e / 100 * window.innerWidth : a === "vh" ? e / 100 * window.innerHeight : a === "%" ? e / 100 * t.clientWidth : e;
}
function I(i, t, e, a, s, n, r) {
  const o = t.x - i.x + (Math.random() - 0.5) * e.noise, h = t.y - i.y + (Math.random() - 0.5) * e.noise, c = Math.sqrt(o * o + h * h);
  let d;
  if (c < 5 ? d = 0.1 * (c / 5) : d = 0.02 * c, c > 0 && (i.vx += o / c * d * n, i.vy += h / c * d * n), a.active)
    if (e.vortexMode) {
      const v = i.x - s.x, f = i.y - s.y, g = Math.sqrt(v * v + f * f);
      if (g > 0) {
        const l = Math.atan2(f, v), p = 1 / g;
        i.vx += Math.cos(l + Math.PI / 2) * p, i.vy += Math.sin(l + Math.PI / 2) * p, i.vx -= v / g * p * 0.1, i.vy -= f / g * p * 0.1;
      }
    } else {
      const v = i.x - a.x, f = i.y - a.y, g = Math.sqrt(v * v + f * f);
      if (g > 0) {
        const l = e.mouseForce / g;
        i.vx += v / g * l * n, i.vy += f / g * l * n;
      }
    }
  let m = r;
  !a.active && c < 10 && (m = Math.max(0.8, r)), i.vx *= m, i.vy *= m, !a.active && c < 1 && Math.abs(i.vx) < 0.1 && Math.abs(i.vy) < 0.1 ? (i.x = t.x, i.y = t.y, i.vx = 0, i.vy = 0) : (i.x += i.vx, i.y += i.vy);
}
function F(i, t, e, a) {
  const s = E(
    t.color,
    a.filter,
    a.hueRotation
  );
  e.fillStyle = `rgba(${s[0]}, ${s[1]}, ${s[2]}, ${s[3] / 255})`;
  const n = Math.floor(i.x), r = Math.floor(i.y), o = a.particleGap / 2;
  switch (a.particleShape) {
    case "circle":
      e.beginPath(), e.arc(n, r, o, 0, Math.PI * 2), e.fill();
      break;
    case "triangle":
      e.beginPath(), e.moveTo(n, r - o), e.lineTo(n + o, r + o), e.lineTo(n - o, r + o), e.closePath(), e.fill();
      break;
    case "square":
    default:
      e.fillRect(n - o / 2, r - o / 2, o, o);
      break;
  }
}
function E(i, t, e) {
  let a = i[0], s = i[1], n = i[2];
  const r = i[3];
  switch (t) {
    case "grayscale":
      a = s = n = 0.299 * a + 0.587 * s + 0.114 * n;
      break;
    case "sepia":
      const h = Math.min(255, 0.393 * a + 0.769 * s + 0.189 * n), c = Math.min(
        255,
        0.349 * a + 0.686 * s + 0.168 * n
      ), d = Math.min(
        255,
        0.272 * a + 0.534 * s + 0.131 * n
      );
      a = h, s = c, n = d;
      break;
    case "invert":
      a = 255 - a, s = 255 - s, n = 255 - n;
      break;
  }
  if (e !== 0) {
    a /= 255, s /= 255, n /= 255;
    const o = Math.max(a, s, n), h = Math.min(a, s, n);
    let c = 0, d = 0;
    const m = (o + h) / 2;
    if (o !== h) {
      const l = o - h;
      switch (d = m > 0.5 ? l / (2 - o - h) : l / (o + h), o) {
        case a:
          c = (s - n) / l + (s < n ? 6 : 0);
          break;
        case s:
          c = (n - a) / l + 2;
          break;
        case n:
          c = (a - s) / l + 4;
          break;
      }
      c /= 6;
    }
    c = (c * 360 + e) % 360, c < 0 && (c += 360), c /= 360;
    const v = (l, p, u) => (u < 0 && (u += 1), u > 1 && (u -= 1), u < 1 / 6 ? l + (p - l) * 6 * u : u < 1 / 2 ? p : u < 2 / 3 ? l + (p - l) * (2 / 3 - u) * 6 : l), f = m < 0.5 ? m * (1 + d) : m + d - m * d, g = 2 * m - f;
    a = v(g, f, c + 1 / 3), s = v(g, f, c), n = v(g, f, c - 1 / 3), a = Math.round(a * 255), s = Math.round(s * 255), n = Math.round(n * 255);
  }
  return [a, s, n, r];
}
function G(i, t, e, a) {
  for (let s = 0; s < i.length; s++) {
    const n = i[s], r = n.x - t, o = n.y - e, h = Math.sqrt(r * r + o * o);
    if (h > 0) {
      const c = a.clickStrength / (h + 1);
      n.vx += r / h * c * 0.1, n.vy += o / h * c * 0.1;
    }
  }
}
function L(i, t) {
  const e = document.createElement("canvas");
  e.width = y(i.width, t), e.height = y(i.height, t), e.style.display = "block", e.style.maxWidth = "100%", e.style.height = "auto";
  const a = e.getContext("2d");
  if (!a)
    throw new Error("Could not get canvas context");
  return t.appendChild(e), { canvas: e, ctx: a };
}
function R(i, t) {
  t.addEventListener("mousemove", (e) => C(e, i)), t.addEventListener("mouseleave", () => b(i)), t.addEventListener("click", (e) => S(e, i)), window.addEventListener("resize", () => P(i));
}
function A(i, t) {
  t.removeEventListener("mousemove", (e) => C(e, i)), t.removeEventListener("mouseleave", () => b(i)), t.removeEventListener("click", (e) => S(e, i)), window.removeEventListener("resize", () => P(i));
}
function C(i, t) {
  if (!t.canvas) return;
  const e = t.canvas.getBoundingClientRect();
  t.mouse.x = (i.clientX - e.left) * (t.canvas.width / e.width), t.mouse.y = (i.clientY - e.top) * (t.canvas.height / e.height), t.mouse.active = !0;
}
function b(i) {
  i.mouse.active = !1, i.vortex.active = !1;
}
function S(i, t) {
  if (!t.canvas) return;
  const e = t.canvas.getBoundingClientRect(), a = (i.clientX - e.left) * (t.canvas.width / e.width), s = (i.clientY - e.top) * (t.canvas.height / e.height);
  t.getConfig().vortexMode ? (t.vortex.x = a, t.vortex.y = s, t.vortex.active = !0) : G(
    t.getParticles(),
    a,
    s,
    t.getConfig()
  );
}
function P(i) {
  const t = i.getConfig(), e = x(t.width), a = x(t.height);
  (e.unit !== "px" || a.unit !== "px") && i.updateConfig({});
}
function D(i) {
  const t = i.preset, e = t ? M[t] : {};
  return { ...{
    particleGap: 4,
    mouseForce: 30,
    gravity: 0.08,
    noise: 10,
    clickStrength: 100,
    width: 400,
    height: 400,
    imageSrc: w(),
    hueRotation: 0,
    filter: "none",
    particleShape: "square",
    vortexMode: !1
  }, ...e, ...i };
}
class k {
  container;
  canvas = null;
  ctx = null;
  particles = [];
  origins = [];
  mouse = { x: 0, y: 0, active: !1 };
  vortex = { x: 0, y: 0, active: !1 };
  animationId = null;
  img = new Image();
  config;
  speed = 0;
  gravityFactor = 0;
  constructor(t, e = {}) {
    this.container = t, this.config = D(e), this.init();
  }
  init() {
    const { canvas: t, ctx: e } = L(this.config, this.container);
    this.canvas = t, this.ctx = e, R(this, this.canvas), this.loadImage();
  }
  loadImage() {
    this.img.crossOrigin = "Anonymous", this.img.onload = () => {
      this.initParticles(), this.startAnimation();
    }, this.img.onerror = () => {
      console.warn("Failed to load image, using default"), this.img.src = w();
    }, this.img.src = this.config.imageSrc;
  }
  initParticles() {
    if (!this.canvas || !this.ctx) return;
    this.particles = [], this.origins = [];
    const t = document.createElement("canvas"), e = t.getContext("2d");
    if (!e) return;
    t.width = this.canvas.width, t.height = this.canvas.height, e.drawImage(this.img, 0, 0, this.canvas.width, this.canvas.height);
    const s = e.getImageData(
      0,
      0,
      this.canvas.width,
      this.canvas.height
    ).data;
    for (let n = 0; n < this.canvas.width; n += this.config.particleGap)
      for (let r = 0; r < this.canvas.height; r += this.config.particleGap) {
        const o = (n + r * this.canvas.width) * 4, h = s[o + 3];
        if (h > 0) {
          const c = {
            x: n,
            y: r,
            color: [s[o], s[o + 1], s[o + 2], h]
          }, d = {
            x: n + (Math.random() - 0.5) * 100,
            y: r + (Math.random() - 0.5) * 100,
            vx: (Math.random() - 0.5) * 2,
            vy: (Math.random() - 0.5) * 2,
            targetX: n,
            targetY: r,
            isDead: !1
          };
          this.origins.push(c), this.particles.push(d);
        }
      }
    this.speed = Math.log(this.particles.length) / 10, this.gravityFactor = 1 - this.config.gravity * this.speed;
  }
  animate = () => {
    if (!(!this.ctx || !this.canvas)) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      for (let t = 0; t < this.particles.length; t++) {
        const e = this.particles[t], a = this.origins[t];
        e.isDead || (I(
          e,
          a,
          this.config,
          this.mouse,
          this.vortex,
          this.speed,
          this.gravityFactor
        ), F(e, a, this.ctx, this.config));
      }
      this.animationId = requestAnimationFrame(this.animate);
    }
  };
  startAnimation() {
    this.animationId && cancelAnimationFrame(this.animationId), this.animate();
  }
  stopAnimation() {
    this.animationId && (cancelAnimationFrame(this.animationId), this.animationId = null);
  }
  resetParticles() {
    for (let t = 0; t < this.particles.length; t++) {
      const e = this.particles[t], a = this.origins[t];
      e.x = a.x + (Math.random() - 0.5) * 20, e.y = a.y + (Math.random() - 0.5) * 20, e.vx = 0, e.vy = 0, e.isDead = !1;
    }
  }
  explodeParticles() {
    for (let t = 0; t < this.particles.length; t++) {
      const e = this.particles[t], a = Math.random() * Math.PI * 2, s = Math.random() * 5 + 2;
      e.vx += Math.cos(a) * s, e.vy += Math.sin(a) * s;
    }
  }
  downloadImage(t = "particle-art.png") {
    if (!this.canvas) return;
    const e = document.createElement("a");
    e.download = t, e.href = this.canvas.toDataURL("image/png"), e.click();
  }
  updateConfig(t) {
    if (this.config = { ...this.config, ...t }, t.gravity !== void 0 && (this.gravityFactor = 1 - this.config.gravity * this.speed), t.imageSrc !== void 0 && this.loadImage(), t.particleGap !== void 0 && this.initParticles(), t.width !== void 0 || t.height !== void 0) {
      if (!this.canvas) return;
      this.canvas.width = y(
        this.config.width,
        this.container
      ), this.canvas.height = y(
        this.config.height,
        this.container
      ), this.initParticles();
    }
  }
  destroy() {
    this.stopAnimation(), this.canvas && this.canvas.parentNode && (A(this, this.canvas), this.canvas.parentNode.removeChild(this.canvas)), this.particles = [], this.origins = [];
  }
  getParticleCount() {
    return this.particles.length;
  }
  getParticles() {
    return this.particles;
  }
  getConfig() {
    return { ...this.config };
  }
}
function X(i, t = {}) {
  if (!i)
    throw new Error("Container element is required");
  let e;
  if (typeof i == "string") {
    if (e = document.querySelector(i), !e)
      throw new Error(`Element with selector "${i}" not found`);
  } else
    e = i;
  return new k(e, t);
}
typeof window < "u" && (window.ParticleCanvas = {
  createParticleCanvas: X,
  ParticleCanvas: k,
  presets: M
});
export {
  k as ParticleCanvas,
  X as createParticleCanvas
};
