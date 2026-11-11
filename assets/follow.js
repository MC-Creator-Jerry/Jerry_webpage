/* ============================================================
 *  _shared/follow-ui/follow.js  —— 全站统一「关注按钮」前端组件
 *
 *  形态（对齐微博风格）：
 *      ┌───────────┬───┐
 *      │   关注    │ ▾ │     ← 主键：切换关注/取消关注
 *      └───────────┴───┘
 *         ┌────────────┐
 *         │  特别关注   │     ← 下拉：升级为特别关注
 *         │  取消关注   │     ← 已关注时才出现
 *         └────────────┘
 *
 *  用法：
 *    FollowUI.attach(el, login, { endpoint, me, onLoginRequired, onChange });
 *    FollowUI.enhance(root, { endpoint, me });   // 扫描 [data-follow-login]
 *    FollowUI.badge(flags) -> Element|null       // 「优先 / 特别关注」标记
 *
 *  关系：none（未关注）→ follow（关注）→ star（特别关注）
 *    · star 隐含 follow；取消关注会同时取消特别关注；取消特别关注保留关注。
 * ============================================================ */
(function () {
  'use strict';

  var STYLE_ID = 'fui-style';

  function isEn() {
    var l = (document.documentElement.getAttribute('lang') || '').toLowerCase();
    return l.indexOf('en') === 0;
  }
  var LABELS = {
    zh: { follow: '关注', followed: '已关注', starred: '已特别关注', star: '特别关注', unstar: '取消特别关注', unfollow: '取消关注', self: '自己', priority: '优先', toLogin: '请先登录' },
    en: { follow: 'Follow', followed: 'Following', starred: 'Close friend', star: 'Close friend', unstar: 'Remove close friend', unfollow: 'Unfollow', self: 'You', priority: 'Priority', toLogin: 'Please sign in' },
  };
  function L() { return isEn() ? LABELS.en : LABELS.zh; }

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    var css = '' +
      '.fui-wrap{position:relative;display:inline-flex;align-items:stretch;vertical-align:middle;font-size:.84rem;line-height:1;}' +
      '.fui-main,.fui-caret{border:1px solid color-mix(in srgb,var(--accent) 55%,var(--card-border));background:var(--accent);color:#fff;font-weight:700;cursor:pointer;padding:6px 12px;transition:filter .15s,background .15s,color .15s;}' +
      '.fui-main{border-radius:999px 0 0 999px;border-right:none;min-width:56px;}' +
      '.fui-caret{border-radius:0 999px 999px 0;padding:6px 8px;display:inline-flex;align-items:center;}' +
      '.fui-caret svg{display:block;}' +
      '.fui-main:hover,.fui-caret:hover{filter:brightness(1.08);}' +
      '.fui-wrap.on .fui-main,.fui-wrap.on .fui-caret{background:transparent;color:var(--accent);border-color:color-mix(in srgb,var(--accent) 45%,var(--card-border));}' +
      '.fui-wrap.on .fui-main{border-right:1px solid color-mix(in srgb,var(--accent) 30%,var(--card-border));}' +
      '.fui-wrap.star .fui-main,.fui-wrap.star .fui-caret{background:color-mix(in srgb,var(--accent) 16%,var(--panel-bg));color:var(--accent);border-color:color-mix(in srgb,var(--accent) 55%,var(--card-border));}' +
      '.fui-caret[disabled],.fui-main[disabled]{opacity:.55;cursor:default;}' +
      '.fui-menu{position:absolute;left:0;top:calc(100% + 6px);z-index:60;min-width:132px;background:var(--card-bg,#fff);border:1px solid var(--card-border);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:4px;display:none;}' +
      '.fui-menu.open{display:block;}' +
      '.fui-menu button{display:block;width:100%;text-align:left;border:none;background:transparent;color:var(--text);font-size:.85rem;font-weight:600;padding:8px 12px;border-radius:7px;cursor:pointer;white-space:nowrap;}' +
      '.fui-menu button:hover{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent);}' +
      '.fui-menu button.fui-danger:hover{background:color-mix(in srgb,#e5484d 14%,transparent);color:#e5484d;}' +
      '.fui-badge{display:inline-flex;align-items:center;gap:3px;font-size:.68rem;font-weight:800;padding:1px 7px;border-radius:999px;background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent);vertical-align:middle;}' +
      '.fui-badge.star{background:color-mix(in srgb,#e6a400 20%,transparent);color:#c98a00;}' +
      '.fui-toast{position:fixed;left:50%;top:22px;transform:translateX(-50%);z-index:9999;background:#1c2733;color:#fff;padding:9px 16px;border-radius:10px;font-size:.86rem;box-shadow:0 6px 20px rgba(0,0,0,.3);opacity:0;transition:opacity .25s;pointer-events:none;}' +
      '.fui-toast.show{opacity:1;}';
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = css;
    document.head.appendChild(s);
  }

  function toast(msg, isErr) {
    if (!msg) return;
    var el = document.querySelector('.fui-toast');
    if (!el) { el = document.createElement('div'); el.className = 'fui-toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.style.background = isErr ? '#c0392b' : '#1c2733';
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 1800);
  }

  function req(endpoint, login) {
    return fetch(endpoint + '?target=' + encodeURIComponent(login), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  function post(endpoint, payload) {
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .catch(function () { return { ok: false }; });
  }

  var CARET = '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M2.5 4.2 6 7.8l3.5-3.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function make(opts) {
    opts = opts || {};
    var endpoint = opts.endpoint || '/api/follow';
    var me = opts.me || null;

    var wrap = document.createElement('span');
    wrap.className = 'fui-wrap';
    var main = document.createElement('button');
    main.type = 'button'; main.className = 'fui-main';
    var caret = document.createElement('button');
    caret.type = 'button'; caret.className = 'fui-caret';
    caret.setAttribute('aria-label', '更多关注选项');
    caret.innerHTML = CARET;
    wrap.appendChild(main); wrap.appendChild(caret);

    var menu = document.createElement('div');
    menu.className = 'fui-menu';
    var btnStar = document.createElement('button');
    btnStar.type = 'button';
    var btnUnfollow = document.createElement('button');
    btnUnfollow.type = 'button'; btnUnfollow.className = 'fui-danger';
    menu.appendChild(btnStar); menu.appendChild(btnUnfollow);
    wrap.appendChild(menu);

    var state = { relation: 'none', target: opts.login };

    function closeMenu() { menu.classList.remove('open'); }
    function openMenu() { menu.classList.add('open'); }
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) closeMenu(); }, true);

    function render() {
      var lb = L();
      var rel = state.relation;
      wrap.classList.toggle('on', rel === 'follow' || rel === 'star');
      wrap.classList.toggle('star', rel === 'star');
      main.textContent = rel === 'star' ? lb.starred : (rel === 'follow' ? lb.followed : lb.follow);
      btnStar.textContent = rel === 'star' ? lb.unstar : lb.star;
      btnUnfollow.textContent = lb.unfollow;
      // 未关注时隐藏「取消关注」（与截图一致：特别关注在下面，已关注才多一项取消关注）
      btnUnfollow.style.display = (rel === 'follow' || rel === 'star') ? '' : 'none';
    }

    function ensureLogin() {
      if (me) return true;
      toast(L().toLogin, true);
      if (opts.requireLogin) opts.requireLogin();
      return false;
    }

    function doAction(action) {
      if (!ensureLogin()) return;
      post(endpoint, { action: action, target: state.target }).then(function (res) {
        if (res && res.ok) {
          state.relation = res.relation || (res.starred ? 'star' : (res.following ? 'follow' : 'none'));
          render();
          var lb = L();
          var msg = action === 'star' ? (lb.star + ' ✓')
            : action === 'unstar' ? lb.unstar
            : action === 'unfollow' ? lb.unfollow : (lb.follow + ' ✓');
          toast(msg);
          if (opts.onChange) opts.onChange(state, res);
        } else {
          toast(res && res.error === 'cannot_self' ? L().self : '操作失败', true);
        }
      });
    }

    main.addEventListener('click', function () {
      if (!ensureLogin()) return;
      doAction(state.relation === 'none' ? 'follow' : 'unfollow');
    });
    caret.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!ensureLogin()) return;
      menu.classList.contains('open') ? closeMenu() : openMenu();
    });
    btnStar.addEventListener('click', function () { closeMenu(); doAction(state.relation === 'star' ? 'unstar' : 'star'); });
    btnUnfollow.addEventListener('click', function () { closeMenu(); doAction('unfollow'); });

    // 阻止点击冒泡：卡片本身常是 <a>，避免点关注时跳转
    wrap.addEventListener('click', function (e) { e.stopPropagation(); });

    render();
    // 拉取当前关系（服务端回传 self / anonymous）
    if (opts.login) {
      req(endpoint, opts.login).then(function (d) {
        if (!d) return;
        if (d.self) { wrap.style.display = 'none'; return; }
        if (!d.anonymous) { state.relation = d.relation || 'none'; render(); }
      });
    }
    return wrap;
  }

  // 把按钮挂到容器里（清空容器）
  function attach(container, login, opts) {
    injectCSS();
    opts = opts || {};
    if (!container) return null;
    container.innerHTML = '';
    var el = make(Object.assign({}, opts, { login: login }));
    container.appendChild(el);
    return el;
  }

  // 扫描 [data-follow-login]，在 [data-follow-slot] 或元素内注入按钮
  function enhance(root, opts) {
    injectCSS();
    opts = opts || {};
    root = root || document;
    var nodes = root.querySelectorAll('[data-follow-login]');
    Array.prototype.forEach.call(nodes, function (n) {
      if (n._fuiDone) return;
      var login = n.getAttribute('data-follow-login');
      if (!login) return;
      if (opts.me && login === opts.me) { n._fuiDone = true; return; }
      var slot = n.querySelector('[data-follow-slot]') || n;
      n._fuiDone = true;
      attach(slot, login, opts);
    });
  }

  // 「优先 / 特别关注」标记
  function badge(flags) {
    if (!flags) return null;
    var b = null;
    if (flags.starred) { b = document.createElement('span'); b.className = 'fui-badge star'; b.textContent = '★ ' + L().starred; }
    else if (flags.followed) { b = document.createElement('span'); b.className = 'fui-badge'; b.textContent = '★ ' + L().priority; }
    return b;
  }

  window.FollowUI = { attach: attach, enhance: enhance, badge: badge, make: make, toast: toast, injectCSS: injectCSS, labels: function () { return L(); } };
})();
