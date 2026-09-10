/* common.js — 小蓝页共享输入增强：文本域自动增高 + 字数计数
 * 用法：
 *   <textarea class="edit-textarea auto-grow" ...></textarea>
 *   <input class="edit-input" id="x" maxlength="200" />
 *   <span class="char-count" data-for="x"></span>
 * 无需手动调用，脚本在 DOM 就绪后自动初始化页面内所有 .auto-grow 与带 maxlength 的字段。
 */
/* ===== 页间导航加载动画：主页↔辅页 切换时盖白 + 蓝色进度条 ===== */
(function () {
  'use strict';
  var KEY = 'xl_nav_loader';
  var MIN_MS = 650; // 最短展示时长，避免极快导航时一闪而过、体感“没了”
  function el() { return document.getElementById('xl-loader'); }
  function build() {
    var n = document.createElement('div');
    n.id = 'xl-loader';
    n.className = 'xl-loader xl-nav';
    n.innerHTML =
      '<div class="xl-loader-inner">' +
        '<div class="xl-loader-text">正在加载资源</div>' +
        '<div class="xl-loader-pct">0%</div>' +
        '<div class="xl-loader-bar"><div class="xl-loader-fill"></div></div>' +
      '</div>';
    (document.body || document.documentElement).appendChild(n);
    return n;
  }
  function show() {
    var n = el();
    if (!n) n = build();
    n.classList.remove('xl-hidden');
    return n;
  }
  function hide() {
    var n = el();
    if (!n) return;
    n.classList.add('xl-hidden');
    setTimeout(function () { if (n && n.parentNode) n.parentNode.removeChild(n); }, 650);
  }
  function animate() {
    var n = show();
    var fill = n.querySelector('.xl-loader-fill');
    var pct = n.querySelector('.xl-loader-pct');
    var p = 0;
    var t0 = Date.now();
    fill.style.width = '0%';
    pct.textContent = '0%';
    var timer = setInterval(function () {
      p += Math.random() * 11 + 5;
      if (p > 92) p = 92;
      fill.style.width = p + '%';
      pct.textContent = Math.round(p) + '%';
    }, 170);
    function finish() {
      clearInterval(timer);
      fill.style.width = '100%';
      pct.textContent = '100%';
      var elapsed = Date.now() - t0;
      // 至少展示 MIN_MS，保证可见；不论 load 是否已触发
      setTimeout(hide, Math.max(280, MIN_MS - elapsed));
    }
    if (document.readyState === 'complete') finish();
    else {
      window.addEventListener('load', finish);
      setTimeout(finish, 2600); // 兜底：资源迟迟不触发 load 也收尾
    }
  }
  // 出发页：点击站内链接 → 立即盖白 + 记录标记，目标页据此播放动画
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || href.charAt(0) === '?') return;
    if (a.target === '_blank' || a.hasAttribute('download')) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; // 新标签/修饰键不视为站内跳转
    // 仅站内 / 相对路径链接
    if (/^(https?:)?\/\//i.test(href) && href.indexOf(location.host) === -1) return;
    try { sessionStorage.setItem(KEY, '1'); } catch (e2) {}
    show();
    // 若导航未真正发生（同页/被拦截），看守狗收掉白屏
    setTimeout(function () { if (el()) hide(); }, 1600);
  }, true);
  // 目标页：从站内导航过来则播放动画
  try {
    if (sessionStorage.getItem(KEY) === '1') {
      sessionStorage.removeItem(KEY);
      animate();
    }
  } catch (e) {}
})();

