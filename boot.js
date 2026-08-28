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
    var loader = doc.getElementById('xlLoader');
    if (loader) {
      // 揭晓前把进度条补满到 100%，保证视觉收尾连贯
      var pf = loader.querySelector('.xl-prog-v-fill');
      var pp = loader.querySelector('.xl-prog-v-pct');
      if (pf) pf.style.height = '100%';
      if (pp) pp.textContent = '100%';
    }
    // 露出正文
    doc.documentElement.classList.remove('xl-booting');
    // 正文轻微入场（从下往上淡入 + 极轻微缩放）
    doc.documentElement.classList.add('xl-entered');
    // 整块加载层（白底 + 蓝色长方块 + 「小蓝页」文字）一起淡出 —— 三者同时消失
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
      '<div class="xl-intro">' +
        '<div class="xl-glow">' +
          '<i class="xl-spark s1"></i><i class="xl-spark s2"></i><i class="xl-spark s3"></i><i class="xl-spark s4"></i>' +
        '</div>' +
        '<div class="xl-intro-title"><span class="t1">Jerry\'s webpage</span><span class="t2">小蓝页</span></div>' +
        '<div class="xl-prog-v"><div class="xl-prog-v-fill"></div><div class="xl-prog-v-dot"></div></div>' +
        '<div class="xl-prog-v-pct">0%</div>' +
      '</div>' +
      '<div class="xl-sqs"></div>' +
      '<div class="xl-load-text">' +
        '<span class="xl-line">欢迎来到</span>' +
        '<span class="xl-line">小蓝页</span>' +
        '<span class="xl-line">Jerry&#39;s Webpage</span>' +
      '</div>';
    doc.body.appendChild(loader);
    return loader;
  }

  function run() {
    clearTimeout(safety);
    if (reduced || intra) { safeReveal(); return; }

    var loader = buildLoader();
    requestAnimationFrame(function () { loader.classList.add('xl-show'); });

    // 整段序列兜底：比正常流程略长，保证异常时也能揭晓
    safety = setTimeout(safeReveal, 3400);

    // ---- 阶段一：左上角标题 + 左侧竖直进度条（从上往下）----
    var intro = loader.querySelector('.xl-intro');
    var fill = intro.querySelector('.xl-prog-v-fill');
    var pct = intro.querySelector('.xl-prog-v-pct');
    var dot = intro.querySelector('.xl-prog-v-dot');
    var PROG_MS = 1100;
    var t0 = (performance && performance.now) ? performance.now() : Date.now();
    (function tick() {
      var n = (performance && performance.now) ? performance.now() : Date.now();
      var p = Math.min(100, Math.round((n - t0) / PROG_MS * 100));
      if (fill) fill.style.height = p + '%';
      if (pct) pct.textContent = p + '%';
      if (dot) dot.style.top = p + '%';
      if (p < 100) requestAnimationFrame(tick);
      else phaseSlide();
    })();

    // ---- 阶段二：整个面板往右滑 ----
    function phaseSlide() {
      intro.classList.add('xl-slide');
      setTimeout(phasePrev, 460);
    }

    // ---- 阶段三：衔接「之前的」终末地动画（蓝字 + 随机方块 + 白 → 揭晓）----
    function phasePrev() {
      // 进度条阶段不显示三行字，进入阶段三（方块）才淡入
      loader.classList.add('xl-msg');
      var sqs = loader.querySelector('.xl-sqs');
      var count = 4 + Math.floor(Math.random() * 5); // 4~8 个
      var squares = [];
      var vw = window.innerWidth, vh = window.innerHeight;

      for (var i = 0; i < count; i++) {
        (function (i) {
          var s = doc.createElement('div');
          s.className = 'xl-sq';
          // 相对大的长方形方块：宽高独立随机，形成矩形块
          var pad = 16; // 边距，确保方块不出屏幕
          var w = 60 + Math.random() * 120;   // 60~180
          var h = 34 + Math.random() * 80;    // 34~114
          if (w > vw - pad * 2) w = Math.max(20, vw - pad * 2);
          if (h > vh - pad * 2) h = Math.max(20, vh - pad * 2);
          s.style.width = w + 'px';
          s.style.height = h + 'px';
          // 限制在屏幕内（含边距），避免贴边或出屏
          var availW = Math.max(0, vw - w - pad * 2);
          var availH = Math.max(0, vh - h - pad * 2);
          s.style.left = (pad + Math.random() * availW) + 'px';
          s.style.top = (pad + Math.random() * availH) + 'px';
          // 随机赋予花纹 / 半透明（部分）
          var r = Math.random();
          if (r < 0.34) s.classList.add('pat');        // 约 1/3 带花纹
          else if (r < 0.62) s.classList.add('dim');   // 约 1/4 半透明
          sqs.appendChild(s);
          squares.push(s);
          setTimeout(function () { s.classList.add('xl-in'); }, 180 + i * 70);
        })(i);
      }

      // 长方块保持显示，直到整块加载层淡出时与白底、「小蓝页」文字同时消失
      setTimeout(safeReveal, 1280); // 方块出现后停留，再随整块一起淡出
    }
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
