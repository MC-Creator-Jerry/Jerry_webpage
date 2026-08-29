/* common.js — 小蓝页共享输入增强：文本域自动增高 + 字数计数
 * 用法：
 *   <textarea class="edit-textarea auto-grow" ...></textarea>
 *   <input class="edit-input" id="x" maxlength="200" />
 *   <span class="char-count" data-for="x"></span>
 * 无需手动调用，脚本在 DOM 就绪后自动初始化页面内所有 .auto-grow 与带 maxlength 的字段。
 */
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
(function () {
  function iconPrefix() {
    var sc = document.querySelector('script[src$="common.js"]');
    var src = sc ? (sc.getAttribute('src') || '') : '';
    var m = src.match(/^((?:\.\.\/)*)/);
    return (m ? m[1] : '') + 'icons/';
  }
  function makeImg(file) {
    var img = document.createElement('img');
    img.className = 'ico';
    img.src = iconPrefix() + file;
    img.alt = '';
    return img;
  }
  function addIcon(el, file) {
    if (!el || el.querySelector(':scope > img.ico')) return;
    el.insertBefore(makeImg(file), el.firstChild);
  }

  // 顶部蓝条按钮 -> 白色图标
  var BAR = [
    { re: /消息中心|通知/, f: 'w-bell.svg' },
    { re: /帮助/, f: 'w-help.svg' },
    { re: /个人主页|主页/, f: 'w-user.svg' },
    { re: /帖子中心/, f: 'w-posts.svg' },
    { re: /产品/, f: 'w-products.svg' },
    { re: /登录/, f: 'w-user.svg' },
    { re: /退出/, f: 'w-logout.svg' },
    { re: /新加帖子/, f: 'w-edit.svg' }
  ];
  // 浮动按钮（语言/设置）-> 深色图标，替换内联 svg
  var FAB = [
    { re: /语言|language/i, f: 'globe.svg' },
    { re: /设置|settings/i, f: 'gear.svg' }
  ];
  // 通用文字按钮 -> 深色图标
  var GEN = [
    { re: /^发送$/, f: 'send.svg' }
  ];

  function run() {
    document.querySelectorAll('.bar-btn').forEach(function (b) {
      var t = (b.getAttribute('data-zh') || b.textContent || '').trim();
      for (var i = 0; i < BAR.length; i++) {
        if (BAR[i].re.test(t)) { addIcon(b, BAR[i].f); break; }
      }
    });
    document.querySelectorAll('.fab').forEach(function (f) {
      var label = (f.getAttribute('aria-label') || f.getAttribute('title') || '').trim();
      for (var j = 0; j < FAB.length; j++) {
        if (FAB[j].re.test(label)) { f.innerHTML = ''; f.appendChild(makeImg(FAB[j].f)); break; }
      }
    });
    document.querySelectorAll('button, .btn').forEach(function (b) {
      if (b.querySelector(':scope > img.ico')) return;
      var t = (b.getAttribute('data-zh') || b.textContent || '').trim();
      for (var k = 0; k < GEN.length; k++) {
        if (GEN[k].re.test(t)) { addIcon(b, GEN[k].f); break; }
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();

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
    var sc = document.querySelector('script[src$="common.js"]');
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
      vid: getVid()
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

/* ============ 顶栏搜索框 + 私信入口 + 管理员入口（注入到每个页面的 .bar-right） ============ */
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

      var dmLink = document.createElement('a');
      dmLink.className = 'bar-btn xl-dm';
      dmLink.href = '/messages/';
      dmLink.textContent = '私信';
      dmLink.hidden = true;
      var dmBadge = document.createElement('span');
      dmBadge.className = 'badge'; dmBadge.id = 'dmBadge'; dmBadge.hidden = true;
      dmLink.appendChild(dmBadge);

      var pointsLink = document.createElement('a');
      pointsLink.className = 'bar-btn xl-points';
      pointsLink.href = '/points/';
      pointsLink.textContent = '积分榜';

      var groupsLink = document.createElement('a');
      groupsLink.className = 'bar-btn xl-groups';
      groupsLink.href = '/groups/';
      groupsLink.textContent = '群组';

      var subLink = document.createElement('a');
      subLink.className = 'bar-btn xl-subscribe';
      subLink.href = '/subscribe/';
      subLink.textContent = '订阅';

      var adminLink = document.createElement('a');
      adminLink.className = 'bar-btn admin-only';
      adminLink.href = '/admin/reports/';
      adminLink.textContent = '举报后台';

      var notice = bar.querySelector('#noticeBtn');
      var login = bar.querySelector('#loginBtn') || bar.querySelector('#logoutBtn');
      // 搜索栏放在「消息中心」按钮的左侧
      var formRef = notice || login;
      if (formRef) { bar.insertBefore(form, formRef); }
      else { bar.appendChild(form); }
      if (login) { bar.insertBefore(dmLink, login); bar.insertBefore(groupsLink, login); bar.insertBefore(pointsLink, login); bar.insertBefore(subLink, login); bar.insertBefore(adminLink, login); }
      else { bar.appendChild(dmLink); bar.appendChild(groupsLink); bar.appendChild(pointsLink); bar.appendChild(subLink); bar.appendChild(adminLink); }
    });
    updateDmBadge();
    // 实时刷新：后台轮询通知 / 私信徽标（免 VAPID，纯前端轮询）
    if (!window.__xlRealtimeStarted) {
      window.__xlRealtimeStarted = true;
      setInterval(function () {
        try { updateDmBadge(); } catch (e) {}
        try { if (window.JW_REFRESH_BADGE) window.JW_REFRESH_BADGE(); } catch (e) {}
      }, 45000);
    }
  }
  function updateDmBadge() {
    fetch('/api/me').then(function (r) { return r.ok ? r.json() : null; }).then(function (me) {
      if (!me || !me.login) return;
      var links = document.querySelectorAll('.xl-dm');
      links.forEach(function (l) { l.hidden = false; });
      fetch('/api/message').then(function (r) { return r.ok ? r.json() : { conversations: [] }; }).then(function (d) {
        var convs = d.conversations || [];
        var unread = convs.reduce(function (s, c) { return s + (c.unread || 0); }, 0);
        var badges = document.querySelectorAll('#dmBadge');
        badges.forEach(function (b) {
          if (unread > 0) { b.textContent = unread > 99 ? '99+' : String(unread); b.hidden = false; }
          else { b.hidden = true; }
        });
      }).catch(function () {});
    }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();

/* ============ 浮动按钮：深浅色切换（所有访客）+ 站主「更改当前页面布局」 ============ */
(function () {
  'use strict';
  var OWNER = 'MC-Creator-Jerry';
  var SUN = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8L6 18M18 6l1.8-1.8"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  var EDIT = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>';

  function getTheme() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('xl_theme', t); } catch (e) {}
    if (themeBtn) themeBtn.innerHTML = t === 'dark' ? MOON : SUN;
  }

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

  function injectFloat() {
    // 预载编辑栏脚本：无论是否有浮动按钮，都让其应用已保存的页面覆盖
    loadEditbar();

    var fa = document.querySelector('.float-actions');
    if (!fa) return;

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
  }

  function loadEditbar() {
    if (window.XLEdit) return;
    var sc = document.querySelector('script[src$="common.js"]');
    var src = sc ? (sc.getAttribute('src') || '') : '';
    var m = src.match(/^((?:\.\.\/)*)/);
    var prefix = m ? m[1] : '';
    var s = document.createElement('script');
    s.src = prefix + 'editbar.js';
    s.async = true;
    document.head.appendChild(s);
  }

  function maybeInjectLayoutBtn() {
    var fa = document.querySelector('.float-actions');
    if (!fa || fa.querySelector('#editLayoutBtn')) return;
    var auth = window.JW_AUTH;
    var ok = auth && auth.user && (auth.user.isAdmin || auth.user.login === OWNER);
    if (!ok) return;
    var btn = fabBtn('editLayoutBtn', 'xl-edit-fab', '更改当前页面布局', EDIT, function () {
      if (window.XLEdit) window.XLEdit.open();
    });
    var ref = fa.querySelector('#themeToggle') || fa.querySelector('#langBtn');
    if (ref) fa.insertBefore(btn, ref);
    else fa.appendChild(btn);
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
})();
