/* ════════════════════════════════════════════════════════════
   云胡牌 · particles.js
   胡牌演出：金币雨 + 烟花（canvas 粒子）
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const GOLD = ['#d4af37', '#f4dd8a', '#b8860b', '#ffe9a8'];
  const FIREWORK = ['#ff4f9a', '#46e8d4', '#f4dd8a', '#ff8c42', '#fff3d6'];

  class ParticleFX {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.parts = [];
      this.running = false;
      this.coinTimer = null;
      this.burstTimer = null;
      this._raf = null;
      this._resize = this.resize.bind(this);
      window.addEventListener('resize', this._resize);
      this.resize();
    }

    resize() {
      const host = this.canvas.parentElement;
      if (!host) return;
      const r = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = r.width * dpr;
      this.canvas.height = r.height * dpr;
      this.canvas.style.width = r.width + 'px';
      this.canvas.style.height = r.height + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.W = r.width; this.H = r.height;
    }

    /** 金币：金圆片 + 翻面闪烁 */
    spawnCoin() {
      this.parts.push({
        kind: 'coin',
        x: Math.random() * this.W,
        y: -20,
        vy: 120 + Math.random() * 160,
        vx: (Math.random() - 0.5) * 60,
        r: 5 + Math.random() * 6,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 10,
        color: GOLD[(Math.random() * GOLD.length) | 0],
        life: 6
      });
    }

    /** 烟花：升空弹 + 爆裂 */
    spawnRocket() {
      const x = this.W * (0.15 + Math.random() * 0.7);
      const targetY = this.H * (0.12 + Math.random() * 0.3);
      this.parts.push({
        kind: 'rocket', x, y: this.H + 10,
        vy: -(this.H * 1.4) * (0.9 + Math.random() * 0.3),
        targetY,
        color: FIREWORK[(Math.random() * FIREWORK.length) | 0],
        life: 4
      });
    }

    explode(x, y, color) {
      const n = 42 + (Math.random() * 20 | 0);
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.2;
        const sp = 60 + Math.random() * 170;
        this.parts.push({
          kind: 'spark',
          x, y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          r: 1.2 + Math.random() * 2,
          color: Math.random() < 0.75 ? color : FIREWORK[(Math.random() * FIREWORK.length) | 0],
          life: 1.1 + Math.random() * 0.9,
          age: 0
        });
      }
    }

    /** 开始演出：持续金币雨 + 定时烟花 */
    start() {
      this.stop();
      this.running = true;
      this.resize();
      // 开场三发礼花
      [0, 350, 800].forEach(d => setTimeout(() => this.running && this.spawnRocket(), d));
      this.coinTimer = setInterval(() => {
        for (let i = 0; i < 3; i++) this.spawnCoin();
      }, 140);
      this.burstTimer = setInterval(() => this.spawnRocket(), 1600);
      let last = performance.now();
      const loop = (now) => {
        if (!this.running) return;
        const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05) || 0.016;
        last = now;
        this.step(dt);
        this._raf = requestAnimationFrame(loop);
      };
      this._raf = requestAnimationFrame(loop);
    }

    step(dt) {
      const c = this.ctx;
      c.clearRect(0, 0, this.W, this.H);
      const grav = 900;
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const p = this.parts[i];
        if (p.kind === 'coin') {
          p.vy += grav * 0.35 * dt;
          p.x += p.vx * dt; p.y += p.vy * dt;
          p.rot += p.vr * dt; p.life -= dt;
          const squish = Math.abs(Math.sin(p.rot)); // 翻面效果
          c.save();
          c.translate(p.x, p.y);
          c.scale(Math.max(0.15, squish), 1);
          c.beginPath();
          c.arc(0, 0, p.r, 0, Math.PI * 2);
          c.fillStyle = p.color;
          c.fill();
          c.lineWidth = 1.5;
          c.strokeStyle = 'rgba(120,80,10,.8)';
          c.stroke();
          c.beginPath();
          c.arc(-p.r * 0.3, -p.r * 0.3, p.r * 0.25, 0, Math.PI * 2);
          c.fillStyle = 'rgba(255,255,255,.75)';
          c.fill();
          c.restore();
          if (p.y > this.H + 30 || p.life <= 0) this.parts.splice(i, 1);
        } else if (p.kind === 'rocket') {
          p.y += p.vy * dt; p.life -= dt;
          c.beginPath();
          c.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
          c.fillStyle = p.color;
          c.shadowColor = p.color; c.shadowBlur = 10;
          c.fill(); c.shadowBlur = 0;
          if (p.y <= p.targetY || p.life <= 0) {
            this.explode(p.x, p.y, p.color);
            this.parts.splice(i, 1);
            if (window.AudioFX) { /* 爆裂小金币声点缀 */ window.AudioFX.coin(Math.random() * 0.05); }
          }
        } else { // spark
          p.age += dt;
          p.vy += grav * 0.25 * dt;
          p.vx *= 0.985; p.vy *= 0.985;
          p.x += p.vx * dt; p.y += p.vy * dt;
          const t = 1 - p.age / p.life;
          if (t <= 0) { this.parts.splice(i, 1); continue; }
          c.globalAlpha = Math.max(0, t);
          c.beginPath();
          c.arc(p.x, p.y, p.r * (0.5 + t * 0.5), 0, Math.PI * 2);
          c.fillStyle = p.color;
          c.shadowColor = p.color; c.shadowBlur = 6;
          c.fill();
          c.shadowBlur = 0; c.globalAlpha = 1;
        }
      }
    }

    stop() {
      this.running = false;
      if (this._raf) cancelAnimationFrame(this._raf);
      clearInterval(this.coinTimer);
      clearInterval(this.burstTimer);
      this.parts.length = 0;
      this.ctx && this.ctx.clearRect(0, 0, this.W || 0, this.H || 0);
    }
  }

  window.ParticleFX = ParticleFX;
})();
