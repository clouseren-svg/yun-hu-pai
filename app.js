/* ════════════════════════════════════════════════════════════
   云胡牌 · app.js
   单页状态机：开机屏 → 选番型 → 牌桌 → 胡牌结算
   调试：支持 URL hash 跳转，例如
     #stage=select  #stage=table&fan=guoshi  #stage=win&fan=guoshi&instant=1
     追加 &debug=1 时把 JS 错误写到 <html data-js-error> 便于无头排查
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 调试参数 ─────────────────────────────── */
  const hash = new URLSearchParams(location.hash.slice(1));
  const DEBUG = hash.has('debug');
  if (DEBUG) {
    window.addEventListener('error', (e) => {
      document.documentElement.dataset.jsError = e.message + ' @' + (e.filename || '') + ':' + (e.lineno || '');
    });
    window.addEventListener('unhandledrejection', (e) => {
      document.documentElement.dataset.jsError = 'unhandledrejection: ' + (e.reason && e.reason.message || e.reason);
    });
  }

  const $ = (sel) => document.querySelector(sel);
  const { renderTile, sortTiles, tileName, FANS } = window.Tiles;

  /* ── DOM 引用 ─────────────────────────────── */
  const appEl = $('#app');
  const stages = {
    boot: $('#stage-boot'),
    select: $('#stage-select'),
    table: $('#stage-table'),
    win: $('#stage-win')
  };
  const wallEl = $('#wall');
  const wallTipEl = $('#wall-tip');
  const riverEl = $('#river');
  const handEl = $('#hand');
  const tingEl = $('#ting-banner');
  const btnHu = $('#btn-hu');
  const btnMic = $('#btn-mic');
  const micLabel = $('#mic-label');
  const micMeter = $('#mic-meter');
  const micFill = $('#mic-meter-fill');
  const toastEl = $('#toast');
  const fx = new window.ParticleFX($('#fx-canvas'));

  /* ── 全局状态 ─────────────────────────────── */
  const state = {
    stage: 'boot',
    fan: null,          // 当前番型配置
    hand: [],           // 手牌编码
    scriptIdx: 0,       // 摸打进度
    tenpai: false,
    winDrawn: false,    // 关键张已摸到手
    busy: false,        // 摸打动画进行中
    muted: false
  };

  const QUIPS = [
    '自摸！三家通吃',
    '牌品即人品',
    '手气来了，挡都挡不住',
    '这一手，值一壶好茶',
    '牌桌如江湖，今天我坐庄'
  ];

  /* ── 工具 ─────────────────────────────────── */
  function toast(msg, ms = 2200) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  function vibrate(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (_) {} }
  }

  function showStage(name) {
    Object.entries(stages).forEach(([k, el]) => el.classList.toggle('is-active', k === name));
    state.stage = name;
    if (name !== 'win') { fx.stop(); clearInterval(quipTimer); }
    if (name !== 'table') stopMic();
  }

  /** 骰子点数 → 多点径向渐变背景 */
  function dieFace(v) {
    const P = { 1: [[50, 50, 3.4]], 2: [[28, 28], [72, 72]], 3: [[26, 26], [50, 50], [74, 74]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]], 5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]], 6: [[28, 22], [72, 22], [28, 50], [72, 50], [28, 78], [72, 78]] }[v];
    return P.map(([x, y, r]) => `radial-gradient(circle at ${x}% ${y}%, #c0392b ${r || 2.4}px, transparent ${(r || 2.4) + 0.5}px)`).join(',');
  }

  function rollDice() {
    const d1 = $('#die-1'), d2 = $('#die-2');
    [d1, d2].forEach(d => { d.classList.remove('rolling'); void d.offsetWidth; d.classList.add('rolling'); });
    window.AudioFX.dice();
    setTimeout(() => {
      d1.querySelector('i').style.background = dieFace(1 + (Math.random() * 6 | 0));
      d2.querySelector('i').style.background = dieFace(1 + (Math.random() * 6 | 0));
    }, 420);
  }

  /* ════════════ 阶段一 · 开机屏 ════════════ */
  $('#btn-start').addEventListener('click', () => {
    window.AudioFX.ensure();
    window.AudioFX.tick(1.2, 0.8);
    showStage('select');
  });

  /* ════════════ 阶段二 · 选番型 ════════════ */
  const fanListEl = $('#fan-list');
  const btnToTable = $('#btn-to-table');

  function renderFanCards() {
    fanListEl.innerHTML = '';
    FANS.forEach((fan) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'fan-card';
      card.innerHTML =
        '<span class="fan-seal"><b>' + fan.fan + '<br>番</b></span>' +
        '<span class="fan-main">' +
          '<span class="fan-name">' + fan.name + '</span>' +
          '<span class="fan-desc" style="display:block">' + fan.desc + '</span>' +
        '</span>' +
        '<span class="fan-arrow">➤</span>';
      card.addEventListener('click', () => {
        window.AudioFX.ensure();
        window.AudioFX.select();
        fanListEl.querySelectorAll('.fan-card').forEach(c => c.classList.remove('is-selected'));
        card.classList.add('is-selected');
        state.fan = fan;
        btnToTable.disabled = false;
      });
      fanListEl.appendChild(card);
    });
  }

  btnToTable.addEventListener('click', () => {
    if (!state.fan) return;
    window.AudioFX.ensure();
    initTable(state.fan);
    showStage('table');
  });

  /* ════════════ 阶段三 · 牌桌 ════════════ */
  function initTable(fan) {
    state.fan = fan;
    state.hand = sortTiles(fan.startHand);
    state.scriptIdx = 0;
    state.tenpai = false;
    state.winDrawn = false;
    state.busy = false;
    state._gangDone = false;
    riverEl.innerHTML = '';
    tingEl.classList.remove('show');
    tingEl.innerHTML = '';
    btnHu.classList.remove('ready');
    btnHu.disabled = true;
    $('#fan-chip').textContent = fan.name + ' · ' + fan.fan + '番';
    wallTipEl.textContent = '点牌墙 · 摸牌';
    renderHand();
    renderWall(8);
    rollDice();
  }

  function renderWall(count) {
    wallEl.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const t = document.createElement('span');
      t.className = 'wall-tile';
      wallEl.appendChild(t);
    }
  }

  function renderHand(highlightCode) {
    handEl.innerHTML = '';
    state.hand.forEach((code, i) => {
      const t = renderTile(code);
      if (highlightCode && i === state.hand.length - 1) t.classList.add('is-drawn');
      handEl.appendChild(t);
    });
  }

  /** 生成一张可飞行的牌（定位在 .app 坐标系） */
  function spawnFlyTile(code, fromRect) {
    const appRect = appEl.getBoundingClientRect();
    const el = renderTile(code);
    el.classList.add('fly-tile');
    el.style.left = (fromRect.left - appRect.left) + 'px';
    el.style.top = (fromRect.top - appRect.top) + 'px';
    el.style.width = fromRect.width + 'px';
    el.style.height = fromRect.height + 'px';
    appEl.appendChild(el);
    return { el, appRect };
  }

  function flyTo(fly, toRect, flop) {
    const dx = toRect.left + toRect.width / 2 - (parseFloat(fly.el.style.left) + parseFloat(fly.el.style.width) / 2);
    const dy = toRect.top + toRect.height / 2 - (parseFloat(fly.el.style.top) + parseFloat(fly.el.style.height) / 2);
    if (flop) fly.el.classList.add('flop');
    requestAnimationFrame(() => {
      fly.el.style.transform = `translate(${dx}px, ${dy}px)`;
    });
  }

  /** 摸牌主流程：按番型脚本依次摸打，最后一张即胡牌张 */
  function drawNext() {
    if (state.busy || state.winDrawn) return;
    const step = state.fan.script[state.scriptIdx];
    if (!step) return;

    // 杠上开花彩蛋：关键张前先喊一声「杠！」
    if (step.discard === null && state.fan.flavor === 'gang' && !state._gangDone) {
      state._gangDone = true;
      toast('杠！', 900);
      window.AudioFX.dice();
      setTimeout(drawNext, 620);
      return;
    }

    state.busy = true;
    window.AudioFX.draw();
    vibrate(15);

    // 从牌墙取一张（视觉消耗）
    const wallTiles = wallEl.querySelectorAll('.wall-tile');
    const topTile = wallTiles[wallTiles.length - 1];
    const fromRect = topTile ? topTile.getBoundingClientRect() : wallEl.getBoundingClientRect();

    // 牌背飞入手牌区
    const fly = spawnFlyTile('back', fromRect);
    const handRect = handEl.getBoundingClientRect();
    const target = {
      left: handRect.right - 40, top: handRect.top,
      width: 34, height: 48
    };
    flyTo(fly, target);
    if (topTile) topTile.remove();

    setTimeout(() => {
      // 翻成正面，入手
      state.hand.push(step.draw);
      state.hand = sortTiles(state.hand);
      // 把新摸的牌挪到末尾展示
      const idx = state.hand.lastIndexOf(step.draw);
      state.hand.splice(idx, 1);
      state.hand.push(step.draw);
      renderHand(step.draw);
      fly.el.remove();

      if (step.discard) {
        // 稍作停顿，打出弃牌
        setTimeout(() => discardTile(step.discard), 420);
      } else {
        // 关键张到手！
        state.winDrawn = true;
        state.busy = false;
        btnHu.disabled = false;
        btnHu.classList.add('ready');
        wallTipEl.textContent = '就是这张！';
        wallEl.classList.remove('glow');
        window.AudioFX.tick(0.9, 1);
        vibrate([30, 40, 30]);
        if (!mic.listening) toast('点「胡！」或者喊一嗓子！', 2000);
      }
    }, 400);
  }

  function discardTile(code) {
    const idx = state.hand.indexOf(code);
    if (idx >= 0) state.hand.splice(idx, 1);
    // 从手牌位置飞向弃牌河
    const tiles = handEl.querySelectorAll('.tile');
    const fromEl = tiles[Math.min(idx, tiles.length - 1)] || handEl;
    const fromRect = fromEl.getBoundingClientRect();
    const fly = spawnFlyTile(code, fromRect);
    renderHand();
    const riverRect = riverEl.getBoundingClientRect();
    const slot = {
      left: riverRect.left + riverRect.width / 2 - 11 + (Math.random() - 0.5) * 60,
      top: riverRect.top + 12 + Math.random() * 20,
      width: 22, height: 31
    };
    window.AudioFX.discard();
    flyTo(fly, slot, true);
    setTimeout(() => {
      fly.el.remove();
      riverEl.appendChild(renderTile(code));
      state.scriptIdx++;
      state.busy = false;
      checkTenpai();
    }, 480);
  }

  function checkTenpai() {
    if (state.scriptIdx >= state.fan.script.length - 1 && !state.tenpai) {
      state.tenpai = true;
      tingEl.innerHTML = '<span class="ting-inner">' + state.fan.waitText + '</span>';
      tingEl.classList.add('show');
      wallEl.classList.add('glow');
      wallTipEl.textContent = '手气滚烫 · 再摸一张';
      // 海底捞月：牌墙只剩最后一张月亮
      if (state.fan.flavor === 'lastTile') {
        renderWall(1);
        wallTipEl.textContent = '牌墙只剩最后一张…';
      }
      window.AudioFX.select();
      vibrate(40);
    }
  }

  wallEl.addEventListener('click', () => { window.AudioFX.ensure(); drawNext(); });
  wallEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drawNext(); } });
  $('#dice').addEventListener('click', () => { window.AudioFX.ensure(); rollDice(); });

  /* ── 麦克风「喊胡」彩蛋 ───────────────────── */
  const mic = {
    stream: null, ctx: null, analyser: null, raf: null,
    listening: false, hotFrames: 0, cooldownUntil: 0
  };

  function setMicUI(on) {
    btnMic.classList.toggle('listening', on);
    btnMic.setAttribute('aria-pressed', String(on));
    micLabel.textContent = on ? '听着呢' : '喊胡';
    micMeter.hidden = !on;
  }

  function stopMic() {
    mic.listening = false;
    mic.hotFrames = 0;
    if (mic.raf) cancelAnimationFrame(mic.raf);
    if (mic.stream) { mic.stream.getTracks().forEach(t => t.stop()); mic.stream = null; }
    if (mic.ctx) { mic.ctx.close().catch(() => {}); mic.ctx = null; }
    setMicUI(false);
  }

  function startMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('这儿喊不了，点「胡！」一样响', 2000);
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      mic.stream = stream;
      mic.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = mic.ctx.createMediaStreamSource(stream);
      mic.analyser = mic.ctx.createAnalyser();
      mic.analyser.fftSize = 512;
      src.connect(mic.analyser);
      mic.listening = true;
      setMicUI(true);
      toast('嗓子备好，喊「胡！」', 1800);
      const buf = new Uint8Array(mic.analyser.fftSize);
      const loop = () => {
        if (!mic.listening) return;
        mic.analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i] - 128) / 128;
          if (v > peak) peak = v;
        }
        micFill.style.width = Math.min(100, peak * 160) + '%';
        const now = performance.now();
        if (state.winDrawn && state.stage === 'table' && now > mic.cooldownUntil) {
          if (peak > 0.45) {
            mic.hotFrames++;
            if (mic.hotFrames >= 3) { // 连续 ~50ms 高分贝：算你喊了
              mic.cooldownUntil = now + 3000;
              mic.hotFrames = 0;
              triggerHu('shout');
            }
          } else {
            mic.hotFrames = 0;
          }
        }
        mic.raf = requestAnimationFrame(loop);
      };
      loop();
    }).catch(() => {
      // 权限被拒/不支持：静默降级，不弹错误
      stopMic();
      toast('麦克风没到位，点「胡！」也过瘾', 2000);
    });
  }

  btnMic.addEventListener('click', () => {
    window.AudioFX.ensure();
    if (mic.listening) stopMic(); else startMic();
  });

  /* ════════════ 阶段四 · 胡牌演出 ════════════ */
  btnHu.addEventListener('click', () => { if (state.winDrawn) triggerHu('tap'); });

  function triggerHu(via, opts = {}) {
    if (state.stage !== 'table' && !opts.force) return;
    stopMic();
    state.winDrawn = false;
    btnHu.classList.remove('ready');
    const fan = state.fan;
    const instant = !!opts.instant;

    showStage('win');
    fx.start();

    // 关键牌拍桌
    const slam = $('#win-slam');
    slam.innerHTML = '';
    slam.appendChild(renderTile(fan.winTile));
    requestAnimationFrame(() => slam.classList.add('slam-in'));
    window.AudioFX.gong();
    vibrate([90, 60, 160]);
    appEl.classList.add('shake');
    setTimeout(() => appEl.classList.remove('shake'), 550);

    // 「胡！」砸屏
    const charEl = $('#win-char');
    charEl.classList.remove('char-in');
    // 番型横批
    const banner = $('#win-banner');
    $('#win-banner-text').textContent = fan.name;
    banner.classList.remove('banner-in');

    const d1 = instant ? 0 : 380;
    const d2 = instant ? 0 : 850;
    const d3 = instant ? 0 : 1100;
    setTimeout(() => charEl.classList.add('char-in'), d1);
    setTimeout(() => banner.classList.add('banner-in'), d2);

    // 番数滚动
    setTimeout(() => rollCounter(fan, instant), d3);

    // 彩蛋文案轮换
    startQuips();
  }

  function rollCounter(fan, instant) {
    const numEl = $('#fan-num');
    const scoreEl = $('#win-score');
    if (instant) {
      numEl.textContent = fan.fan;
      scoreEl.textContent = '三家通吃 · 入账 ' + fan.fan * 100 + ' 分';
      return;
    }
    const dur = 1400;
    const t0 = performance.now();
    let coinTick = 0;
    const step = () => {
      // 自取 performance.now()，不依赖 rAF 回调时间戳（headless 虚拟时间下时基可能不同）
      const p = Math.min(Math.max((performance.now() - t0) / dur, 0), 1);
      const eased = 1 - Math.pow(1 - p, 3);
      numEl.textContent = Math.round(fan.fan * eased);
      if (performance.now() - coinTick > 110) { coinTick = performance.now(); window.AudioFX.coin(); }
      if (p < 1) requestAnimationFrame(step);
      else {
        numEl.textContent = fan.fan;
        scoreEl.textContent = '三家通吃 · 入账 ' + fan.fan * 100 + ' 分';
      }
    };
    requestAnimationFrame(step);
  }

  let quipTimer = null;
  function startQuips() {
    clearInterval(quipTimer);
    const el = $('#win-quip');
    let i = 0;
    el.textContent = QUIPS[0];
    quipTimer = setInterval(() => {
      i = (i + 1) % QUIPS.length;
      el.classList.add('swap');
      setTimeout(() => { el.textContent = QUIPS[i]; el.classList.remove('swap'); }, 300);
    }, 2600);
  }

  /* ── 结算按钮 ─────────────────────────────── */
  $('#btn-again').addEventListener('click', () => {
    window.AudioFX.ensure();
    window.AudioFX.select();
    state._gangDone = false;
    initTable(state.fan);
    showStage('table');
  });

  $('#btn-switch').addEventListener('click', () => {
    window.AudioFX.ensure();
    window.AudioFX.select();
    state._gangDone = false;
    showStage('select');
  });

  $('#btn-share').addEventListener('click', () => {
    window.AudioFX.ensure();
    const fan = state.fan;
    const text = `我在「云胡牌」胡了一把【${fan.name} · ${fan.fan}番】，三家通吃入账 ${fan.fan * 100} 分！手机里的满番爽局，纯属娱乐，不赌一分钱。🀄`;
    const done = () => toast('分享文案已复制，去群里凡尔赛吧');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  });

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); }
    catch (_) { toast('复制没成功，手动截个图吧'); }
    ta.remove();
  }

  /* ── 静音开关 ─────────────────────────────── */
  const btnMute = $('#btn-mute');
  btnMute.addEventListener('click', () => {
    window.AudioFX.ensure();
    state.muted = !state.muted;
    window.AudioFX.setMuted(state.muted);
    btnMute.classList.toggle('muted', state.muted);
    btnMute.setAttribute('aria-pressed', String(state.muted));
  });

  /* ── 初始化 + 调试跳转 ────────────────────── */
  renderFanCards();

  (function debugJump() {
    const stage = hash.get('stage');
    if (!stage) return;
    window.AudioFX.ensure(); // 无头环境下通常失败，已做静默保护
    const fanId = hash.get('fan') || 'guoshi';
    const fan = FANS.find(f => f.id === fanId) || FANS[FANS.length - 1];
    if (stage === 'select') {
      showStage('select');
    } else if (stage === 'table') {
      initTable(fan);
      showStage('table');
      if (hash.get('ff') === 'tenpai') {
        // 快进：瞬间完成全部摸打，进入听牌
        while (state.scriptIdx < fan.script.length - 1) {
          const s = fan.script[state.scriptIdx];
          const di = state.hand.indexOf(s.discard);
          if (di >= 0) state.hand.splice(di, 1);
          state.hand.push(s.draw);
          state.hand = sortTiles(state.hand);
          riverEl.appendChild(renderTile(s.discard));
          state.scriptIdx++;
        }
        renderHand();
        renderWall(fan.flavor === 'lastTile' ? 1 : 6);
        checkTenpai();
      }
    } else if (stage === 'win') {
      initTable(fan);
      showStage('table');
      state._gangDone = true;
      triggerHu('debug', { force: true, instant: hash.get('instant') === '1' });
    }
    // 自动播放：走真实摸打流程连点三次牌墙，最后点「胡！」
    if (hash.get('autoplay') === '1' && (stage === 'table' || !stage)) {
      if (!stage) { initTable(fan); showStage('table'); }
      const taps = fan.script.length;
      for (let i = 0; i < taps; i++) {
        setTimeout(() => wallEl.click(), 600 + i * 1700);
      }
      setTimeout(() => btnHu.click(), 600 + taps * 1700);
    }
  })();
})();
