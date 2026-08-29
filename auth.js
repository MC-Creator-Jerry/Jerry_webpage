// 小蓝页 · GitHub 登录（OAuth2 + Cloudflare Pages Functions + KV）
// 完全免费组合：Cloudflare Pages/Workers/KV 免费层 + GitHub OAuth App（免费）。
// secret 由 /api/callback 后端持有，浏览器只拿不到 token 的 httpOnly cookie。
// 未配置 CLIENT_ID 时静默降级（隐藏登录入口），不会在 GitHub Pages 上崩溃。
//
// 账户菜单（头像）也在此集中处理：蓝条最右侧头像 -> 下拉「个人主页 / 设置」
// （未登录时额外显示「GitHub 登录」）；登出入口放在设置页底部。
(function () {
  var loginBtn = document.getElementById('loginBtn');
  var logoutBtn = document.getElementById('logoutBtn');
  window.JW_AUTH = { user: null, isAdmin: false };

  // 注入样式（通知红点 + 头像菜单 + 铃铛），避免给每个页面单独加 CSS
  (function injectStyles() {
    var s = document.createElement('style');
    s.textContent = [
      '.bar-btn{position:relative}',
      '.bar-btn .badge{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;margin-left:6px;background:#d13438;color:#fff;border-radius:999px;font-size:.7rem;font-weight:700;line-height:1}',
      '.bar-btn.icon{padding:6px 9px}',
      '.bar-btn.icon .badge{position:absolute;top:-6px;right:-8px;margin-left:0}',
      '.bar-right{position:relative}',
      '.bar-avatar{border:none;background:rgba(255,255,255,.12);width:36px;height:36px;border-radius:50%;padding:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;border:2px solid rgba(255,255,255,.7);flex:0 0 auto}',
      '.bar-avatar:hover{background:rgba(255,255,255,.22)}',
      '.bar-avatar img{width:100%;height:100%;object-fit:cover;display:block}',
      '.user-popup{position:absolute;top:calc(100% + 8px);right:0;min-width:184px;background:#fff;color:#1c2733;border:1px solid #e3e8ef;border-radius:12px;box-shadow:0 10px 30px rgba(20,35,59,.18);padding:6px;z-index:200}',
      '.user-popup .up-item{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;color:#1c2733;text-decoration:none;font-size:.95rem;font-weight:600}',
      '.user-popup .up-item:hover{background:#f1f5fa}',
      '.user-popup .up-ico{width:18px;height:18px;display:inline-flex;flex:0 0 auto}',
      '[hidden]{display:none!important}',
      /* ===== 悬浮预览卡（B 站风格） ===== */
      '.xl-hovercard{position:fixed;z-index:300;min-width:220px;max-width:360px;background:#fff;color:#1c2733;border:1px solid #e3e8ef;border-radius:14px;box-shadow:0 14px 38px rgba(20,35,59,.24);padding:14px;opacity:0;transform:translateY(-6px) scale(.98);transition:opacity .18s ease,transform .18s ease;pointer-events:none;visibility:hidden}',
      '.xl-hovercard.show{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;visibility:visible}',
      '.xl-hovercard.avatar-card{max-width:240px}',
      '.xl-hovercard .hc-avatar{width:64px;height:64px;border-radius:50%;overflow:hidden;margin:0 auto 8px;background:#eef2f7}',
      '.xl-hovercard .hc-avatar img{width:100%;height:100%;object-fit:cover;display:block}',
      '.xl-hovercard .hc-name{text-align:center;font-size:1.02rem;font-weight:700}',
      '.xl-hovercard .hc-login{text-align:center;font-size:.8rem;color:#6b7785;margin-top:2px}',
      '.xl-hovercard .hc-actions{display:flex;gap:8px;margin-top:12px}',
      '.xl-hovercard .hc-btn{flex:1;text-align:center;padding:8px 10px;border-radius:9px;background:#0078d4;color:#fff;text-decoration:none;font-size:.9rem;font-weight:600}',
      '.xl-hovercard .hc-btn.ghost{background:#eef2f7;color:#1c2733}',
      '.xl-hovercard .hc-btn:hover{filter:brightness(1.06)}',
      '.xl-hovercard .hc-head{display:flex;justify-content:space-between;align-items:center;font-weight:700;margin-bottom:10px}',
      '.xl-hovercard .hc-more{font-weight:600;font-size:.82rem;color:#0078d4;text-decoration:none}',
      '.xl-hovercard .hc-cols{display:flex;gap:10px}',
      '.xl-hovercard .hc-col{flex:1;min-width:0}',
      '.xl-hovercard .hc-ct{font-size:.78rem;color:#6b7785;margin-bottom:4px}',
      '.xl-hovercard .hc-ct b{color:#d13438;font-size:.85rem}',
      '.xl-hovercard .hc-col ul{list-style:none;margin:0;padding:0;font-size:.76rem;line-height:1.4}',
      '.xl-hovercard .hc-col li{padding:3px 0;border-top:1px solid #f0f3f7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.xl-hovercard .hc-empty{color:#9aa6b2}',
      '.xl-hovercard .hc-loading{font-size:.85rem;color:#6b7785;text-align:center;padding:8px}',
      '@media (prefers-reduced-motion: reduce){.xl-hovercard{transition:none}}'
    ].join('\n');
    document.head.appendChild(s);
  })();

  // 默认头像（未登录：灰底白人形）
  function defaultAvatarSvg() {
    return "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='12' fill='#c9d3df'/><path d='M12 12.6a4 4 0 1 0 0-8 4 4 0 0 0 0 8z' fill='#fff'/><path d='M12 14c-3.3 0-6 1.8-6 4v.6h12v-.6c0-2.2-2.7-4-6-4z' fill='#fff'/></svg>";
  }
  var DEFAULT_AVATAR = 'data:image/svg+xml,' + encodeURIComponent(defaultAvatarSvg());

  // 计算相对路径前缀（依据当前页面所在目录深度）
  function relBase() {
    var p = location.pathname;
    var dir = p.endsWith('/') ? p : p.substring(0, p.lastIndexOf('/') + 1);
    var segs = dir.split('/').filter(function (s) { return s.length > 0; });
    return segs.map(function () { return '..'; }).join('/') + (segs.length ? '/' : '');
  }
  var BASE = relBase();

  // 蓝条「通知」红点：拉取未读总数（系统+消息+评论）并刷新
  function updateNoticeBadge() {
    var badge = document.getElementById('noticeBadge');
    if (!badge) return;
    fetch('/api/notif')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.total > 0) {
          badge.textContent = d.total > 99 ? '99+' : String(d.total);
          badge.hidden = false;
        } else {
          badge.hidden = true;
        }
      })
      .catch(function () { badge.hidden = true; });
  }
  window.JW_REFRESH_BADGE = updateNoticeBadge;

  // ← 填入 GitHub OAuth App 的 Client ID；为空则视为未配置（按钮隐藏）
  var CLIENT_ID = 'Ov23ctu9zRxIQ0o0uxiJ';

  var KEYS = { lang: 'xl_lang', theme: 'xl_theme', font: 'xl_font', radius: 'xl_radius', autosave: 'xl_autosave' };
  function get(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function applyUserPrefs(p) {
    if (!p) return;
    if (p.lang) set(KEYS.lang, p.lang);
    if (p.theme) set(KEYS.theme, p.theme);
    if (p.font != null) set(KEYS.font, String(p.font));
    if (p.radius != null) set(KEYS.radius, String(p.radius));
    if (p.autosave) set(KEYS.autosave, p.autosave);
    if (typeof window.applyAll === 'function') window.applyAll();
  }

  // 移除蓝条上不应出现的按钮（个人主页、退出）——集中在此处理，避免改 11 个页面
  function cleanupBar() {
    if (logoutBtn && logoutBtn.parentNode) logoutBtn.parentNode.removeChild(logoutBtn);
    var ph = document.querySelector('.bar-right a.bar-btn[href="home.html"]');
    if (ph && ph.parentNode) ph.parentNode.removeChild(ph);
  }
  cleanupBar();

  function setAvatar(src) {
    var img = document.getElementById('userAvatarImg');
    if (img) img.src = src || DEFAULT_AVATAR;
  }
  function setLoginItem(show) {
    var li = document.getElementById('upLogin');
    if (li) li.hidden = !show;
  }

  function setLoggedIn(user) {
    window.JW_AUTH.user = user;
    window.JW_AUTH.isAdmin = !!(user && user.isAdmin);
    if (loginBtn) loginBtn.style.display = 'none';
    setAvatar((user && user.avatar_url) || ('https://github.com/' + user.login + '.png'));
    setLoginItem(false);
    fetch('/api/usersettings')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.prefs) applyUserPrefs(d.prefs); })
      .catch(function () {});
    updateNoticeBadge();
    if (typeof window.onAuthState === 'function') window.onAuthState(window.JW_AUTH);
  }

  function setLoggedOut() {
    window.JW_AUTH.user = null;
    window.JW_AUTH.isAdmin = false;
    if (loginBtn) loginBtn.style.display = '';
    setAvatar(DEFAULT_AVATAR);
    setLoginItem(true);
    updateNoticeBadge();
    if (typeof window.onAuthState === 'function') window.onAuthState(window.JW_AUTH);
  }

  // 暴露给设置页：登出 / 登录
  window.JW_LOGOUT = function () {
    fetch('/api/logout').then(function () { setLoggedOut(); }).catch(function () { setLoggedOut(); });
  };
  function doLogin() {
    var state = randState();
    try { sessionStorage.setItem('gh_oauth_state', state); } catch (x) {}
    var url = 'https://github.com/login/oauth/authorize?client_id=' + encodeURIComponent(CLIENT_ID) +
      '&redirect_uri=' + encodeURIComponent(REDIRECT) +
      '&scope=' + encodeURIComponent('read:user user:email') +
      '&state=' + encodeURIComponent(state);
    window.location.href = url;
  }
  window.JW_LOGIN = doLogin;

  // 注入头像按钮 + 下拉菜单（蓝条最右侧）
  (function buildAvatarMenu() {
    var right = document.querySelector('.bar-right');
    if (!right) return;
    var personIco = "<svg viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'/><circle cx='12' cy='7' r='4'/></svg>";
    var gearIco = "<svg viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='3'/><path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'/></svg>";
    var ghIco = "<svg viewBox='0 0 24 24' width='18' height='18' fill='currentColor'><path d='M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17 4.6 18 4.9 18 4.9c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z'/></svg>";

    var btn = document.createElement('button');
    btn.className = 'bar-avatar';
    btn.id = 'userAvatarBtn';
    btn.setAttribute('aria-label', '账户');
    btn.innerHTML = '<img id="userAvatarImg" src="' + DEFAULT_AVATAR + '" alt="">';

    var pop = document.createElement('div');
    pop.className = 'user-popup';
    pop.id = 'userPopup';
    pop.hidden = true;
    pop.innerHTML =
      '<a class="up-item" id="upProfile" href="' + BASE + 'personal_profile/">' +
        '<span class="up-ico">' + personIco + '</span><span data-zh="个人主页" data-en="Profile">个人主页</span></a>' +
      '<a class="up-item" id="upSettings" href="' + BASE + 'settings/homepage.html">' +
        '<span class="up-ico">' + gearIco + '</span><span data-zh="设置" data-en="Settings">设置</span></a>' +
      '<a class="up-item" id="upLogin" href="#" hidden>' +
        '<span class="up-ico">' + ghIco + '</span><span data-zh="登录" data-en="Sign in">登录</span></a>';

    right.appendChild(btn);
    right.appendChild(pop);

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      pop.hidden = !pop.hidden;
    });
    document.addEventListener('click', function (e) {
      if (!pop.hidden && e.target !== btn && !pop.contains(e.target)) pop.hidden = true;
    });
    var loginItem = document.getElementById('upLogin');
    if (loginItem) loginItem.addEventListener('click', function (e) {
      e.preventDefault();
      pop.hidden = true;
      doLogin();
    });

    // 让下拉项跟随当前语言
    if (typeof window.applyAll === 'function') window.applyAll();
  })();

  // 通知按钮统一换成铃铛图标（避免改 11 个页面）
  (function bellifyNotice() {
    var nb = document.getElementById('noticeBtn');
    if (!nb) return;
    var badge = nb.querySelector('#noticeBadge');
    var bell = "<svg viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9'/><path d='M13.73 21a2 2 0 0 1-3.46 0'/></svg>";
    nb.classList.add('icon');
    nb.setAttribute('aria-label', '通知');
    nb.removeAttribute('data-zh');
    nb.removeAttribute('data-en');
    nb.innerHTML = bell + (badge ? badge.outerHTML : '');
  })();

  // 头像 / 通知 悬浮预览卡（B 站风格：鼠标悬停自动展开小型预览）
  (function hoverPreview() {
    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    function curLang() { try { return localStorage.getItem('xl_lang') || 'zh'; } catch (e) { return 'zh'; } }
    function t(zh, en) { return curLang() === 'en' ? en : zh; }
    var notifCache = { data: null, ts: 0 };

    // 通用：把 trigger 绑定到一个悬浮卡（卡挂到 body，用 fixed 定位，避免嵌套 <a> 与定位问题）
    function makeHover(trigger, builder, extraClass) {
      if (!trigger) return null;
      var card = document.createElement('div');
      card.className = 'xl-hovercard' + (extraClass ? ' ' + extraClass : '');
      document.body.appendChild(card);
      var showT, hideT;
      function place() {
        var r = trigger.getBoundingClientRect();
        var w = card.offsetWidth || 240;
        var h = card.offsetHeight || 180;
        var left = r.right - w - 4;
        if (left < 8) left = 8;
        if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
        // 如果触发器在屏幕下半部、下方空间不足，就把卡片显示在触发器上方
        var spaceBelow = window.innerHeight - r.bottom;
        var top;
        if (spaceBelow >= h + 12) {
          top = r.bottom + 8;
        } else {
          top = r.top - h - 8;
          if (top < 8) top = 8;
        }
        card.style.top = top + 'px';
        card.style.left = left + 'px';
      }
      function show() {
        clearTimeout(hideT);
        showT = setTimeout(function () {
          builder(card);
          place();
          card.classList.add('show');
        }, 200);
      }
      function hide() {
        clearTimeout(showT);
        hideT = setTimeout(function () { card.classList.remove('show'); }, 160);
      }
      trigger.addEventListener('mouseenter', show);
      trigger.addEventListener('mouseleave', hide);
      card.addEventListener('mouseenter', function () { clearTimeout(hideT); });
      card.addEventListener('mouseleave', hide);
      card.addEventListener('click', function (e) { e.stopPropagation(); });
      return { card: card, show: show, hide: hide };
    }

    function buildAvatar(card) {
      var u = window.JW_AUTH.user;
      if (u && u.login) {
        var av = u.avatar_url || ('https://github.com/' + u.login + '.png');
        card.innerHTML =
          '<div class="hc-avatar"><img src="' + av + '" alt=""></div>' +
          '<div class="hc-name">' + esc(u.display_name || u.login) + '</div>' +
          '<div class="hc-login">@' + esc(u.login) + (u.isAdmin ? ' · ' + t('管理员', 'Admin') : '') + '</div>' +
          '<div class="hc-actions">' +
            '<a class="hc-btn" href="' + BASE + 'personal_profile/">' + t('个人主页', 'Profile') + '</a>' +
            '<a class="hc-btn ghost" href="' + BASE + 'settings/homepage.html">' + t('设置', 'Settings') + '</a>' +
          '</div>';
      } else {
        card.innerHTML =
          '<div class="hc-avatar"><img src="' + DEFAULT_AVATAR + '" alt=""></div>' +
          '<div class="hc-name">' + t('未登录', 'Not signed in') + '</div>' +
          '<div class="hc-login">' + t('登录后可同步设置与数据', 'Sign in to sync settings & data') + '</div>' +
          '<div class="hc-actions"><a class="hc-btn" href="#" id="hcLogin">' + t('登录', 'Sign in') + '</a></div>';
        var lb = card.querySelector('#hcLogin');
        if (lb) lb.addEventListener('click', function (e) { e.preventDefault(); if (window.JW_LOGIN) window.JW_LOGIN(); });
      }
    }

    function buildNotice(card) {
      card.innerHTML = '<div class="hc-loading">' + t('加载中…', 'Loading…') + '</div>';
      var now = Date.now();
      if (notifCache.data && now - notifCache.ts < 15000) { renderNotif(card, notifCache.data); return; }
      fetch('/api/notif')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (d) { notifCache.data = d; notifCache.ts = Date.now(); renderNotif(card, d); }
          else card.innerHTML = '<div class="hc-loading">' + t('暂时无法加载', 'Unavailable') + '</div>';
        })
        .catch(function () { card.innerHTML = '<div class="hc-loading">' + t('网络错误', 'Network error') + '</div>'; });
    }
    function renderNotif(card, d) {
      var sys = d.system || [], msg = d.messages || [], cm = d.comments || [];
      function items(arr) {
        var top = arr.slice(0, 3);
        if (!top.length) return '<li class="hc-empty">' + t('暂无', 'None') + '</li>';
        return top.map(function (it) {
          var x = it.text || it.title || it.content || it.msg || t('通知', 'Notification');
          return '<li title="' + esc(x) + '">' + esc(x) + '</li>';
        }).join('');
      }
      card.innerHTML =
        '<div class="hc-head"><span>' + t('通知预览', 'Notifications') + '</span>' +
          '<a class="hc-more" href="' + BASE + 'notice/">' + t('查看全部 ›', 'View all ›') + '</a></div>' +
        '<div class="hc-cols">' +
          '<div class="hc-col"><div class="hc-ct">' + t('系统', 'System') + ' <b>' + (d.unread.system || 0) + '</b></div><ul>' + items(sys) + '</ul></div>' +
          '<div class="hc-col"><div class="hc-ct">' + t('消息', 'Messages') + ' <b>' + (d.unread.message || 0) + '</b></div><ul>' + items(msg) + '</ul></div>' +
          '<div class="hc-col"><div class="hc-ct">' + t('评论', 'Comments') + ' <b>' + (d.unread.comment || 0) + '</b></div><ul>' + items(cm) + '</ul></div>' +
        '</div>';
    }

    var avatarHover = makeHover(document.getElementById('userAvatarBtn'), buildAvatar, 'avatar-card');
    var noticeHover = makeHover(document.getElementById('noticeBtn'), buildNotice, 'notice-card');
    window.__avatarHover = avatarHover;
    window.__noticeHover = noticeHover;

    // 其余蓝条按钮的悬浮预览（帖子中心 / 产品 / 帮助中心 / 登录）
    function buildInfo(card, opts) {
      var html =
        '<div class="hc-name" style="text-align:left">' + esc(opts.title) + '</div>' +
        '<div class="hc-login" style="text-align:left;margin-top:6px;line-height:1.55">' + esc(opts.desc) + '</div>';
      if (opts.btnText) {
        html += '<div class="hc-actions"><a class="hc-btn" href="' + (opts.href || '#') + '"' +
          (opts.self ? ' target="_blank" rel="noopener"' : '') + '>' + esc(opts.btnText) + '</a></div>';
      }
      card.innerHTML = html;
      if (opts.onClick) {
        var b = card.querySelector('.hc-btn');
        if (b) b.onclick = function (e) { if (opts.href === '#') e.preventDefault(); opts.onClick(); };
      }
    }
    var postHover = makeHover(document.querySelector('.bar-right a[href$="post/"]'), function (c) {
      buildInfo(c, {
        title: t('帖子中心', 'Post Center'),
        desc: t('浏览社区帖子，或发布你的内容。', 'Browse community posts or publish your own.'),
        btnText: t('进入帖子中心 ›', 'Open Post Center ›'),
        href: BASE + 'post/', self: true
      });
    });
    var prodHover = makeHover(document.querySelector('.bar-right a[href*="products.html"]'), function (c) {
      buildInfo(c, {
        title: t('产品', 'Products'),
        desc: t('浏览我发布的工具与软件。', 'Browse the tools and software I published.'),
        btnText: t('查看产品 ›', 'View products ›'),
        href: BASE + 'products.html', self: true
      });
    });
    var helpHover = makeHover(document.querySelector('.bar-right a[href*="helpcenter/"]'), function (c) {
      buildInfo(c, {
        title: t('帮助中心', 'Help Center'),
        desc: t('常见问题与使用指南。', 'FAQ and usage guides.'),
        btnText: t('前往帮助中心 ›', 'Go to Help Center ›'),
        href: BASE + 'helpcenter/', self: true
      });
    });
    var loginHover = makeHover(document.getElementById('loginBtn'), function (c) {
      buildInfo(c, {
        title: t('登录', 'Sign in'),
        desc: t('登录以同步你的设置与数据到云端。', 'Sign in to sync your settings and data to the cloud.'),
        btnText: t('使用 GitHub 登录', 'Sign in with GitHub'),
        href: '#',
        onClick: function () { if (window.JW_LOGIN) window.JW_LOGIN(); }
      });
    });
    window.__postHover = postHover; window.__prodHover = prodHover;
    window.__helpHover = helpHover; window.__loginHover = loginHover;

    // 避免头像的「悬浮预览」与原有「点击下拉菜单」互相冲突
    var ab = document.getElementById('userAvatarBtn');
    if (ab) {
      ab.addEventListener('mouseenter', function () { var p = document.getElementById('userPopup'); if (p) p.hidden = true; });
      ab.addEventListener('click', function () { if (avatarHover) avatarHover.hide(); });
    }
  })();

  // 暴露给设置页：把当前设置保存到云端（用户身份由后端 cookie 识别）
  window.saveUserPrefs = function (prefs) {
    fetch('/api/usersettings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefs: prefs })
    }).catch(function () {});
  };

  if (!CLIENT_ID) {
    if (loginBtn) loginBtn.style.display = 'none';
    return;
  }

  var REDIRECT = window.location.origin + '/api/callback';
  function randState() {
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  // 页面加载即尝试读取登录态（后端 cookie）
  // 健壮性修复：只在后端明确「无会话(401)」时才登出；网络/限流等非 401 错误
  // 一律重试一次并保留当前状态，杜绝「切个页面就莫名登出」。
  function loadMe(tries) {
    tries = tries || 0;
    fetch('/api/me')
      .then(function (r) {
        if (r.ok) {
          return r.json().then(function (d) {
            if (d && d.login) setLoggedIn(d);
            else setLoggedOut();
          });
        }
        // 401 = 确实没有会话 -> 登出；其余（网络/404/5xx）属于瞬时异常
        if (r.status === 401) { setLoggedOut(); return; }
        if (tries < 1) return loadMe(tries + 1);
        // 重试后仍异常：不要误登出，保持页面默认（登录按钮可见）状态
      })
      .catch(function () {
        // 网络层失败：重试一次；绝不因瞬时网络抖动而登出
        if (tries < 1) return loadMe(tries + 1);
      });
  }
  loadMe();

  if (loginBtn) loginBtn.addEventListener('click', function (e) {
    e.preventDefault();
    doLogin();
  });
})();
