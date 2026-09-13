/* ════════════════════════════════════════════════════════════
   云胡牌 · ai.js
   三家 AI（纯逻辑，浏览器 / node 双端可用）：
   - 打牌：向听数优先，平手时先打孤立字牌/幺九
   - 声明：能胡必胡；碰杠以不向听恶化为界；吃仅显著改善才动
   ════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const E = (typeof module !== 'undefined' && module.exports)
    ? require('./engine.js')
    : root.Engine;
  const M = factory(E);
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
  root.AI = M;
})(typeof self !== 'undefined' ? self : globalThis, function (E) {
  'use strict';

  /** 牌的「联络价值」：越低越该先打 */
  function usefulness(counts, i) {
    let v = counts[i] * 4; // 自身成对/成刻价值
    if (i < 27) {
      const s = (i / 9) | 0;
      for (const d of [-2, -1, 1, 2]) {
        const j = i + d;
        if (j >= s * 9 && j < s * 9 + 9) v += counts[j] * (d === -1 || d === 1 ? 2 : 1);
      }
      if (i % 9 === 0 || i % 9 === 8) v -= 2; // 幺九联络差
    } else {
      v -= 3; // 字牌天生孤立
    }
    return v;
  }

  /**
   * 选要打的牌：返回牌编码
   * concealed: codes[]（14 张或摸入后）；melds: 副露数组
   */
  function chooseDiscard(concealed, melds) {
    const counts = E.countsOf(concealed);
    const open = melds.length;
    let bestTile = null, bestKey = Infinity;
    const seen = new Set();
    for (const code of concealed) {
      const i = E.idxOf(code);
      if (seen.has(i)) continue;
      seen.add(i);
      counts[i]--;
      const sh = E.shanten(counts, open);
      // 键 = 向听 * 100 - 联络价值（越小越该打）
      const key = sh * 100 - usefulness(counts, i);
      counts[i]++;
      if (key < bestKey) { bestKey = key; bestTile = code; }
    }
    return bestTile;
  }

  /** 当前向听 */
  function shantenOf(concealed, melds) {
    return E.shanten(E.countsOf(concealed), melds.length);
  }

  /**
   * 能否宣布胡（含计番场 8 番门槛）
   * ctx: 引擎计番上下文；minFan: 起胡番数
   */
  function canDeclareWin(concealed, melds, winTileIdx, ctx, minFan) {
    const counts = E.countsOf(concealed);
    counts[winTileIdx]++;
    if (!E.canWin(counts, melds.length)) return false;
    if (minFan > 1) {
      const r = E.calcFan(counts, melds, winTileIdx, ctx);
      return !!r && r.total >= minFan;
    }
    return true;
  }

  /**
   * 对他人弃牌的声明决策
   * options: { hu, kong, pong, chi: [[i,i+1,i+2]..] }
   * 返回 {action:'hu'|'kong'|'pong'|'chi', tiles?} | null
   */
  function decideOnDiscard(concealed, melds, tileIdx, options) {
    if (options.hu) return { action: 'hu' };
    const before = shantenOf(concealed, melds);
    const counts = E.countsOf(concealed);
    if (options.kong) {
      // 有就杠，除非拆听（听牌时不杠）
      if (before > 0) return { action: 'kong' };
    }
    if (options.pong) {
      counts[tileIdx] -= 2;
      const after = E.shanten(counts, melds.length + 1);
      counts[tileIdx] += 2;
      if (after <= before) return { action: 'pong' };
    }
    if (options.chi && options.chi.length) {
      let bestChi = null, bestSh = before;
      for (const seq of options.chi) {
        const [a, b, c] = seq;
        counts[a]--; counts[b]--; counts[c]--;
        counts[tileIdx]++; // 吃入
        const after = E.shanten(counts, melds.length + 1);
        counts[a]++; counts[b]++; counts[c]++; counts[tileIdx]--;
        if (after < bestSh) { bestSh = after; bestChi = seq; }
      }
      if (bestChi) return { action: 'chi', tiles: bestChi };
    }
    return null;
  }

  /**
   * 自家摸牌后的声明决策（自摸 / 暗杠 / 补杠）
   * options: { hu, ankong: [idx..], addkong: [idx..] }
   */
  function decideOnDraw(concealed, melds, options) {
    if (options.hu) return { action: 'hu' };
    const before = shantenOf(concealed, melds);
    if (before > 0) {
      if (options.ankong && options.ankong.length) return { action: 'ankong', tile: options.ankong[0] };
      if (options.addkong && options.addkong.length) return { action: 'addkong', tile: options.addkong[0] };
    }
    return null;
  }

  return { usefulness, chooseDiscard, shantenOf, canDeclareWin, decideOnDiscard, decideOnDraw };
});
