// 小蓝页 · GitHub 登录（OAuth2 + Cloudflare Pages Functions + KV）
// 完全免费组合：Cloudflare Pages/Workers/KV 免费层 + GitHub OAuth App（免费）。
// secret 由 /api/callback 后端持有，浏览器只拿不到 token 的 httpOnly cookie。
// 未配置 CLIENT_ID 时静默降级（隐藏登录入口），不会在 GitHub Pages 上崩溃。
(function () {
  var loginBtn = document.getElementById('loginBtn');
  var logoutBtn = document.getElementById('logoutBtn');
  window.JW_AUTH = { user: null };

  // ← 填入 GitHub OAuth App 的 Client ID；为空则视为未配置（按钮隐藏）
  var CLIENT_ID = 'Ov23ctu9zRxIQ0o0uxiJ';

  var KEYS = { lang: 'xl_lang', theme: 'xl_theme', font: 'xl_font', radius: 'xl_radius' };
  function get(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function applyUserPrefs(p) {
    if (!p) return;
    if (p.lang) set(KEYS.lang, p.lang);
    if (p.theme) set(KEYS.theme, p.theme);
    if (p.font != null) set(KEYS.font, String(p.font));
    if (p.radius != null) set(KEYS.radius, String(p.radius));
    if (typeof window.applyAll === 'function') window.applyAll();
  }

  function setLoggedIn(user) {
    window.JW_AUTH.user = user;
    if (loginBtn) loginBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = '';
    fetch('/api/usersettings')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.prefs) applyUserPrefs(d.prefs); })
      .catch(function () {});
  }

  function setLoggedOut() {
    window.JW_AUTH.user = null;
    if (loginBtn) loginBtn.style.display = '';
    if (logoutBtn) logoutBtn.style.display = 'none';
  }

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
    if (logoutBtn) logoutBtn.style.display = 'none';
    return;
  }

  var REDIRECT = window.location.origin + '/api/callback';
  function randState() {
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  // 页面加载即尝试读取登录态（后端 cookie）
  fetch('/api/me')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { if (d && d.login) setLoggedIn(d); else setLoggedOut(); })
    .catch(function () { setLoggedOut(); });

  if (loginBtn) loginBtn.addEventListener('click', function (e) {
    e.preventDefault();
    var state = randState();
    try { sessionStorage.setItem('gh_oauth_state', state); } catch (x) {}
    var url = 'https://github.com/login/oauth/authorize?client_id=' + encodeURIComponent(CLIENT_ID) +
      '&redirect_uri=' + encodeURIComponent(REDIRECT) +
      '&scope=' + encodeURIComponent('read:user user:email') +
      '&state=' + encodeURIComponent(state);
    window.location.href = url;
  });

  if (logoutBtn) logoutBtn.addEventListener('click', function (e) {
    e.preventDefault();
    fetch('/api/logout').then(function () { setLoggedOut(); }).catch(function () { setLoggedOut(); });
  });
})();
