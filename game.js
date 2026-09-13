/* ════════════════════════════════════════════════════════════
   云胡牌 · game.js
   四人麻将对局流程状态机（大众规则 / 简化国标）：
   洗牌码墙 → 掷骰定庄 → 发牌 → 摸打循环 → 声明裁决 → 计分
   → 连庄/轮庄 → 东风圈四局一场 → 总结算。
   通过 hooks 与 UI 解耦，node 可无人值守跑整场（测试/演示）。

   牌墙约定：wall[head++] 摸牌，wall[tail--] 杠后补牌；
   head > tail 即荒庄。摸到最后一张可摸牌触发海底捞月标记。
   ════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const E = isNode ? require('./engine.js') : root.Engine;
  const A = isNode ? require('./ai.js') : root.AI;
  const M = factory(E, A);
  if (isNode) module.exports = M;
  root.Game = M;
})(typeof self !== 'undefined' ? self : globalThis, function (E, A) {
  'use strict';

  const PLAYER_NAMES = ['你', '阿柴', '龙五', '霞姨']; // 座次 0 自家 / 1 下家 / 2 对家 / 3 上家

  class MahjongGame {
    /**
     * cfg:
     *  mode: 'rookie'（推倒胡，1番起）| 'pro'（计番场，8番起胡）
     *  hooks: {
     *    event(name, data)                       状态变化通知（UI 渲染）
     *    askDiscard(player)                      → Promise<code>       人类出牌
     *    askClaims(player, opts)                 → Promise<claim|null> 人类对弃牌声明（5s 超时 UI 自决）
     *    askSelfClaims(player, opts)             → Promise<claim|null> 人类摸牌后自摸/杠声明
     *  }
     *  rng 可注入种子随机；delayScale 节奏缩放；autoHuman: 0 号位也由 AI 代打
     */
    constructor(cfg) {
      this.mode = cfg.mode || 'rookie';
      this.hooks = cfg.hooks || {};
      this.rng = cfg.rng || Math.random;
      this.delayScale = cfg.delayScale == null ? 1 : cfg.delayScale;
      this.autoHuman = !!cfg.autoHuman;
      this.minFan = this.mode === 'pro' ? 8 : 1;
      this.players = [0, 1, 2, 3].map((seat) => ({
        seat, name: PLAYER_NAMES[seat],
        isAI: seat !== 0 || this.autoHuman,
        concealed: [], melds: [], discards: [],
        score: 0
      }));
      this.dealer = 0;
      this.roundNum = 1;   // 东一局..东四局
      this.renchan = 0;    // 连庄数
    }

    emit(name, data) { if (this.hooks.event) this.hooks.event(name, data || {}); }
    sleep(ms) { return new Promise((r) => setTimeout(r, ms * this.delayScale)); }
    aiDelay() { return this.sleep(600 + this.rng() * 600); }

    /* ── 整场：东风圈四局 ─────────────────────────── */
    async startMatch() {
      // 掷骰定庄
      const dice = [1 + (this.rng() * 6 | 0), 1 + (this.rng() * 6 | 0)];
      this.dealer = (dice[0] + dice[1] - 2) % 4;
      this.emit('matchStart', { dice, dealer: this.dealer, mode: this.mode });
      await this.sleep(900);

      let played = 0;
      while (played++ < 50) { // 50 局兜底防死循环（正常 4~10 局结束）
        const result = await this.playRound();
        // 局间暂停钩子：UI 等待玩家点「下一局」/ 流局提示
        if (this.hooks.pause) await this.hooks.pause(result);
        if (result.drawGame) {
          this.emit('exhausted', { roundNum: this.roundNum });
          await this.sleep(1500);
          continue; // 荒庄：本场重开不计分
        }
        if (this.roundNum >= 4) break; // 东四局打完即终场
        if (result.winner === this.dealer) {
          this.renchan++; // 连庄：局数不动
        } else {
          this.dealer = (this.dealer + 1) % 4;
          this.roundNum++;
          this.renchan = 0;
        }
      }
      const ranking = this.players.slice().sort((a, b) =>
        b.score - a.score || a.seat - b.seat);
      this.emit('matchEnd', {
        ranking: ranking.map((p) => ({ seat: p.seat, name: p.name, score: p.score.toString() }))
      });
    }

    /* ── 单局 ─────────────────────────────────────── */
    async playRound() {
      const wall = E.shuffle(E.buildWall(), this.rng);
      this.emit('shuffle', { roundNum: this.roundNum, renchan: this.renchan, dealer: this.dealer });
      await this.sleep(700);

      for (const p of this.players) { p.concealed = []; p.melds = []; p.discards = []; }
      for (let k = 0; k < 13; k++) for (const p of this.players) p.concealed.push(wall[k * 4 + p.seat]);
      this.wall = wall;
      this.head = 52;                    // 摸牌指针
      this.tail = this.wall.length - 1;  // 杠补指针（牌墙尾）
      for (const p of this.players) this.sortHand(p);
      this.emit('deal', this.publicState());
      await this.sleep(500);

      let current = this.dealer;
      while (true) {
        if (this.head > this.tail) return { drawGame: true };
        const p = this.players[current];
        const lastTile = this.head === this.tail;
        const drawn = this.wall[this.head++];
        p.concealed.push(drawn);
        this.sortHand(p);
        this.lastDrawnIdx = E.idxOf(drawn);
        this.emit('draw', { seat: current, tile: drawn, wallLeft: this.tail - this.head + 1 });

        // 自家声明（自摸/暗杠/补杠，杠后补牌可连锁）
        let r = await this.selfPhase(current, { selfDraw: true, onKongSupplement: false, lastTile });
        if (r) return r; // 胡牌或荒庄

        // 打牌
        const code = await this.discardPhase(current);
        // 他家声明裁决（可能连锁）
        const out = await this.claimLoop(current, E.idxOf(code));
        if (out.settled) return out.settled;
        current = out.next;
      }
    }

    /** 自家声明阶段；返回结算结果 / {drawGame} / null */
    async selfPhase(seat, ctx) {
      const p = this.players[seat];
      let onKong = ctx.onKongSupplement;
      let guard = 0;
      while (guard++ < 8) {
        const opts = this.selfOptions(p, ctx);
        let act = null;
        if (opts.hu || opts.ankong.length || opts.addkong.length) {
          if (p.isAI) { await this.aiDelay(); act = A.decideOnDraw(p.concealed, p.melds, opts); }
          else act = await this.hooks.askSelfClaims(p, opts);
        }
        if (!act) return null;
        if (act.action === 'hu') {
          return this.settle({
            winner: seat, winTile: this.lastDrawnIdx, selfDraw: true,
            ctx: { selfDraw: true, onKongSupplement: onKong, lastTile: ctx.lastTile }
          });
        }
        // 杠
        if (act.action === 'addkong') {
          const rob = await this.tryRobKong(seat, act.tile);
          if (rob != null) {
            return this.settle({ winner: rob, winTile: act.tile, selfDraw: false, loser: seat, ctx: { robbingKong: true } });
          }
        }
        this.applyKong(p, act.action, act.tile);
        if (this.head > this.tail) return { drawGame: true };
        const sup = this.wall[this.tail--];
        p.concealed.push(sup);
        this.sortHand(p);
        this.lastDrawnIdx = E.idxOf(sup);
        onKong = true;
        this.emit('draw', { seat, tile: sup, kong: true, wallLeft: this.tail - this.head + 1 });
      }
      return null;
    }

    /** 出牌阶段；返回打出的牌编码 */
    async discardPhase(seat) {
      const p = this.players[seat];
      let code;
      if (p.isAI) { await this.aiDelay(); code = A.chooseDiscard(p.concealed, p.melds); }
      else code = await this.hooks.askDiscard(p);
      p.concealed.splice(p.concealed.indexOf(code), 1);
      p.discards.push(code);
      this.emit('discard', { seat, tile: code });
      await this.sleep(280);
      return code;
    }

    /** 弃牌声明裁决 + 连锁（碰杠后打出的牌再被声明）；返回 {settled} 或 {next} */
    async claimLoop(discarder, tileIdx) {
      let from = discarder, tile = tileIdx, guard = 0;
      while (guard++ < 8) {
        const claim = await this.resolveClaims(from, tile);
        if (claim.type === 'none') return { next: (from + 1) % 4 };
        if (claim.type === 'hu') {
          return {
            settled: this.settle({
              winner: claim.seat, winTile: tile, selfDraw: false, loser: from, ctx: {}
            })
          };
        }
        const cp = this.players[claim.seat];
        this.applyMeldFromDiscard(cp, claim, tile, from);
        if (claim.type === 'kong') {
          // 明杠补牌后同样拥有杠上开花机会
          if (this.head > this.tail) return { settled: { drawGame: true } };
          const sup = this.wall[this.tail--];
          cp.concealed.push(sup);
          this.sortHand(cp);
          this.lastDrawnIdx = E.idxOf(sup);
          this.emit('draw', { seat: claim.seat, tile: sup, kong: true, wallLeft: this.tail - this.head + 1 });
          const r = await this.selfPhase(claim.seat, { selfDraw: true, onKongSupplement: true, lastTile: false });
          if (r) return { settled: r };
        }
        from = claim.seat;
        const code = await this.discardPhase(from);
        tile = E.idxOf(code);
      }
      return { next: (from + 1) % 4 };
    }

    /* ── 声明收集与优先级裁决 ───────────────────────
       胡 > 碰/杠 > 吃；多家可胡时按出牌者下家起就近优先。
    ──────────────────────────────────────────────── */
    async resolveClaims(discarder, tileIdx) {
      const code = E.codeOf(tileIdx);
      const intents = [];
      for (let d = 1; d <= 3; d++) {
        const seat = (discarder + d) % 4;
        const p = this.players[seat];
        const counts = E.countsOf(p.concealed);
        const opts = {
          hu: A.canDeclareWin(p.concealed, p.melds, tileIdx, {}, this.minFan),
          kong: counts[tileIdx] === 3,
          pong: counts[tileIdx] >= 2,
          chi: d === 1 ? this.chiOptions(counts, tileIdx) : []
        };
        if (!opts.hu && !opts.kong && !opts.pong && !opts.chi.length) continue;
        let act = null;
        if (p.isAI) act = A.decideOnDiscard(p.concealed, p.melds, tileIdx, opts);
        else act = await this.hooks.askClaims(p, { ...opts, tile: code });
        if (act) intents.push({ seat, d, ...act });
      }
      if (!intents.length) return { type: 'none' };
      const pri = { hu: 0, kong: 1, pong: 1, chi: 2 };
      intents.sort((a, b) => pri[a.action] - pri[b.action] || a.d - b.d);
      const top = intents[0];
      return { type: top.action, seat: top.seat, tiles: top.tiles };
    }

    /** 吃牌组合：返回 [[i,i+1,i+2]...] */
    chiOptions(counts, t) {
      if (t >= 27) return [];
      const s = (t / 9) | 0, out = [];
      const inSuit = (i) => i >= s * 9 && i < s * 9 + 9;
      const need = (a, b) => inSuit(a) && inSuit(b) && counts[a] > 0 && counts[b] > 0;
      if (need(t - 2, t - 1)) out.push([t - 2, t - 1, t]);
      if (need(t - 1, t + 1)) out.push([t - 1, t, t + 1]);
      if (need(t + 1, t + 2)) out.push([t, t + 1, t + 2]);
      return out;
    }

    /* ── 自家可声明项（当前 concealed 已含摸入牌）─── */
    selfOptions(p, ctx) {
      const counts = E.countsOf(p.concealed);
      let hu = E.canWin(counts, p.melds.length);
      if (hu && this.minFan > 1) {
        const r = E.calcFan(counts, p.melds, this.lastDrawnIdx, ctx);
        hu = !!r && r.total >= this.minFan;
      }
      const ankong = [];
      for (let i = 0; i < 34; i++) if (counts[i] === 4) ankong.push(i);
      const addkong = [];
      for (const m of p.melds) {
        if (m.type === 'pong' && counts[m.tiles[0]] >= 1) addkong.push(m.tiles[0]);
      }
      return { hu, ankong, addkong };
    }

    /* ── 抢杠胡：补杠瞬间他家可胡该牌（就近优先）─── */
    async tryRobKong(kongSeat, tileIdx) {
      for (let d = 1; d <= 3; d++) {
        const seat = (kongSeat + d) % 4;
        const p = this.players[seat];
        if (!A.canDeclareWin(p.concealed, p.melds, tileIdx, { robbingKong: true }, this.minFan)) continue;
        let act = null;
        if (p.isAI) act = { action: 'hu' }; // 能胡必抢
        else act = await this.hooks.askClaims(p, { hu: true, kong: false, pong: false, chi: [], tile: E.codeOf(tileIdx), rob: true });
        if (act && act.action === 'hu') return seat;
      }
      return null;
    }

    /* ── 杠/副露落地 ─────────────────────────────── */
    applyKong(p, action, tileIdx) {
      const code = E.codeOf(tileIdx);
      if (action === 'ankong') {
        for (let k = 0; k < 4; k++) p.concealed.splice(p.concealed.indexOf(code), 1);
        p.melds.push({ type: 'ankong', tiles: [tileIdx, tileIdx, tileIdx, tileIdx] });
        this.emit('meld', { seat: p.seat, type: 'ankong', tile: code });
      } else { // addkong：补到已有碰
        p.concealed.splice(p.concealed.indexOf(code), 1);
        const m = p.melds.find((m) => m.type === 'pong' && m.tiles[0] === tileIdx);
        m.type = 'kong';
        m.tiles.push(tileIdx);
        this.emit('meld', { seat: p.seat, type: 'kong', tile: code, added: true });
      }
    }

    applyMeldFromDiscard(p, claim, tileIdx, fromSeat) {
      const code = E.codeOf(tileIdx);
      this.players[fromSeat].discards.pop(); // 被吃碰杠的牌从牌河收回
      if (claim.type === 'kong') {
        for (let k = 0; k < 3; k++) p.concealed.splice(p.concealed.indexOf(code), 1);
        p.melds.push({ type: 'kong', tiles: [tileIdx, tileIdx, tileIdx, tileIdx], from: fromSeat });
        this.emit('meld', { seat: p.seat, type: 'kong', tile: code, from: fromSeat });
      } else if (claim.type === 'pong') {
        for (let k = 0; k < 2; k++) p.concealed.splice(p.concealed.indexOf(code), 1);
        p.melds.push({ type: 'pong', tiles: [tileIdx, tileIdx, tileIdx], from: fromSeat });
        this.emit('meld', { seat: p.seat, type: 'pong', tile: code, from: fromSeat });
      } else { // chi
        for (const t of claim.tiles) {
          if (t !== tileIdx) p.concealed.splice(p.concealed.indexOf(E.codeOf(t)), 1);
        }
        p.melds.push({ type: 'chi', tiles: claim.tiles.slice().sort((a, b) => a - b), from: fromSeat });
        this.emit('meld', { seat: p.seat, type: 'chi', tiles: claim.tiles.map(E.codeOf), from: fromSeat });
      }
      this.sortHand(p);
    }

    /* ── 计分结算 ───────────────────────────────── */
    settle({ winner, winTile, selfDraw, loser, ctx }) {
      const p = this.players[winner];
      const counts = E.countsOf(p.concealed);
      if (!selfDraw) counts[winTile]++; // 点炮/抢杠：胡牌张并入门前
      const fan = E.calcFan(counts, p.melds, winTile, ctx);
      const pts = E.pointsOf(fan.total);
      const transfers = [];
      if (selfDraw) {
        for (const q of this.players) {
          if (q.seat === winner) continue;
          q.score -= pts; p.score += pts;
          transfers.push({ from: q.seat, fromName: q.name, to: winner, toName: p.name, amount: pts.toString() });
        }
      } else {
        const lp = this.players[loser];
        lp.score -= pts; p.score += pts;
        transfers.push({ from: loser, fromName: lp.name, to: winner, toName: p.name, amount: pts.toString() });
      }
      const result = {
        winner, winnerName: p.name, selfDraw, loser,
        winTile: E.codeOf(winTile),
        fan: fan.total, items: fan.items,
        points: pts.toString(),
        transfers,
        scores: this.players.map((q) => ({ seat: q.seat, name: q.name, score: q.score.toString() })),
        roundNum: this.roundNum, renchan: this.renchan
      };
      this.emit('win', result);
      return result;
    }

    /* ── 工具 ───────────────────────────────────── */
    sortHand(p) { p.concealed.sort((a, b) => E.idxOf(a) - E.idxOf(b)); }

    publicState() {
      return {
        roundNum: this.roundNum, renchan: this.renchan, dealer: this.dealer,
        wallLeft: this.tail - this.head + 1,
        players: this.players.map((p) => ({
          seat: p.seat, name: p.name,
          concealed: p.concealed.slice(),
          melds: p.melds.map((m) => ({ ...m, tiles: m.tiles.slice() })),
          discards: p.discards.slice(),
          score: p.score.toString()
        }))
      };
    }
  }

  return { MahjongGame, PLAYER_NAMES };
});
