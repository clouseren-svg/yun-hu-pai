/* ════════════════════════════════════════════════════════════
   云胡牌 · app.js
   UI 控制器：开机 → 模式 → 引导 → 牌桌 → 单局结算 → 整场结算
   通过 hooks 与 game.js 对局引擎对接；引擎本身不碰 DOM。
   调试入口（URL hash）：
     #stage=mode|tutorial|table|claim|win|match
     #stage=table&seed=7&mode=rookie        真开局（停在你的决策点）
     #stage=table&seed=7&fake=claim         真牌桌 + 演示声明弹窗
     #autoplay=1&seed=7&mode=rookie         AI 代打整场到总结算
     任意页面追加 &debug=1：JS 错误写入 <html data-js-error>
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 静默错误兜底（不糊脸，仅记录） ────────────── */
  window.addEventListener('error', (e) => {
    document.documentElement.dataset.jsError = e.message + ' @' + (e.filename || '') + ':' + (e.lineno || '');
  });
  window.addEventListener('unhandledrejection', (e) => {
    document.documentElement.dataset.jsError = 'unhandledrejection: ' + (e.reason && e.reason.message || e.reason);
  });

  const E = window.Engine;
  const A = window.AI;
  const { MahjongGame } = window.Game;
  const { renderTile, tileName } = window.Tiles;
  const $ = (sel) => document.querySelector(sel);

  const hash = new URLSearchParams(location.hash.slice(1));
  const DEBUG_SEED = hash.get('seed');
  const FAST = hash.has('fast');

  /* ── DOM 引用 ─────────────────────────────── */
  const appEl = $('#app');
  const stages = {
    boot: $('#stage-boot'), mode: $('#stage-mode'), tutorial: $('#stage-tutorial'),
    table: $('#stage-table'), win: $('#stage-win'), match: $('#stage-match')
  };
  const toastEl = $('#toast');
  const fx = new window.ParticleFX($('#fx-canvas'));
  const handEl = $('#hand');
  const myMeldsEl = $('#my-melds');
  const tingEl = $('#ting-banner');
  const claimBar = $('#claim-bar');
  const claimBtns = $('#claim-btns');
  const claimFill = $('#claim-timer-fill');
  const selfBar = $('#self-bar');
  const handTip = $('#hand-tip');

  /* ── 全局 UI 状态 ─────────────────────────── */
  const ui = {
    mode: 'rookie',
    game: null,
    turnSeat: -1,        // 当前行动座位（高亮）
    selectedIdx: -1,     // 手牌选中
    discardResolver: null,
    selfResolver: null,
    claimResolver: null,
    claimTimer: null,
    stashDiscard: null,  // 自家声明阶段直接点牌 = 放弃声明并打出
    muted: false
  };

  const ROUND_NAMES = ['一', '二', '三', '四'];
  const WINDS = ['東', '南', '西', '北'];

  /* ── 工具 ─────────────────────────────────── */
  function toast(msg, ms = 2200) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove('show'), ms);
  }
  function vibrate(p) { if (navigator.vibrate) { try { navigator.vibrate(p); } catch (_) {} } }
  /** 分数字符串 → 千分位展示；异常/旧存档脏数据兜底为 0，绝不糊超长数字 */
  function fmt(scoreStr) {
    const n = Number(scoreStr);
    return E.formatPoints(isFinite(n) ? n : 0);
  }

  function showStage(name) {
    Object.entries(stages).forEach(([k, el]) => el.classList.toggle('is-active', k === name));
    if (name !== 'win') { fx.stop(); }
  }

  /* ════════════ 牌桌渲染 ════════════ */
  function seatEl(seat) { return $('#seat-' + seat); }

  function renderAll() {
    const g = ui.game;
    if (!g) return;
    const s = g.publicState();
    // 顶部信息
    $('#round-label').textContent =
      '東風圈 · 東' + ROUND_NAMES[s.roundNum - 1] + '局' + (s.renchan ? ' · 连庄×' + s.renchan : '');
    $('#wall-label').textContent = '牌墙 ' + s.wallLeft;
    $('#my-score').textContent = '你 · ' + fmt(s.players[0].score);
    // 座位
    for (const p of s.players) {
      const el = seatEl(p.seat);
      if (!el) continue;
      el.classList.toggle('is-dealer', s.dealer === p.seat);
      el.classList.toggle('is-turn', ui.turnSeat === p.seat);
      el.querySelector('.seat-score').textContent = fmt(p.score);
      if (p.seat !== 0) {
        // 手牌背
        const backs = el.querySelector('.backs');
        backs.innerHTML = '';
        for (let i = 0; i < p.concealed.length; i++) {
          const b = document.createElement('span');
          b.className = 'back-mini';
          backs.appendChild(b);
        }
        // 副露
        const meldsEl = el.querySelector('.melds');
        meldsEl.innerHTML = '';
        for (const m of p.melds) meldsEl.appendChild(renderMeldGroup(m, true));
      }
    }
    // 牌河
    for (let seat = 0; seat < 4; seat++) {
      const pile = $('#river-' + seat);
      pile.innerHTML = '';
      const ds = s.players[seat].discards;
      ds.forEach((code, i) => {
        const t = renderTile(code);
        if (i === ds.length - 1) t.classList.add('last-discard');
        pile.appendChild(t);
      });
    }
    // 自家副露 + 手牌
    myMeldsEl.innerHTML = '';
    for (const m of s.players[0].melds) myMeldsEl.appendChild(renderMeldGroup(m, false));
    renderHand();
    updateTingBanner();
  }

  function renderMeldGroup(m, mini) {
    const div = document.createElement('div');
    div.className = 'meld-group';
    const tiles = m.type === 'ankong'
      ? [m.tiles[0], m.tiles[0], m.tiles[0], m.tiles[0]]
      : m.tiles;
    tiles.forEach((t, i) => {
      // 暗杠中间两张盖着
      const el = renderTile(m.type === 'ankong' && (i === 1 || i === 2) ? 'back' : E.codeOf(t));
      div.appendChild(el);
    });
    void mini;
    return div;
  }

  function renderHand() {
    const g = ui.game;
    handEl.innerHTML = '';
    ui.selectedIdx = -1;
    if (!g) return;
    g.players[0].concealed.forEach((code, i) => {
      const t = renderTile(code);
      t.dataset.idx = i;
      handEl.appendChild(t);
    });
  }

  /** 新手场辅助：听牌横幅 + 推荐出牌 */
  function updateTingBanner() {
    tingEl.innerHTML = '';
    if (ui.mode !== 'rookie' || !ui.game) return;
    const p = ui.game.players[0];
    if (p.concealed.length % 3 !== 1) return; // 非 13 张形态（摸牌后 14 张不算）
    const counts = E.countsOf(p.concealed);
    if (E.shanten(counts, p.melds.length) !== 0) return;
    const waits = E.waitTiles(counts, p.melds.length);
    if (!waits.length) return;
    const box = document.createElement('span');
    box.className = 'ting-inner';
    box.appendChild(document.createTextNode('听 '));
    waits.forEach((w) => box.appendChild(renderTile(E.codeOf(w))));
    tingEl.appendChild(box);
  }

  function markRecommended() {
    if (ui.mode !== 'rookie' || !ui.game) return;
    const p = ui.game.players[0];
    const rec = A.chooseDiscard(p.concealed, p.melds);
    handEl.querySelectorAll('.tile').forEach((t) => {
      if (t.dataset.code === rec) t.classList.add('rec');
    });
  }

  /* ── 飞牌小动画 ───────────────────────────── */
  function flyTile(code, fromRect, toRect, flop, size) {
    const appRect = appEl.getBoundingClientRect();
    const w = (size && size.w) || 30, h = (size && size.h) || 43;
    const el = renderTile(code);
    el.classList.add('fly-tile');
    // 起点居中于 fromRect，尺寸用牌自身大小（容器 rect 只是锚点）
    el.style.left = (fromRect.left + fromRect.width / 2 - w / 2 - appRect.left) + 'px';
    el.style.top = (fromRect.top + fromRect.height / 2 - h / 2 - appRect.top) + 'px';
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    appEl.appendChild(el);
    const dx = toRect.left + toRect.width / 2 - (fromRect.left + fromRect.width / 2);
    const dy = toRect.top + toRect.height / 2 - (fromRect.top + fromRect.height / 2);
    if (flop) el.classList.add('flop');
    requestAnimationFrame(() => { el.style.transform = `translate(${dx}px, ${dy}px)`; });
    setTimeout(() => el.remove(), 520);
  }

  function seatAnchorRect(seat) {
    const el = seat === 0 ? handEl : seatEl(seat).querySelector('.seat-info');
    return el.getBoundingClientRect();
  }

  /* ════════════ 对局 hooks ════════════ */
  const hooks = {
    event(name, data) {
      switch (name) {
        case 'matchStart': {
          const dName = ui.game.players[data.dealer].name;
          toast('掷骰 ' + data.dice.join(' + ') + ' · ' + dName + ' 坐庄', 2200);
          window.AudioFX.dice();
          break;
        }
        case 'shuffle':
          showStage('table');
          fx.stop();
          ui.turnSeat = -1;
          claimBar.hidden = true;
          selfBar.hidden = true;
          ui.discardResolver = null; ui.selfResolver = null; ui.claimResolver = null;
          appEl.classList.add('shuffling');
          window.AudioFX.shuffle();
          window.AudioFX.roundBell();
          setTimeout(() => appEl.classList.remove('shuffling'), 650);
          hideDrawOverlay();
          break;
        case 'deal':
          ui.turnSeat = data.dealer;
          renderAll();
          break;
        case 'draw':
          ui.turnSeat = data.seat;
          renderAll();
          if (data.seat !== 0) window.AudioFX.tick(1.1, 0.3);
          break;
        case 'discard': {
          ui.turnSeat = data.seat;
          const pile = $('#river-' + data.seat);
          const pr = pile.getBoundingClientRect();
          const big = data.seat === 0;
          flyTile(data.tile, seatAnchorRect(data.seat),
            { left: pr.left + pr.width / 2 - 9, top: pr.top + pr.height / 2 - 12, width: 18, height: 24 },
            true, big ? { w: 30, h: 43 } : { w: 18, h: 24 });
          window.AudioFX.discard();
          setTimeout(renderAll, 300);
          break;
        }
        case 'meld': {
          const label = { chi: '吃', pong: '碰！', kong: '杠！', ankong: '暗杠！' }[data.type] || '';
          toast(ui.game.players[data.seat].name + ' · ' + label, 1200);
          window.AudioFX.meld(data.type);
          vibrate(30);
          renderAll();
          break;
        }
        case 'win': showWin(data); break;
        case 'exhausted': break; // 荒庄提示由 pause 钩子处理
        case 'matchEnd': showMatch(data); break;
      }
    },

    /* 人类出牌 */
    askDiscard(player) {
      return new Promise((resolve) => {
        if (ui.stashDiscard) { const c = ui.stashDiscard; ui.stashDiscard = null; resolve(c); return; }
        handTip.textContent = ui.mode === 'rookie' ? '轮到你 · 点牌选中，再点打出' : '轮到你出牌';
        window.AudioFX.turn();
        markRecommended();
        ui.discardResolver = resolve;
      });
      void player;
    },

    /* 人类摸牌后声明（自摸/暗杠/补杠） */
    askSelfClaims(player, opts) {
      return new Promise((resolve) => {
        selfBar.innerHTML = '';
        selfBar.hidden = false;
        const mk = (label, act, ghost) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'self-btn' + (ghost ? ' ghost' : '');
          b.textContent = label;
          b.addEventListener('click', () => { selfBar.hidden = true; window.AudioFX.select(); resolve(act); });
          selfBar.appendChild(b);
        };
        if (opts.hu) mk('自摸！', { action: 'hu' });
        opts.ankong.forEach((i) => mk('暗杠 ' + tileName(E.codeOf(i)), { action: 'ankong', tile: i }));
        opts.addkong.forEach((i) => mk('补杠 ' + tileName(E.codeOf(i)), { action: 'addkong', tile: i }));
        mk('先不', null, true);
        ui.selfResolver = resolve; // 若此时点手牌：视为放弃声明并打出
      });
    },

    /* 人类对他人弃牌的声明（5 秒倒计时） */
    askClaims(player, opts) {
      return new Promise((resolve) => {
        claimBtns.innerHTML = '';
        claimBar.hidden = false;
        if (opts.rob) toast('有人补杠——可以抢！', 1600);
        const done = (act) => {
          clearInterval(ui.claimTimer);
          claimBar.hidden = true;
          ui.claimResolver = null;
          resolve(act);
        };
        const mk = (label, act, cls, tilesHtml) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'claim-btn' + (cls ? ' ' + cls : '');
          if (tilesHtml) { tilesHtml.forEach((t) => b.appendChild(t)); }
          else b.textContent = label;
          b.addEventListener('click', () => { window.AudioFX.select(); done(act); });
          claimBtns.appendChild(b);
          return b;
        };
        if (opts.hu) mk('胡!', { action: 'hu' }, 'hu');
        if (opts.kong) mk('杠', { action: 'kong' });
        if (opts.pong) mk('碰', { action: 'pong' });
        opts.chi.forEach((seq) => {
          mk('吃', { action: 'chi', tiles: seq }, '', seq.map((i) => renderTile(E.codeOf(i))));
        });
        mk('过', null, 'pass');
        // 5 秒倒计时
        claimFill.style.width = '100%';
        const t0 = performance.now();
        ui.claimTimer = setInterval(() => {
          const left = Math.max(0, 1 - (performance.now() - t0) / 5000);
          claimFill.style.width = left * 100 + '%';
          if (left <= 0) done(null); // 超时自动放弃
        }, 100);
        ui.claimResolver = done;
      });
    },

    /* 局间闸门：胡牌结算等点击 / 流局提示自动继续 */
    pause(result) {
      return new Promise((resolve) => {
        if (result.drawGame) {
          showDrawOverlay();
          setTimeout(() => { hideDrawOverlay(); resolve(); }, FAST ? 200 : 1600);
          return;
        }
        // 等「下一局/看总账」点击；autoplay 自动继续
        const btn = $('#btn-next-round');
        btn.textContent = result.roundNum >= 4 ? '看总账' : '下一局';
        const go = () => { btn.removeEventListener('click', go); resolve(); };
        btn.addEventListener('click', go);
        if (ui.game && ui.game.autoHuman) setTimeout(go, FAST ? 300 : 1800);
      });
    }
  };

  /* ── 手牌交互：点选/再点打出/双击/上滑 ─────── */
  handEl.addEventListener('click', (e) => {
    const t = e.target.closest('.tile');
    if (!t) return;
    const idx = Number(t.dataset.idx);
    const code = t.dataset.code;
    window.AudioFX.ensure();
    // 声明阶段点牌 = 放弃声明并打出
    if (ui.selfResolver) {
      const r = ui.selfResolver;
      ui.selfResolver = null;
      selfBar.hidden = true;
      ui.stashDiscard = code;
      r(null);
      return;
    }
    if (!ui.discardResolver) return;
    if (ui.selectedIdx === idx) {
      // 再点：打出
      const r = ui.discardResolver;
      ui.discardResolver = null;
      ui.selectedIdx = -1;
      handTip.textContent = '';
      window.AudioFX.tick(1.2, 0.7);
      r(code);
    } else {
      ui.selectedIdx = idx;
      handEl.querySelectorAll('.tile').forEach((x) => x.classList.toggle('selected', x === t));
      window.AudioFX.tick(1.4, 0.4);
    }
  });
  handEl.addEventListener('dblclick', (e) => {
    const t = e.target.closest('.tile');
    if (!t || !ui.discardResolver) return;
    const r = ui.discardResolver;
    ui.discardResolver = null;
    ui.selectedIdx = -1;
    r(t.dataset.code);
  });
  // 上滑出牌
  let touchStart = null;
  handEl.addEventListener('touchstart', (e) => {
    const t = e.target.closest('.tile');
    touchStart = t ? { y: e.touches[0].clientY, el: t } : null;
  }, { passive: true });
  handEl.addEventListener('touchend', (e) => {
    if (!touchStart || !ui.discardResolver) { touchStart = null; return; }
    const dy = e.changedTouches[0].clientY - touchStart.y;
    if (dy < -36) {
      const r = ui.discardResolver;
      ui.discardResolver = null;
      r(touchStart.el.dataset.code);
      e.preventDefault();
    }
    touchStart = null;
  });

  /* ════════════ 胡牌结算演出 ════════════ */
  const INSTANT_WIN = hash.get('instant') === '1'; // 调试截图：跳过演出动画
  function showWin(r) {
    showStage('win');
    stages.win.classList.toggle('instant', INSTANT_WIN);
    const T = (ms) => (INSTANT_WIN ? 0 : ms);
    fx.start();
    window.AudioFX.gong();
    vibrate([90, 60, 160]);
    appEl.classList.add('shake');
    setTimeout(() => appEl.classList.remove('shake'), 550);

    // 关键牌拍桌
    const slam = $('#win-slam');
    slam.innerHTML = '';
    slam.classList.remove('slam-in');
    slam.appendChild(renderTile(r.winTile));
    requestAnimationFrame(() => slam.classList.add('slam-in'));

    // 胡！与横幅
    const charEl = $('#win-char');
    charEl.classList.remove('char-in');
    $('#win-banner-text').textContent =
      r.winnerName + ' · ' + (r.selfDraw ? '自摸' : '点炮') + (r.renchan ? ' · 连庄×' + r.renchan : '');
    const banner = $('#win-banner');
    banner.classList.remove('banner-in');
    setTimeout(() => charEl.classList.add('char-in'), T(380));
    setTimeout(() => banner.classList.add('banner-in'), T(850));

    // 番种明细逐行弹出
    const list = $('#fan-breakdown');
    list.innerHTML = '';
    r.items.forEach((it, i) => {
      const li = document.createElement('li');
      li.innerHTML = '<span>' + it.name + '</span><b>' + it.fan + ' 番</b>';
      list.appendChild(li);
      setTimeout(() => li.classList.add('in'), T(1050 + i * 160));
    });

    // 番数滚动 + 进账
    setTimeout(() => INSTANT_WIN ? finishCounter(r) : rollCounter(r), T(1100 + r.items.length * 160));

    // 资金流水
    const tr = $('#win-transfers');
    tr.innerHTML = '';
    r.transfers.forEach((t, i) => {
      const li = document.createElement('li');
      li.innerHTML = t.fromName + ' → ' + t.toName + '　<b>+' + fmt(t.amount) + '</b> 分';
      tr.appendChild(li);
      setTimeout(() => li.classList.add('in'), T(1900 + i * 180));
    });
  }

  function finishCounter(r) {
    $('#fan-num').textContent = r.fan;
    $('#fan-cap-note').hidden = r.fan <= 88;
    $('#win-score').textContent = (r.selfDraw ? '三家通吃 · 进账 ' : '点炮独付 · 进账 ') + fmt(r.points) + ' 分';
  }

  function rollCounter(r) {
    const numEl = $('#fan-num');
    const scoreEl = $('#win-score');
    const capNote = $('#fan-cap-note');
    capNote.hidden = true;
    const dur = 1200;
    const t0 = performance.now();
    let coinTick = 0;
    const step = () => {
      const p = Math.min(Math.max((performance.now() - t0) / dur, 0), 1);
      const eased = 1 - Math.pow(1 - p, 3);
      numEl.textContent = Math.round(Math.min(r.fan, 888) * eased);
      if (performance.now() - coinTick > 110) { coinTick = performance.now(); window.AudioFX.coin(); }
      if (p < 1) requestAnimationFrame(step);
      else finishCounter(r);
    };
    requestAnimationFrame(step);
  }

  /* ── 流局覆盖层 ───────────────────────────── */
  function showDrawOverlay() {
    $('#draw-overlay').hidden = false;
    window.AudioFX.tick(0.6, 0.8);
  }
  function hideDrawOverlay() { $('#draw-overlay').hidden = true; }

  /* ════════════ 整场总结算 ════════════ */
  function showMatch(data) {
    showStage('match');
    fx.start();
    const medal = ['①', '②', '③', '④'];
    $('#match-champion').textContent = data.ranking[0].name + ' 技压群雄';
    const list = $('#match-list');
    list.innerHTML = '';
    data.ranking.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'match-row' + (i === 0 ? ' champ' : '');
      const neg = p.score.startsWith('-');
      row.innerHTML =
        '<span class="match-rank">' + medal[i] + '</span>' +
        '<span class="match-name">' + p.name + (p.seat === 0 ? '<span class="is-you">你</span>' : '') + '</span>' +
        '<span class="match-score' + (neg ? ' neg' : '') + '">' + (neg ? '' : '+') + fmt(p.score) + '</span>';
      list.appendChild(row);
      setTimeout(() => row.classList.add('in'), 250 + i * 200);
    });
  }

  /* ════════════ 流程控制 ════════════ */
  function startMatch(mode, opts) {
    opts = opts || {};
    ui.mode = mode;
    $('#mode-chip').textContent = mode === 'pro' ? '计番场' : '新手场';
    const seed = opts.seed != null ? opts.seed : (DEBUG_SEED != null ? Number(DEBUG_SEED) : null);
    ui.game = new MahjongGame({
      mode,
      hooks,
      rng: seed != null ? E.mulberry32(seed) : Math.random,
      delayScale: opts.delayScale != null ? opts.delayScale : (FAST ? 0.12 : 1),
      autoHuman: !!opts.autoHuman
    });
    showStage('table');
    renderAll();
    ui.game.startMatch();
  }

  $('#btn-start').addEventListener('click', () => {
    window.AudioFX.ensure();
    window.AudioFX.tick(1.2, 0.8);
    showStage('mode');
  });

  function pickMode(mode) {
    window.AudioFX.ensure();
    window.AudioFX.select();
    if (mode === 'rookie' && !localStorage.getItem('yhp_tut_v1')) {
      showStage('tutorial');
      tutGo(0);
      return;
    }
    startMatch(mode);
  }
  $('#mode-rookie').addEventListener('click', () => pickMode('rookie'));
  $('#mode-pro').addEventListener('click', () => pickMode('pro'));

  /* ── 引导页翻页 ───────────────────────────── */
  const tutPages = $('#tut-pages');
  let tutIdx = 0;
  function tutGo(i) {
    tutIdx = Math.max(0, Math.min(2, i));
    tutPages.scrollTo({ left: tutIdx * tutPages.clientWidth, behavior: 'smooth' });
    $('#tut-dots').querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === tutIdx));
    $('#tut-next').textContent = tutIdx === 2 ? '上桌！' : '下一条';
  }
  tutPages.addEventListener('scroll', () => {
    const i = Math.round(tutPages.scrollLeft / tutPages.clientWidth);
    if (i !== tutIdx) tutGo(i);
  }, { passive: true });
  $('#tut-next').addEventListener('click', () => {
    window.AudioFX.ensure();
    if (tutIdx < 2) { tutGo(tutIdx + 1); window.AudioFX.select(); }
    else finishTut();
  });
  $('#tut-skip').addEventListener('click', finishTut);
  function finishTut() {
    localStorage.setItem('yhp_tut_v1', '1');
    startMatch('rookie');
  }

  /* ── 总结算按钮 ───────────────────────────── */
  $('#btn-rematch').addEventListener('click', () => { window.AudioFX.select(); startMatch(ui.mode); });
  $('#btn-menu').addEventListener('click', () => { window.AudioFX.select(); showStage('mode'); });

  /* ── 麦克风「喊胡」彩蛋 ───────────────────── */
  const mic = { stream: null, ctx: null, analyser: null, raf: null, listening: false, hot: 0, coolUntil: 0 };
  const btnMic = $('#btn-mic');
  function setMicUI(on) {
    btnMic.classList.toggle('listening', on);
    btnMic.setAttribute('aria-pressed', String(on));
    $('#mic-label').textContent = on ? '听着呢' : '喊胡';
  }
  function stopMic() {
    mic.listening = false; mic.hot = 0;
    if (mic.raf) cancelAnimationFrame(mic.raf);
    if (mic.stream) { mic.stream.getTracks().forEach((t) => t.stop()); mic.stream = null; }
    if (mic.ctx) { mic.ctx.close().catch(() => {}); mic.ctx = null; }
    setMicUI(false);
  }
  function shoutHu() {
    // 仅当真有「胡/自摸」按钮可点时，喊胡才生效
    let huBtn = null;
    if (!claimBar.hidden) huBtn = claimBtns.querySelector('.claim-btn.hu');
    if (!huBtn && !selfBar.hidden) {
      huBtn = Array.from(selfBar.querySelectorAll('.self-btn')).find((b) => b.textContent === '自摸！');
    }
    if (huBtn) { huBtn.click(); toast('喊得震天响！', 1500); }
  }
  btnMic.addEventListener('click', () => {
    window.AudioFX.ensure();
    if (mic.listening) { stopMic(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('这儿喊不了，点「胡！」一样响', 2000);
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      mic.stream = stream;
      mic.ctx = new (window.AudioContext || window.webkitAudioContext)();
      mic.analyser = mic.ctx.createAnalyser();
      mic.analyser.fftSize = 512;
      mic.ctx.createMediaStreamSource(stream).connect(mic.analyser);
      mic.listening = true;
      setMicUI(true);
      toast('嗓子备好，能胡时喊一嗓子', 1800);
      const buf = new Uint8Array(mic.analyser.fftSize);
      const loop = () => {
        if (!mic.listening) return;
        mic.analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i] - 128) / 128;
          if (v > peak) peak = v;
        }
        const now = performance.now();
        if (now > mic.coolUntil && peak > 0.45) {
          if (++mic.hot >= 3) { mic.coolUntil = now + 3000; mic.hot = 0; shoutHu(); }
        } else mic.hot = 0;
        mic.raf = requestAnimationFrame(loop);
      };
      loop();
    }).catch(() => { stopMic(); toast('麦克风没到位，点「胡！」也过瘾', 2000); });
  });

  /* ── 静音开关 ─────────────────────────────── */
  const btnMute = $('#btn-mute');
  btnMute.addEventListener('click', () => {
    window.AudioFX.ensure();
    ui.muted = !ui.muted;
    window.AudioFX.setMuted(ui.muted);
    btnMute.classList.toggle('muted', ui.muted);
  });

  /* ════════════ 调试 / 演示入口 ════════════ */
  (function debugJump() {
    const stage = hash.get('stage');
    const autoplay = hash.get('autoplay') === '1';
    const seed = DEBUG_SEED != null ? Number(DEBUG_SEED) : 7;
    const mode = hash.get('mode') === 'pro' ? 'pro' : 'rookie';
    if (autoplay) {
      startMatch(mode, { autoHuman: true, seed, delayScale: FAST ? 0.05 : 0.15 });
      return;
    }
    if (!stage || stage === 'boot') return;
    if (stage === 'mode' || stage === 'tutorial') { showStage(stage); return; }
    if (stage === 'table' || stage === 'claim') {
      startMatch(mode, { seed });
      if (hash.get('fake') === 'claim') {
        // 演示声明弹窗（不影响后台真实对局）
        setTimeout(() => {
          claimBtns.innerHTML = '';
          claimBar.hidden = false;
          const mk = (label, cls) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'claim-btn' + (cls ? ' ' + cls : '');
            b.textContent = label;
            claimBtns.appendChild(b);
          };
          mk('胡!', 'hu'); mk('杠'); mk('碰');
          const chiBtn = document.createElement('button');
          chiBtn.type = 'button'; chiBtn.className = 'claim-btn';
          ['3m', '4m', '5m'].forEach((c) => chiBtn.appendChild(renderTile(c)));
          claimBtns.appendChild(chiBtn);
          mk('过', 'pass');
          claimFill.style.width = '62%';
        }, 800);
      }
      return;
    }
    if (stage === 'win') {
      showWin({
        winner: 0, winnerName: '你', selfDraw: true, loser: null, winTile: '1m', renchan: 1,
        fan: 99, items: [
          { name: '国士无双', fan: 88 }, { name: '杠上开花', fan: 8 },
          { name: '自摸', fan: 1 }, { name: '门清', fan: 1 }, { name: '推倒胡底', fan: 1 }
        ],
        points: String(E.pointsOf(99)),
        transfers: [
          { from: 1, fromName: '阿柴', to: 0, toName: '你', amount: String(E.pointsOf(99)) },
          { from: 2, fromName: '龙五', to: 0, toName: '你', amount: String(E.pointsOf(99)) },
          { from: 3, fromName: '霞姨', to: 0, toName: '你', amount: String(E.pointsOf(99)) }
        ],
        scores: [], roundNum: 2, renchan: 1
      });
      $('#btn-next-round').textContent = '下一局';
      return;
    }
    if (stage === 'match') {
      showMatch({
        ranking: [
          { seat: 2, name: '龙五', score: '12345' },
          { seat: 0, name: '你', score: String(E.pointsOf(30)) },
          { seat: 1, name: '阿柴', score: '-' + E.pointsOf(29) },
          { seat: 3, name: '霞姨', score: '-2048' }
        ]
      });
    }
  })();
})();
