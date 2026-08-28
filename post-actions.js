// 小蓝页 · 帖子的关注 / 屏蔽 / 举报（前端共享模块）
// 用法：<script src="../post-actions.js"></script>
//   window.XLPostActions.getStates([id,...]) -> Promise<{ [id]: {followed,blocked,reported} }>
//   window.XLPostActions.initBar(container, postId, state, opts)
//       opts: { loggedIn:bool, toast:fn(msg,err), onBlock:fn(postId,blocked) }
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

  function mkBtn(label, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'pa-btn ' + cls;
    b.textContent = label;
    return b;
  }

  function initBar(container, postId, state, opts) {
    opts = opts || {};
    state = state || {};
    if (!container) return;
    container.innerHTML = '';
    container.className = (container.className || '').replace(/\bpost-actions\b/g, '').trim() + ' post-actions';

    var followBtn = mkBtn(state.followed ? '已关注' : '关注', 'pa-follow' + (state.followed ? ' on' : ''));
    var blockBtn = mkBtn(state.blocked ? '已屏蔽' : '屏蔽', 'pa-block' + (state.blocked ? ' on' : ''));
    var reportBtn = mkBtn(state.reported ? '已举报' : '举报', 'pa-report' + (state.reported ? ' on' : ''));

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
    var willFollow = !btn.classList.contains('on');
    apiPost({ post: postId, action: willFollow ? 'follow' : 'unfollow' }).then(function (res) {
      if (res && res.ok) {
        btn.classList.toggle('on', !!res.followed);
        btn.textContent = res.followed ? '已关注' : '关注';
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
        btn.textContent = res.blocked ? '已屏蔽' : '屏蔽';
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
        btn.textContent = '已举报';
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
