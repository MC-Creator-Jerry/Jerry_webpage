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
  window.JW_AUTH = { user: null, isAdmin: false, isReviewer: false, role: '' };

  // 权限分级辅助：permLevel() 返回数字等级（0 普通 / 1 审核 / 2 管理员）；
  // canUse('admin'|'review'|'all') 判断当前登录态是否满足按钮所需权限。
  function xlPermLevel() {
    var a = window.JW_AUTH;
    if (a && a.isAdmin) return 2;
    if (a && a.isReviewer) return 1;
    return 0;
  }
  window.XL = window.XL || {};
  window.XL.permLevel = xlPermLevel;
  window.XL.canUse = function (perm) {
    if (perm === 'admin') return xlPermLevel() >= 2;
    if (perm === 'review') return xlPermLevel() >= 1;
    return true; // 'all' / 未指定
  };

  // —— 登录态客户端缓存：避免每次切页都打 /api/me（省函数调用、更快）——
  var ME_KEY = '__xl_me', ME_TTL = 120000, ME_PROMISE = null;
  function readMeCache() {
    try { var r = sessionStorage.getItem(ME_KEY); if (!r) return null; var o = JSON.parse(r); if (o && o.ts && Date.now() - o.ts < ME_TTL) return o.data; } catch (e) {}
    return null;
  }
  function writeMeCache(d) { try { sessionStorage.setItem(ME_KEY, JSON.stringify({ ts: Date.now(), data: d })); } catch (e) {} }
  function clearMeCache() { try { sessionStorage.removeItem(ME_KEY); } catch (e) {} }
  function applyMe(d) { if (d && d.login) setLoggedIn(d); else setLoggedOut(); }

  // 等级查询（供头像悬浮卡 / 下拉菜单展示 Lv + 进度条）
  function jwLang() { try { return localStorage.getItem('xl_lang') || 'zh'; } catch (e) { return 'zh'; } }
  function jwT(zh, en) { return jwLang() === 'en' ? en : zh; }
  function jwEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function getCookie(name) {
    var h = document.cookie;
    if (!h) return '';
    var parts = h.split(';');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p.indexOf(name + '=') === 0) return decodeURIComponent(p.slice(name.length + 1));
    }
    return '';
  }
  function setCookie(name, value, days) {
    var d = new Date();
    d.setTime(d.getTime() + (days || 30) * 24 * 60 * 60 * 1000);
    document.cookie = name + '=' + encodeURIComponent(value) + '; Path=/; Secure; SameSite=Lax; expires=' + d.toUTCString();
  }
  function updateAuthCookies(user) {
    // 改名自愈：/api/me 返回的 login/id 与 cookie 不一致时，自动刷新客户端 cookie
    if (!user) return;
    var curLogin = getCookie('gh_user');
    if (user.login && user.login !== curLogin) setCookie('gh_user', user.login, 30);
    var curUid = getCookie('gh_uid');
    if (user.id && String(user.id) !== curUid) setCookie('gh_uid', String(user.id), 30);
  }
  function updateHeroTitle(user) {
    var el = document.getElementById('heroTitle');
    if (!el) return;
    var en = jwLang() === 'en';
    if (user && user.login) {
      var name = jwEsc(user.display_name || user.login);
      var tpl = en ? (el.getAttribute('data-en-logged') || 'Welcome back<br>【{name}】') : (el.getAttribute('data-zh-logged') || '欢迎回来<br>【{name}】');
      el.innerHTML = tpl.replace(/\{name\}/g, name);
    } else {
      var def = en ? (el.getAttribute('data-en') || 'Welcome to Jerry\'s webpage') : (el.getAttribute('data-zh') || '欢迎来到 Jerry\'s webpage');
      el.innerHTML = def;
    }
  }
  var __levelCache = {};
  function loadLevel(login, cb) {
    if (!login) { cb(null); return; }
    var c = __levelCache[login];
    if (c && (Date.now() - c.ts) < 60000) { cb(c.data); return; }
    fetch('/api/points?user=' + encodeURIComponent(login))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && typeof d.lv === 'number') { __levelCache[login] = { data: d, ts: Date.now() }; cb(d); }
        else cb(null);
      })
      .catch(function () { cb(null); });
  }
  // 返回等级块的内部内容（外层 .hc-level 由占位 div 提供，避免空数据时显示空盒子）
  // opts.points: 是否在右下角显示「积分榜 ›」入口（仅头像悬浮卡片使用）
  function renderLevelBlock(lv, opts) {
    opts = opts || {};
    var pct = Math.round((lv.lvProgress || 0) * 100);
    var hint = lv.lvCapped
      ? jwT('已达最高等级', 'Max level reached')
      : jwT('还需 ', 'Need ') + (lv.lvDaysLeft || 0) + jwT(' 天升级', ' days to next level');
    var more = opts.points
      ? '<a class="hc-lv-more" href="' + BASE + 'points/">' + jwT('积分榜 ›', 'Points ›') + '</a>'
      : '';
    return '<div class="hc-level-row">' +
        '<span class="hc-lv-name">' + jwT('等级', 'Level') + '</span>' +
        '<span class="hc-lv-val">Lv.' + lv.lv + '</span>' +
      '</div>' +
      '<div class="hc-progress" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100">' +
        '<div class="hc-progress-bar" style="width:' + pct + '%"></div>' +
      '</div>' +
      '<div class="hc-lv-hint-row">' +
        '<span class="hc-lv-hint">' + jwEsc(hint) + '</span>' +
        more +
      '</div>';
  }

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
      /* 头像显示模式：名字槽 + 两种胶囊形态（xl-av-na=名字+头像 · xl-av-an=头像+名字） */
      '.bar-avatar .ba-name{display:none;color:#fff;font-size:.84rem;font-weight:700;line-height:1;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.bar-avatar.xl-av-na,.bar-avatar.xl-av-an{width:auto;height:36px;border-radius:999px;gap:7px}',
      '.bar-avatar.xl-av-na img,.bar-avatar.xl-av-an img{width:28px;height:28px;border-radius:50%;flex:0 0 auto}',
      '.bar-avatar.xl-av-na .ba-name,.bar-avatar.xl-av-an .ba-name{display:block}',
      '.bar-avatar.xl-av-na .ba-name{order:-1}',
      '.bar-avatar.xl-av-na{padding:0 5px 0 12px}',
      '.bar-avatar.xl-av-an{padding:0 12px 0 5px}',
      '.user-popup{position:absolute;top:calc(100% + 8px);right:0;min-width:184px;background:#fff;color:#1c2733;border:1px solid #e3e8ef;border-radius:12px;box-shadow:0 10px 30px rgba(20,35,59,.18);padding:6px;z-index:200}',
      '.user-popup .up-item{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;color:#1c2733;text-decoration:none;font-size:.95rem;font-weight:600}',
      '.user-popup .up-item:hover{background:#f1f5fa}',
      '.user-popup .up-ico{width:18px;height:18px;display:inline-flex;flex:0 0 auto}',
      '[hidden]{display:none!important}',
      /* ===== 悬浮预览卡（B 站风格） ===== */
      '.xl-hovercard{position:fixed;z-index:300;min-width:220px;max-width:360px;background:#fff;color:#1c2733;border:1px solid #e3e8ef;border-radius:14px;box-shadow:0 14px 38px rgba(20,35,59,.24);padding:14px;opacity:0;transform:translateY(-6px) scale(.98);transition:opacity .18s ease,transform .18s ease;pointer-events:none;visibility:hidden}',
      '.xl-hovercard.show{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;visibility:visible}',
      '.xl-hovercard.avatar-card{width:min(500px,calc(100vw - 24px));max-width:none}',
      '.xl-hovercard .hc-avatar{width:64px;height:64px;border-radius:50%;overflow:hidden;margin:0 auto 8px;background:#eef2f7}',
      '.xl-hovercard .hc-avatar img{width:100%;height:100%;object-fit:cover;display:block}',
      '.xl-hovercard .hc-name{text-align:center;font-size:1.02rem;font-weight:700}',
      '.xl-hovercard .hc-login{text-align:center;font-size:.8rem;color:#6b7785;margin-top:2px}',
      '.xl-hovercard .hc-actions{display:flex;gap:10px;margin-top:12px}',
      '.xl-hovercard .hc-btn{flex:1;text-align:center;padding:8px 10px;border-radius:9px;background:#0078d4;color:#fff;text-decoration:none;font-size:.9rem;font-weight:600}',
      '.xl-hovercard .hc-btn.ghost{background:#eef2f7;color:#1c2733}',
      '.xl-hovercard .hc-btn:hover{filter:brightness(1.06)}',
      '.xl-hovercard .hc-actions-sub{margin-top:8px}',
      '.xl-hovercard .hc-actions-sub .hc-btn-sub{flex:none;width:100%;font-size:.82rem;padding:7px 10px}',
      '.xl-hovercard .hc-actions-extras{margin-top:8px;display:flex;flex-direction:column;gap:6px}',
      '.xl-hovercard .hc-actions-extras .hc-btn-sub{flex:none;width:100%;font-size:.82rem;padding:7px 10px;display:flex;align-items:center;justify-content:flex-start;gap:8px}',
      '.xl-hovercard .hc-actions-extras .hc-btn-sub svg{width:16px;height:16px;flex:0 0 auto}',
      '.xl-hovercard .hc-head{display:flex;justify-content:space-between;align-items:center;font-weight:700;margin-bottom:10px}',
      '.xl-hovercard .hc-more{font-weight:600;font-size:.82rem;color:#0078d4;text-decoration:none}',
      '.xl-hovercard .hc-cols{display:flex;gap:10px}',
      '.xl-hovercard .hc-col{flex:1;min-width:0}',
      '.xl-hovercard .hc-ct{font-size:.78rem;color:#6b7785;margin-bottom:4px}',
      '.xl-hovercard .hc-ct b{color:#d13438;font-size:.85rem}',
      '.xl-hovercard .hc-col ul{list-style:none;margin:0;padding:0;font-size:.76rem;line-height:1.4}',
      '.xl-hovercard .hc-col li{padding:3px 0;border-top:1px solid #f0f3f7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.xl-hovercard .hc-empty{color:#9aa6b2}',
      '.xl-hovercard .hc-sp{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;background:#1d9e75;color:#fff;font-size:.68rem;font-weight:700;vertical-align:1px}',
      '.xl-hovercard .hc-loading{font-size:.85rem;color:#6b7785;text-align:center;padding:8px}',
      /* ===== 头像菜单：等级 + 进度条 ===== */
      '.hc-level{margin:10px 0 12px;padding:10px 12px;background:#f5f8fb;border:1px solid #e7edf3;border-radius:10px}',
      '.user-popup .hc-level{margin:6px}',
      '.hc-level[hidden]{display:none!important}',
      '.hc-level-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}',
      '.hc-lv-name{font-size:.82rem;color:#5b6776}',
      '.hc-lv-val{font-size:.92rem;font-weight:800;color:#0078d4}',
      '.hc-progress{height:7px;background:#e1e8f0;border-radius:999px;overflow:hidden}',
      '.hc-progress-bar{height:100%;background:linear-gradient(90deg,#0078d4,#4eb1ff);border-radius:999px;transition:width .3s ease}',
      '.hc-lv-hint{margin-top:5px;font-size:.72rem;color:#8a96a3}',
      '.hc-lv-hint-row{display:flex;justify-content:space-between;align-items:center;margin-top:5px;gap:8px}',
      '.hc-lv-hint-row .hc-lv-hint{margin-top:0}',
      '.hc-lv-more{font-size:.72rem;color:#0078d4;text-decoration:none;font-weight:600;white-space:nowrap}',
      '.hc-lv-more:hover{text-decoration:underline}',
      /* ===== 宽版账户卡（双栏）：左=头像/昵称/按钮/菜单，右=等级卡+调度券卡 ===== */
      '.xl-hovercard.avatar-card .hc-top{display:flex;gap:14px;align-items:flex-start}',
      '.xl-hovercard.avatar-card .hc-top-left{flex:1;min-width:0}',
      '.xl-hovercard.avatar-card .hc-top-right{flex:0 0 200px;min-width:0;display:flex;flex-direction:column;gap:8px}',
      '.xl-hovercard.avatar-card .hc-idrow{display:flex;gap:12px;align-items:center}',
      '.xl-hovercard.avatar-card .hc-avatar{margin:0;flex:0 0 auto}',
      '.xl-hovercard.avatar-card .hc-name{text-align:left}',
      '.xl-hovercard.avatar-card .hc-login{text-align:left}',
      '.xl-hovercard.avatar-card .hc-level{margin:0}',
      /* 调度券显示卡（用户拥有数量）：两行结构，加载/完成两态宽度恒定，不会把右侧栏撑宽 */
      '.hc-voucher{padding:10px 14px;background:#f5f8fb;border:1px solid #e7edf3;border-radius:10px;min-width:0;box-sizing:border-box}',
      '.hc-v-row{display:flex;align-items:center;gap:8px;min-width:0}',
      '.hc-v-ico{display:inline-flex;flex:0 0 auto;align-items:center}',
      '.hc-v-ico img{height:15px;width:auto;display:block}',
      '.hc-v-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.hc-v-name{font-size:.82rem;color:#5b6776;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.hc-v-meta{display:flex;align-items:center;gap:6px;min-width:0}',
      '.hc-v-val{font-size:.92rem;font-weight:800;color:#0078d4;white-space:nowrap;flex:0 0 auto}',
      '.hc-v-done{font-size:.7rem;color:#8a94a3;white-space:nowrap;flex:0 0 auto}',
      '.hc-toast{position:fixed;left:50%;top:22px;transform:translateX(-50%);z-index:99999;background:#1c2733;color:#fff;padding:9px 16px;border-radius:10px;font-size:.86rem;box-shadow:0 6px 20px rgba(0,0,0,.3);opacity:0;transition:opacity .25s;pointer-events:none}',
      '.hc-toast.show{opacity:1}',
      '.hc-cal{margin-top:0;display:block;min-width:0}',
      '.hc-cal-strip{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;min-width:0;transition:transform .45s cubic-bezier(.22,.61,.36,1),opacity .4s ease}',
      '.hc-cal-strip.hc-out{transform:translateX(-55%);opacity:0}',
      '.hc-cal-strip.hc-in{transform:translateX(55%);opacity:0}',
      '.hc-cal-cell{position:relative;display:flex;flex-direction:column;align-items:center;gap:1px;min-width:0;padding:3px 0;border-radius:7px}',
      '.hc-cal-num{font-size:.78rem;font-weight:800;line-height:1.15;color:#3d4753}',
      '.hc-cal-lunar{font-size:.55rem;color:#8a94a3;line-height:1.1}',
      '.hc-cal-fest{font-size:.5rem;color:#d99a1f;line-height:1.1;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}',
      /* 今日：整格铺蓝色圆角方块（方块在文字底下），数字/农历文字反白 */
      '.hc-cal-cell.is-today{background:#29a9e0}',
      '.hc-cal-cell.is-today .hc-cal-num{color:#fff}',
      '.hc-cal-cell.is-today .hc-cal-lunar{color:rgba(255,255,255,.92)}',
      '.hc-cal-cell.is-today .hc-cal-fest{color:#fff}',
      /* 旧的小圆点不再使用 */
      '.hc-cal-dot{display:none}',
      '.hc-cal-strip.hc-in .is-today{animation:hcCalPop .5s .18s both}',
      '@keyframes hcCalPop{0%{transform:scale(0)}70%{transform:scale(1.3)}100%{transform:scale(1)}}',
      '@media (prefers-reduced-motion:reduce){.hc-cal-strip{transition:none!important}.hc-cal-strip.hc-in .is-today .hc-cal-dot{animation:none!important}}',
      /* 个人主页壁纸：头像卡左上（头像+昵称行）铺用户自己的主页背景，白纱保证文字可读 */
      '.hc-idrow.hc-wp{position:relative;border-radius:12px;padding:9px;background-size:cover;background-position:center;background-repeat:no-repeat}',
      '.hc-idrow.hc-wp::after{content:"";position:absolute;inset:0;border-radius:12px;background:linear-gradient(180deg,rgba(255,255,255,.88),rgba(255,255,255,.93));pointer-events:none}',
      '.hc-idrow.hc-wp>*{position:relative;z-index:1}',
      /* 每日登录动画（等级卡上方）：默认已登录；悬浮头像时播放，看完显示 √已登录 */
      '.hc-login-state{margin:0 0 8px;min-height:32px;box-sizing:border-box;display:flex;align-items:center;gap:7px;padding:7px 12px;border-radius:10px;background:#f0f9f1;border:1px solid #d8efd9;font-size:.8rem;font-weight:600;color:#1d7a33}',
      '.hc-login-state.hls-loading{background:#f5f8fb;border-color:#e7edf3;color:#5b6776}',
      '.hls-dot{width:8px;height:8px;border-radius:50%;background:#0078d4;flex:0 0 auto;animation:hls-pulse 1s ease-in-out infinite}',
      '@keyframes hls-pulse{0%,100%{opacity:.35;transform:scale(.8)}50%{opacity:1;transform:scale(1.15)}}',
      '.hls-check{width:15px;height:15px;flex:0 0 auto}',
      '.hls-check circle{stroke-dasharray:36;stroke-dashoffset:36;animation:hls-draw .5s ease forwards}',
      '.hls-check path{stroke-dasharray:20;stroke-dashoffset:20;animation:hls-draw .35s ease .4s forwards}',
      '@keyframes hls-draw{to{stroke-dashoffset:0}}',
      '.hls-pop{animation:hls-pop .45s cubic-bezier(.2,1.4,.4,1)}',
      '@keyframes hls-pop{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}',
      '@media (prefers-reduced-motion: reduce){.hls-dot{animation:none}.hls-check circle,.hls-check path{stroke-dashoffset:0;animation:none}.hls-pop{animation:none}}',
      /* 等级卡未加载完：显示「加载中」占位，不隐藏 */
      '.hc-level.hc-level-loading{display:flex;align-items:center;justify-content:center;min-height:58px;color:#8a94a0;font-size:.82rem;font-weight:600}',
      /* 菜单网格：订阅更新通栏，其余两列；管理员专属区三列 */
      '.hc-menu{margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:10px}',
      '.hc-menu .hc-btn-sub{flex:none;width:100%;font-size:.78rem;padding:8px 10px;display:flex;align-items:center;justify-content:flex-start;gap:6px;min-width:0}',
      '.hc-menu .hc-btn-sub span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.hc-menu .hc-btn-sub svg{width:14px;height:14px;flex:0 0 auto}',
      '.hc-menu .span2{grid-column:1 / -1}',
      '.hc-menu.hc-admin{grid-template-columns:1fr 1fr 1fr}',
      '@media (max-width:560px){.xl-hovercard.avatar-card .hc-top{flex-direction:column;gap:10px}.xl-hovercard.avatar-card .hc-top-right{flex:1 1 auto;width:100%}.hc-menu.hc-admin{grid-template-columns:1fr 1fr}}',
      '.user-popup .up-divider{height:1px;background:#e3e8ef;margin:6px 4px}',
      '.user-popup .up-item.admin-only[hidden]{display:none!important}',
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

  // 图标（供悬浮卡片与下拉菜单共用）
  var helpIco = "<svg viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='10'/><path d='M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3'/><line x1='12' y1='17' x2='12.01' y2='17'/></svg>";
  var flagIco = "<svg viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z'/><line x1='4' y1='22' x2='4' y2='15'/></svg>";
  var trafficIco = "<svg viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M3 3v18h18'/><path d='M7 16l4-4 4 5 5-7'/></svg>";
  var banIco = "<svg viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='9'/><line x1='5.6' y1='5.6' x2='18.4' y2='18.4'/></svg>";
  var fbIco = "<svg viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z'/></svg>";
  var ticketIco = "<svg viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2.5 2.5 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2.5 2.5 0 0 0 0-6z'/><path d='M13 5v14'/></svg>";

  // 全局轻提示（头像卡内签到等操作用；样式随卡片 CSS 一起注入）
  function hcToast(msg) {
    var el = document.createElement('div');
    el.className = 'hc-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () { el.classList.remove('show'); setTimeout(function () { el.remove(); }, 300); }, 1800);
  }
  var subIco = "<svg viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><rect x='2' y='5' width='20' height='14' rx='2'/><path d='m2 7 10 7 10-7'/></svg>";

  // 蓝条「通知」红点：拉取未读总数（系统+消息+评论）并刷新
  var NOTIF_KEY = '__xl_notif', NOTIF_TTL = 30000;
  function applyBadge(d) {
    var badge = document.getElementById('noticeBadge');
    if (!badge) return;
    if (d && d.total > 0) { badge.textContent = d.total > 99 ? '99+' : String(d.total); badge.hidden = false; }
    else badge.hidden = true;
  }
  function updateNoticeBadge() {
    var badge = document.getElementById('noticeBadge');
    if (!badge) return;
    try {
      var r = sessionStorage.getItem(NOTIF_KEY);
      if (r) { var o = JSON.parse(r); if (o && o.ts && Date.now() - o.ts < NOTIF_TTL) { applyBadge(o.data); return; } }
    } catch (e) {}
    fetch('/api/notif')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d) { try { sessionStorage.setItem(NOTIF_KEY, JSON.stringify({ ts: Date.now(), data: d })); } catch (e) {} applyBadge(d); }
        else applyBadge(null);
      })
      .catch(function () { applyBadge(null); });
  }
  window.JW_REFRESH_BADGE = updateNoticeBadge;

  // ← 填入 GitHub OAuth App 的 Client ID；为空则视为未配置（按钮隐藏）
  var CLIENT_ID = 'Ov23ctu9zRxIQ0o0uxiJ';

  var KEYS = { lang: 'xl_lang', theme: 'xl_theme', font: 'xl_font', radius: 'xl_radius', autosave: 'xl_autosave', barmode: 'xl_barmode', avatarmode: 'xl_avatarmode' };
  function get(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function applyUserPrefs(p) {
    if (!p) return;
    // 语言本地优先：云端值只在本地从未设置时做初始值。
    // 根因（2026-09-28）：language.html 切语言只写本地，云端残留旧值会登录后每页
    // 把用户选择压回去 —— 「主页英文、点进产品页变中文」就是它。
    if (p.lang && get(KEYS.lang, null) == null) set(KEYS.lang, p.lang);
    if (p.theme) set(KEYS.theme, p.theme);
    if (p.font != null) set(KEYS.font, String(p.font));
    if (p.radius != null) set(KEYS.radius, String(p.radius));
    if (p.autosave) set(KEYS.autosave, p.autosave);
    if (p.barmode) set(KEYS.barmode, p.barmode);
    if (p.avatarmode) {
      set(KEYS.avatarmode, p.avatarmode);
      // 云端头像模式也要即时生效（名字/头像顺序变化）
      if (typeof window.__xlApplyAvatarMode === 'function') window.__xlApplyAvatarMode();
    }
    if (p.barmode) set(KEYS.barmode, p.barmode);
    if (typeof window.applyAll === 'function') window.applyAll();
    // 云端小蓝条模式也要即时生效（图标注入由 common.js 完成，这里只补 body 类）
    if (typeof window.__xlApplyBarMode === 'function') window.__xlApplyBarMode();
    // 确保顶栏图标始终注入（任何 applyAll 路径后都补一次，杜绝按钮变空白）
    if (typeof window.__xlInjectBarIcons === 'function') window.__xlInjectBarIcons();
  }

  // 移除蓝条上不应出现的「退出」按钮（登出已并入头像下拉菜单 JW_LOGOUT）
  function cleanupBar() {
    if (logoutBtn && logoutBtn.parentNode) logoutBtn.parentNode.removeChild(logoutBtn);
  }
  cleanupBar();

  function initialAvatarSvg(login) {
    var ch = (login || '?').charAt(0).toUpperCase();
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="navav" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#28599c"/><stop offset="1" stop-color="#0078d4"/></linearGradient></defs><rect width="64" height="64" rx="32" fill="url(#navav)"/><text x="32" y="42" font-size="30" font-family="Arial,sans-serif" fill="#fff" text-anchor="middle">' + ch + '</text></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
  window.initialAvatarSvg = initialAvatarSvg;
  function setAvatar(user) {
    var img = document.getElementById('userAvatarImg');
    if (!img) return;
    var login = user && user.login;
    // 头像统一走「自己的 Cloudflare 域名」端点：浏览器不再直连 GitHub 头像服务器，
    // 与网站本体同源可达性一致（网络差时也能出图）。
    var AVATAR_API = 'https://mc-creator-jerry-webpage.pages.dev/api/avatar?login=';
    var src = (user && user.cloud_avatar_url) || (user && user.avatar_url) ||
      (login ? AVATAR_API + encodeURIComponent(login) : '');
    img.onerror = function () { this.onerror = null; this.src = login ? initialAvatarSvg(login) : DEFAULT_AVATAR; };
    img.src = src || DEFAULT_AVATAR;
  }
  function setLoggedIn(user) {
    window.JW_AUTH.user = user;
    window.JW_AUTH.isAdmin = !!(user && user.isAdmin);
    window.JW_AUTH.isReviewer = !!(user && user.isReviewer);
    window.JW_AUTH.role = (user && user.role) || '';
    updateAuthCookies(user);
    if (loginBtn) loginBtn.style.display = 'none';
    var avatarBtn = document.getElementById('userAvatarBtn');
    if (avatarBtn) avatarBtn.style.display = '';
    setAvatar(user);
    // 登录后刷新头像按钮的名字槽（display_name / login）
    if (typeof window.__xlApplyAvatarMode === 'function') window.__xlApplyAvatarMode();
    fetch('/api/usersettings')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.prefs) applyUserPrefs(d.prefs); })
      .catch(function () {});
    updateNoticeBadge();
    updateHeroTitle(user);
    // 同步更新开场加载动画欢迎词（若仍在播放）：登录态确认即回写「欢迎回来\n【用户名】」
    if (window.__xlSetLoginText && user.login) window.__xlSetLoginText(user.login);
    if (typeof window.onAuthState === 'function') window.onAuthState(window.JW_AUTH);
  }

  function setLoggedOut() {
    window.JW_AUTH.user = null;
    window.JW_AUTH.isAdmin = false;
    window.JW_AUTH.isReviewer = false;
    window.JW_AUTH.role = '';
    if (loginBtn) loginBtn.style.display = '';
    var avatarBtn = document.getElementById('userAvatarBtn');
    if (avatarBtn) avatarBtn.style.display = 'none';
    setAvatar(DEFAULT_AVATAR);
    if (typeof window.__xlApplyAvatarMode === 'function') window.__xlApplyAvatarMode();
    updateNoticeBadge();
    updateHeroTitle(null);
    if (typeof window.onAuthState === 'function') window.onAuthState(window.JW_AUTH);
  }

  // 暴露给设置页：登出 / 登录
  window.JW_LOGOUT = function () {
    clearMeCache();
    fetch('/api/logout').then(function () { setLoggedOut(); }).catch(function () { setLoggedOut(); });
  };
  function doLogin() {
    var state = randState();
    clearMeCache();
    try { sessionStorage.setItem('gh_oauth_state', state); } catch (x) {}
    var url = 'https://github.com/login/oauth/authorize?client_id=' + encodeURIComponent(CLIENT_ID) +
      '&redirect_uri=' + encodeURIComponent('https://mc-creator-jerry-webpage.pages.dev/api/callback') +
      '&scope=' + encodeURIComponent('read:user user:email') +
      '&state=' + encodeURIComponent(state);
    window.location.href = url;
  }
  window.JW_LOGIN = openEmailModal; // 改为打开「邮箱登录/注册」弹窗（内含 GitHub 登录入口）

  // —— 邮箱登录/注册弹窗（含 GitHub 登录入口）——
  var EMAIL_MASK, EMAIL_INPUT, EMAIL_CODE, EMAIL_SEND, EMAIL_SUBMIT, EMAIL_MSG, EMAIL_GH;
  function ensureEmailModal() {
    if (EMAIL_MASK) return;
    var ms = document.createElement('style');
    ms.textContent = [
      '.xl-email-mask{position:fixed;inset:0;background:rgba(10,18,30,.55);display:flex;align-items:center;justify-content:center;z-index:3000;padding:20px}',
      '.xl-email-mask[hidden]{display:none}',
      '.xl-email-box{background:var(--card-bg,#fff);color:var(--text,#1c2733);width:100%;max-width:360px;border-radius:16px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.3);position:relative}',
      '.xl-email-box h3{font-size:1.15rem;margin-bottom:6px}',
      '.xl-email-sub{font-size:.86rem;color:var(--muted,#6b7785);margin-bottom:16px;line-height:1.5}',
      '.xl-email-box label{display:block;font-size:.85rem;font-weight:600;margin:12px 0 6px}',
      '.xl-email-box input{width:100%;padding:10px 12px;border:1px solid var(--card-border,#e3e8ef);border-radius:9px;font-size:.95rem;background:var(--input-bg,#fff);color:var(--text,#1c2733);box-sizing:border-box}',
      '.xl-email-box input:focus{outline:none;border-color:var(--accent,#0078d4)}',
      '.xl-email-send{margin-top:10px;width:100%;padding:10px;border:none;border-radius:9px;background:var(--panel-bg,#eef2f7);color:var(--text,#1c2733);font-weight:600;cursor:pointer}',
      '.xl-email-send:disabled{opacity:.6;cursor:not-allowed}',
      '.xl-email-primary{margin-top:14px;width:100%;padding:12px;border:none;border-radius:10px;background:var(--accent,#0078d4);color:#fff;font-weight:700;font-size:.98rem;cursor:pointer}',
      '.xl-email-primary:hover{filter:brightness(1.06)}',
      '.xl-email-primary:disabled{opacity:.6;cursor:not-allowed}',
      '.xl-email-divider{display:flex;align-items:center;gap:10px;margin:16px 0;color:var(--muted,#9aa6b2);font-size:.8rem}',
      '.xl-email-divider:before,.xl-email-divider:after{content:"";flex:1;height:1px;background:var(--card-border,#e3e8ef)}',
      '.xl-email-gh{width:100%;padding:11px;border:1px solid var(--card-border,#e3e8ef);border-radius:10px;background:var(--card-bg,#fff);color:var(--text,#1c2733);font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px}',
      '.xl-email-gh:hover{background:var(--panel-bg,#f1f5fa)}',
      '.xl-email-msg{margin-top:12px;font-size:.85rem;min-height:1.1em;line-height:1.5}',
      '.xl-email-msg.err{color:#d13438}',
      '.xl-email-msg.ok{color:#1d9e75}',
      '.xl-email-close{position:absolute;top:12px;right:14px;border:none;background:transparent;font-size:1.4rem;line-height:1;color:var(--muted,#9aa6b2);cursor:pointer}',
      '.xl-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:rgba(28,39,51,.94);color:#fff;padding:10px 16px;border-radius:10px;font-size:.9rem;z-index:4000;box-shadow:0 8px 24px rgba(0,0,0,.3);opacity:0;transition:opacity .2s ease}',
      '.xl-toast.show{opacity:1}',
      '.xl-toast.err{background:rgba(178,43,47,.96)}'
    ].join('\n');
    document.head.appendChild(ms);

    EMAIL_MASK = document.createElement('div');
    EMAIL_MASK.className = 'xl-email-mask';
    EMAIL_MASK.hidden = true;
    EMAIL_MASK.innerHTML =
      '<div class="xl-email-box" role="dialog" aria-modal="true">' +
      '<button class="xl-email-close" id="xlEmailClose" aria-label="关闭">×</button>' +
      '<h3 id="xlEmailTitle">登录 / 注册</h3>' +
      '<div class="xl-email-sub" id="xlEmailSub">用邮箱验证码登录；新邮箱将自动注册为账户。</div>' +
      '<label for="xlEmailInput">邮箱</label>' +
      '<input type="email" id="xlEmailInput" placeholder="you@example.com" autocomplete="email" />' +
      '<button class="xl-email-send" id="xlEmailSend" type="button">发送验证码</button>' +
      '<label for="xlEmailCode">验证码</label>' +
      '<input type="text" id="xlEmailCode" placeholder="6 位验证码" maxlength="6" inputmode="numeric" autocomplete="one-time-code" />' +
      '<button class="xl-email-primary" id="xlEmailSubmit" type="button">登录 / 注册</button>' +
      '<div class="xl-email-divider"><span>或</span></div>' +
      '<button class="xl-email-gh" id="xlEmailGh" type="button"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17 4.6 18 4.9 18 4.9c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z"/></svg>使用 GitHub 登录</button>' +
      '<div class="xl-email-msg" id="xlEmailMsg"></div>' +
      '</div>';
    document.body.appendChild(EMAIL_MASK);

    EMAIL_INPUT = document.getElementById('xlEmailInput');
    EMAIL_CODE = document.getElementById('xlEmailCode');
    EMAIL_SEND = document.getElementById('xlEmailSend');
    EMAIL_SUBMIT = document.getElementById('xlEmailSubmit');
    EMAIL_MSG = document.getElementById('xlEmailMsg');
    EMAIL_GH = document.getElementById('xlEmailGh');

    EMAIL_MASK.addEventListener('click', function (e) { if (e.target === EMAIL_MASK) closeEmailModal(); });
    document.getElementById('xlEmailClose').addEventListener('click', closeEmailModal);
    EMAIL_SEND.addEventListener('click', onEmailSend);
    EMAIL_SUBMIT.addEventListener('click', onEmailVerify);
    EMAIL_CODE.addEventListener('keydown', function (e) { if (e.key === 'Enter') onEmailVerify(); });
    EMAIL_INPUT.addEventListener('keydown', function (e) { if (e.key === 'Enter') onEmailSend(); });
    EMAIL_GH.addEventListener('click', function () { closeEmailModal(); doLogin(); });
  }
  function openEmailModal() {
    ensureEmailModal();
    EMAIL_MSG.textContent = '';
    EMAIL_MSG.className = 'xl-email-msg';
    EMAIL_MASK.hidden = false;
    try { EMAIL_INPUT.focus(); } catch (e) {}
  }
  function closeEmailModal() { if (EMAIL_MASK) EMAIL_MASK.hidden = true; }
  function setEmailMsg(text, kind) { if (!EMAIL_MSG) return; EMAIL_MSG.textContent = text; EMAIL_MSG.className = 'xl-email-msg' + (kind ? ' ' + kind : ''); }
  function onEmailSend() {
    var email = (EMAIL_INPUT.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setEmailMsg('请输入有效的邮箱地址', 'err'); return; }
    EMAIL_SEND.disabled = true;
    setEmailMsg('发送中…', '');
    fetch('/api/email/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email, intent: 'login' }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        EMAIL_SEND.disabled = false;
        var d = res.d || {};
        if (res.ok && d.ok) { setEmailMsg('验证码已发送到 ' + email + '（10 分钟内有效）', 'ok'); try { EMAIL_CODE.focus(); } catch (e) {} }
        else if (d.error === 'too_frequent') setEmailMsg('发送过于频繁，请 ' + (d.retryAfter || 60) + ' 秒后再试', 'err');
        else if (d.error === 'too_many') setEmailMsg('尝试次数过多，请稍后再试', 'err')
        else if (d.error === 'bad_email') setEmailMsg('邮箱格式不正确', 'err')
        else if (d.error === 'send_failed') setEmailMsg('邮件发送失败，请稍后重试', 'err')
        else setEmailMsg('发送失败，请重试', 'err');
      })
      .catch(function () { EMAIL_SEND.disabled = false; setEmailMsg('网络错误，请重试', 'err'); });
  }
  function onEmailVerify() {
    var email = (EMAIL_INPUT.value || '').trim();
    var code = (EMAIL_CODE.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setEmailMsg('请输入有效的邮箱地址', 'err'); return; }
    if (!/^\d{6}$/.test(code)) { setEmailMsg('请输入 6 位验证码', 'err'); return; }
    EMAIL_SUBMIT.disabled = true;
    setEmailMsg('验证中…', '');
    fetch('/api/email/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email, code: code }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        EMAIL_SUBMIT.disabled = false;
        var d = res.d || {};
        if (res.ok && d.login) {
          setEmailMsg('登录成功，欢迎 ' + (d.display_name || d.login), 'ok');
          closeEmailModal();
          ME_PROMISE = null; clearMeCache(); loadMe();
          xlToast('已登录：' + (d.display_name || d.login));
        } else if (d.error === 'expired') setEmailMsg('验证码已过期，请重新获取', 'err')
        else if (d.error === 'invalid_code') setEmailMsg('验证码不正确', 'err')
        else setEmailMsg('验证失败，请重试', 'err');
      })
      .catch(function () { EMAIL_SUBMIT.disabled = false; setEmailMsg('网络错误，请重试', 'err'); });
  }
  function xlToast(msg, kind) {
    var t = document.createElement('div');
    t.className = 'xl-toast' + (kind ? ' ' + kind : '');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 250); }, 2200);
  }
  window.xlToast = xlToast;

  // 注入头像按钮（蓝条最右侧）。点击与悬浮统一展开同一张完整账户卡（见下方 hoverPreview.buildAvatar）
  (function buildAvatarMenu() {
    var right = document.querySelector('.bar-right');
    if (!right) return;

    var btn = document.createElement('button');
    btn.className = 'bar-avatar';
    btn.id = 'userAvatarBtn';
    btn.setAttribute('aria-label', '账户');
    btn.style.display = 'none'; // 默认隐藏，仅登录后显示（避免未登录时同时出现头像与登录按钮）
    // 名字槽：默认不显示，由 xl_avatarmode（仅头像 / 名字+头像 / 头像+名字）控制
    btn.innerHTML = '<img id="userAvatarImg" src="' + DEFAULT_AVATAR + '" alt=""><span class="ba-name" id="userAvatarName"></span>';
    right.appendChild(btn);

    // 头像显示模式：读取 xl_avatarmode 并应用到蓝条头像按钮
    // avatar=仅头像（默认）· name-avatar=名字在左头像在右 · avatar-name=头像在左名字在右
    function applyAvatarMode() {
      var b = document.getElementById('userAvatarBtn');
      if (!b) return;
      var m = 'avatar';
      try { m = localStorage.getItem('xl_avatarmode') || 'avatar'; } catch (e) {}
      if (m !== 'avatar' && m !== 'name-avatar' && m !== 'avatar-name') m = 'avatar';
      b.classList.remove('xl-av-na', 'xl-av-an');
      if (m === 'name-avatar') b.classList.add('xl-av-na');
      else if (m === 'avatar-name') b.classList.add('xl-av-an');
      var nameEl = document.getElementById('userAvatarName');
      var u = window.JW_AUTH && window.JW_AUTH.user;
      if (nameEl) nameEl.textContent = (u && (u.display_name || u.login)) || '';
    }
    window.__xlApplyAvatarMode = applyAvatarMode;
    applyAvatarMode();

    // 点击 = 展开同一张悬浮卡并「钉住」（鼠标移开也不收），再点一次头像收起
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var h = window.__avatarHover;
      if (!h) return;
      if (h.isPinned()) { h.hide(true); h.unpin(); }
      else h.showNow();
    });
    // 点页面空白处收起（卡片自身 click 已 stopPropagation，不会误伤）
    document.addEventListener('click', function () {
      var h = window.__avatarHover;
      if (h && h.isPinned()) { h.hide(true); h.unpin(); }
    });

    // 让下拉项跟随当前语言
    if (typeof window.applyAll === 'function') window.applyAll();
    // 确保顶栏图标始终注入（登录态确认后补一次，杜绝按钮变空白）
    if (typeof window.__xlInjectBarIcons === 'function') window.__xlInjectBarIcons();
  })();

  // 通知按钮图标交给 common.js 的 injectIcons() 统一处理（与全站顶栏风格一致），
  // 这里不再额外覆盖 innerHTML，避免与注入的 .bar-icon 重复产生「两个铃铛」的 bug。
  // 原 bellifyNotice() 块（2026-09-08 移除）

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
      var showT, hideT, pinned = false;
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
      function reveal() {
        builder(card);
        place();
        card.classList.add('show');
      }
      function show() {
        clearTimeout(hideT);
        showT = setTimeout(reveal, 200);
      }
      // 点击打开：立即显示并钉住（pinned 期间 mouseleave 不收起）
      function showNow() {
        clearTimeout(showT);
        clearTimeout(hideT);
        pinned = true;
        reveal();
      }
      function hide(force) {
        clearTimeout(showT);
        // 注意：mouseleave 等监听器会把事件对象传进来（永远 truthy），
        // 必须严格比对 === true，否则钉住状态会被鼠标移开误杀。
        if (pinned && force !== true) return;
        hideT = setTimeout(function () { card.classList.remove('show'); }, 160);
      }
      function unpin() { pinned = false; }
      function isPinned() { return pinned; }
      trigger.addEventListener('mouseenter', show);
      trigger.addEventListener('mouseleave', hide);
      card.addEventListener('mouseenter', function () { clearTimeout(hideT); });
      card.addEventListener('mouseleave', hide);
      card.addEventListener('click', function (e) { e.stopPropagation(); });
      return { card: card, show: show, hide: hide, showNow: showNow, unpin: unpin, isPinned: isPinned };
    }

    /* 个人主页壁纸：/api/bg 取用户自己的背景（banner 超长背景优先，大背景兜底），铺到头像+昵称行 */
    var __bgCache = {};
    function paintWallpaper(row, url) {
      if (!url) return;
      row.classList.add('hc-wp');
      row.style.backgroundImage = 'url("' + String(url).replace(/"/g, '%22') + '")';
    }
    function applyProfileWallpaper(card, login) {
      if (!login) return;
      var row = card.querySelector('.hc-idrow');
      if (!row) return;
      var c = __bgCache[login];
      if (c && Date.now() - c.ts < 60000) { paintWallpaper(row, c.url); return; }
      fetch('/api/bg?user=' + encodeURIComponent(login))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          var url = (d && (d.banner || d.bg)) || null;
          __bgCache[login] = { url: url, ts: Date.now() };
          if (card.contains(row)) paintWallpaper(row, url);
        })
        .catch(function () {});
    }
    /* 每日登录动画：默认已登录；今天还没看过动画才播放，看完落定「√ 已登录」并按日记录 */
    function loginStateHtml() {
      return '<svg class="hls-check hls-pop" viewBox="0 0 24 24" fill="none" stroke="#1d9e75" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.2"/><path d="M8 12.4l2.6 2.6L16.2 9.4"/></svg><span>' + t('已登录', 'Signed in') + '</span>';
    }
    function playDailyLogin(card) {
      var box = card.querySelector('#hcLoginState');
      if (!box) return;
      var d = new Date();
      var key = 'xl_login_anim:' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      var seen = false;
      try { seen = localStorage.getItem(key) === '1'; } catch (e) {}
      if (seen) {
        box.classList.remove('hls-loading');
        box.innerHTML = loginStateHtml();
        return;
      }
      box.classList.add('hls-loading');
      box.innerHTML = '<span class="hls-dot"></span><span>' + t('登录中…', 'Signing in…') + '</span>';
      setTimeout(function () {
        if (!box.isConnected) return;
        box.classList.remove('hls-loading');
        box.innerHTML = loginStateHtml();
        try { localStorage.setItem(key, '1'); } catch (e) {}
      }, 1000);
    }

    function buildAvatar(card) {
      var u = window.JW_AUTH.user;
      if (u && u.login) {
        var av = u.cloud_avatar_url || u.avatar_url ||
          (u.login ? 'https://mc-creator-jerry-webpage.pages.dev/api/avatar?login=' + encodeURIComponent(u.login) : '') ||
          DEFAULT_AVATAR;
        card.innerHTML =
          '<div class="hc-top">' +
            '<div class="hc-top-left">' +
              '<div class="hc-idrow">' +
                '<div class="hc-avatar"><img id="hcAvatarImg" src="' + av + '" alt=""></div>' +
                '<div class="hc-idtext">' +
                  '<div class="hc-name">' + esc(u.display_name || u.login) + '</div>' +
                  '<div class="hc-login">@' + esc(u.login) + (u.isAdmin ? ' · ' + t('管理员', 'Admin') : '') +
                    (u.sponsor ? '<span class="hc-sp">' + esc(u.sponsor.label || t('赞助者', 'Supporter')) + '</span>' : '') + '</div>' +
                '</div>' +
              '</div>' +
              '<div class="hc-actions">' +
                '<a class="hc-btn" href="' + BASE + 'personal_profile/">' + t('个人主页', 'Profile') + '</a>' +
                '<a class="hc-btn ghost" href="' + BASE + 'settings/homepage.html">' + t('设置', 'Settings') + '</a>' +
              '</div>' +
              '<div class="hc-menu">' +
                '<a class="hc-btn ghost hc-btn-sub span2" href="' + BASE + 'subscribe/">' + subIco + '<span>' + t('订阅更新', 'Subscribe') + '</span></a>' +
                '<a class="hc-btn ghost hc-btn-sub" href="' + BASE + 'helpcenter/">' + helpIco + '<span>' + t('帮助中心', 'Help Center') + '</span></a>' +
                '<a class="hc-btn ghost hc-btn-sub" href="' + BASE + 'redeem/">' + ticketIco + '<span>' + t('兑换赞助码', 'Redeem code') + '</span></a>' +
                (u.isAdmin ? '<a class="hc-btn ghost hc-btn-sub xl-perm-admin" href="' + BASE + 'admin/feedback/">' + fbIco + '<span>' + t('建议管理', 'Feedback') + '</span></a>' : '') +
                (u.isAdmin ? '<a class="hc-btn ghost hc-btn-sub xl-perm-admin" href="' + BASE + 'admin/sponsors/">' + ticketIco + '<span>' + t('赞助管理', 'Sponsors') + '</span></a>' : '') +
              '</div>' +
            '</div>' +
            '<div class="hc-top-right">' +
              '<div class="hc-login-state hls-loading" id="hcLoginState">' + t('登录中…', 'Signing in…') + '</div>' +
              '<div class="hc-level hc-level-loading" id="hcLevel">' + t('加载中…', 'Loading…') + '</div>' +
              '<div class="hc-voucher" id="hcVoucher">' +
                '<div class="hc-v-row">' +
                  '<span class="hc-v-ico"><img src="' + BASE + 'assets/voucher.svg?v=2" alt="" width="38" height="15"></span>' +
                  '<span class="hc-v-main">' +
                    '<span class="hc-v-name">' + t('小蓝页调度券', 'Vouchers') + '</span>' +
                    '<span class="hc-v-meta">' +
                      '<span class="hc-v-val" id="hcVoucherVal">' + t('加载中…', 'Loading…') + '</span>' +
                      '<span class="hc-v-done" id="hcVoucherDone" hidden>' + t('已签到', 'Checked in') + '</span>' +
                    '</span>' +
                  '</span>' +
                '</div>' +
              '</div>' +
              '<div class="hc-cal" id="hcCal" aria-label="' + t('七日日历', '7-day calendar') + '"></div>' +
            '</div>' +
          '</div>' +
          ((u.isReviewer || u.isAdmin) ?
            '<div class="hc-menu hc-admin">' +
              '<a class="hc-btn ghost hc-btn-sub xl-perm-review" href="' + BASE + 'admin/reports/">' + flagIco + '<span>' + t('举报后台', 'Reports') + '</span></a>' +
              '<a class="hc-btn ghost hc-btn-sub xl-perm-review" href="' + BASE + 'admin/ban/">' + banIco + '<span>' + t('小黑屋', 'Ban List') + '</span></a>' +
              (u.isAdmin ? '<a class="hc-btn ghost hc-btn-sub xl-perm-admin" href="' + BASE + 'stats/">' + trafficIco + '<span>' + t('流量', 'Traffic') + '</span></a>' : '') +
            '</div>' : '');
        var himg = card.querySelector('#hcAvatarImg');
        if (himg) himg.onerror = function () { this.onerror = null; this.src = initialAvatarSvg(u.login); };
        // 个人主页壁纸 + 每日登录动画（等级上方）
        applyProfileWallpaper(card, u.login);
        playDailyLogin(card);
        loadLevel(u.login, function (lv) {
          var box = card.querySelector('#hcLevel');
          if (!box || !box.isConnected) return;
          if (lv) { box.classList.remove('hc-level-loading'); box.innerHTML = renderLevelBlock(lv, { points: true }); }
          else box.textContent = '—'; // 加载失败也保留占位盒，只换文案（不隐藏）
        });
        // 调度券数量（每日登录自动 +1，无需手动签到；数据来自五站统一账本 /api/voucher）
        var vVal = card.querySelector('#hcVoucherVal');
        var vDone = card.querySelector('#hcVoucherDone');
        if (vVal) {
          function vSetBalance(n) { vVal.textContent = n + (curLang() === 'en' ? '' : ' 张'); }
          fetch('/api/voucher', { credentials: 'include' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
              if (!card.contains(vVal)) return; // 卡已重建或已关闭
              // 无限账号（站长本人）：显示 ∞，无需签到
              if (d && d.ok && d.infinite === true) {
                vVal.textContent = '∞ ' + (curLang() === 'en' ? '' : '张');
                if (vDone) vDone.hidden = false;
                return;
              }
              if (d && d.ok && typeof d.balance === 'number') {
                vSetBalance(d.balance);
                if (d.signinClaimed && vDone) vDone.hidden = false; // 今日已自动签到
                if (d.justClaimed > 0) {
                  hcToast(t('今日登录奖励，调度券 +' + d.justClaimed, 'Daily login bonus +' + d.justClaimed));
                }
              } else {
                vVal.textContent = '—'; // 账本不可用（未登录/后端异常）
              }
            })
            .catch(function () {
              if (card.contains(vVal)) vVal.textContent = '—';
            });
        }
        // 七日日历条（前3天 + 今天 + 后3天，农历 + 节日标注）
        var calBox = card.querySelector('#hcCal');
        if (calBox) {
          if (window.XL_CALENDAR) { window.XL_CALENDAR.render(calBox); }
          else {
            var calScript = document.createElement('script');
            calScript.src = BASE + 'assets/xl-calendar.js';
            calScript.onload = function () { if (window.XL_CALENDAR) window.XL_CALENDAR.render(calBox); };
            document.head.appendChild(calScript);
          }
        }
      } else {
        card.innerHTML =
          '<div class="hc-avatar"><img src="' + DEFAULT_AVATAR + '" alt=""></div>' +
          '<div class="hc-name">' + t('访客', 'Guest') + '</div>' +
          '<div class="hc-login">@' + t('guest', 'guest') + '</div>' +
          '<div class="hc-actions">' +
            '<a class="hc-btn" href="#" id="hcLogin">' + t('登录', 'Sign in') + '</a>' +
            '<a class="hc-btn ghost" href="' + BASE + 'subscribe/">' + t('订阅更新', 'Updates') + '</a>' +
          '</div>' +
          '<div class="hc-actions hc-actions-extras">' +
            '<a class="hc-btn ghost hc-btn-sub" href="' + BASE + 'helpcenter/">' + helpIco + '<span>' + t('帮助中心', 'Help Center') + '</span></a>' +
          '</div>';
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
        '<div class="hc-head"><span>' + t('消息中心预览', 'Message Center') + '</span>' +
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

    // 其余蓝条按钮的悬浮预览（产品 / 帮助中心 / 登录）
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
        btnText: t('登录 / 注册', 'Sign in / Register'),
        href: '#',
        onClick: function () { if (window.JW_LOGIN) window.JW_LOGIN(); }
      });
    });
    /* ===== 蓝条其余按钮统一补悬浮预览 =====
       auth.js 先于 common.js 执行，而顶栏按钮（消息中心/兑换码/订阅和博客/支持与付款/群组等）
       由 common.js 在 DOMContentLoaded 兜底注入——此前只有静态 HTML 里已有的按钮绑定了预览，
       导致「不是所有按钮都会显示预览界面」。这里在 DCL + 两轮延时兜底扫描，给所有未绑定的
       蓝条按钮补预览卡（消息中心按钮补通知富卡片，其余补信息卡）。 */
    (function wireBarPreviews() {
      var FLAG = 'data-xl-hv';
      function mark(el) { if (el && el.setAttribute) el.setAttribute(FLAG, '1'); }
      function bound(el) { return !!(el && el.getAttribute && el.getAttribute(FLAG) === '1'); }
      function barText(n) { return ((n.getAttribute && n.getAttribute('data-zh')) || n.textContent || '').trim(); }
      function barHref(n) { return (n.getAttribute && n.getAttribute('href')) || ''; }
      function run() {
        var bar = document.querySelector('.bar-right');
        if (!bar) return;
        var nodes = bar.querySelectorAll('.bar-btn, .xl-search, #loginBtn, #logoutBtn');
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          if (bound(n)) continue;
          var href = barHref(n), txt = barText(n);
          var isForm = n.tagName === 'FORM' || /(^|\s)xl-search(\s|$)/.test(n.className || '');
          if (isForm) {
            mark(n);
            makeHover(n, function (c) {
              buildInfo(c, {
                title: t('快搜', 'Quick Search'),
                desc: t('输入关键词，实时匹配站内用户与产品。', 'Type to search users and products instantly.'),
                href: '#',
                btnText: t('去搜索 ›', 'Search ›'),
                onClick: function () { var inp = document.querySelector('.xl-search-input'); if (inp) inp.focus(); }
              });
            });
            continue;
          }
          if (/\/notice\//.test(href) || /消息中心|通知中心|通知/.test(txt)) { mark(n); makeHover(n, buildNotice, 'notice-card'); continue; }
          var d = null;
          if (/\/redeem\//.test(href) || /兑换/.test(txt)) d = { title: t('兑换码', 'Redeem'), desc: t('输入赞助码，兑换会员权益与定制内容。', 'Enter a sponsor code to redeem benefits.') };
          else if (/\/sub-blog\//.test(href) || /订阅和博客/.test(txt)) d = { title: t('订阅和博客', 'Subscribe & Blog'), desc: t('订阅更新动态，浏览站内博客文章。', 'Subscribe to updates and read blog posts.') };
          else if (/\/support\//.test(href) || /支持与付款/.test(txt)) d = { title: t('支持与付款', 'Support & Payment'), desc: t('赞助方式、付款说明与常见问题。', 'Sponsorship, payment info and FAQ.') };
          else if (/\/groups\//.test(href) || /群组/.test(txt)) d = { title: t('群组', 'Groups'), desc: t('加入兴趣群组，与大家讨论。', 'Join interest groups and chat.') };
          else if (/\/products\.html/.test(href) || txt === '产品') d = { title: t('产品', 'Products'), desc: t('浏览我发布的工具与软件。', 'Browse the tools and software I published.') };
          else if (/\/helpcenter\//.test(href) || /帮助中心/.test(txt)) d = { title: t('帮助中心', 'Help Center'), desc: t('常见问题与使用指南。', 'FAQ and usage guides.') };
          if (!d) continue;
          mark(n);
          (function (btn, info) {
            makeHover(btn, function (c) {
              buildInfo(c, { title: info.title, desc: info.desc, btnText: t('前往 ›', 'Open ›'), href: btn.href || '#' });
            });
          })(n, d);
        }
      }
      // 已绑定专属预览的触发器打标，防止本扫描重复绑定
      mark(document.getElementById('userAvatarBtn'));
      mark(document.getElementById('noticeBtn'));
      mark(document.getElementById('loginBtn'));
      var prod0 = document.querySelector('.bar-right a[href*="products.html"]'); if (prod0) mark(prod0);
      var help0 = document.querySelector('.bar-right a[href*="helpcenter/"]'); if (help0) mark(help0);
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
      else run();
      setTimeout(run, 300);  // common.js 的注入在 DCL 执行，晚于本脚本的 DCL 监听，兜底第一轮
      setTimeout(run, 1200); // 再兜底一轮（深页 / 慢注入）
    })();

    window.__prodHover = prodHover;
    window.__helpHover = helpHover; window.__loginHover = loginHover;
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

  // 固定回调到 CF 生产主站；避免 GH 镜像 / preview 子域名因 origin 不同被 GitHub OAuth 拒绝
  var REDIRECT = 'https://mc-creator-jerry-webpage.pages.dev/api/callback';
  function randState() {
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  // 页面加载即尝试读取登录态（后端 cookie）。
  // 优先用客户端缓存（sessionStorage），命中则跳过 /api/me；未命中才请求，
  // 并用 ME_PROMISE 去重，避免与 boot.js 同帧各打一次（旧版会重复请求）。
  function loadMe() {
    var cached = readMeCache();
    if (cached) { applyMe(cached); return; }
    if (ME_PROMISE) { ME_PROMISE.then(applyMe); return; }
    ME_PROMISE = fetch('/api/me')
      .then(function (r) {
        if (r.ok) return r.json().then(function (d) { if (d && d.login) writeMeCache(d); return d; });
        return { __noSession: true, status: r.status }; // 401=无会话；其余为瞬时异常
      })
      .catch(function () { return { __noSession: true, status: 0 }; });
    ME_PROMISE.then(function (d) {
      // 仅在明确无会话(401)或空响应时登出；瞬时异常(网络/5xx)保持默认 UI，不误登出
      if (!d || d.__noSession) { if (d && d.status === 401) setLoggedOut(); return; }
      applyMe(d);
    });
  }
  loadMe();

  if (loginBtn) loginBtn.addEventListener('click', function (e) {
    e.preventDefault();
    openEmailModal();
  });
})();
