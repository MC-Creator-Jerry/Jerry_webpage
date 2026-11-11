/* ============================================================
 *  _shared/voucher-ui/voucher.js  —— 全站统一「调度券」前端组件
 *
 *  形态（默认收起，点了才展开）：
 *      ┌──────────────────────┐
 *      │ 🎫 调度券 × 12   [签到] │   ← 自己：余额 + 每日签到
 *      └──────────────────────┘
 *      ┌──────────────────────┐
 *      │ 🎫 打赏楼主        [打赏] │   ← 别人（通用）：打赏按钮
 *      └──────────────────────┘
 *      ┌──────────────────────┐
 *      │ 🎫 调度券 0/2（可点）  │   ← 站点模式：点一下弹「选张数+确认」弹窗
 *      └──────────────────────┘
 *
 *  用法：
 *    VoucherUI.enhance(root, { endpoint, me });   // 扫描 [data-voucher-login]
 *    VoucherUI.mount(el, { login, endpoint, me });// 单个挂载
 *    VoucherUI.openTip({ login, site, cap, endpoint, me }); // 直接弹打赏弹窗（站点模式）
 *
 *  HTML 约定：
 *    <span data-voucher-login="jerry"></span>                 别人：打赏
 *    <span data-voucher-login="jerry" data-voucher-self></span> 自己：余额+签到
 *    <span data-voucher-login="jerry" data-voucher-site="pianyu" data-voucher-cap="2"></span> 站点模式
 *
 *  后端契约（/api/voucher，见 _shared/voucher-core/voucher.js）：
 *    GET  -> { ok, me, balance, signinClaimed }
 *    POST { action:'signin' }                -> { ok, balance }
 *    POST { action:'tip', to, amount, memo, postId } -> { ok, balance }  // postId 用于「流量」每帖计数
 *    POST { action:'history' }               -> { ok, ledger[] }
 * ============================================================ */
