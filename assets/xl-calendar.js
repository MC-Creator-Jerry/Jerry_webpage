/* ============================================================
 *  xl-calendar.js —— 头像卡「七日日历条」（前3天 + 今天 + 后3天）
 *
 *  - 每格：公历日（大）+ 农历日（小，如 初二）
 *  - 今天：蓝色圆底白字高亮
 *  - 特殊日期：格内底部标注节日名（公历节日 + 农历节日）
 *  - 农历数据：lunardate(YEAR_INFOS) 提取的标准表，1900-2099
 *
 *  用法：XL_CALENDAR.render(el, opts)  -> el.innerHTML = 七日条 HTML
 *        XL_CALENDAR.solarToLunar(y, m, d) -> {y,m,d,leap,monthName,dayName}
 * ============================================================ */
(function () {
  'use strict';

  // 1900-2099 农历信息表（bit15-4 大小月，bit3-0 闰月月份，bit16 闰月大小）
  var LUNAR_INFO = [
    0x4bd8, 0x4ae0, 0xa570, 0x54d5, 0xd260, 0xd950, 0x16554, 0x56a0, 0x9ad0, 0x55d2,
    0x4ae0, 0xa5b6, 0xa4d0, 0xd250, 0x1d255, 0xb540, 0xd6a0, 0xada2, 0x95b0, 0x14977,
    0x4970, 0xa4b0, 0xb4b5, 0x6a50, 0x6d40, 0x1ab54, 0x2b60, 0x9570, 0x52f2, 0x4970,
    0x6566, 0xd4a0, 0xea50, 0x6e95, 0x5ad0, 0x2b60, 0x186e3, 0x92e0, 0x1c8d7, 0xc950,
    0xd4a0, 0x1d8a6, 0xb550, 0x56a0, 0x1a5b4, 0x25d0, 0x92d0, 0xd2b2, 0xa950, 0xb557,
    0x6ca0, 0xb550, 0x15355, 0x4da0, 0xa5d0, 0x14573, 0x52b0, 0xa9a8, 0xe950, 0x6aa0,
    0xaea6, 0xab50, 0x4b60, 0xaae4, 0xa570, 0x5260, 0xf263, 0xd950, 0x5b57, 0x56a0,
    0x96d0, 0x4dd5, 0x4ad0, 0xa4d0, 0xd4d4, 0xd250, 0xd558, 0xb540, 0xb5a0, 0x195a6,
    0x95b0, 0x49b0, 0xa974, 0xa4b0, 0xb27a, 0x6a50, 0x6d40, 0xaf46, 0xab60, 0x9570,
    0x4af5, 0x4970, 0x64b0, 0x74a3, 0xea50, 0x6b58, 0x5ac0, 0xab60, 0x96d5, 0x92e0,
    0xc960, 0xd954, 0xd4a0, 0xda50, 0x7552, 0x56a0, 0xabb7, 0x25d0, 0x92d0, 0xcab5,
    0xa950, 0xb4a0, 0xbaa4, 0xad50, 0x55d9, 0x4ba0, 0xa5b0, 0x15176, 0x52b0, 0xa930,
    0x7954, 0x6aa0, 0xad50, 0x5b52, 0x4b60, 0xa6e6, 0xa4e0, 0xd260, 0xea65, 0xd530,
    0x5aa0, 0x76a3, 0x96d0, 0x4afb, 0x4ad0, 0xa4d0, 0x1d0b6, 0xd250, 0xd520, 0xdd45,
    0xb5a0, 0x56d0, 0x55b2, 0x49b0, 0xa577, 0xa4b0, 0xaa50, 0x1b255, 0x6d20, 0xada0,
    0x14b63, 0x9370, 0x49f8, 0x4970, 0x64b0, 0x168a6, 0xea50, 0x6aa0, 0x1a6c4, 0xaae0,
    0x92e0, 0xd2e3, 0xc960, 0xd557, 0xd4a0, 0xda50, 0x5d55, 0x56a0, 0xa6d0, 0x55d4,
    0x52d0, 0xa9b8, 0xa950, 0xb4a0, 0xb6a6, 0xad50, 0x55a0, 0xaba4, 0xa5b0, 0x52b0,
    0xb273, 0x6930, 0x7337, 0x6aa0, 0xad50, 0x14b55, 0x4b60, 0xa570, 0x54e4, 0xd160,
    0xe968, 0xd520, 0xdaa0, 0x16aa6, 0x56d0, 0x4ae0, 0xa9d4, 0xa2d0, 0xd150, 0xf252
  ];

  function leapMonth(y) { return LUNAR_INFO[y - 1900] & 0xf; }
  function leapDays(y) {
    if (leapMonth(y)) return (LUNAR_INFO[y - 1900] & 0x10000) ? 30 : 29;
    return 0;
  }
  function monthDays(y, m) { return (LUNAR_INFO[y - 1900] & (0x10000 >> m)) ? 30 : 29; }
  function yearDays(y) {
    var sum = 348;
    for (var i = 0x8000; i > 0x8; i >>= 1) sum += (LUNAR_INFO[y - 1900] & i) ? 1 : 0;
    return sum + leapDays(y);
  }

  // 公历 -> 农历。返回 {y,m,d,leap,monthName,dayName}
  function solarToLunar(y, m, d) {
    var offset = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(1900, 0, 31)) / 86400000);
    var i, temp = 0;
    for (i = 1900; i < 2100 && offset > 0; i++) {
      temp = yearDays(i);
      offset -= temp;
    }
    if (offset < 0) { offset += temp; i--; }
    var year = i;
    var leap = leapMonth(year);
    var isLeap = false;
    for (i = 1; i < 13 && offset > 0; i++) {
      if (leap > 0 && i === (leap + 1) && !isLeap) {
        --i; isLeap = true; temp = leapDays(year);
      } else {
        temp = monthDays(year, i);
      }
      if (isLeap && i === (leap + 1)) isLeap = false;
      offset -= temp;
    }
    if (offset === 0 && leap > 0 && i === leap + 1) {
      if (isLeap) { isLeap = false; } else { isLeap = true; --i; }
    }
    if (offset < 0) { offset += temp; --i; }
    var month = i;
    var day = offset + 1;
    var MONTHS = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
    var D1 = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
    var dayName;
    if (day === 10) dayName = '初十';
    else if (day === 20) dayName = '二十';
    else if (day === 30) dayName = '三十';
    else if (day % 10 === 0) dayName = ['', '初', '廿'][day / 10] + '十';
    else dayName = (day < 10 ? '初' : (day < 20 ? '十' : '廿')) + D1[day % 10 - 1];
    return { y: year, m: month, d: day, leap: isLeap, monthName: (isLeap ? '闰' : '') + MONTHS[month - 1], dayName: dayName };
  }

  /* ---------------- 节日 ---------------- */
  var SOLAR_FEST = {
    '01-01': '元旦', '02-14': '情人节', '03-08': '妇女节', '03-12': '植树节',
    '04-01': '愚人节', '05-01': '劳动节', '05-04': '青年节', '06-01': '儿童节',
    '07-01': '建党节', '08-01': '建军节', '09-10': '教师节', '10-01': '国庆节',
    '11-11': '双十一', '12-24': '平安夜', '12-25': '圣诞节',
  };
  var LUNAR_FEST = {
    '1-1': '春节', '1-15': '元宵节', '5-5': '端午节', '7-7': '七夕节',
    '8-15': '中秋节', '9-9': '重阳节', '12-8': '腊八节', '12-23': '小年',
  };

  function festival(y, m, d, lunar) {
    var sk = String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    if (SOLAR_FEST[sk]) return SOLAR_FEST[sk];
    var lk = lunar.m + '-' + lunar.d;
    if (LUNAR_FEST[lk]) return LUNAR_FEST[lk];
    // 除夕：腊月最后一天（29 或 30，看该年腊月大小月）
    if (lunar.m === 12 && !lunar.leap && lunar.d === monthDays(lunar.y, 12)) return '除夕';
    return '';
  }

  /* ---------------- 渲染 ---------------- */
  // 跨午夜滚动：模块级单例（一个容器 + 一个定时器），头像卡重建时自动跟随新容器
  var rollEl = null, rollTimer = null, lastDayKey = '';

  function dayKey(d) {
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  }

  function buildStrip(base) {
    var strip = document.createElement('div');
    strip.className = 'hc-cal-strip';
    var html = '';
    for (var i = -3; i <= 3; i++) {
      var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
      var lunar = solarToLunar(d.getFullYear(), d.getMonth() + 1, d.getDate());
      var fest = festival(d.getFullYear(), d.getMonth() + 1, d.getDate(), lunar);
      html += '<div class="hc-cal-cell' + (i === 0 ? ' is-today' : '') + '">' +
        '<div class="hc-cal-num">' + d.getDate() + '</div>' +
        '<div class="hc-cal-lunar">' + lunar.dayName + '</div>' +
        (fest ? '<div class="hc-cal-fest">' + fest + '</div>' : '') +
        (i === 0 ? '<div class="hc-cal-dot"></div>' : '') +   // 今日：底部蓝色圆角方块
        '</div>';
    }
    strip.innerHTML = html;
    return strip;
  }

  // 排定下一个本地午夜的切换定时（页面停留跨天时自动翻日期）
  function scheduleRollover() {
    if (rollTimer) { clearTimeout(rollTimer); rollTimer = null; }
    if (!rollEl) return;
    var now = new Date();
    var next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    rollTimer = setTimeout(function () {
      rollTimer = null;
      if (!rollEl || !rollEl.isConnected) { rollEl = null; return; } // 卡已关闭：停止滚动
      if (dayKey(new Date()) !== lastDayKey) render(rollEl, { animate: true });
      scheduleRollover();
    }, Math.max(50, next.getTime() - Date.now()));
  }

  function render(el, opts) {
    if (!el) return;
    opts = opts || {};
    var base = (opts.base instanceof Date) ? opts.base : new Date();
    var animate = opts.animate === true;
    var strip = buildStrip(base);
    var old = el.querySelector('.hc-cal-strip');
    if (animate && old) {
      // 切换动画：旧条左滑淡出，新条从右滑入；今日蓝方块弹跳出现（CSS 驱动）
      old.classList.add('hc-out');
      strip.classList.add('hc-in');
      el.appendChild(strip);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { strip.classList.remove('hc-in'); });
      });
      setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, 600);
    } else {
      if (old && old.parentNode) old.parentNode.removeChild(old);
      el.appendChild(strip);
    }
    lastDayKey = dayKey(base);
    rollEl = el; // 让午夜定时跟随最新容器
    scheduleRollover();
  }

  window.XL_CALENDAR = { render: render, solarToLunar: solarToLunar, festival: festival };
})();
