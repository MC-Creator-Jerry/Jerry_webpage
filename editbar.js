// editbar.js — 页面内容覆盖（站主「更改当前页面布局」）
//  - 所有访客加载时：拉取并应用当前页保存的文字/图片修改 + 内容块
//  - 站主点击浮动「更改当前页面布局」按钮 -> window.XLEdit.open() 进入编辑模式
//      · 点击已有文字元素 -> 就地编辑（contenteditable）
//      · 点击图片 -> 弹出输入新地址换图
//      · Word 式工具栏：新建文本框 / 删除文本框 / 插入图片 / 插入视频 /
//        改变字体 / 字号 / 选取文字颜色
//      · 保存 -> POST /api/page-edit；退出 -> 还原到已保存状态
(function () {
  'use strict';
  var OWNER = 'MC-Creator-Jerry';
  // 可编辑的文字元素（排除导航/浮动条/脚本等系统区域）
  var TEXT_SEL = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,td,th,label,figcaption,span,a,.editable';
  var EXCLUDE = '.topbar,.bar-right,nav,.float-actions,.fab,.modal-overlay,.modal,.settings-overlay,.settings-panel,.pop-menu,.user-popup,script,style,button,form,header.breadcrumb-bar';

  function curPath() { return location.pathname || '/'; }
  function $(s, c) { return (c || document).querySelector(s); }
  function $all(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
  function inExcluded(el) { return !!(el.closest && el.closest(EXCLUDE)); }
  function genId() { return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

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

  // ---------- 内容块容器 ----------
  function blocksContainer() {
    var c = document.getElementById('xl-edit-blocks');
    if (c) return c;
    c = document.createElement('div');
    c.id = 'xl-edit-blocks';
    var host = document.querySelector('main.content') || document.querySelector('main') || document.querySelector('.content') || document.body;
    host.appendChild(c);
    return c;
  }

  // 视频地址 -> 嵌入方式
  function videoEmbed(url) {
    var m;
    if ((m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/))) {
      return { kind: 'iframe', src: 'https://www.youtube.com/embed/' + m[1] };
    }
    if (/^https?:\/\/.+\.(?:mp4|webm|ogg)(?:\?.*)?$/i.test(url) || /^\/.*\.(?:mp4|webm|ogg)$/i.test(url)) {
      return { kind: 'video', src: url };
    }
    return { kind: 'link', src: url };
  }

  function buildBlockEl(b) {
    var wrap = document.createElement('div');
    wrap.className = 'xl-block';
    wrap.dataset.bid = b.id || genId();
    wrap.dataset.type = b.type;
    if (b.type === 'textbox') {
      var inner = document.createElement('div');
      inner.className = 'xl-block-inner';
      inner.setAttribute('contenteditable', 'false');
      inner.setAttribute('data-placeholder', '在此输入文字…');
      inner.innerHTML = b.html || '';
      if (b.style) inner.setAttribute('style', b.style);
      wrap.appendChild(inner);
    } else if (b.type === 'image') {
      var img = document.createElement('img');
      img.src = b.src; img.alt = b.alt || ''; img.loading = 'lazy';
      wrap.appendChild(img);
    } else if (b.type === 'video') {
      wrap.dataset.url = b.url || '';
      var emb = videoEmbed(b.url || '');
      if (emb.kind === 'iframe') {
        var f = document.createElement('iframe');
        f.src = emb.src; f.allowFullscreen = true; f.loading = 'lazy';
        f.setAttribute('frameborder', '0'); f.className = 'xl-video';
        wrap.appendChild(f);
      } else if (emb.kind === 'video') {
        var v = document.createElement('video');
        v.src = emb.src; v.controls = true; v.className = 'xl-video'; v.setAttribute('preload', 'metadata');
        wrap.appendChild(v);
      } else {
        var a = document.createElement('a');
        a.href = b.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = b.url;
        wrap.appendChild(a);
      }
    }
    return wrap;
  }

  // ---------- 应用已保存覆盖（所有访客） ----------
  function applySaved() {
    fetch('/api/page-edit?path=' + encodeURIComponent(curPath()))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        var edits = d.edits || {};
        var blocks = Array.isArray(d.blocks) ? d.blocks : [];
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
        var c = blocksContainer();
        blocks.forEach(function (b) { c.appendChild(buildBlockEl(b)); });
      })
      .catch(function () {});
  }

  // ---------- 编辑模式（站主） ----------
  var edits = {};            // cssPath -> {type,value}（legacy）
  var active = false;
  var activeWrap = null;     // 当前选中的内容块
  var activeInner = null;    // 当前聚焦的文本框
  var savedRange = null;     // 文本框内选区

  function saveSel() {
    var s = window.getSelection();
    if (s && s.rangeCount) {
      var r = s.getRangeAt(0);
      if (r && activeInner && activeInner.contains(r.commonAncestorContainer)) savedRange = r.cloneRange();
    }
  }
  function restoreSel() {
    if (savedRange && activeInner) {
      try {
        activeInner.focus();
        var s = window.getSelection();
        s.removeAllRanges();
        s.addRange(savedRange);
        return;
      } catch (_) {}
    }
    if (activeInner) activeInner.focus();
  }

  function setActive(wrap) {
    activeWrap = wrap;
    $all('#xl-edit-blocks .xl-block').forEach(function (w) { w.classList.toggle('active', w === wrap); });
  }

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

  // ---------- 工具栏动作 ----------
  function makeTextbox() {
    var b = buildBlockEl({ id: genId(), type: 'textbox', html: '' });
    var inner = b.querySelector('.xl-block-inner');
    inner.setAttribute('contenteditable', 'true');
    blocksContainer().appendChild(b);
    setActive(b);
    inner.focus();
  }

  function deleteActive() {
    if (!activeWrap) { window.alert('请先点选要删除的内容块（文本框/图片/视频）。'); return; }
    activeWrap.remove();
    activeWrap = null; activeInner = null;
  }

  function insertImage() {
    var url = window.prompt('输入图片地址（http/https 或以 / 开头的站内路径）：', '');
    if (url === null) return;
    url = url.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url) && !/^\//.test(url) && !/^data:image\//i.test(url)) {
      window.alert('地址不合法：仅支持 http/https 或 / 开头的站内路径。'); return;
    }
    var b = buildBlockEl({ id: genId(), type: 'image', src: url, alt: '' });
    blocksContainer().appendChild(b);
    setActive(b);
  }

  function insertVideo() {
    var url = window.prompt('输入视频地址（YouTube 链接，或 .mp4/.webm/.ogg 直链）：', '');
    if (url === null) return;
    url = url.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url) && !/^\//.test(url)) { window.alert('地址不合法。'); return; }
    var b = buildBlockEl({ id: genId(), type: 'video', url: url });
    blocksContainer().appendChild(b);
    setActive(b);
  }

  function applyFont(val) {
    if (!activeInner) { window.alert('请先点选一个文本框。'); return; }
    activeInner.style.fontFamily = val;
    savedRange = null;
  }

  function applySize(val) {
    if (!activeInner) { window.alert('请先点选一个文本框。'); return; }
    activeInner.style.fontSize = val;
  }

  function applyColor(val) {
    if (!activeInner) { window.alert('请先点选一个文本框。'); return; }
    restoreSel();
    if (savedRange && !savedRange.collapsed) {
      try { document.execCommand('foreColor', false, val); return; } catch (_) {}
    }
    activeInner.style.color = val;
  }

  function showUI() {
    var b = document.createElement('div');
    b.className = 'xl-edit-banner';
    var row = document.createElement('div');
    row.className = 'xl-edit-row';
    var tip = document.createElement('span');
    tip.className = 'xl-edit-tip';
    tip.textContent = '布局编辑模式：点文字直接改，点图片换图；或用下方工具栏新建内容块';
    var save = document.createElement('button');
    save.type = 'button'; save.className = 'xl-edit-save'; save.textContent = '保存';
    var exit = document.createElement('button');
    exit.type = 'button'; exit.className = 'xl-edit-exit'; exit.textContent = '退出';
    row.appendChild(tip); row.appendChild(save); row.appendChild(exit);

    var tb = document.createElement('div');
    tb.className = 'xl-edit-toolbar';

    function keep(e) { e.preventDefault(); }       // 点按钮不抢焦点
    function btn(label, fn) {
      var x = document.createElement('button');
      x.type = 'button'; x.className = 'xl-tb-btn'; x.textContent = label;
      x.addEventListener('mousedown', keep);
      x.addEventListener('click', fn);
      return x;
    }

    tb.appendChild(btn('＋ 新建文本框', makeTextbox));
    tb.appendChild(btn('🗑 删除文本框', deleteActive));
    tb.appendChild(btn('🖼 插入图片', insertImage));
    tb.appendChild(btn('🎬 插入视频', insertVideo));

    tb.appendChild(sep());

    var font = document.createElement('select');
    font.className = 'xl-tb-select';
    [['', '改变字体'], ['sans-serif', '无衬线'], ['serif', '衬线'], ['monospace', '等宽'],
      ['微软雅黑, sans-serif', '微软雅黑'], ['宋体, serif', '宋体'], ['黑体, sans-serif', '黑体'],
      ['楷体, serif', '楷体'], ['Arial', 'Arial'], ['Georgia', 'Georgia'],
      ['Times New Roman', 'Times'], ['Courier New, monospace', 'Courier']]
      .forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; font.appendChild(op); });
    font.addEventListener('change', function () { if (font.value) applyFont(font.value); });
    tb.appendChild(font);

    var size = document.createElement('select');
    size.className = 'xl-tb-select';
    [['', '字号'], ['12px', '12'], ['14px', '14'], ['16px', '16'], ['18px', '18'],
      ['20px', '20'], ['24px', '24'], ['28px', '28'], ['32px', '32'], ['36px', '36'], ['48px', '48']]
      .forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; size.appendChild(op); });
    size.addEventListener('change', function () { if (size.value) applySize(size.value); });
    tb.appendChild(size);

    tb.appendChild(sep());

    var colorWrap = document.createElement('label');
    colorWrap.className = 'xl-tb-color';
    var color = document.createElement('input');
    color.type = 'color'; color.value = '#e60012';
    color.addEventListener('input', function () { applyColor(color.value); });
    color.addEventListener('mousedown', keep);
    var colorTxt = document.createElement('span'); colorTxt.textContent = '文字颜色';
    colorWrap.appendChild(color); colorWrap.appendChild(colorTxt);
    tb.appendChild(colorWrap);

    b.appendChild(row);
    b.appendChild(tb);
    document.body.appendChild(b);

    save.addEventListener('click', saveEdits);
    exit.addEventListener('click', function () { exitEdit(false); });

    function sep() { var s = document.createElement('span'); s.className = 'xl-tb-sep'; return s; }
  }

  function open() {
    if (active) return;
    active = true;
    document.body.classList.add('xl-editmode');
    showUI();
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
    // 已有内容块进入可编辑
    var c = blocksContainer();
    c.querySelectorAll('.xl-block').forEach(function (w) {
      var inner = w.querySelector('.xl-block-inner');
      if (inner) inner.setAttribute('contenteditable', 'true');
    });
    c.addEventListener('focusin', function (e) {
      var inner = e.target.closest && e.target.closest('.xl-block-inner');
      if (inner) { activeInner = inner; setActive(inner.closest('.xl-block')); }
    });
    c.addEventListener('mousedown', function (e) {
      var w = e.target.closest && e.target.closest('.xl-block');
      if (w) setActive(w);
    });
    document.addEventListener('selectionchange', saveSel);
    toast('已进入布局编辑模式');
  }

  function saveEdits() {
    var blocks = [];
    $all('#xl-edit-blocks .xl-block').forEach(function (wrap) {
      var type = wrap.dataset.type;
      var id = wrap.dataset.bid || genId();
      if (type === 'textbox') {
        var inner = wrap.querySelector('.xl-block-inner');
        blocks.push({ id: id, type: 'textbox', html: inner.innerHTML, style: inner.getAttribute('style') || '' });
      } else if (type === 'image') {
        var img = wrap.querySelector('img');
        blocks.push({ id: id, type: 'image', src: img.getAttribute('src'), alt: img.getAttribute('alt') || '' });
      } else if (type === 'video') {
        blocks.push({ id: id, type: 'video', url: wrap.dataset.url || '' });
      }
    });
    fetch('/api/page-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: curPath(), edits: edits, blocks: blocks })
    }).then(function (r) {
      if (!r.ok) { window.alert('保存失败（需要以站主账号登录）。'); return; }
      toast('已保存布局修改');
      exitEdit(true);
    }).catch(function () { window.alert('保存失败，请重试。'); });
  }

  function exitEdit(keep) {
    active = false;
    activeWrap = null; activeInner = null; savedRange = null;
    document.body.classList.remove('xl-editmode');
    document.removeEventListener('selectionchange', saveSel);
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
