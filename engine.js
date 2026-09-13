/* ════════════════════════════════════════════════════════════
   云胡牌 · engine.js
   纯逻辑麻将引擎（无 DOM，浏览器 / node 双端可用）：
   - 136 张牌模型（万/筒/条 1-9×4 + 东南西北中发白 ×4）
   - 洗牌码墙 / 计数数组转换
   - 胡牌判定：标准 4 副+1 将（含副露）、七对子、国士无双
   - 向听数（shanten）：标准型 / 七对子 / 国士
   - 番种计分：17 种，逐项明细，得分 = 2^番数（封顶 88，BigInt）
   ════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const M = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
  root.Engine = M;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  /* ── 牌编码 ───────────────────────────────────────────
     '1m'..'9m' 万 → 0-8   '1p'..'9p' 筒 → 9-17
     '1s'..'9s' 条 → 18-26  E S W N R G B → 27..33
     R=中 G=發 B=白
  ────────────────────────────────────────────────────── */
  const HONORS = ['E', 'S', 'W', 'N', 'R', 'G', 'B'];
  const KOKUSHI_SET = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

  function idxOf(code) {
    const suit = code.slice(-1);
    if (suit === 'm' || suit === 'p' || suit === 's') {
      const n = parseInt(code, 10);
      return (suit === 'm' ? 0 : suit === 'p' ? 9 : 18) + n - 1;
    }
    return 27 + HONORS.indexOf(code);
  }

  function codeOf(i) {
    if (i < 9) return (i + 1) + 'm';
    if (i < 18) return (i - 8) + 'p';
    if (i < 27) return (i - 17) + 's';
    return HONORS[i - 27];
  }

  const isHonor = (i) => i >= 27;
  const isWind = (i) => i >= 27 && i <= 30;
  const isDragon = (i) => i >= 31 && i <= 33;
  const isTerminal = (i) => i < 27 && (i % 9 === 0 || i % 9 === 8);
  const suitOf = (i) => (i < 27 ? (i / 9) | 0 : -1); // 0万 1筒 2条；字牌 -1

  /** codes[] → 长度 34 的计数数组 */
  function countsOf(codes) {
    const c = new Array(34).fill(0);
    for (const code of codes) c[idxOf(code)]++;
    return c;
  }

  /** 计数数组 → codes[] */
  function codesOf(counts) {
    const out = [];
    for (let i = 0; i < 34; i++) for (let k = 0; k < counts[i]; k++) out.push(codeOf(i));
    return out;
  }

  /** 造 136 张牌墙 */
  function buildWall() {
    const w = [];
    for (let i = 0; i < 34; i++) for (let k = 0; k < 4; k++) w.push(codeOf(i));
    return w;
  }

  /** Fisher–Yates 洗牌，rng 可注入（测试用种子随机） */
  function shuffle(arr, rng) {
    const r = rng || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (r() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** mulberry32 种子随机（测试 / autoplay 可复现） */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ── 分解：计数数组 → {pair, sets:[{type,tile}]} 的所有解 ── */
  function extractAll(c, need, sets, out, guard) {
    if (guard.n-- <= 0) return; // 防爆保护
    if (sets.length === need) {
      if (c.every((x) => x === 0)) out.push(sets.map((s) => ({ ...s })));
      return;
    }
    let i = -1;
    for (let k = 0; k < 34; k++) if (c[k] > 0) { i = k; break; }
    if (i === -1) return;
    // 刻子
    if (c[i] >= 3) {
      c[i] -= 3; sets.push({ type: 'triplet', tile: i });
      extractAll(c, need, sets, out, guard);
      sets.pop(); c[i] += 3;
    }
    // 顺子
    if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      sets.push({ type: 'chi', tile: i });
      extractAll(c, need, sets, out, guard);
      sets.pop(); c[i]++; c[i + 1]++; c[i + 2]++;
    }
  }

  /** 枚举「need 副 + 1 将」全部分解（concealed 含将牌，共 need*3+2 张） */
  function decomposeAll(counts, need) {
    const total = counts.reduce((a, b) => a + b, 0);
    if (total !== need * 3 + 2) return [];
    const out = [];
    const c = counts.slice();
    for (let p = 0; p < 34; p++) {
      if (c[p] >= 2) {
        c[p] -= 2;
        const raw = [];
        extractAll(c, need, [], raw, { n: 5000 });
        for (const sets of raw) out.push({ pair: p, sets });
        c[p] += 2;
      }
    }
    return out;
  }

  /* ── 特殊牌型判定 ─────────────────────────────────── */
  function isChiitoi(counts) {
    let pairs = 0;
    for (let i = 0; i < 34; i++) {
      if (counts[i] === 2) pairs++;
      else if (counts[i] !== 0) return false; // 3/4 张不算两对
    }
    return pairs === 7;
  }

  function isKokushi(counts) {
    let dup = false;
    for (const i of KOKUSHI_SET) {
      if (counts[i] === 0) return false;
      if (counts[i] >= 2) dup = true;
    }
    for (let i = 0; i < 34; i++) {
      if (counts[i] > 0 && !KOKUSHI_SET.includes(i)) return false;
    }
    return dup; // 13 种各一 + 任一成对
  }

  /* ── 胡牌判定 ───────────────────────────────────────
     concealedCounts：门前计数（含所胡的那张）
     meldCount：副露/暗杠副数（杠按 1 副计）
  ──────────────────────────────────────────────────── */
  function canWin(concealedCounts, meldCount) {
    const need = 4 - meldCount;
    if (need < 0) return false;
    if (decomposeAll(concealedCounts, need).length > 0) return true;
    if (meldCount === 0) {
      if (isChiitoi(concealedCounts)) return true;
      if (isKokushi(concealedCounts)) return true;
    }
    return false;
  }

  /** 13 张门前牌 + 副露 → 所有可胡的牌 index 列表 */
  function waitTiles(concealedCounts, meldCount) {
    const out = [];
    for (let i = 0; i < 34; i++) {
      if (concealedCounts[i] >= 4) continue;
      concealedCounts[i]++;
      if (canWin(concealedCounts, meldCount)) out.push(i);
      concealedCounts[i]--;
    }
    return out;
  }

  /* ── 向听数 ─────────────────────────────────────── */
  function shantenStandard(counts, openCount) {
    let best = 8;
    const c = counts.slice();
    function rec(m, t, p, guard) {
      if (guard.n-- <= 0) return;
      let i = -1;
      for (let k = 0; k < 34; k++) if (c[k] > 0) { i = k; break; }
      if (i === -1) {
        const melds = m + openCount;
        let taatsu = t;
        if (melds + taatsu > 4) taatsu = 4 - melds;
        if (taatsu < 0) taatsu = 0;
        const s = 8 - 2 * melds - taatsu - p;
        if (s < best) best = s;
        return;
      }
      // 孤张跳过
      c[i]--; rec(m, t, p, guard); c[i]++;
      // 刻子
      if (c[i] >= 3) { c[i] -= 3; rec(m + 1, t, p, guard); c[i] += 3; }
      // 顺子
      if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
        c[i]--; c[i + 1]--; c[i + 2]--;
        rec(m + 1, t, p, guard);
        c[i]++; c[i + 1]++; c[i + 2]++;
      }
      // 将
      if (!p && c[i] >= 2) { c[i] -= 2; rec(m, t, 1, guard); c[i] += 2; }
      // 搭子（面子未超 4 时才有意义）
      if (m + t + openCount < 4) {
        if (i < 27) {
          if (i % 9 <= 7 && c[i + 1] > 0) { c[i]--; c[i + 1]--; rec(m, t + 1, p, guard); c[i]++; c[i + 1]++; }
          if (i % 9 <= 6 && c[i + 2] > 0) { c[i]--; c[i + 2]--; rec(m, t + 1, p, guard); c[i]++; c[i + 2]++; }
        }
        if (p && c[i] >= 2) { c[i] -= 2; rec(m, t + 1, p, guard); c[i] += 2; } // 对子转搭子
      }
    }
    rec(0, 0, 0, { n: 20000 });
    return best;
  }

  function shantenChiitoi(counts) {
    let pairs = 0, unique = 0;
    for (let i = 0; i < 34; i++) {
      if (counts[i] >= 1) unique++;
      if (counts[i] >= 2) pairs++;
    }
    return 6 - pairs + Math.max(0, 7 - unique);
  }

  function shantenKokushi(counts) {
    let unique = 0, pair = 0;
    for (const i of KOKUSHI_SET) {
      if (counts[i] >= 1) unique++;
      if (counts[i] >= 2) pair = 1;
    }
    return 13 - unique - pair;
  }

  /** 综合向听：openCount>0 时只看标准型 */
  function shanten(counts, openCount) {
    const s = shantenStandard(counts, openCount);
    if (openCount > 0) return s;
    return Math.min(s, shantenChiitoi(counts), shantenKokushi(counts));
  }

  /* ── 番种计分 ─────────────────────────────────────
     melds: [{type:'chi'|'pong'|'kong'|'ankong', tiles:[idx..]}]
     ctx: { selfDraw, onKongSupplement, lastTile, robbingKong }
     返回 { total, items:[{name,fan}] }；不可胡返回 null
  ──────────────────────────────────────────────────── */
  function ctxFans(ctx) {
    const items = [];
    if (ctx.selfDraw) items.push({ name: '自摸', fan: 1 });
    if (ctx.menzen) items.push({ name: '门清', fan: 1 });
    if (ctx.onKongSupplement) items.push({ name: '杠上开花', fan: 8 });
    if (ctx.lastTile) items.push({ name: '海底捞月', fan: 8 });
    if (ctx.robbingKong) items.push({ name: '抢杠胡', fan: 8 });
    return items;
  }

  function fanOfStandard(decomp, melds, ctx) {
    const sets = melds.map((m) => ({
      type: m.type === 'chi' ? 'chi' : 'triplet',
      tile: m.tiles[0]
    })).concat(decomp.sets);
    const pair = decomp.pair;
    const items = [{ name: '推倒胡底', fan: 1 }];

    // 三色/字色
    const suitSet = new Set();
    let hasHonor = false;
    const touchTile = (i) => {
      if (i >= 27) hasHonor = true; else suitSet.add(suitOf(i));
    };
    sets.forEach((s) => {
      if (s.type === 'chi') { touchTile(s.tile); touchTile(s.tile + 1); touchTile(s.tile + 2); }
      else touchTile(s.tile);
    });
    touchTile(pair);

    if (suitSet.size === 0 && hasHonor) items.push({ name: '字一色', fan: 64 });
    else if (suitSet.size === 1 && !hasHonor) items.push({ name: '清一色', fan: 24 });
    else if (suitSet.size === 1 && hasHonor) items.push({ name: '混一色', fan: 6 });

    // 刻/顺结构
    const allTriplet = sets.every((s) => s.type === 'triplet');
    const allChi = sets.every((s) => s.type === 'chi');
    if (allTriplet) items.push({ name: '碰碰胡', fan: 6 });
    if (allChi && pair < 27 && ctx.menzen) items.push({ name: '平和', fan: 2 });

    // 三元 / 四喜
    const dragonTriplets = sets.filter((s) => s.type === 'triplet' && isDragon(s.tile)).length;
    const windTriplets = sets.filter((s) => s.type === 'triplet' && isWind(s.tile)).length;
    if (dragonTriplets === 3) items.push({ name: '大三元', fan: 88 });
    else if (dragonTriplets === 2 && isDragon(pair)) items.push({ name: '小三元', fan: 64 });
    if (windTriplets === 4) items.push({ name: '大四喜', fan: 88 });
    else if (windTriplets === 3 && isWind(pair)) items.push({ name: '小四喜', fan: 64 });

    return items;
  }

  function calcFan(concealedCounts, melds, winTileIdx, ctxFlags) {
    const ctx = ctxFlags || {};
    const menzen = melds.length === 0 || melds.every((m) => m.type === 'ankong');
    const fullCtx = { ...ctx, menzen };
    let best = null;

    const consider = (baseItems) => {
      const items = baseItems.concat(ctxFans(fullCtx));
      const total = items.reduce((a, b) => a + b.fan, 0);
      if (!best || total > best.total) best = { total, items };
    };

    if (melds.length === 0 && isKokushi(concealedCounts)) {
      consider([{ name: '国士无双', fan: 88 }, { name: '推倒胡底', fan: 1 }]);
    }
    if (melds.length === 0 && isChiitoi(concealedCounts)) {
      consider([{ name: '七对子', fan: 24 }, { name: '推倒胡底', fan: 1 }]);
    }
    const need = 4 - melds.length;
    if (need >= 0) {
      for (const decomp of decomposeAll(concealedCounts, need)) {
        consider(fanOfStandard(decomp, melds, fullCtx));
      }
    }
    return best;
  }

  /** 得分 = min(番数, 88) × 100：推倒胡 100、清一色 2400、满贯 8800 */
  function pointsOf(fan) {
    return Math.min(fan, 88) * 100;
  }

  /** 分数展示：千分位（8,800 / 2,400），负号前置 */
  function formatPoints(n) {
    n = Number(n);
    if (!isFinite(n)) return '0';
    const neg = n < 0;
    const s = Math.abs(Math.round(n)).toLocaleString('en-US');
    return (neg ? '-' : '') + s;
  }

  return {
    HONORS, KOKUSHI_SET,
    idxOf, codeOf, isHonor, isWind, isDragon, isTerminal, suitOf,
    countsOf, codesOf, buildWall, shuffle, mulberry32,
    decomposeAll, isChiitoi, isKokushi,
    canWin, waitTiles,
    shanten, shantenStandard, shantenChiitoi, shantenKokushi,
    calcFan, pointsOf, formatPoints
  };
});