(function () {
  'use strict';

  function autoGrow(el) {
    if (!el.offsetParent) return; // 隐藏时不计算，避免高度被压成 0
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  function getCounter(field) {
    if (!field.id) return null;
    return document.querySelector('.char-count[data-for="' + CSS.escape(field.id) + '"]');
  }

  function updateCounter(field) {
    var c = getCounter(field);
    if (!c) return;
    var max = parseInt(field.getAttribute('maxlength') || '0', 10);
    var len = (field.value || '').length;
    c.textContent = len + ' / ' + max;
    if (len > max) c.classList.add('over');
    else c.classList.remove('over');
  }

  function init() {
    document.querySelectorAll('textarea.auto-grow').forEach(function (t) {
      autoGrow(t);
      t.addEventListener('input', function () { autoGrow(t); updateCounter(t); });
      updateCounter(t);
    });
    document.querySelectorAll('input[maxlength], textarea[maxlength]').forEach(function (f) {
      if (!getCounter(f)) return;
      f.addEventListener('input', function () { updateCounter(f); });
      updateCounter(f);
    });
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();

/* common.js — 流畅动画：滚动揭示 + 图片淡入
 * 与 common.css 配套：仅用透明度过渡（opacity-only），避免与悬浮位移冲突；
 * 排除弹层（.modal / .settings-panel 等）内部元素，避免永久隐藏。
 */
(function () {
  'use strict';
  var d = document;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SKIP = '.modal-overlay,.settings-overlay,.modal,.settings-panel,.pop-menu,.user-popup,.dropdown,.modal-card,.tab-pane';

  function tag() {
    var sel = '.section-card,.prod-card,.feature-card,.card,.post,.user-card,.product-card,.notice-item,.comment-item';
    d.querySelectorAll(sel).forEach(function (el) {
      if (el.closest && el.closest(SKIP)) return;            // 弹层内部不揭示
      if (el.classList.contains('xl-reveal') || el.classList.contains('in')) return;
      el.classList.add('xl-reveal');
    });
  }
  tag();

  if (reduce) {
    d.querySelectorAll('.xl-reveal,.section-card,.prod-card,.feature-card').forEach(function (e) { e.classList.add('in'); });
    return;
  }

  var els = d.querySelectorAll('.xl-reveal,.section-card,.prod-card,.feature-card');
  if (!('IntersectionObserver' in window) || !els.length) {
    els.forEach(function (e) { e.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
  els.forEach(function (e) { io.observe(e); });

  // 图片淡入
  d.querySelectorAll('img').forEach(function (img) {
    if (img.complete) img.classList.add('loaded');
    else img.addEventListener('load', function () { img.classList.add('loaded'); });
  });
})();

/* ============ 按钮图标：用图片图标（<img class="ico">）替代文字/emoji ============ */
// 2026-09-08 移除：旧的 <img class="ico"> 注入与下方「小蓝条显示模式」IIFE 的 injectIcons()
// 重复工作，会让 .bar-text 内残留 <img>（在 tile 模式显示为「文字左边的小图标」）。
// 现在顶栏所有 .bar-btn 的图标统一由 injectIcons()（统一 SVG 风格）注入。
// 浮动的「发送」按钮仍用 send.svg 兜底（避免 video 控件/动态创建按钮拿不到 SVG）：

/* ============ 帖子附件渲染（视频/音频/图片/其他），video-only 自动预览 ============ */
window.XLMedia = (function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function humanSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
  function url(key) { return '/api/file?key=' + encodeURIComponent(key); }

  function isVideoOnly(files, hasText) {
    return !!(files && files.length === 1 && /^video\//.test(files[0].type || '') && !hasText);
  }

  function build(files, opts) {
    opts = opts || {};
    if (!files || !files.length) return '';
    if (opts.videoOnly) {
      var f = files[0];
      return '<div class="att att-video-only">' +
        '<video class="att-video-auto" src="' + url(f.key) + '" autoplay muted loop playsinline controls preload="metadata"></video>' +
        '</div>';
    }
    var tiles = files.map(function (f) {
      var u = url(f.key);
      var t = f.type || '';
      if (/^image\//.test(t)) {
        return '<a class="att-tile att-img" href="' + u + '" target="_blank" rel="noopener">' +
          '<img src="' + u + '" alt="' + esc(f.name) + '" loading="lazy"></a>';
      }
      if (/^video\//.test(t)) {
        return '<video class="att-tile att-video" src="' + u + '" controls playsinline preload="metadata"></video>';
      }
      if (/^audio\//.test(t)) {
        return '<div class="att-tile att-audio"><audio controls src="' + u + '"></audio></div>';
      }
      var ext = (String(f.name).split('.').pop() || 'FILE').toUpperCase().slice(0, 5);
      return '<a class="att-tile att-file" href="' + u + '" download="' + esc(f.name) + '">' +
        '<span class="att-ext">' + esc(ext) + '</span>' +
        '<span class="att-meta"><span class="att-name">' + esc(f.name) + '</span>' +
        '<span class="att-size">' + humanSize(f.size) + '</span></span></a>';
    }).join('');
    return '<div class="att att-grid count-' + Math.min(files.length, 4) + '">' + tiles + '</div>';
  }

  return { url: url, isVideoOnly: isVideoOnly, build: build };
})();

/* ============ 话题（#hashtag）：把正文里的 #话题 渲染成可点击标签 ============ */
window.XLTopics = (function () {
  var STOP = /[\s#,.!?;:，。！？；：、)\]【】{}（）「」『』"'“”‘’《》<>|\\/~^$&*+=`]/;
  var WORDISH = /[A-Za-z0-9_\/]/;
  var TRAILING = /[.,!?;:，。！？；：、]+$/;
  var MAX_LEN = 30;

  function basePrefix() {
    var sc = document.querySelector('script[src*="common.js"]');
    var src = sc ? (sc.getAttribute('src') || '') : '';
    var m = src.match(/^((?:\.\.\/)*)/);
    return m ? m[1] : '';
  }

  function extract(text, limit) {
    limit = limit || 10;
    var s = String(text || '');
    var out = [], seen = {};
    for (var i = 0; i < s.length; i++) {
      if (s[i] !== '#') continue;
      var prev = i > 0 ? s[i - 1] : '';
      if (prev && WORDISH.test(prev)) continue; // URL 锚点等
      var j = i + 1, name = '';
      while (j < s.length && name.length < MAX_LEN) {
        if (STOP.test(s[j])) break;
        name += s[j]; j++;
      }
      name = name.replace(TRAILING, '');
      if (!name) continue;
      var key = name.toLowerCase();
      if (!seen[key]) {
        seen[key] = 1;
        out.push(name);
        if (out.length >= limit) break;
      }
      i = j - 1;
    }
    return out;
  }

  function topicHref(name) {
    return basePrefix() + 'post/center/?topic=' + encodeURIComponent(name);
  }

  function makeLink(name) {
    var a = document.createElement('a');
    a.className = 'topic-link';
    a.href = topicHref(name);
    a.textContent = '#' + name;
    return a;
  }

  function replaceInTextNode(node) {
    var s = node.nodeValue || '';
    var frag = document.createDocumentFragment();
    var last = 0, changed = false;
    for (var i = 0; i < s.length; i++) {
      if (s[i] !== '#') continue;
      var prev = i > 0 ? s[i - 1] : '';
      if (prev && WORDISH.test(prev)) continue;
      var j = i + 1, name = '';
      while (j < s.length && name.length < MAX_LEN) {
        if (STOP.test(s[j])) break;
        name += s[j]; j++;
      }
      name = name.replace(TRAILING, '');
      if (!name) continue;
      if (last < i) frag.appendChild(document.createTextNode(s.slice(last, i)));
      frag.appendChild(makeLink(name));
      last = j; changed = true;
      i = j - 1;
    }
    if (!changed) return;
    if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }

  // 遍历文本节点做替换（用 DOM API 构造，天然防 XSS）
  function linkify(root) {
    if (!root || !document.createTreeWalker) return;
    var targets = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    while (walker.nextNode()) {
      var node = walker.currentNode;
      if (node.nodeValue.indexOf('#') === -1) continue;
      var p = node.parentElement;
      if (!p) continue;
      if (p.className && String(p.className).indexOf('topic-link') !== -1) continue;
      if (p.closest && p.closest('a, code, pre, script, style, textarea')) continue;
      targets.push(node);
    }
    targets.forEach(replaceInTextNode);
  }

  return { extract: extract, linkify: linkify, href: topicHref };
})();

/* ============ 流量埋点：页面加载后上报一次 PV/UV ============ */
(function () {
  function getVid() {
    try {
      var v = localStorage.getItem('xl_vid');
      if (!v) {
        v = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('xl_vid', v);
      }
      return v;
    } catch (e) {
      return '';
    }
  }
  function shouldTrack() {
    var p = location.pathname || '';
    // 不统计看板页自身与接口，避免自干扰
    if (/^\/stats\//.test(p) || /^\/api\//.test(p)) return false;
    return true;
  }
  function send() {
    if (!shouldTrack()) return;
    var payload = JSON.stringify({
      path: (location.pathname || '/') + (location.search || ''),
      title: document.title || '',
      ref: document.referrer || '',
      vid: getVid(),
      hour: new Date().getHours() // 访客本地小时（0-23），用于时段分布
    });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' }));
      } else {
        fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        }).catch(function () {});
      }
    } catch (e) { /* 埋点失败不影响页面 */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(send, 0); });
  else setTimeout(send, 0);
})();

/* ============ 顶栏搜索框 + 群组入口（注入到每个页面的 .bar-right；私信入口已并入通知中心） ============ */
(function () {
  function isSearchPage() { return /\/search\//.test(location.pathname); }
  function inject() {
    if (isSearchPage()) return;
    var bars = document.querySelectorAll('.bar-right');
    if (!bars.length) return;
    bars.forEach(function (bar) {
      if (!bar || bar.querySelector('.xl-search') || bar.querySelector('.xl-dm')) return;
      var form = document.createElement('form');
      form.className = 'xl-search';
      form.setAttribute('action', '/search/');
      form.method = 'get';
      var inp = document.createElement('input');
      inp.type = 'search'; inp.name = 'q'; inp.className = 'xl-search-input';
      inp.placeholder = '搜索'; inp.setAttribute('aria-label', '搜索'); inp.maxLength = 80;
      form.appendChild(inp);

      var notice = bar.querySelector('#noticeBtn');
      var login = bar.querySelector('#loginBtn') || bar.querySelector('#logoutBtn');
      // 搜索栏放在「消息中心」按钮的左侧
      var formRef = notice || login;
      if (formRef) { bar.insertBefore(form, formRef); }
      else { bar.appendChild(form); }
      // 注：群组入口不再全局注入；已在「通知中心」(notice/index.html) 与「帖子中心」(post/center/index.html) 两页顶栏显式放置
    });
    // 实时刷新：后台轮询通知徽标（免 VAPID，纯前端轮询）
    if (!window.__xlRealtimeStarted) {
      window.__xlRealtimeStarted = true;
      setInterval(function () {
        try { if (window.JW_REFRESH_BADGE) window.JW_REFRESH_BADGE(); } catch (e) {}
      }, 45000);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();

/* ============ 小蓝条显示模式：注入图标到顶栏按钮（.bar-icon + .bar-text），并按 xl_barmode 应用 body 类 ============ */
(function () {
  // 按钮 → SVG 路径（viewBox 0 0 24 24，stroke=currentColor）。匹配按 id 优先，其次 data-zh/文本，最后 href 正则。
  var ICON_MAP = [
    { keys: ['消息中心', '通知中心', '通知'], href: /\/notice\//, svg: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9z"/><path d="M10 21a2 2 0 0 0 4 0"/>' },
    { keys: ['帖子中心', '帖子'], href: /\/post\//, svg: '<path d="M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2z"/><path d="M4 18h14"/><path d="M8 8h6M8 12h6M8 16h4"/>' },
    { keys: ['产品'], href: /products/, svg: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' },
    { keys: ['帮助中心', '帮助'], href: /helpcenter/, svg: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><circle cx="12" cy="17" r=".8" fill="currentColor"/>' },
    { keys: ['登录'], id: 'loginBtn', svg: '<circle cx="12" cy="7" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>' },
    { keys: ['退出'], id: 'logoutBtn', svg: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>' },
    { keys: ['主页', '首页'], href: /(index\.html|\/(index)?$)/, svg: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>' },
    { keys: ['群组'], href: /\/groups\//, svg: '<circle cx="9" cy="9" r="3.5"/><circle cx="17" cy="10" r="2.5"/><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5"/><path d="M15 19c.5-2 2.5-3.5 5-3.5"/>' },
    { keys: ['个人主页', '我的主页', '个人'], href: /(personal_profile|home\.html)/, svg: '<circle cx="12" cy="7" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>' },
    { keys: ['搜索'], href: /\/search\//, svg: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>' }
  ];

  function pickIcon(btn) {
    var id = btn.id || '';
    var href = btn.getAttribute('href') || '';
    var txt = (btn.getAttribute('data-zh') || btn.textContent || '').trim();
    for (var i = 0; i < ICON_MAP.length; i++) {
      var m = ICON_MAP[i];
      if (m.id && id && id === m.id) return m.svg;
      if (m.keys && m.keys.length) {
        for (var k = 0; k < m.keys.length; k++) { if (txt.indexOf(m.keys[k]) !== -1) return m.svg; }
      }
      if (m.href && m.href.test(href)) return m.svg;
    }
    return null;
  }

  function injectIcons() {
    var btns = document.querySelectorAll('.bar-right .bar-btn');
    for (var i = 0; i < btns.length; i++) {
      var btn = btns[i];
      if (btn.querySelector(':scope > .bar-icon')) continue;
      var svg = pickIcon(btn);
      if (!svg) continue;
      // 1) 把现有所有子节点（文本 + 徽标）包进 .bar-text；
      //    徽标（未读小红点）单独提到按钮直接子节点，避免「仅图标」模式被 sr-only 一起裁掉。
      var textSpan = document.createElement('span');
      textSpan.className = 'bar-text';
      // 把双语属性下沉到文字层：注入后 .bar-btn 有了子元素，applyLang 会跳过它，
      // 只有 .bar-text 带 data-zh/data-en 才能在切语言时继续被翻译。
      var zh = btn.getAttribute('data-zh'), en = btn.getAttribute('data-en');
      if (zh) textSpan.setAttribute('data-zh', zh);
      if (en) textSpan.setAttribute('data-en', en);
      while (btn.firstChild) textSpan.appendChild(btn.firstChild);
      var badge = textSpan.querySelector('.badge');
      if (badge) btn.appendChild(badge);
      btn.appendChild(textSpan);
      // 2) 前置 .bar-icon（tile 模式 flex-column：图标在上、文字在下；long/icon 模式图标不显示）
      var iconSpan = document.createElement('span');
      iconSpan.className = 'bar-icon';
      iconSpan.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + svg + '</svg>';
      btn.insertBefore(iconSpan, btn.firstChild);
    }
  }

  function applyBarMode() {
    // 默认改为「图标加小文字」(tile)；新访客进来直接看到 tile，老用户保留自己存过的偏好。
    var m = 'tile';
    try { m = localStorage.getItem('xl_barmode') || 'tile'; } catch (e) {}
    if (m !== 'tile' && m !== 'icon' && m !== 'long') m = 'tile';
    document.body.classList.remove('xl-bar-tile', 'xl-bar-long', 'xl-bar-icon');
    document.body.classList.add('xl-bar-' + m);
  }
  // 暴露给设置页等需要主动重应用的场景
  window.__xlApplyBarMode = applyBarMode;
  window.__xlInjectBarIcons = injectIcons;

  function run() { applyBarMode(); injectIcons(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();

/* ============ 横竖屏切换：加载动画 + 按钮位移到对应位置 ============ */
/* 触发条件：移动端 orientationchange 事件；桌面浏览器无该事件，则用 matchMedia('(orientation: portrait)') 的 change
 事件兜底。期间给 body 加 .xl-orient-anim，由 common.css 中的覆盖层 + 按钮位移动画完成「加载 + 移动」视觉效果。 */
(function () {
  var ANIM_MS = 460;
  function trigger() {
    try {
      document.body.classList.add('xl-orient-anim');
      void document.body.offsetWidth; // 强制回流，确保 animation 立即生效
      setTimeout(function () { document.body.classList.remove('xl-orient-anim'); }, ANIM_MS + 40);
    } catch (e) {}
  }
  try { window.addEventListener('orientationchange', trigger); } catch (e) {}
  try {
    var mq = window.matchMedia('(orientation: portrait)');
    var last = mq.matches ? 'p' : 'l';
    var handler = function () {
      var cur = mq.matches ? 'p' : 'l';
      if (cur !== last) { last = cur; trigger(); }
    };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler); // 旧 Safari/Webkit 兼容
  } catch (e) {}
})();

/* ============ 竖屏底部导航条：视觉视口（地址栏）感知 ============ */
/* 移动端 WebKit 在地址栏收起/展开时 layout viewport 高度变化，position:fixed;bottom:0 会贴到
   layout viewport 底（页面底）而非视觉视口底（屏幕底）。地址栏高度 = window.visualViewport.offsetBottom，
   直接并入 pinBarRight()/pinFloat() 的 inline bottom（!important），使底部条始终贴屏幕最底。
   具体实现见下方浮动按钮 IIFE 内的 vbOffset()/syncVB()。桌面 Chrome 的 offsetBottom 恒为 0，无副作用。 */

/* ============ 键盘快捷键（单一来源 XL_KEYS）：N 通知中心 / S 搜索 / U 登录·用户 / H 帮助中心 / P 产品 / T 帖子中心 / L 语言 / O 设置 / M 切换深浅色 / F 主页 / E 编辑当前页面布局(站主) ============ */
/* 说明：key=按键（小写，用于 keydown 匹配）；nav=目标路径；re=按钮 href 匹配（用于 Alt 键提示徽标，已兼容相对链接）；login=true 走 loginOrMine()，theme=true 走 window.__xlToggleTheme() */
(function () {
  var XL_KEYS = [
    { key: 'n', nav: '/notice/',          re: /\/notice\//,            login: false },
    { key: 's', nav: '/search/',          re: /\/search\//,            login: false },
    { key: 'u', nav: '/personal_profile/', login: true },
    { key: 'h', nav: '/helpcenter/',      re: /\/helpcenter\//,         login: false },
    { key: 'p', nav: '/products.html',    re: /\/products\.html/,       login: false },
    { key: 't', nav: '/post/center/',     re: /\/post\//,              login: false },
    { key: 'l', nav: '/language',         re: /\blanguage\b/,          login: false },
    { key: 'o', nav: '/settings/homepage.html', re: /\bsettings\b/,     login: false },
    { key: 'f', nav: '/',                 re: /\/(index\.html)?$/,     login: false },
    { key: 'm', theme: true },
    { key: 'e', edit: true } // 编辑当前页面布局（仅站主，权限在 keydown 内校验）
  ];
  window.__xlKeys = XL_KEYS; // 暴露给 Alt 键提示 IIFE 复用，避免键位漂移
  function typing(e) {
    var t = e.target;
    return !!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')));
  }
  function go(path) {
    if (location.pathname === path) return; // 已在目标页则不跳转（避免无谓刷新）
    try { sessionStorage.setItem('__xl_intra', '1'); } catch (e) {} // 站内跳转不重播开场动画
    location.href = path;
  }
  function loginOrMine() {
    var auth = window.JW_AUTH;
    if (auth && auth.user) { go('/personal_profile/'); return; }
    var lb = document.getElementById('loginBtn');
    if (lb) { lb.click(); return; }
    go('/'); // 兜底：无登录入口则回首页
  }
  // 编辑当前页面布局：仅站主（与浮动「更改布局」按钮同源权限）
  function isOwner() {
    var a = window.JW_AUTH;
    return !!(a && a.user && (a.user.isAdmin || a.user.login === 'MC-Creator-Jerry'));
  }
  function xlToast(msg) {
    try {
      var t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:rgba(32,40,54,.95);color:#fff;padding:10px 16px;border-radius:8px;font-size:.9rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:90vw;';
      document.body.appendChild(t);
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2200);
    } catch (e) {}
  }
  function editCurrentPage() {
    if (document.body.classList.contains('xl-editmode')) return; // 已在编辑模式
    if (!isOwner()) return; // 非站主：静默，不弹任何提示（当作没有这个功能）
    if (window.XLEdit) window.XLEdit.open();
  }
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;             // 不干扰组合键（如 Ctrl/Cmd+S 保存）；Alt 交由键提示 IIFE 处理
    if (typing(e)) return;                                       // 输入框内不触发
    if (document.body.classList.contains('xl-editmode')) return; // 站主编辑模式内不触发
    var k = (e.key || '').toLowerCase();
    for (var i = 0; i < XL_KEYS.length; i++) {
      if (k === XL_KEYS[i].key) {
        e.preventDefault();
        if (XL_KEYS[i].login) loginOrMine();
        else if (XL_KEYS[i].theme) { if (window.__xlToggleTheme) window.__xlToggleTheme(); }
        else if (XL_KEYS[i].edit) { if (isOwner()) editCurrentPage(); }
        else go(XL_KEYS[i].nav);
        return;
      }
    }
  });
})();

/* ============ Alt 键提示（类 Office keytip）：按 Alt 显示/隐藏顶栏按钮对应快捷键，再按一次或 Esc 隐藏 ============ */
(function () {
  var STYLE = '.bar-btn,.xl-search,.fab{position:relative}.xl-keycap{position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:5px;background:#0078D4;color:#fff;font:600 11px/1.3 system-ui,"Segoe UI",sans-serif;padding:1px 7px;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.35);pointer-events:none;z-index:60;display:none;white-space:nowrap}body.xl-keytips .xl-keycap{display:block}';
  function ensureStyle() {
    if (document.getElementById('xl-keytip-css')) return;
    var s = document.createElement('style');
    s.id = 'xl-keytip-css';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }
  function keyForButton(btn) {
    var keys = window.__xlKeys || [];
    for (var i = 0; i < keys.length; i++) {
      var kk = keys[i];
      if (kk.theme) {
        if (btn.id === 'themeToggle') return kk.key.toUpperCase();
      } else if (kk.login) {
        if (btn.id === 'loginBtn' || btn.id === 'logoutBtn') return kk.key.toUpperCase();
      } else if (kk.edit) {
        if (btn.id === 'editLayoutBtn') return kk.key.toUpperCase();
      } else if (kk.re) {
        var href = btn.getAttribute('href') || '';
        if (href && href.charAt(0) !== '/' && href.charAt(0) !== '#') href = '/' + href; // 兼容根目录相对链接（如 notice/、products.html）
        if (kk.re.test(href)) return kk.key.toUpperCase();
      }
    }
    return null;
  }
  function buildKeytips() {
    if (window.__xlKeytipsBuilt) return;
    window.__xlKeytipsBuilt = true;
    ensureStyle();
    var targets = [];
    document.querySelectorAll('.bar-right .bar-btn').forEach(function (b) { targets.push(b); });
    document.querySelectorAll('.xl-search').forEach(function (f) { targets.push(f); }); // 搜索框也提示 S
    document.querySelectorAll('a.fab, button.fab').forEach(function (f) { targets.push(f); }); // 浮动按钮：语言(L)/设置(O)/主题(M)
    var editFab = document.getElementById('editLayoutBtn');
    if (editFab) targets.push(editFab); // 站主浮动按钮：编辑当前页面布局(E)
    document.querySelectorAll('a.site-name, a[data-zh="主页"]').forEach(function (f) { targets.push(f); }); // 主页(F)：站名 logo + 面包屑「主页」超链接
    targets.forEach(function (el) {
      var key = el.classList.contains('xl-search') ? 'S' : keyForButton(el);
      if (!key) return;
      if (el.querySelector('.xl-keycap')) return;
      var cap = document.createElement('span');
      cap.className = 'xl-keycap';
      cap.textContent = key;
      el.appendChild(cap);
    });
  }
  function toggleKeytips() {
    buildKeytips();
    document.body.classList.toggle('xl-keytips');
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight') {
      if (e.repeat) return;            // 长按不重复切换
      e.preventDefault();              // 阻止浏览器菜单聚焦
      toggleKeytips();
    } else if (e.key === 'Escape') {
      if (document.body.classList.contains('xl-keytips')) document.body.classList.remove('xl-keytips');
    }
  });
})();

/* ============ 浮动按钮：深浅色切换（所有访客）+ 站主「更改当前页面布局」 ============ */
(function () {
  'use strict';
  var OWNER = 'MC-Creator-Jerry';
  var SUN = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8L6 18M18 6l1.8-1.8"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  var EDIT = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';

  function getTheme() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('xl_theme', t); } catch (e) {}
    if (themeBtn) themeBtn.innerHTML = t === 'dark' ? MOON : SUN;
  }
  // 暴露给键盘快捷键 IIFE：M=切换深浅色
  window.__xlToggleTheme = function () {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  };

  function fabBtn(id, cls, title, svg, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'fab ' + cls;
    b.id = id;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = svg;
    b.addEventListener('click', onClick);
    return b;
  }

  var themeBtn = null;

  // 把浮动按钮强制提升为 body 直接子元素，并用 inline style 兜底，
  // 避免某些页面把它嵌在 main/content 里，或 CSS 媒体查询未命中导致随滚动消失。
  function pinFloat() {
    var fa = ensureFloatActions();
    if (fa.parentNode !== document.body) {
      try { document.body.appendChild(fa); } catch (e) {}
    }
    var landscape = false;
    try { landscape = window.matchMedia('(orientation: landscape)').matches; } catch (e) {}
    var small = false;
    try { small = window.innerWidth <= 560; } catch (e) {}
    // 用 !important 内联样式兜底，确保任何 CSS 规则都无法把它推到页面底部
    var off = vbOffset();
    var right = landscape ? (small ? '12px' : '20px') : '12px';
    var bottom = landscape
      ? (small ? 'calc(12px + env(safe-area-inset-bottom, 0px) + ' + off + 'px)' : 'calc(20px + env(safe-area-inset-bottom, 0px) + ' + off + 'px)')
      : 'calc(86px + env(safe-area-inset-bottom, 0px) + ' + off + 'px)';
    var z = landscape ? '150' : '1000';
    fa.style.setProperty('position', 'fixed', 'important');
    fa.style.setProperty('top', 'auto', 'important');
    fa.style.setProperty('left', 'auto', 'important');
    fa.style.setProperty('right', right, 'important');
    fa.style.setProperty('bottom', bottom, 'important');
    fa.style.setProperty('z-index', z, 'important');
  }

  // 底部蓝条同样强制钉在屏幕底部：竖屏时移到 body 并内联 fixed 兜底，
  // 防止它嵌在 .topbar 里受包含块影响而退化为文档流（要滚到底才看到）。
  // 横屏/桌面则还原回 .topbar 内，保持顶部右侧布局。
  function pinBarRight() {
    var bar = document.querySelector('.bar-right');
    if (!bar) return;
    var portrait = false;
    try { portrait = window.matchMedia('(orientation: portrait)').matches; } catch (e) {}
    if (portrait) {
      if (bar.parentNode !== document.body) {
        try { bar.__origParent = bar.parentNode; bar.__origNext = bar.nextSibling; document.body.appendChild(bar); } catch (e) {}
      }
      bar.style.setProperty('position', 'fixed', 'important');
      bar.style.setProperty('top', 'auto', 'important');
      bar.style.setProperty('bottom', 'calc(env(safe-area-inset-bottom, 0px) + ' + vbOffset() + 'px)', 'important');
      bar.style.setProperty('left', '0px', 'important');
      bar.style.setProperty('right', '0px', 'important');
      bar.style.setProperty('width', '100%', 'important');
      bar.style.setProperty('z-index', '1000', 'important');
    } else {
      if (bar.parentNode === document.body && bar.__origParent && bar.__origParent.parentNode) {
        try {
          if (bar.__origNext && bar.__origNext.parentNode === bar.__origParent) bar.__origParent.insertBefore(bar, bar.__origNext);
          else bar.__origParent.appendChild(bar);
        } catch (e) { try { bar.__origParent.appendChild(bar); } catch (_) {} }
      }
      ['position', 'top', 'bottom', 'left', 'right', 'width', 'z-index'].forEach(function (p) {
        bar.style.removeProperty(p);
      });
    }
  }

  // 视觉视口（地址栏）感知：把地址栏高度并入底部固定条 bottom，使其始终贴屏幕底
  function vbOffset() {
    var vv = window.visualViewport;
    var o = 0;
    try { if (vv) o = vv.offsetBottom || 0; } catch (e) {}
    return o;
  }
  function syncVB() {
    var off = vbOffset();
    document.documentElement.style.setProperty('--vb-bottom', off + 'px');
    try { pinBarRight(); } catch (e) {}
    try { pinFloat(); } catch (e) {}
  }
  (function attachVB() {
    var vv = window.visualViewport;
    if (vv) {
      var ticking = false;
      function onVV() {
        if (ticking) return;
        ticking = true;
        (window.requestAnimationFrame || function (f) { setTimeout(f, 16); })(function () { syncVB(); ticking = false; });
      }
      // resize 覆盖地址栏展开/折叠；scroll 覆盖页面滚动导致的视觉视口位移
      vv.addEventListener('resize', onVV, { passive: true });
      vv.addEventListener('scroll', onVV, { passive: true });
    }
    // 兜底：部分浏览器 window resize 也可能反映地址栏变化（schedulePin 也会再 pin 一次）
    try { window.addEventListener('resize', function () { syncVB(); }, { passive: true }); } catch (e) {}
    syncVB();
  })();

  function ensureFloatActions() {
    var fa = document.querySelector('.float-actions');
    if (!fa) {
      fa = document.createElement('div');
      fa.className = 'float-actions';
      document.body.appendChild(fa);
    }
    return fa;
  }

  function injectFloat() {
    // 预载编辑栏脚本：无论是否有浮动按钮，都让其应用已保存的页面覆盖
    loadEditbar();

    var fa = ensureFloatActions();

    // 1) 深浅色切换：插在「语言」按钮左侧
    if (!fa.querySelector('#themeToggle')) {
      themeBtn = fabBtn('themeToggle', 'xl-theme', '切换深浅色', getTheme() === 'dark' ? MOON : SUN, function () {
        setTheme(getTheme() === 'dark' ? 'light' : 'dark');
      });
      var lang = fa.querySelector('#langBtn') || fa.querySelector('a[href$="language.html"]');
      if (lang) fa.insertBefore(themeBtn, lang);
      else fa.appendChild(themeBtn);
    }

    // 2) 动态加载编辑栏脚本（仅站主会用，但全站预载以便随时可用）
    loadEditbar();

    // 3) 站主：在主题按钮左侧插入「更改当前页面布局」
    maybeInjectLayoutBtn();

    // 4) 强制钉在 body 并兜底固定位置，防止横屏下随滚动消失
    pinFloat();
    pinBarRight();
  }

  function loadEditbar() {
    if (window.XLEdit) return;
    // 注意：脚本引用带 ?v= 版本号，src 不再以 "common.js" 结尾，必须用 *=
    var sc = document.querySelector('script[src*="common.js"]');
    var src = sc ? (sc.getAttribute('src') || '') : '';
    var m = src.match(/^((?:\.\.\/)*)/);
    var prefix = m ? m[1] : '';
    var s = document.createElement('script');
    s.src = prefix + 'editbar.js?v=20260908ae';
    s.async = true;
    document.head.appendChild(s);
  }

  function maybeInjectLayoutBtn() {
    var fa = ensureFloatActions();
    if (fa.querySelector('#editLayoutBtn')) return;
    var auth = window.JW_AUTH;
    var ok = auth && auth.user && (auth.user.isAdmin || auth.user.login === OWNER);
    if (!ok) return;
    var btn = fabBtn('editLayoutBtn', 'xl-edit-fab', '更改当前页面布局', EDIT, function () {
      if (window.XLEdit) window.XLEdit.open();
    });
    var ref = fa.querySelector('#themeToggle') || fa.querySelector('#langBtn');
    if (ref) fa.insertBefore(btn, ref);
    else fa.appendChild(btn);
    pinFloat();
  }

  // 登录态变化（auth.js 在解析完成后回调）-> 站主时补插布局按钮
  var prev = window.onAuthState;
  window.onAuthState = function (auth) {
    if (typeof prev === 'function') { try { prev(auth); } catch (e) {} }
    maybeInjectLayoutBtn();
  };
  // 若 auth 已就绪（脚本加载顺序导致），立即判断一次
  if (window.JW_AUTH && window.JW_AUTH.user) maybeInjectLayoutBtn();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectFloat);
  else injectFloat();

  // 方向/尺寸变化时重新兜底固定位置
  var pinTimer = null;
  function schedulePin() {
    if (pinTimer) clearTimeout(pinTimer);
    pinTimer = setTimeout(function () { pinFloat(); pinBarRight(); }, 80);
  }
  try { window.addEventListener('resize', schedulePin); } catch (e) {}
  try { window.addEventListener('orientationchange', schedulePin); } catch (e) {}
  try { window.matchMedia('(orientation: landscape)').addEventListener('change', schedulePin); } catch (e) {}
})();
