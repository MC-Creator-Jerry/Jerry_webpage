// editbar.js — 页面内容覆盖（站主「更改当前页面布局」）
//  - 所有访客加载时：拉取并应用当前页保存的文字/图片修改
//  - 站主点击浮动「更改当前页面布局」按钮 -> window.XLEdit.open() 进入编辑模式
//      · 点击文字元素 -> 就地编辑（contenteditable）
//      · 点击图片 -> 弹出输入新地址换图
//      · 保存 -> POST /api/page-edit；退出 -> 还原到已保存状态
(function () {
  'use strict';
  var OWNER = 'MC-Creator-Jerry';
  // 可编辑的文字元素（排除导航/浮动条/脚本等系统区域）
  var TEXT_SEL = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,td,th,label,figcaption,span,a,.editable';
  var EXCLUDE = '.topbar,.bar-right,nav,.float-actions,.fab,.modal-overlay,.modal,.settings-overlay,.settings-panel,.pop-menu,.user-popup,script,style,button,form,header.breadcrumb-bar';

  function curPath() { return location.pathname || '/'; }

  // 生成确定性 CSS 选择器（DOM 结构不变时稳定）
  function cssPath(el) {
    if (el.id) return '#' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id);
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node.tagName !== 'BODY' && node.tagName !== 'HTML') {
      var parent = node.parentNode;
      if (!parent) break;
      var tag = node.tagName.toLowerCase();
      var sibs = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
      var idx = Array.prototype.indexOf.call(sibs, node) + 1;
      parts.unshift(tag + ':nth-of-type(' + idx + ')');
      node = parent;
    }
    return 'body > ' + parts.join(' > ');
  }

  function inExcluded(el) { return !!(el.closest && el.closest(EXCLUDE)); }

  // ---------- 应用已保存覆盖（所有访客） ----------
  function applySaved() {
    fetch('/api/page-edit?path=' + encodeURIComponent(curPath()))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var edits = (d && d.edits) || {};
        Object.keys(edits).forEach(function (sel) {
          var e = edits[sel];
          if (!e) return;
          var node = document.querySelector(sel);
          if (!node) return;
          try {
            if (e.type === 'img') { if (node.tagName === 'IMG') node.src = e.value; }
            else { node.textContent = e.value; }
          } catch (_) {}
        });
      })
      .catch(function () {});
  }

  // ---------- 编辑模式（站主） ----------
  var edits = {};       // cssPath -> {type,value}
  var active = false;

  function onTextClick(e) {
    e.preventDefault();
    e.stopPropagation();
    var el = e.currentTarget;
    if (el.getAttribute('contenteditable') === 'true') return;
    el.setAttribute('contenteditable', 'true');
    el.focus();
    function done() {
      el.removeEventListener('blur', done);
      el.removeAttribute('contenteditable');
      edits[cssPath(el)] = { type: 'text', value: el.textContent };
    }
    el.addEventListener('blur', done);
  }

  function onImgClick(e) {
    e.preventDefault();
    e.stopPropagation();
    var img = e.currentTarget;
    var cur = img.getAttribute('src') || '';
    var url = window.prompt('输入新的图片地址（http/https 或以 / 开头的站内路径）：', cur);
    if (url === null) return;
    url = url.trim();
    if (!/^https?:\/\//i.test(url) && !/^\//.test(url) && !/^data:image\//i.test(url)) {
      window.alert('地址不合法：仅支持 http/https 或 / 开头的站内路径。');
      return;
    }
    img.src = url;
    edits[cssPath(img)] = { type: 'img', value: url };
  }

  function showBanner() {
    var b = document.createElement('div');
    b.className = 'xl-edit-banner';
    var tip = document.createElement('span');
    tip.className = 'xl-edit-tip';
    tip.textContent = '布局编辑模式：点击文字直接修改，点击图片可换图';
    var save = document.createElement('button');
    save.type = 'button'; save.className = 'xl-edit-save'; save.textContent = '保存';
    var exit = document.createElement('button');
    exit.type = 'button'; exit.className = 'xl-edit-exit'; exit.textContent = '退出';
    b.appendChild(tip); b.appendChild(save); b.appendChild(exit);
    document.body.appendChild(b);
    save.addEventListener('click', saveEdits);
    exit.addEventListener('click', function () { exitEdit(false); });
  }

  function open() {
    if (active) return;
    active = true;
    document.body.classList.add('xl-editmode');
    showBanner();
    document.querySelectorAll(TEXT_SEL).forEach(function (el) {
      if (inExcluded(el)) return;
      el.setAttribute('data-xl-edit', '');
      el.addEventListener('click', onTextClick);
    });
    document.querySelectorAll('img').forEach(function (img) {
      if (inExcluded(img)) return;
      img.setAttribute('data-xl-edit-img', '');
      img.addEventListener('click', onImgClick);
    });
    toast('已进入布局编辑模式');
  }

  function saveEdits() {
    fetch('/api/page-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: curPath(), edits: edits })
    }).then(function (r) {
      if (!r.ok) { window.alert('保存失败（需要以站主账号登录）。'); return; }
      toast('已保存布局修改');
      exitEdit(true);
    }).catch(function () { window.alert('保存失败，请重试。'); });
  }

  function exitEdit(keep) {
    active = false;
    document.body.classList.remove('xl-editmode');
    var b = document.querySelector('.xl-edit-banner');
    if (b) b.remove();
    document.querySelectorAll('[data-xl-edit]').forEach(function (el) {
      el.removeAttribute('data-xl-edit');
      el.removeEventListener('click', onTextClick);
      el.removeAttribute('contenteditable');
    });
    document.querySelectorAll('[data-xl-edit-img]').forEach(function (el) {
      el.removeAttribute('data-xl-edit-img');
      el.removeEventListener('click', onImgClick);
    });
    if (!keep) applySaved(); // 还原到已保存状态
  }

  var toastTimer;
  function toast(msg) {
    var t = document.querySelector('.xl-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'xl-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  window.XLEdit = { open: open, applySaved: applySaved };

  if (document.readyState !== 'loading') applySaved();
  else document.addEventListener('DOMContentLoaded', applySaved);
})();
