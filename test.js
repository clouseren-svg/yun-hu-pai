/* ════════════════════════════════════════════════════════════
   云胡牌 · test.js
   引擎与对局流程测试：`node test.js` 直接运行，全部断言通过退出码 0。
   覆盖：胡牌正/反例、七对子、十三幺、副露胡牌、杠后补牌、
        抢杠胡、番种计算、8 番门槛、整场对局冒烟（种子可复现）。
   ════════════════════════════════════════════════════════════ */
'use strict';
const E = require('./engine.js');
const A = require('./ai.js');
const { MahjongGame } = require('./game.js');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name); console.log('  ✗ ' + name); }
}
function group(name) { console.log('\n■ ' + name); }

const C = (codes) => E.countsOf(codes);           // codes[] → counts
const meld = (type, codes) => ({ type, tiles: codes.map(E.idxOf) });

async function main() {

  /* ════ 1. 基础牌型判定 ════ */
  group('标准胡牌 · 正例');
  {
    const win = C(['1m','2m','3m','4p','5p','6p','7s','8s','9s','E','E','B','B','B']);
    ok(E.canWin(win, 0), '三顺 + 一刻 + 一将：123m456p789s EE BBB');
    const pongHu = C(['1m','1m','1m','2m','2m','2m','3p','3p','3p','5s','5s','5s','9p','9p']);
    ok(E.canWin(pongHu, 0), '四刻一将（碰碰胡型）');
    const edge = C(['1m','1m','1m','1m','2m','2m','2m','2m','3m','3m','3m','3m','4m','4m']);
    ok(E.canWin(edge, 0), '四连对复合刻子：1m×4 2m×4 3m×4 4m×2 可胡');
  }
  group('标准胡牌 · 反例');
  {
    const bad1 = C(['1m','2m','3m','4p','5p','6p','7s','8s','9s','E','E','B','B','1p']);
    ok(!E.canWin(bad1, 0), '无将牌：BB 与 1p 互不相干');
    const bad2 = C(['1m','1m','1m','2m','2m','3p','3p','3p','5s','5s','5s','9p','9p','9s']);
    ok(!E.canWin(bad2, 0), '面子不齐：2m 对 + 9s 单');
    const bad3 = C(['1m','2m','3m','4p','5p','6p','7s','8s','9s','E','E','E','B','9m']);
    ok(!E.canWin(bad3, 0), '将牌错配：EEE + B + 9m');
  }

  /* ════ 2. 七对子 ════ */
  group('七对子');
  {
    const seven = C(['2m','2m','5m','5m','8p','8p','3s','3s','6s','6s','E','E','9m','9m']);
    ok(E.isChiitoi(seven), '正例：7 个不同对子');
    const four = C(['2m','2m','2m','2m','8p','8p','3s','3s','6s','6s','E','E','9m','9m']);
    ok(!E.isChiitoi(four), '反例：四张相同不算两对');
    const six = C(['2m','2m','5m','5m','8p','8p','3s','3s','6s','6s','E','E','9m','8m']);
    ok(!E.isChiitoi(six), '反例：6 对 + 两张散牌');
  }

  /* ════ 3. 国士无双 ════ */
  group('国士无双（十三幺）');
  {
    const ks = C(['1m','9m','1p','9p','1s','9s','E','S','W','N','R','G','B','1m']);
    ok(E.isKokushi(ks) && E.canWin(ks, 0), '正例：十三幺 + 1m 成对');
    const all = ['1m','9m','1p','9p','1s','9s','E','S','W','N','R','G','B'];
    let allOk = true;
    for (const extra of all) if (!E.isKokushi(C(all.concat(extra)))) allOk = false;
    ok(allOk, '十三面听：13 种幺九任意补一张皆可胡');
    const bad = C(['1m','9m','1p','9p','1s','9s','E','S','W','N','R','G','2m','2m']);
    ok(!E.isKokushi(bad), '反例：缺白板');
  }

  /* ════ 4. 副露后胡牌 ════ */
  group('副露状态下的胡牌');
  {
    const hand = C(['1m','2m','3m','4s','5s','6s','7s','8s','9s','E','E']);
    const melds = [meld('pong', ['5p','5p','5p'])];
    ok(E.canWin(hand, melds.length), '碰后门前 11 张：可听牌');
    const hand2 = C(['1m','2m','3m','4m','5m','6m','6m','7m','8m','E','E']);
    ok(E.canWin(hand2, 1), '碰副露 + 门前 11 张（三顺+将）可胡');
    const openSeven = C(['2m','2m','5m','5m','8p','8p','3s','3s','6s','E','E']);
    ok(!E.isChiitoi(openSeven) && !E.canWin(openSeven, 1), '副露后“准七对”既不能七对也不能胡');
    const hand3 = C(['1m','2m','3m','4m','5m','6m','7m','8m','9m','E','E']);
    const melds3 = [meld('kong', ['5s','5s','5s','5s'])];
    ok(E.canWin(hand3, melds3.length), '明杠 1 副后：门前三顺+将可胡');
  }

  /* ════ 5. 番种计算 ════ */
  group('番种计算');
  const fanTotal = (codes, melds, winCode, ctx) =>
    E.calcFan(C(codes), melds || [], E.idxOf(winCode), ctx || {}).total;
  const fanNames = (codes, melds, winCode, ctx) =>
    E.calcFan(C(codes), melds || [], E.idxOf(winCode), ctx || {}).items.map(i => i.name);
  {
    const plainOpen = ['1m','2m','3m','4p','5p','6p','7s','8s','9s','E','E'];
    ok(fanTotal(plainOpen, [meld('pong', ['B','B','B'])], '1m') === 1, '推倒胡底 = 1 番（副露后无门清）');
    const plain = ['1m','2m','3m','4p','5p','6p','7s','8s','9s','E','E','B','B','B'];
    ok(fanNames(plain, [], '1m').includes('推倒胡底'), '明细含推倒胡底');
    ok(fanTotal(plain, [], '1m', { selfDraw: true }) === 3, '自摸+门清+底 = 3 番');

    const pinhu = ['1m','2m','3m','4m','5m','6m','2p','3p','4p','6s','7s','8s','5p','5p'];
    ok(fanNames(pinhu, [], '5p').includes('平和'), '平和成立（四顺+数牌将）');
    ok(fanTotal(pinhu, [], '5p', { selfDraw: true }) === 5, '平和+自摸+门清+底 = 5 番');

    const pong = ['1m','1m','1m','2m','2m','2m','3p','3p','3p','5s','5s','5s','9p','9p'];
    ok(fanTotal(pong, [], '9p') === 8, '碰碰胡+门清+底 = 8 番');

    const hun = ['1m','1m','1m','2m','3m','4m','7m','8m','9m','E','E','E','B','B'];
    ok(fanNames(hun, [], 'B').includes('混一色'), '混一色成立（一门+字牌）');

    const qing = ['1m','2m','3m','3m','4m','5m','6m','7m','8m','9m','9m','9m','4m','4m'];
    ok(fanTotal(qing, [], '4m') === 26, '清一色+门清+底 = 26 番');

    const seven = ['2m','2m','5m','5m','8p','8p','3s','3s','6s','6s','E','E','9m','9m'];
    ok(fanTotal(seven, [], '9m') === 26, '七对子+门清+底 = 26 番');

    const dsy = ['R','R','R','G','G','G','B','B','B','E','E','E','9m','9m'];
    ok(fanNames(dsy, [], '9m').includes('大三元'), '大三元成立');
    ok(fanTotal(dsy, [], '9m') === 102, '大三元+混一色+碰碰胡+门清+底 = 102 番（得分封顶 88）');

    const xsy = ['R','R','R','G','G','G','B','B','1m','2m','3m','5p','6p','7p'];
    ok(fanNames(xsy, [], '3m').includes('小三元'), '小三元成立（两刻+字将）');

    const dsx = ['E','E','E','S','S','S','W','W','W','N','N','N','R','R'];
    ok(fanNames(dsx, [], 'R').includes('大四喜'), '大四喜成立');

    const xsx = ['E','E','E','S','S','S','W','W','W','N','N','1m','2m','3m'];
    ok(fanNames(xsx, [], '1m').includes('小四喜'), '小四喜成立（三刻+风将）');

    const zi = ['E','E','E','S','S','S','W','W','R','R','R','G','G','G'];
    ok(fanNames(zi, [], 'W').includes('字一色'), '字一色成立');

    const ks = ['1m','9m','1p','9p','1s','9s','E','S','W','N','R','G','B','B'];
    ok(fanNames(ks, [], 'B').includes('国士无双'), '国士无双成立');

    ok(fanNames(plain, [], '1m', { selfDraw: true, onKongSupplement: true }).includes('杠上开花'), '杠上开花入明细');
    ok(fanNames(plain, [], '1m', { lastTile: true }).includes('海底捞月'), '海底捞月入明细');
    ok(fanNames(plain, [], '1m', { robbingKong: true }).includes('抢杠胡'), '抢杠胡入明细');

    const open = fanNames(plain.slice(0, 11), [meld('pong', ['B','B','B'])], '1m');
    ok(!open.includes('门清'), '副露后不计门清');
    const closedKong = fanNames(['1m','2m','3m','4p','5p','6p','7s','8s','9s','E','E'], [meld('ankong', ['B','B','B','B'])], '1m', {});
    ok(closedKong.includes('门清'), '暗杠不破门清');

    ok(E.pointsOf(3) === 300, '得分 min(3,88)×100 = 300');
    ok(E.pointsOf(24) === 2400, '清一色档 24 番 = 2,400 分');
    ok(E.pointsOf(88) === 8800, '满贯 88 番 = 8,800 分');
    ok(E.pointsOf(200) === 8800, '超 88 番按 88 计');
    ok(E.formatPoints(8800) === '8,800', '千分位：8,800');
    ok(E.formatPoints(-2400) === '-2,400', '负分：-2,400');
    ok(E.formatPoints(123456789) === '123,456,789', '大数千分位：123,456,789');
  }

  /* ════ 5b. 明细之和 === 总番数（逐实例锁定） ════ */
  group('番种明细与总数一致性');
  {
    const cases = [
      ['推倒胡', ['1m','2m','3m','4p','5p','6p','7s','8s','9s','E','E','B','B','B'], [], '1m', {}],
      ['平和自摸', ['1m','2m','3m','4m','5m','6m','2p','3p','4p','6s','7s','8s','5p','5p'], [], '5p', { selfDraw: true }],
      ['碰碰胡', ['1m','1m','1m','2m','2m','2m','3p','3p','3p','5s','5s','5s','9p','9p'], [], '9p', {}],
      ['混一色', ['1m','1m','1m','2m','3m','4m','7m','8m','9m','E','E','E','B','B'], [], 'B', {}],
      ['清一色', ['1m','2m','3m','3m','4m','5m','6m','7m','8m','9m','9m','9m','4m','4m'], [], '4m', {}],
      ['七对子', ['2m','2m','5m','5m','8p','8p','3s','3s','6s','6s','E','E','9m','9m'], [], '9m', {}],
      ['大三元', ['R','R','R','G','G','G','B','B','B','E','E','E','9m','9m'], [], '9m', {}],
      ['小三元', ['R','R','R','G','G','G','B','B','1m','2m','3m','5p','6p','7p'], [], '3m', {}],
      ['大四喜', ['E','E','E','S','S','S','W','W','W','N','N','N','R','R'], [], 'R', {}],
      ['小四喜', ['E','E','E','S','S','S','W','W','W','N','N','1m','2m','3m'], [], '1m', {}],
      ['字一色', ['E','E','E','S','S','S','W','W','R','R','R','G','G','G'], [], 'W', {}],
      ['国士无双', ['1m','9m','1p','9p','1s','9s','E','S','W','N','R','G','B','B'], [], 'B', {}],
      ['国士+杠上开花+自摸', ['1m','9m','1p','9p','1s','9s','E','S','W','N','R','G','B','B'], [], 'B', { selfDraw: true, onKongSupplement: true }],
      ['海底捞月', ['1m','2m','3m','4p','5p','6p','7s','8s','9s','E','E','B','B','B'], [], '1m', { lastTile: true }],
      ['抢杠胡', ['1m','2m','3m','4p','5p','6p','7s','8s','9s','E','E','B','B','B'], [], '1m', { robbingKong: true }],
      ['副露碰碰胡', ['1m','1m','1m','2m','2m','2m','5s','5s','5s','9p','9p'], [meld('pong', ['3p','3p','3p'])], '9p', {}],
      ['暗杠门清', ['1m','2m','3m','4p','5p','6p','7s','8s','9s','E','E'], [meld('ankong', ['B','B','B','B'])], '1m', { selfDraw: true }],
    ];
    for (const [label, codes, melds, winCode, ctx] of cases) {
      const r = E.calcFan(C(codes), melds, E.idxOf(winCode), ctx);
      const sum = r.items.reduce((a, b) => a + b.fan, 0);
      ok(sum === r.total, label + '：明细和 ' + sum + ' === 总番数 ' + r.total);
      ok(E.pointsOf(r.total) === Math.min(r.total, 88) * 100, label + '：得分与公式一致（' + E.pointsOf(r.total) + '）');
    }
  }

  /* ════ 6. 向听与听牌 ════ */
  group('向听数 / 听牌');
  {
    const tenpai = C(['1m','2m','3m','4p','5p','6p','7s','8s','9s','E','E','B','B']);
    ok(E.shanten(tenpai, 0) === 0, '听牌 shanten = 0');
    const waits = E.waitTiles(tenpai, 0).map(E.codeOf).sort();
    ok(waits.join(',') === 'B,E', '双碰听 E/B（实际：' + waits.join(',') + '）');
    const win = C(['1m','2m','3m','4p','5p','6p','7s','8s','9s','E','E','B','B','B']);
    ok(E.shanten(win, 0) === -1, '成型 shanten = -1');
    const waits2 = E.waitTiles(C(['1m','2m','3m','4p','5p','6p','7s','8s','9s','E','E','3m','4m']), 0).map(E.codeOf).sort();
    ok(waits2.join(',') === '2m,5m', '两面听 2m/5m（实际：' + waits2.join(',') + '）');
    const far = C(['1m','4m','7m','2p','5p','8p','3s','6s','9s','E','S','W','R']);
    ok(E.shanten(far, 0) >= 4, '全散牌向听 ≥ 4（实际 ' + E.shanten(far, 0) + '）');
    const ks13 = C(['1m','9m','1p','9p','1s','9s','E','S','W','N','R','G','B']);
    ok(E.shanten(ks13, 0) === 0, '国士十三面听 shanten = 0');
    ok(E.waitTiles(ks13, 0).length === 13, '国士听 13 张');
  }

  /* ════ 7. AI 决策 ════ */
  group('AI 启发式');
  {
    const hand = ['1m','2m','3m','4p','5p','6p','7s','8s','9s','E','E','B','B','N'];
    ok(A.chooseDiscard(hand, []) === 'N', '孤张北风优先打出');
    const hand2 = ['R','R','R','G','G','G','B','B','1m','2m','3m','7s','8s','9m'];
    const d2 = A.chooseDiscard(hand2, []);
    ok(d2 === '9m', '不拆三元刻子/对子，先打孤张 9m（实际打 ' + d2 + '）');
    ok(A.decideOnDiscard([], [], 0, { hu: true, kong: true, pong: true, chi: [[1, 2, 3]] }).action === 'hu', '能胡必胡');
  }

  /* ════ 8. 对局机制：杠后补牌 / 抢杠胡 / 门槛 ════ */
  group('对局机制（构造场景）');
  {
    const g = new MahjongGame({ mode: 'rookie', autoHuman: true, hooks: { event() {} }, rng: E.mulberry32(1), delayScale: 0 });
    g.wall = E.buildWall(); g.head = 52; g.tail = 135;
    const p = g.players[0];
    p.concealed = ['5p','5p','5p','5p','1m','3m','5m','2p','4p','6p','1s','3s','5s','E']; // 散牌+四张5筒
    g.sortHand(p);
    const tailBefore = g.tail;
    g.lastDrawnIdx = E.idxOf('5p');
    const r = await g.selfPhase(0, { selfDraw: true, onKongSupplement: false, lastTile: false });
    const konged = p.melds.some(m => m.type === 'ankong');
    ok(konged, '未听牌时摸到第四张 5筒：AI 暗杠');
    if (konged && !r) {
      ok(g.tail === tailBefore - 1, '杠后补牌取自牌墙尾（tail-1）');
      ok(p.concealed.length === 11, '杠后门前守恒（14-4+补1=11，实际 ' + p.concealed.length + '）');
    }
  }
  {
    const g = new MahjongGame({ mode: 'rookie', autoHuman: true, hooks: { event() {} }, rng: E.mulberry32(2), delayScale: 0 });
    g.wall = E.buildWall(); g.head = 52; g.tail = 135;
    const konger = g.players[1];
    konger.melds = [meld('pong', ['5m','5m','5m'])];
    konger.concealed = ['5m','1p','2p','3p','4p','5p','6p','7s','8s','E','S','N']; // 非听牌，摸到第4张5万
    const robber = g.players[0];
    robber.concealed = ['1m','2m','3m','4p','5p','6p','7s','8s','9s','B','B','4m','6m']; // 卡 5m
    g.lastDrawnIdx = E.idxOf('5m');
    const r = await g.selfPhase(1, { selfDraw: true, onKongSupplement: false, lastTile: false });
    ok(r && r.winner === 0, '抢杠胡：0 号位抢 1 号位的补杠');
    ok(r && r.items.some(i => i.name === '抢杠胡'), '结算明细含抢杠胡');
    ok(r && r.transfers.length === 1 && r.transfers[0].from === 1, '抢杠由被抢者独付');
  }
  {
    const g = new MahjongGame({ mode: 'pro', hooks: { event() {} }, rng: E.mulberry32(3), delayScale: 0 });
    const p = g.players[0];
    p.concealed = ['1m','2m','3m','4p','5p','6p','7s','8s','9s','E','E','B','B','B'];
    g.lastDrawnIdx = E.idxOf('B');
    ok(!g.selfOptions(p, { selfDraw: true }).hu, '计番场：自摸 3 番不可胡（8 番起）');
    p.concealed = ['1m','2m','3m','3m','4m','5m','6m','7m','8m','9m','9m','9m','4m','4m'];
    g.lastDrawnIdx = E.idxOf('4m');
    ok(g.selfOptions(p, { selfDraw: true }).hu, '计番场：清一色可胡');
  }

  /* ════ 9. 整场冒烟：种子可复现，资金守恒 ════ */
  group('整场对局冒烟（4 AI 自动）');
  async function smokeMatch(seed, mode) {
    const events = [];
    const g = new MahjongGame({
      mode, autoHuman: true, delayScale: 0,
      rng: E.mulberry32(seed),
      hooks: { event: (n) => events.push(n) }
    });
    await g.startMatch();
    const wins = events.filter(e => e === 'win').length;
    const draws = events.filter(e => e === 'exhausted').length;
    const deals = events.filter(e => e === 'deal').length;
    ok(events.includes('matchEnd'), `seed=${seed} mode=${mode}：整场结束（胡 ${wins} 局 / 荒庄 ${draws} 局）`);
    const total = g.players.reduce((a, p) => a + p.score, 0);
    ok(total === 0, `seed=${seed}：四家总账守恒`);
    ok(deals >= 4, `seed=${seed}：至少 4 局（实际 ${deals}）`);
  }
  await smokeMatch(7, 'rookie');
  await smokeMatch(42, 'rookie');
  await smokeMatch(99, 'pro');

  /* ════ 汇总 ════ */
  console.log('\n══════════════════════');
  console.log(`通过 ${pass} / ${pass + fail}`);
  if (fail) { console.log('失败项：\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('全部测试通过 ✓');
}

main().catch((e) => { console.error('测试运行异常：', e); process.exit(1); });