(function () {
  'use strict';

  var STYLE_ID = 'vui-style';
  var ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
    '<rect x="2" y="5" width="20" height="14" rx="3" fill="currentColor"/>' +
    '<rect x="2" y="5" width="20" height="3" rx="1.5" fill="#fff" opacity=".55"/>' +
    '<circle cx="12" cy="13" r="2.6" fill="#fff" opacity=".9"/></svg>';

  function isEn() {
    var l = (document.documentElement.getAttribute('lang') || '').toLowerCase();
    return l.indexOf('en') === 0;
  }
  var LABELS = {
    zh: { coin: '调度券', signin: '签到', signed: '已签到', tip: '打赏', self: '自己', toLogin: '请先登录', fail: '操作失败', done: '完成', need: '张数不够', full: '额度已满',
          tipTitle: '调度券打赏', confirm: '确认打赏', cancel: '取消', left: '剩余', to: '给', amount: '张数', close: '关闭' },
    en: { coin: 'Voucher', signin: 'Check in', signed: 'Checked in', tip: 'Tip', self: 'You', toLogin: 'Please sign in', fail: 'Failed', done: 'Done', need: 'Not enough', full: 'Quota full',
          tipTitle: 'Tip with vouchers', confirm: 'Send tip', cancel: 'Cancel', left: 'Left', to: 'To', amount: 'Count', close: 'Close' },
  };
  function L() { return isEn() ? LABELS.en : LABELS.zh; }

  function escAttr(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    var css = '' +
      '.vui-wrap{display:inline-flex;align-items:center;gap:6px;font-size:.82rem;line-height:1;vertical-align:middle;}' +
      '.vui-bal{display:inline-flex;align-items:center;gap:5px;font-weight:800;padding:5px 10px;border-radius:999px;' +
      'background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent);}' +
      '.vui-bal svg{display:block}' +
      '.vui-bal.vui-bal-clickable{cursor:pointer;transition:filter .15s,background .15s;}' +
      '.vui-bal.vui-bal-clickable:hover{filter:brightness(.95)}' +
      '.vui-bal.vui-disabled{opacity:.5;cursor:default;filter:none}' +
      '.vui-btn{border:1px solid color-mix(in srgb,var(--accent) 45%,var(--card-border));background:transparent;' +
      'color:var(--accent);font-weight:700;font-size:.78rem;padding:5px 10px;border-radius:999px;cursor:pointer;' +
      'transition:background .15s,color .15s;white-space:nowrap;}' +
      '.vui-btn:hover{background:var(--accent);color:#fff}' +
      '.vui-btn[disabled]{opacity:.5;cursor:default}' +
      '.vui-btn[disabled]:hover{background:transparent;color:var(--accent)}' +
      '.vui-btn.primary{background:var(--accent);color:#fff;border-color:transparent}' +
      '.vui-btn.primary:hover{filter:brightness(1.08)}' +
      '.vui-btn.done{background:transparent;color:var(--accent);border-style:dashed}' +
      '.vui-amount{width:52px;border:1px solid var(--card-border);background:var(--panel-bg,#fff);color:var(--text);' +
      'border-radius:8px;padding:4px 6px;font-size:.8rem;text-align:center}' +
      '.vui-toast{position:fixed;left:50%;top:22px;transform:translateX(-50%);z-index:9999;background:#1c2733;' +
      'color:#fff;padding:9px 16px;border-radius:10px;font-size:.86rem;box-shadow:0 6px 20px rgba(0,0,0,.3);' +
      'opacity:0;transition:opacity .25s;pointer-events:none}' +
      '.vui-toast.show{opacity:1}' +
      // 弹窗（B站投币式：选张数 + 确认）
      '.vui-modal-mask{position:fixed;inset:0;z-index:9000;background:rgba(15,23,33,.45);' +
      'display:flex;align-items:center;justify-content:center;padding:16px;}' +
      '.vui-modal{background:var(--panel-bg,#fff);color:var(--text);min-width:260px;max-width:92vw;' +
      'border-radius:16px;padding:16px 18px;box-shadow:0 20px 60px rgba(0,0,0,.35);}' +
      '.vui-modal-head{display:flex;align-items:center;justify-content:space-between;gap:12px;}' +
      '.vui-modal-title{font-size:1rem;font-weight:800;}' +
      '.vui-modal-close{border:none;background:transparent;font-size:1.35rem;line-height:1;color:var(--muted);' +
      'cursor:pointer;padding:2px 8px;border-radius:8px;}' +
      '.vui-modal-close:hover{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--text);}' +
      '.vui-modal-sub{font-size:.8rem;color:var(--muted);margin-top:4px;}' +
      '.vui-modal-row{margin-top:12px;font-size:.82rem;color:var(--muted);}' +
      '.vui-stepper{display:flex;align-items:center;justify-content:center;gap:12px;margin:12px 0 2px;}' +
      '.vui-step{width:38px;height:38px;border-radius:10px;border:1px solid var(--card-border);' +
      'background:var(--panel-bg,#fff);color:var(--text);font-size:1.3rem;font-weight:700;cursor:pointer;}' +
      '.vui-step:hover{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent);}' +
      '.vui-step-n{width:66px;height:38px;border:1px solid var(--card-border);border-radius:10px;text-align:center;' +
      'font-size:1rem;color:var(--text);background:var(--panel-bg,#fff);}' +
      '.vui-modal-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px;}';
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'vui-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 1800);
  }

  function post(endpoint, body) {
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json(); }).catch(function () { return null; });
  }

  function get(endpoint) {
    return fetch(endpoint, { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });   // 网络失败不当异常抛出，交给调用方降级
  }

  function balEl(n) {
    var s = document.createElement('span');
    s.className = 'vui-bal';
    s.innerHTML = ICON + '<span class="vui-n"></span>';
    s.querySelector('.vui-n').textContent = L().coin + ' × ' + n;
    return s;
  }

  // 自己：余额 + 签到
  function mountSelf(el, o) {
    injectCSS();
    el.classList.add('vui-wrap');
    el.textContent = '';
    var b = balEl('…');
    var btn = document.createElement('button');
    btn.className = 'vui-btn primary';
    btn.type = 'button';
    btn.textContent = L().signin;
    el.appendChild(b);
    el.appendChild(btn);
    get(o.endpoint).then(function (d) {
      if (!d || d.ok !== true) {
        // 取不到（网络错/未登录/后端未配 KV）：余额显示 —，按钮保留可重试
        b.querySelector('.vui-n').textContent = L().coin + ' × —';
        btn.addEventListener('click', function () { toast(L().fail); });
        return;
      }
      if (!d.me) { btn.textContent = L().toLogin; btn.disabled = true; return; }
      b.querySelector('.vui-n').textContent = L().coin + ' × ' + d.balance;
      if (d.signinClaimed) { btn.textContent = L().signed; btn.disabled = true; btn.classList.add('done'); btn.classList.remove('primary'); }
      btn.addEventListener('click', function () {
        btn.disabled = true;
        post(o.endpoint, { action: 'signin' }).then(function (r) {
          if (r && r.ok) {
            b.querySelector('.vui-n').textContent = L().coin + ' × ' + r.balance;
            btn.textContent = L().signed;
            btn.classList.add('done'); btn.classList.remove('primary');
            toast(L().done + ' +' + r.amount);
          } else {
            btn.disabled = false;
            toast(r && r.error === 'already_claimed' ? L().signed : L().fail);
            if (r && r.balance != null) b.querySelector('.vui-n').textContent = L().coin + ' × ' + r.balance;
          }
        });
      });
    });
  }

  // 别人：打赏（默认收起，点「打赏」才展开输入）
  function mountOther(el, o) {
    injectCSS();
    el.classList.add('vui-wrap');
    el.textContent = '';
    var btn = document.createElement('button');
    btn.className = 'vui-btn';
    btn.type = 'button';
    btn.textContent = L().tip;
    el.appendChild(btn);
    if (o.me === o.login) { btn.disabled = true; btn.textContent = L().self; return; }
    btn.addEventListener('click', function () {
      if (btn.dataset.open === '1') { doTip(); return; }
      btn.dataset.open = '1';
      var input = document.createElement('input');
      input.className = 'vui-amount';
      input.type = 'number';
      input.min = '1';
      input.max = '10';
      input.step = '1';
      input.value = '1';
      input.setAttribute('aria-label', L().coin);
      var go = document.createElement('button');
      go.className = 'vui-btn primary';
      go.type = 'button';
      go.textContent = L().tip;
      el.appendChild(input);
      el.appendChild(go);
      input.focus();
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doTip(); });
      go.addEventListener('click', doTip);
      function doTip() {
        var n = parseInt(input.value, 10);
        if (!Number.isInteger(n) || n < 1) { toast(L().fail); return; }
        go.disabled = true;
        post(o.endpoint, { action: 'tip', to: o.login, amount: n }).then(function (r) {
          if (r && r.ok) { toast(L().done + ' −' + n); el.textContent = ''; el.appendChild(btn); btn.dataset.open = '0'; btn.textContent = L().tip; }
          else {
            go.disabled = false;
            toast(r && r.error === 'insufficient' ? L().need : L().fail);
          }
        });
      }
    });
  }

  // 站点打赏弹窗（B站投币式）：取最新额度 → 弹「选张数 + 确认」modal。
  // opts: { login, site, cap, endpoint, me }；onDone(newUsed) 在成功后回调解挂载点。
  function openTipModal(o, onDone) {
    injectCSS();
    var site = o.site || null;
    get(o.endpoint + (site ? '?site=' + encodeURIComponent(site) : '')).then(function (d) {
      if (!d || d.ok !== true) { toast(L().fail); return; }
      if (!d.me) { toast(L().toLogin); return; }
      if (d.me === o.login) { toast(L().self); return; }
      var cap = Number.isInteger(o.cap) && o.cap > 0 ? o.cap : 0;
      var used = Number.isInteger(d.siteUsed) ? Math.min(d.siteUsed, cap) : 0;
      var remaining = cap - used;
      if (remaining <= 0) { toast(L().full); return; }
      var max = Math.min(remaining, 10);

      var mask = document.createElement('div');
      mask.className = 'vui-modal-mask';
      var modal = document.createElement('div');
      modal.className = 'vui-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.innerHTML =
        '<div class="vui-modal-head">' +
          '<div class="vui-modal-title">' + escAttr(L().tipTitle) + '</div>' +
          '<button class="vui-modal-close" type="button" aria-label="' + escAttr(L().close) + '">×</button>' +
        '</div>' +
        '<div class="vui-modal-sub"></div>' +
        '<div class="vui-modal-row"><span class="vui-modal-left">' + escAttr(L().left) + ' ' + remaining + ' / ' + cap + '</span></div>' +
        '<div class="vui-stepper">' +
          '<button class="vui-step" type="button" data-step="-1" aria-label="−">−</button>' +
          '<input class="vui-step-n" type="number" min="1" max="' + max + '" value="1" aria-label="' + escAttr(L().amount) + '">' +
          '<button class="vui-step" type="button" data-step="1" aria-label="+">+</button>' +
        '</div>' +
        '<div class="vui-modal-actions">' +
          '<button class="vui-btn" type="button" data-act="cancel">' + escAttr(L().cancel) + '</button>' +
          '<button class="vui-btn primary" type="button" data-act="ok">' + escAttr(L().confirm) + '</button>' +
        '</div>';
      if (o.login) modal.querySelector('.vui-modal-sub').textContent = L().to + ' @' + o.login;
      else modal.querySelector('.vui-modal-sub').remove();
      mask.appendChild(modal);
      document.body.appendChild(mask);

      var input = modal.querySelector('.vui-step-n');
      function clamp() {
        var n = parseInt(input.value, 10);
        if (!Number.isInteger(n) || n < 1) n = 1;
        if (n > max) n = max;
        input.value = String(n);
        return n;
      }
      modal.querySelectorAll('.vui-step').forEach(function (b) {
        b.addEventListener('click', function () {
          var cur = clamp() + parseInt(b.getAttribute('data-step'), 10);
          if (cur < 1) cur = 1;
          if (cur > max) cur = max;
          input.value = String(cur);
        });
      });
      input.addEventListener('input', clamp);

      function close() {
        if (mask.parentNode) mask.parentNode.removeChild(mask);
        document.removeEventListener('keydown', onKey, true);
      }
      function onKey(e) {
        if (e.key === 'Escape') close();
        else if (e.key === 'Enter') doSend();
      }
      document.addEventListener('keydown', onKey, true);
      mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
      modal.querySelector('.vui-modal-close').addEventListener('click', close);
      modal.querySelector('[data-act="cancel"]').addEventListener('click', close);

      var okBtn = modal.querySelector('[data-act="ok"]');
      function doSend() {
        var n = clamp();
        okBtn.disabled = true;
        post(o.endpoint, { action: 'tip', to: o.login, amount: n, postId: o.postId }).then(function (r) {
          if (r && r.ok) {
            var nu = Number.isInteger(r.siteUsed) ? Math.min(r.siteUsed, cap) : Math.min(used + n, cap);
            close();
            toast(L().done + ' −' + n);
            if (onDone) onDone(nu);
          } else {
            okBtn.disabled = false;
            var err = r && r.error;
            if (err === 'site_cap') { close(); toast(L().full); if (onDone) onDone(cap); }
            else if (err === 'insufficient') toast(L().need);
            else toast(L().fail);
          }
        });
      }
      okBtn.addEventListener('click', doSend);
    });
  }

  // 站点打赏（data-voucher-site + data-voucher-cap，打给 data-voucher-login 楼主）：
  // 显示「调度券 已用X/Y」，点一下弹 B站投币式弹窗（选张数 + 确认）；每人在本站累计打赏不超过 Y 张。
  function mountSite(el, o) {
    injectCSS();
    el.classList.add('vui-wrap');
    el.textContent = '';
    var capRaw = parseInt((o && o.cap) || el.getAttribute('data-voucher-cap'), 10);
    var cap = Number.isInteger(capRaw) && capRaw > 0 ? capRaw : 0;
    var site = el.getAttribute('data-voucher-site');
    var usedEl = document.createElement('span');
    usedEl.className = 'vui-bal vui-bal-clickable';
    usedEl.innerHTML = ICON + '<span class="vui-n"></span>';
    usedEl.setAttribute('role', 'button');
    usedEl.setAttribute('tabindex', '0');
    el.appendChild(usedEl);
    usedEl.querySelector('.vui-n').textContent = L().coin + ' …/' + cap;

    var st = { used: 0, cap: cap, remaining: cap, login: o.login, site: site, endpoint: o.endpoint, me: null, ready: false };

    function paint() {
      if (!st.ready) { usedEl.querySelector('.vui-n').textContent = L().coin + ' …/' + cap; return; }
      usedEl.querySelector('.vui-n').textContent = L().coin + ' ' + st.used + '/' + st.cap;
      if (st.me === st.login) { usedEl.classList.add('vui-disabled'); usedEl.title = L().self; }
      else if (!st.me) { usedEl.classList.add('vui-disabled'); usedEl.title = L().toLogin; }
      else if (st.remaining <= 0) { usedEl.classList.add('vui-disabled'); usedEl.title = L().full; }
      else { usedEl.classList.remove('vui-disabled'); usedEl.title = ''; }
    }

    get(o.endpoint + (site ? '?site=' + encodeURIComponent(site) : '')).then(function (d) {
      if (!d || d.ok !== true) {
        st.ready = true; st.me = null;
        usedEl.querySelector('.vui-n').textContent = L().coin + ' —/' + cap;
        usedEl.classList.add('vui-disabled'); usedEl.title = L().fail;
        return;
      }
      st.ready = true; st.me = d.me || null;
      st.used = Number.isInteger(d.siteUsed) ? Math.min(d.siteUsed, cap) : 0;
      st.remaining = cap - st.used;
      paint();
    });

    function open() {
      if (usedEl.classList.contains('vui-disabled')) {
        if (!st.me) toast(L().toLogin);
        else if (st.me === st.login) toast(L().self);
        else if (st.remaining <= 0) toast(L().full);
        return;
      }
      // 打赏关联到具体内容（book/video/post id），用于「流量」派生；
      // 点击时才读 data-voucher-post，规避 auto-mount 早于页面注入 id 的时机问题。
      var postId = el.getAttribute('data-voucher-post') || null;
      openTipModal({
        login: st.login, site: st.site, cap: st.cap, endpoint: st.endpoint, me: st.me, postId: postId
      }, function (newUsed) {
        st.used = newUsed; st.remaining = st.cap - newUsed; paint();
        try {
          document.dispatchEvent(new CustomEvent('voucher:tip', {
            detail: { site: st.site, postId: postId, login: st.login }
          }));
        } catch (e) {}
      });
    }
    usedEl.addEventListener('click', open);
    usedEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  }

  function mount(el, o) {
    if (!el || !o || !o.login) return;
    if (o.site) { mountSite(el, o); return; }
    if (o.me && o.me === o.login) mountSelf(el, o);
    else mountOther(el, o);
  }

  function enhance(root, o) {
    var scope = root || document;
    var endpoint = (o && o.endpoint) || '/api/voucher';
    var nodes = scope.querySelectorAll('[data-voucher-login]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      // 已用同一个 endpoint 挂载过就跳过；没配 endpoint 时的空跑不算挂载，
      // 否则后面 enhance() 再挂会被这个标记挡住（踩过的坑）。
      if (el.__vuiEndpoint === endpoint) continue;
      el.__vui = true;
      el.__vuiEndpoint = endpoint;
      mount(el, {
        login: el.getAttribute('data-voucher-login'),
        self: el.hasAttribute('data-voucher-self'),
        site: el.hasAttribute('data-voucher-site') ? el.getAttribute('data-voucher-site') : null,
        cap: el.getAttribute('data-voucher-cap'),
        endpoint: endpoint,
        me: o && o.me,
      });
    }
  }

  window.VoucherUI = { enhance: enhance, mount: mount, toast: toast, openTip: openTipModal };
  // 自动挂载：只在页面提前注入了 __VOUCHER_UI_OPTS__（带 endpoint）时才做，
  // 避免「空跑一遍把所有元素标记成已挂载、后面再挂不上」。
  var AUTO = window.__VOUCHER_UI_OPTS__;
  if (AUTO && AUTO.endpoint) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { enhance(document, AUTO); });
    } else {
      enhance(document, AUTO);
    }
  }
})();
