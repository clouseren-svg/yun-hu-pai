/* ════════════════════════════════════════════════════════════
   云胡牌 · tiles.js
   麻将牌数据模型 + DOM/CSS 牌面绘制 + 番型牌谱
   牌编码：1m~9m 万 / 1p~9p 筒 / 1s~9s 条
          E S W N 东南西北 / R 中 / G 發 / B 白
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const WAN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const HONOR_TEXT = { E: '東', S: '南', W: '西', N: '北', R: '中', G: '發', B: '' };
  /* 筒/条的 3x3 点阵布局（1-9），数字为格子序号 0~8 */
  const PIP_LAYOUT = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
    7: [0, 2, 3, 4, 5, 6, 8],
    8: [0, 1, 2, 3, 5, 6, 7, 8],
    9: [0, 1, 2, 3, 4, 5, 6, 7, 8]
  };

  /** 排序权重：万→筒→条→风→三元，同花色按点数 */
  function tileOrder(code) {
    const suit = code.slice(-1);
    const n = parseInt(code, 10);
    if (suit === 'm') return n;
    if (suit === 'p') return 20 + n;
    if (suit === 's') return 40 + n;
    const winds = { E: 61, S: 62, W: 63, N: 64, R: 71, G: 72, B: 73 };
    return winds[code] || 99;
  }

  function sortTiles(arr) {
    return arr.slice().sort((a, b) => tileOrder(a) - tileOrder(b));
  }

  /** 牌面文字（用于听牌提示等） */
  function tileName(code) {
    const suit = code.slice(-1);
    const n = parseInt(code, 10);
    if (suit === 'm') return WAN_NUM[n] + '万';
    if (suit === 'p') return WAN_NUM[n] + '筒';
    if (suit === 's') return WAN_NUM[n] + '条';
    return HONOR_TEXT[code] || '白';
  }

  /**
   * 渲染一张牌（返回 DOM 元素）
   * @param {string} code 牌编码；传 'back' 渲染牌背
   */
  function renderTile(code) {
    const el = document.createElement('div');
    el.className = 'tile';
    el.dataset.code = code;
    if (code === 'back') {
      el.classList.add('back');
      return el;
    }
    const face = document.createElement('div');
    face.className = 'tile-face';
    const suit = code.slice(-1);
    const n = parseInt(code, 10);

    if (suit === 'm') {
      face.innerHTML =
        '<span class="wan-num">' + WAN_NUM[n] + '</span>' +
        '<span class="wan-zi">萬</span>';
    } else if (suit === 'p' || suit === 's') {
      const grid = document.createElement('div');
      grid.className = 'pip-grid';
      const layout = PIP_LAYOUT[n];
      const isTong = suit === 'p';
      for (let cell = 0; cell < 9; cell++) {
        const slot = document.createElement('span');
        slot.className = 'pip';
        if (layout.includes(cell)) {
          if (n === 1) slot.classList.add('big');
          const pip = document.createElement('i');
          pip.style.display = 'block';
          // 红点缀：筒的 5 中心、条的 5/7 中心点用朱砂
          const red = (n === 5 && cell === 4) || (suit === 's' && n === 7 && cell === 4) || (n === 1 && isTong);
          pip.className = isTong ? 'pip-tong' + (red ? ' red' : '') : 'pip-tiao' + (red ? ' red' : '');
          slot.appendChild(pip);
        }
        grid.appendChild(slot);
      }
      face.appendChild(grid);
    } else {
      // 字牌
      if (code === 'B') {
        const bai = document.createElement('span');
        bai.className = 'honor bai';
        face.appendChild(bai);
      } else {
        const h = document.createElement('span');
        h.className = 'honor' + (code === 'R' ? ' red' : code === 'G' ? ' green' : '');
        h.textContent = HONOR_TEXT[code];
        face.appendChild(h);
      }
    }
    el.appendChild(face);
    return el;
  }

  window.Tiles = { renderTile, sortTiles, tileName };
})();
