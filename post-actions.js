// 小蓝页 · 帖子的关注 / 屏蔽 / 举报（前端共享模块）
// 用法：<script src="../post-actions.js"></script>
//   window.XLPostActions.getStates([id,...]) -> Promise<{ [id]: {followed,blocked,reported} }>
  //   window.XLPostActions.initBar(container, postId, state, opts)
//       opts: { loggedIn:bool, toast:fn(msg,err), onBlock:fn(postId,blocked), onFollow:fn(postId,followed), authorLogin:str }
//   window.XLPostActions.unblockPost(postId, opts) -> Promise<res>
(function () {
  function apiGet(path) {
    return fetch('/api/' + path)
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; });
  }
  function apiPost(payload) {
    return fetch('/api/post-actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.ok ? r.json() : { ok: false }; })
      .catch(function () { return { ok: false }; });
  }

  function getStates(postIds) {
    if (!postIds || !postIds.length) return Promise.resolve({});
    return apiGet('post-actions?posts=' + encodeURIComponent(postIds.join(',')))
      .then(function (d) { return d.states || {}; });
  }

  function mkBtn(label, cls, icon) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'pa-btn ' + cls;
    if (icon) {
      var img = document.createElement('img');
      img.className = 'ico';
      img.src = '../../icons/' + icon;
      img.alt = '';
      b.appendChild(img);
    }
    var span = document.createElement('span');
    span.className = 'pa-label';
    span.textContent = label;
    b.appendChild(span);
    return b;
  }

  function currentLogin() {
    return (window.JW_AUTH && window.JW_AUTH.user && window.JW_AUTH.user.login) || null;
  }

  function setLabel(btn, text) {
    var s = btn.querySelector('.pa-label');
    if (s) s.textContent = text; else btn.textContent = text;
  }
  function setIcon(btn, icon) {
    var im = btn.querySelector('img.ico');
    if (im) im.src = '../../icons/' + icon;
  }

  function initBar(container, postId, state, opts) {
    opts = opts || {};
    state = state || {};
    if (!container) return;
    container.innerHTML = '';
    container.className = (container.className || '').replace(/\bpost-actions\b/g, '').trim() + ' post-actions';

    var followBtn = mkBtn(state.followed ? '已关注' : '关注', 'pa-follow' + (state.followed ? ' on' : ''), state.followed ? 'follow-on.svg' : 'plus.svg');
    var blockBtn = mkBtn(state.blocked ? '已屏蔽' : '屏蔽', 'pa-block' + (state.blocked ? ' on' : ''), 'ban.svg');
    var reportBtn = mkBtn(state.reported ? '已举报' : '举报', 'pa-report' + (state.reported ? ' on' : ''), 'flag.svg');

    // 自己的帖：关注按钮禁用（不能自己关注自己）
    var isSelf = opts.authorLogin && currentLogin() && opts.authorLogin === currentLogin();
    if (isSelf) {
      followBtn.disabled = true;
      followBtn.classList.add('pa-self');
      var lbl = followBtn.querySelector('.pa-label'); if (lbl) lbl.textContent = '自己的帖';
    }

    followBtn.addEventListener('click', function () { doFollow(postId, followBtn, opts); });
    blockBtn.addEventListener('click', function () { doBlock(postId, blockBtn, opts); });
    reportBtn.addEventListener('click', function () { doReport(postId, reportBtn, opts); });

    container.appendChild(followBtn);
    container.appendChild(blockBtn);
    container.appendChild(reportBtn);
  }

  function requireLogin(opts) {
    if (!opts.loggedIn) {
      if (opts.toast) opts.toast('请先登录', true);
      if (window.JW_LOGIN) window.JW_LOGIN();
      return false;
    }
    return true;
  }

  function doFollow(postId, btn, opts) {
    if (!requireLogin(opts)) return;
    var me = currentLogin();
    if (opts.authorLogin && me && opts.authorLogin === me) {
      if (opts.toast) opts.toast('不能关注自己的帖子', true);
      return;
    }
    var willFollow = !btn.classList.contains('on');
    apiPost({ post: postId, action: willFollow ? 'follow' : 'unfollow' }).then(function (res) {
      if (res && res.ok) {
        btn.classList.toggle('on', !!res.followed);
        setLabel(btn, res.followed ? '已关注' : '关注');
        setIcon(btn, res.followed ? 'follow-on.svg' : 'plus.svg');
        if (opts.onFollow) opts.onFollow(postId, !!res.followed);
        if (opts.toast) opts.toast(res.followed ? '已关注 ✓' : '已取消关注');
      } else if (opts.toast) opts.toast('操作失败', true);
    });
  }

  function doBlock(postId, btn, opts) {
    if (!requireLogin(opts)) return;
    var willBlock = !btn.classList.contains('on');
    apiPost({ post: postId, action: willBlock ? 'block' : 'unblock' }).then(function (res) {
      if (res && res.ok) {
        btn.classList.toggle('on', !!res.blocked);
        setLabel(btn, res.blocked ? '已屏蔽' : '屏蔽');
        if (opts.onBlock) opts.onBlock(postId, !!res.blocked);
        if (opts.toast) opts.toast(res.blocked ? '已屏蔽 ✓' : '已取消屏蔽');
      } else if (opts.toast) opts.toast('操作失败', true);
    });
  }

  function doReport(postId, btn, opts) {
    if (!requireLogin(opts)) return;
    if (btn.classList.contains('on')) { if (opts.toast) opts.toast('你已经举报过该帖'); return; }
    var reason = '';
    try { reason = window.prompt('举报理由（可选，最多 200 字）：', '') || ''; } catch (e) { reason = ''; }
    apiPost({ post: postId, action: 'report', reason: reason }).then(function (res) {
      if (res && res.ok) {
        btn.classList.add('on');
        setLabel(btn, '已举报');
        if (opts.toast) opts.toast('举报已提交，感谢反馈');
      } else if (opts.toast) opts.toast('操作失败', true);
    });
  }

  function unblockPost(postId, opts) {
    opts = opts || {};
    return apiPost({ post: postId, action: 'unblock' }).then(function (res) {
      if (res && res.ok && opts.toast) opts.toast('已取消屏蔽');
      return res;
    });
  }

  window.XLPostActions = {
    getStates: getStates,
    initBar: initBar,
    unblockPost: unblockPost
  };
})();
