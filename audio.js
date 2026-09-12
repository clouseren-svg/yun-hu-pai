/* ════════════════════════════════════════════════════════════
   云胡牌 · audio.js
   全部音效用 WebAudio API 现场合成，无外部音频文件。
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const AudioFX = {
    ctx: null,
    master: null,
    muted: false,
    _noiseBuf: null,

    /** 首次用户手势时调用，惰性初始化 AudioContext */
    ensure() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
    },

    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.value = m ? 0 : 0.9;
    },

    get ready() { return !!this.ctx && !this.muted; },

    /** 共享白噪声 buffer */
    noiseBuffer() {
      if (this._noiseBuf) return this._noiseBuf;
      const len = this.ctx.sampleRate * 0.5;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this._noiseBuf = buf;
      return buf;
    },

    /**
     * 木鱼/牌碰桌的「哒」：短噪声 + 快速衰减的低频敲击
     * @param {number} pitch 基频倍率（摸牌略高、弃牌略低）
     */
    tick(pitch = 1, vol = 1) {
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      // 木质敲击体
      const osc = this.ctx.createOscillator();
      const og = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(620 * pitch, t);
      osc.frequency.exponentialRampToValueAtTime(180 * pitch, t + 0.055);
      og.gain.setValueAtTime(0.55 * vol, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.connect(og).connect(this.master);
      osc.start(t); osc.stop(t + 0.1);
      // 击打的脆响（噪声）
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer();
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 2400 * pitch; bp.Q.value = 1.2;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.35 * vol, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
      src.connect(bp).connect(ng).connect(this.master);
      src.start(t); src.stop(t + 0.06);
    },

    /** 摸牌「嗖」：上扫滤波噪声 + 落手哒声 */
    draw() {
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer();
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 2.5;
      bp.frequency.setValueAtTime(500, t);
      bp.frequency.exponentialRampToValueAtTime(3200, t + 0.18);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.07);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      src.connect(bp).connect(g).connect(this.master);
      src.start(t); src.stop(t + 0.22);
      setTimeout(() => this.tick(1.25, 0.9), 180);
    },

    /** 弃牌落河：闷一点的哒 */
    discard() { this.tick(0.75, 0.8); },

    /** 骰子哗啦：三连碎响 */
    dice() {
      if (!this.ready) return;
      [0, 90, 180].forEach((d, i) =>
        setTimeout(() => this.tick(1.6 - i * 0.25, 0.55), d));
    },

    /**
     * 胡牌大锣：多泛音长衰减 + 前置上升五声音阶
     * 音阶：C5→D5→E5→G5→A5（宫商角徵羽），最后锣响
     */
    gong() {
      if (!this.ready) return;
      const t0 = this.ctx.currentTime;
      // 上升音阶
      const scale = [523.25, 587.33, 659.25, 783.99, 880.0];
      scale.forEach((f, i) => {
        const t = t0 + i * 0.09;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'square';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        o.connect(g).connect(this.master);
        o.start(t); o.stop(t + 0.25);
      });
      // 锣：基频 + 不谐和泛音列，长衰减
      const tg = t0 + scale.length * 0.09 + 0.05;
      const partials = [[196, 1], [294, 0.6], [416, 0.5], [560, 0.35], [820, 0.22]];
      partials.forEach(([f, amp]) => {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(f * 1.02, tg);
        o.frequency.exponentialRampToValueAtTime(f * 0.98, tg + 1.8);
        g.gain.setValueAtTime(0.0001, tg);
        g.gain.exponentialRampToValueAtTime(0.5 * amp, tg + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, tg + 2.2);
        o.connect(g).connect(this.master);
        o.start(tg); o.stop(tg + 2.3);
      });
      // 锣面的金属噪声
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer();
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.4, tg);
      g.gain.exponentialRampToValueAtTime(0.001, tg + 0.7);
      src.connect(lp).connect(g).connect(this.master);
      src.start(tg); src.stop(tg + 0.75);
    },

    /** 金币叮当：高频双音快速连响，可循环调用 */
    coin(delay = 0) {
      if (!this.ready) return;
      const t = this.ctx.currentTime + delay;
      [2400, 3150].forEach((f, i) => {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sine'; o.frequency.value = f * (0.95 + Math.random() * 0.1);
        const tt = t + i * 0.03;
        g.gain.setValueAtTime(0.09, tt);
        g.gain.exponentialRampToValueAtTime(0.001, tt + 0.18);
        o.connect(g).connect(this.master);
        o.start(tt); o.stop(tt + 0.2);
      });
    },

    /** 选中卡片的轻叩 */
    select() { this.tick(1.1, 0.6); }
  };

  window.AudioFX = AudioFX;
})();
