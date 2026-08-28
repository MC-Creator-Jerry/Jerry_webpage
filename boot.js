/* ============================================================
   小蓝页 · 终末地风格加载动画引导脚本
   - 白底蓝字「小蓝页」淡入
   - 1 秒内随机出现 4~8 个蓝色方块
   - 随后方块撤离、画面全白、揭晓网站内容（整段 ≤ 2s）
   - 站内链接跳转（主页→附页等）不重播动画
   - 尊重 prefers-reduced-motion；任何异常都会兜底揭晓内容
   ============================================================ */
(function () {
  var doc = document;

  function safeReveal() {
    // 揭晓前把进度条补满到 100%，保证视觉收尾连贯
    var loader0 = doc.getElementById('xlLoader');
    if (loader0) {
      var pf = loader0.querySelector('.xl-prog-fill');
      var pp = loader0.querySelector('.xl-prog-pct');
      if (pf) pf.style.height = '100%';
      if (pp) pp.textContent = '100%';
    }
    doc.documentElement.classList.remove('xl-booting');
    var loader = doc.getElementById('xlLoader');
    if (loader && loader.parentNode) {
      loader.classList.add('xl-hide');
      setTimeout(function () {
        if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
      }, 420);
    }
  }

  // 兜底：无论如何都在 2.4s 后强制揭晓，避免内容被永久隐藏
  var safety = setTimeout(safeReveal, 2400);

  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // 判断是否「站内跳转」：仅当来源页点击了同源链接才跳过动画
  var intra = false;
  try {
    var nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
    var navType = nav.type || 'navigate';
    intra = (sessionStorage.getItem('__xl_intra') === '1') && navType === 'navigate';
    sessionStorage.removeItem('__xl_intra'); // 读取即消费，避免影响后续刷新
  } catch (e) {}

  // 标记加载中，隐藏真实内容（先加类，首帧即生效，避免闪烁）
  doc.documentElement.classList.add('xl-booting');

  // 同源链接点击：标记「本站内跳转」，目标页据此不重播动画
  doc.addEventListener('click', function (e) {
    try {
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a) return;
      var href = a.getAttribute('href');
      if (!href || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      if (/^#/.test(href) || /^javascript:/i.test(href)) return;
      if (a.href && a.href.indexOf(location.origin) === 0) {
        sessionStorage.setItem('__xl_intra', '1');
      }
    } catch (e) {}
  });

  function buildLoader() {
    var loader = doc.getElementById('xlLoader');
    if (loader) return loader;
    loader = doc.createElement('div');
    loader.id = 'xlLoader';
    loader.className = 'xl-loader';
    loader.innerHTML =
      '<div class="xl-sqs"></div>' +
      '<div class="xl-prog"><div class="xl-prog-fill"></div></div>' +
      '<div class="xl-prog-pct">0%</div>' +
      '<div class="xl-load-text">小蓝页</div>';
    doc.body.appendChild(loader);
    return loader;
  }

  function run() {
    clearTimeout(safety);
    if (reduced || intra) { safeReveal(); return; }

    var loader = buildLoader();
    requestAnimationFrame(function () { loader.classList.add('xl-show'); });

    // 最左侧竖直进度条：0%→100% 在约 1.3s 内走完（先于揭晓收尾）
    var progFill = loader.querySelector('.xl-prog-fill');
    var progPct = loader.querySelector('.xl-prog-pct');
    var PROG_MS = 1300;
    var pStart = (performance && performance.now) ? performance.now() : Date.now();
    (function tick() {
      var now = (performance && performance.now) ? performance.now() : Date.now();
      var p = Math.min(100, Math.round((now - pStart) / PROG_MS * 100));
      if (progFill) progFill.style.height = p + '%';
      if (progPct) progPct.textContent = p + '%';
      if (p < 100) requestAnimationFrame(tick);
    })();

    var sqs = loader.querySelector('.xl-sqs');
    var count = 4 + Math.floor(Math.random() * 5); // 4~8 个
    var squares = [];
    var vw = window.innerWidth, vh = window.innerHeight;

    for (var i = 0; i < count; i++) {
      (function (i) {
        var s = doc.createElement('div');
        s.className = 'xl-sq';
        var size = 18 + Math.random() * 46;
        s.style.width = size + 'px';
        s.style.height = size + 'px';
        s.style.left = (Math.random() * Math.max(0, (vw - size))) + 'px';
        s.style.top = (Math.random() * Math.max(0, (vh - size))) + 'px';
        sqs.appendChild(s);
        squares.push(s);
        // 在 1 秒内陆续出现（最后一颗 ≤ ~0.84s）
        setTimeout(function () { s.classList.add('xl-in'); }, 280 + i * 80);
      })(i);
    }

    var outAt = 1000; // 出现完毕后开始撤离
    setTimeout(function () {
      for (var j = 0; j < squares.length; j++) squares[j].classList.add('xl-out');
    }, outAt);

    // 撤离后全白 → 揭晓内容（约 1.48s，满足 ≤2s）
    setTimeout(safeReveal, outAt + 480);
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
