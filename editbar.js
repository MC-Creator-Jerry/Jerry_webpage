// editbar.js — 页面内容覆盖（站主「更改当前页面布局」）
//  - 所有访客加载时：拉取并应用当前页保存的文字/图片修改 + 内容块
//  - 站主点击浮动「更改当前页面布局」按钮 -> window.XLEdit.open() 进入编辑模式
//      · 点击已有文字元素 -> 就地编辑（contenteditable）
//      · 点击图片 -> 弹出输入新地址换图
//      · 工具栏分组：
//          块   ＋新建 / ⧉复制 / ↑上移 / ↓下移 / 🗑删除
//          媒体 🖼图片 / 🎬视频 / 🔍＋放大 / 🔍－缩小
//          格式 B / I / U / S / 对齐 / 🔗链接 / ⛓解除 / 清格式
//          样式 字体 / 字号 / 文字颜色
//      · 快捷键：Ctrl/Cmd+S 保存 · Esc 退出 · Ctrl/Cmd+B/I/U 粗斜下划线
//                Delete/Backspace 删除选中块（未在输入时）
//      · 有未保存修改时，退出或刷新前会提示；保存按钮显示「未保存」圆点
//  - 保存 -> POST /api/page-edit；退出 -> 还原到已保存状态
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
    // 本站上传的文件（/api/file?key=...）一律按可播放视频处理
    if (/^\/api\/file(\?.*)?$/i.test(url) || /\/api\/file\?/i.test(url)) {
      return { kind: 'video', src: url };
    }
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
    applyZoomTo(wrap, b.zoom);
    return wrap;
  }

  function applyZoomTo(wrap, zoom) {
    var z = parseFloat(zoom || '1') || 1;
    if (z !== 1) {
      wrap.dataset.zoom = z;
      wrap.style.transform = 'scale(' + z + ')';
      wrap.style.transformOrigin = 'top left';
    } else {
      delete wrap.dataset.zoom;
      wrap.style.transform = '';
      wrap.style.transformOrigin = '';
    }
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
  var dirty = false;         // 是否有未保存修改
  var saving = false;        // 是否正在保存
  var banner = null;         // 顶部编辑条
  var saveBtn = null;
  // 调色板面板 DOM 引用（showUI 中填充，applyColor/applyHighlight 与 refreshRecents 访问）
  var fgPanel = null;
  var bgPanel = null;
  // 阻止默认行为的 helper（mousedown 在工具按钮上时不抢走 selection 焦点）
  function keepSel(e) { e.preventDefault(); }

  // ---------- 轻提示 ----------
  var toastTimer;
  function toast(msg, ms) {
    var t = document.querySelector('.xl-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'xl-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2000);
  }

  // ---------- 未保存状态 ----------
  function markDirty() {
    if (dirty) return;
    dirty = true;
    updateSaveBtn();
  }
  function updateSaveBtn() {
    if (!saveBtn) return;
    if (saving) {
      saveBtn.textContent = '保存中…';
      saveBtn.disabled = true;
      saveBtn.classList.remove('is-dirty');
      return;
    }
    saveBtn.disabled = false;
    saveBtn.textContent = '保存';
    saveBtn.classList.toggle('is-dirty', dirty);
    saveBtn.title = dirty ? '有未保存的修改（Ctrl/Cmd+S）' : '已保存（Ctrl/Cmd+S）';
  }

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

  // ---------- 富文本命令 ----------
  // execCommand 虽已废弃，但仍是各浏览器普遍支持的富文本实现方式
  function exec(cmd, val) {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    restoreSel();
    try { document.execCommand(cmd, false, val == null ? null : val); } catch (e) {}
    saveSel();
    markDirty();
    updateToolbarState();
  }

  var STATE_CMDS = {
    bold: 'bold', italic: 'italic', underline: 'underline', strikeThrough: 'strike',
    justifyLeft: 'aleft', justifyCenter: 'acenter', justifyRight: 'aright'
  };
  function updateToolbarState() {
    if (!banner) return;
    Object.keys(STATE_CMDS).forEach(function (cmd) {
      var btn = banner.querySelector('.xl-tb-btn[data-cmd="' + STATE_CMDS[cmd] + '"]');
      if (!btn) return;
      var on = false;
      try { on = document.queryCommandState(cmd); } catch (e) {}
      btn.classList.toggle('on', !!on);
    });
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
      markDirty();
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
    markDirty();
  }

  // ---------- 本地文件上传 ----------
  function isValidMediaUrl(url) {
    return /^https?:\/\//i.test(url) || /^\//.test(url) || /^data:image\//i.test(url) || /^\/api\/file/i.test(url);
  }

  // 把本地文件上传到 /api/upload（需登录），返回可引用 URL /api/file?key=
  function uploadFile(file, kind) {
    return new Promise(function (resolve, reject) {
      var fd = new FormData();
      fd.append('file', file);
      fetch('/api/upload', { method: 'POST', body: fd })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (o) {
          if (!o.ok || !o.d.ok) { reject(new Error(o.d && o.d.error ? o.d.error : 'upload_failed')); return; }
          resolve('/api/file?key=' + encodeURIComponent(o.d.key));
        })
        .catch(function (e) { reject(e); });
    });
  }

  // 插入来源选择弹窗：本地文件 / 用链接
  function pickInsertSource(kind, cb) {
    var overlay = document.createElement('div');
    overlay.className = 'xl-insert-modal';
    var box = document.createElement('div');
    box.className = 'xl-insert-box';
    var title = document.createElement('div');
    title.className = 'xl-insert-title';
    title.textContent = kind === 'image' ? '插入图片' : '插入视频';
    box.appendChild(title);

    var fileIn = document.createElement('input');
    fileIn.type = 'file';
    fileIn.accept = kind === 'image' ? 'image/*' : 'video/*';
    fileIn.style.display = 'none';
    box.appendChild(fileIn);

    var optLocal = document.createElement('button');
    optLocal.type = 'button'; optLocal.className = 'xl-insert-opt';
    optLocal.textContent = '📁 本地文件';
    var optLink = document.createElement('button');
    optLink.type = 'button'; optLink.className = 'xl-insert-opt';
    optLink.textContent = '🔗 用链接';
    var optCancel = document.createElement('button');
    optCancel.type = 'button'; optCancel.className = 'xl-insert-opt xl-insert-cancel';
    optCancel.textContent = '取消';
    box.appendChild(optLocal); box.appendChild(optLink); box.appendChild(optCancel);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    optCancel.addEventListener('click', close);

    optLocal.addEventListener('click', function () {
      fileIn.value = '';
      fileIn.onchange = function () {
        var f = fileIn.files && fileIn.files[0];
        if (!f) return;
        close();
        toast(kind === 'image' ? '图片上传中…' : '视频上传中…');
        uploadFile(f, kind).then(function (url) { cb(url); })
          .catch(function (err) {
            window.alert('上传失败：' + (err && err.message ? err.message : '未知错误') +
              '\n（需以站主账号登录，且文件 ≤ 20MB）');
          });
      };
      fileIn.click();
    });

    optLink.addEventListener('click', function () {
      close();
      var url = window.prompt(
        kind === 'image' ? '输入图片地址（http/https 或以 / 开头的站内路径）：'
                         : '输入视频地址（YouTube 链接，或 .mp4/.webm/.ogg 直链）：', '');
      if (url === null) return;
      url = url.trim();
      if (!url) return;
      if (!isValidMediaUrl(url)) { window.alert('地址不合法。'); return; }
      cb(url);
    });
  }

  // ---------- 块操作 ----------
  function makeTextbox() {
    var b = buildBlockEl({ id: genId(), type: 'textbox', html: '' });
    var inner = b.querySelector('.xl-block-inner');
    inner.setAttribute('contenteditable', 'true');
    blocksContainer().appendChild(b);
    setActive(b);
    activeInner = inner;
    inner.focus();
    markDirty();
  }

  function deleteActive() {
    if (!activeWrap) { toast('请先点选要删除的内容块'); return; }
    activeWrap.remove();
    activeWrap = null; activeInner = null; savedRange = null;
    markDirty();
    toast('已删除该内容块');
  }

  // 上移 / 下移（dir = -1 上移，+1 下移）
  function moveActive(dir) {
    if (!activeWrap) { toast('请先点选要移动的内容块'); return; }
    var c = blocksContainer();
    var blocks = $all('.xl-block', c);
    var i = blocks.indexOf(activeWrap);
    if (i < 0) return;
    var j = i + dir;
    if (j < 0) { toast('已经在最上面了'); return; }
    if (j >= blocks.length) { toast('已经在最下面了'); return; }
    if (dir < 0) c.insertBefore(activeWrap, blocks[j]);
    else if (blocks[j].nextSibling) c.insertBefore(activeWrap, blocks[j].nextSibling);
    else c.appendChild(activeWrap);
    activeWrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    markDirty();
    toast(dir < 0 ? '已上移' : '已下移');
  }

  function duplicateActive() {
    if (!activeWrap) { toast('请先点选要复制的内容块'); return; }
    var clone = activeWrap.cloneNode(true);
    clone.dataset.bid = genId();
    clone.classList.remove('active');
    activeWrap.parentNode.insertBefore(clone, activeWrap.nextSibling);
    setActive(clone);
    markDirty();
    toast('已复制此块');
  }

  function insertImage() {
    pickInsertSource('image', function (url) {
      var b = buildBlockEl({ id: genId(), type: 'image', src: url, alt: '' });
      blocksContainer().appendChild(b);
      setActive(b);
      markDirty();
    });
  }

  function insertVideo() {
    pickInsertSource('video', function (url) {
      var b = buildBlockEl({ id: genId(), type: 'video', url: url });
      blocksContainer().appendChild(b);
      setActive(b);
      markDirty();
    });
  }

  function applyFont(val) {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    activeInner.style.fontFamily = val;
    savedRange = null;
    markDirty();
  }

  function applySize(val) {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    activeInner.style.fontSize = val;
    markDirty();
  }

  // 调色板与最近色：localStorage 记住最近 8 个用过的颜色
  var RECENT_COLORS_KEY = 'xl_edit_recent_colors';
  var RECENT_COLORS_MAX = 8;
  var RECENT_BG_KEY = 'xl_edit_recent_bg';
  function getRecent(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; } }
  function setRecent(key, arr) { try { localStorage.setItem(key, JSON.stringify(arr.slice(0, RECENT_COLORS_MAX))); } catch (e) {} }
  function pushRecent(key, val) {
    if (!val) return;
    var arr = getRecent(key).filter(function (x) { return x.toLowerCase() !== val.toLowerCase(); });
    arr.unshift(val);
    setRecent(key, arr);
  }

  // 在选区上应用包裹标签（用于背景色等 execCommand 难处理的情况）
  function applyStyleToRange(prop, val) {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    var range = sel.getRangeAt(0);
    if (range.collapsed) return false;
    // 包裹：逐个 textNode 套一层 <span style="...">
    var spans = [];
    var walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        // 仅接受与 range 有交集的文本节点
        if (!range.intersectsNode(n)) return NodeFilter.FILTER_REJECT;
        // 跳过空文本
        if (!n.nodeValue || !n.nodeValue.trim().length) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode())) {
      var span = document.createElement('span');
      span.style[prop] = val;
      var parent = node.parentNode;
      // 如果父节点已经是带同样 prop 的 span，复用
      if (parent && parent.tagName === 'SPAN' && parent.style[prop] === val &&
          parent.childNodes.length === 1) {
        continue;
      }
      parent.insertBefore(span, node);
      span.appendChild(node);
      spans.push(span);
    }
    return spans.length > 0;
  }

  function applyColor(val) {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    val = (val || '').toLowerCase();
    if (!val) return;
    restoreSel();
    var ok = false;
    if (savedRange && !savedRange.collapsed) {
      try {
        // execCommand 兼容性最好，但现代浏览器可能对其弃用；双保险
        document.execCommand('foreColor', false, val);
        ok = true;
      } catch (_) {}
      if (!ok) ok = applyStyleToRange('color', val);
    }
    if (!ok) activeInner.style.color = val;
    pushRecent(RECENT_COLORS_KEY, val);
    refreshRecents();
    savedRange = null;
    markDirty();
  }

  function applyHighlight(val) {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    val = (val || '').toLowerCase();
    if (!val) return;
    restoreSel();
    var ok = false;
    if (savedRange && !savedRange.collapsed) {
      try {
        document.execCommand('hiliteColor', false, val);
        ok = true;
      } catch (_) {}
      if (!ok) ok = applyStyleToRange('backgroundColor', val);
    }
    if (!ok) activeInner.style.backgroundColor = val;
    pushRecent(RECENT_BG_KEY, val);
    refreshRecents();
    savedRange = null;
    markDirty();
  }

  function applyClearFormat() {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    restoreSel();
    if (savedRange && !savedRange.collapsed) {
      try { document.execCommand('removeFormat'); } catch (_) {}
    } else {
      // 清空 activeInner 上的所有 inline style
      activeInner.removeAttribute('style');
    }
    savedRange = null;
    markDirty();
  }

  // 缩放选中的图片/视频块（0.2 ~ 4 倍）
  function applyZoom(delta) {
    if (!activeWrap) { toast('请先点选一个图片或视频块'); return; }
    var t = activeWrap.dataset.type;
    if (t !== 'image' && t !== 'video') { toast('放大/缩小仅适用于图片块或视频块'); return; }
    var cur = parseFloat(activeWrap.dataset.zoom || '1') || 1;
    var next = Math.min(4, Math.max(0.2, Math.round((cur + delta) * 100) / 100));
    applyZoomTo(activeWrap, next);
    markDirty();
    toast('缩放 ' + Math.round(next * 100) + '%');
  }

  function insertLink() {
    if (!activeInner) { toast('请先点选一个文本框'); return; }
    restoreSel();
    if (!savedRange || savedRange.collapsed) { toast('请先在文本框里选中要加链接的文字'); return; }
    var url = window.prompt('输入链接地址（http/https 或以 / 开头）：', 'https://');
    if (url === null) return;
    url = url.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url) && !/^\//.test(url)) { window.alert('地址不合法。'); return; }
    exec('createLink', url);
  }

  // ---------- 顶部编辑条 ----------
  function showUI() {
    banner = document.createElement('div');
    banner.className = 'xl-edit-banner';

    var row = document.createElement('div');
    row.className = 'xl-edit-row';
    var tip = document.createElement('span');
    tip.className = 'xl-edit-tip';
    tip.innerHTML = '布局编辑模式 · 点文字直接改，点图片换图　<span class="xl-kbd">Ctrl/⌘+S</span> 保存　<span class="xl-kbd">Esc</span> 退出';
    saveBtn = document.createElement('button');
    saveBtn.type = 'button'; saveBtn.className = 'xl-edit-save'; saveBtn.textContent = '保存';
    var exit = document.createElement('button');
    exit.type = 'button'; exit.className = 'xl-edit-exit'; exit.textContent = '退出';
    row.appendChild(tip); row.appendChild(saveBtn); row.appendChild(exit);

    var tb = document.createElement('div');
    tb.className = 'xl-edit-toolbar';

    function keep(e) { e.preventDefault(); }       // 点按钮不抢焦点
    function btn(label, fn, opts) {
      opts = opts || {};
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'xl-tb-btn' + (opts.cls ? ' ' + opts.cls : '');
      x.textContent = label;
      if (opts.cmd) x.setAttribute('data-cmd', opts.cmd);
      if (opts.title) x.title = opts.title;
      x.addEventListener('mousedown', keep);
      x.addEventListener('click', fn);
      return x;
    }
    function sep() { var s = document.createElement('span'); s.className = 'xl-tb-sep'; return s; }
    function group() { var g = document.createElement('div'); g.className = 'xl-tb-group'; return g; }

    // — 块操作 —
    var gBlock = group();
    gBlock.appendChild(btn('＋ 新建', makeTextbox, { title: '新建一个文本框' }));
    gBlock.appendChild(btn('⧉ 复制', duplicateActive, { title: '复制选中的内容块' }));
    gBlock.appendChild(btn('↑ 上移', function () { moveActive(-1); }, { title: '把选中块往上移' }));
    gBlock.appendChild(btn('↓ 下移', function () { moveActive(1); }, { title: '把选中块往下移' }));
    gBlock.appendChild(btn('🗑 删除', deleteActive, { title: '删除选中的内容块（Delete）' }));
    tb.appendChild(gBlock);
    tb.appendChild(sep());

    // — 媒体 —
    var gMedia = group();
    gMedia.appendChild(btn('🖼 图片', insertImage, { title: '插入图片（本地文件或链接）' }));
    gMedia.appendChild(btn('🎬 视频', insertVideo, { title: '插入视频（本地文件或链接）' }));
    gMedia.appendChild(btn('🔍＋', function () { applyZoom(0.2); }, { title: '放大选中块' }));
    gMedia.appendChild(btn('🔍－', function () { applyZoom(-0.2); }, { title: '缩小选中块' }));
    tb.appendChild(gMedia);
    tb.appendChild(sep());

    // — 行内格式 —
    var gFmt = group();
    gFmt.appendChild(btn('B', function () { exec('bold'); }, { cmd: 'bold', cls: 'f-bold', title: '粗体 (Ctrl/⌘+B)' }));
    gFmt.appendChild(btn('I', function () { exec('italic'); }, { cmd: 'italic', cls: 'f-italic', title: '斜体 (Ctrl/⌘+I)' }));
    gFmt.appendChild(btn('U', function () { exec('underline'); }, { cmd: 'underline', cls: 'f-underline', title: '下划线 (Ctrl/⌘+U)' }));
    gFmt.appendChild(btn('S', function () { exec('strikeThrough'); }, { cmd: 'strike', cls: 'f-strike', title: '删除线' }));
    tb.appendChild(gFmt);
    tb.appendChild(sep());

    // — 对齐 —
    var gAlign = group();
    gAlign.appendChild(btn('⇤', function () { exec('justifyLeft'); }, { cmd: 'aleft', title: '左对齐' }));
    gAlign.appendChild(btn('⇔', function () { exec('justifyCenter'); }, { cmd: 'acenter', title: '居中' }));
    gAlign.appendChild(btn('⇥', function () { exec('justifyRight'); }, { cmd: 'aright', title: '右对齐' }));
    tb.appendChild(gAlign);
    tb.appendChild(sep());

    // — 链接 / 清除 —
    var gLink = group();
    gLink.appendChild(btn('🔗 链接', insertLink, { title: '给选中的文字加链接' }));
    gLink.appendChild(btn('⛓ 解除', function () { exec('unlink'); }, { title: '移除链接' }));
    gLink.appendChild(btn('🧹 清格式', function () { exec('removeFormat'); }, { title: '清除选中文字的格式' }));
    tb.appendChild(gLink);
    tb.appendChild(sep());

    // — 字体 / 字号 / 颜色（Word-like 增强版） —
    var gStyle = group();

    // 字体下拉（更多字体）
    var font = document.createElement('select');
    font.className = 'xl-tb-select';
    [['', '字体'], ['inherit', '继承'],
      ['sans-serif', '无衬线'], ['serif', '衬线'], ['monospace', '等宽'],
      ['system-ui, sans-serif', '系统默认'], ['-apple-system, BlinkMacSystemFont, sans-serif', '苹果系统'],
      ['微软雅黑, sans-serif', '微软雅黑'], ['Microsoft YaHei, sans-serif', 'Microsoft YaHei'],
      ['宋体, serif', '宋体'], ['SimSun, serif', 'SimSun'],
      ['黑体, sans-serif', '黑体'], ['SimHei, sans-serif', 'SimHei'],
      ['楷体, serif', '楷体'], ['KaiTi, serif', 'KaiTi'],
      ['隶书, serif', '隶书'], ['FangSong, serif', '仿宋'],
      ['PingFang SC, sans-serif', '苹方'],
      ['Helvetica, Arial, sans-serif', 'Helvetica'],
      ['Arial, sans-serif', 'Arial'], ['Verdana, sans-serif', 'Verdana'],
      ['Tahoma, sans-serif', 'Tahoma'], ['Trebuchet MS, sans-serif', 'Trebuchet'],
      ['Georgia, serif', 'Georgia'], ['Times New Roman, serif', 'Times'],
      ['Garamond, serif', 'Garamond'], ['Palatino, serif', 'Palatino'],
      ['Courier New, monospace', 'Courier'], ['Consolas, monospace', 'Consolas']]
      .forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; font.appendChild(op); });
    font.addEventListener('change', function () { if (font.value) applyFont(font.value); });
    gStyle.appendChild(font);

    // 字号下拉（更宽的范围，支持手动输入）
    var size = document.createElement('input');
    size.className = 'xl-tb-size';
    size.type = 'text';
    size.placeholder = '字号';
    size.setAttribute('list', 'xl-tb-size-list');
    var sizeList = document.createElement('datalist');
    sizeList.id = 'xl-tb-size-list';
    ['10','11','12','14','16','18','20','22','24','28','32','36','42','48','56','64','72','96']
      .forEach(function (s) { var op = document.createElement('option'); op.value = s; sizeList.appendChild(op); });
    banner.appendChild(sizeList); // datalist 挂到 banner 上更安全
    size.addEventListener('change', function () {
      var v = (size.value || '').trim();
      if (!v) return;
      // 接受纯数字（如 "16"）或带 px/em 的（如 "16px"）
      if (/^\d+(\.\d+)?$/.test(v)) v = v + 'px';
      if (!/^[\d.]+(px|em|rem|%)$/.test(v)) { toast('字号格式不对，如 16 / 18px / 1.2em'); return; }
      applySize(v);
    });
    gStyle.appendChild(size);

    tb.appendChild(gStyle);

    // — 颜色工具组（调色板 + 自定义 + 最近用色 + 背景色） —
    var gColor = group();
    gColor.classList.add('xl-tb-group-color');

    // 文字颜色按钮（带下拉面板）
    var fgBtn = document.createElement('button');
    fgBtn.type = 'button';
    fgBtn.className = 'xl-tb-color-btn';
    fgBtn.innerHTML = '<span class="xl-tb-color-letter">A</span><span class="xl-tb-color-bar" style="background:#222"></span><span class="xl-caret">▾</span>';
    fgBtn.title = '文字颜色';
    gColor.appendChild(fgBtn);

    // 背景颜色按钮（高亮）
    var bgBtn = document.createElement('button');
    bgBtn.type = 'button';
    bgBtn.className = 'xl-tb-color-btn xl-tb-bg-btn';
    bgBtn.innerHTML = '<span class="xl-tb-color-bg-letter">A</span><span class="xl-tb-color-bar" style="background:#fff36d"></span><span class="xl-caret">▾</span>';
    bgBtn.title = '背景颜色（高亮）';
    gColor.appendChild(bgBtn);

    // 调色板
    var STANDARD_COLORS = [
      '#000000','#404040','#808080','#a0a0a0','#d0d0d0','#ffffff',
      '#e60012','#ff6600','#ffcc00','#ffe800','#a8d600','#00b050',
      '#00b0f0','#0078d4','#002060','#5c0a8a','#d6006a','#a30000'
    ];
    var STANDARD_BG = [
      '#ffffff','#fff36d','#ffd966','#a4d2ff','#c5e0b4','#f4cccc',
      '#fff2cc','#e2efda','#d9e8f5','#fce4d6','#fad7d0','#e6b8af'
    ];

    function buildPanel(which) {
      var panel = document.createElement('div');
      panel.className = 'xl-tb-color-panel';
      panel.dataset.which = which; // 'fg' or 'bg'
      var palette = which === 'fg' ? STANDARD_COLORS : STANDARD_BG;
      var grid = document.createElement('div');
      grid.className = 'xl-tb-color-grid';
      palette.forEach(function (c) {
        var sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'xl-tb-color-swatch';
        sw.style.background = c;
        sw.dataset.color = c;
        sw.title = c;
        sw.addEventListener('mousedown', keep);
        sw.addEventListener('click', function () {
          closePanels();
          if (which === 'fg') applyColor(c); else applyHighlight(c);
        });
        grid.appendChild(sw);
      });
      panel.appendChild(grid);

      // 最近用色
      var recentWrap = document.createElement('div');
      recentWrap.className = 'xl-tb-color-recent';
      var recentLabel = document.createElement('div');
      recentLabel.className = 'xl-tb-color-recent-label';
      recentLabel.textContent = '最近用色';
      recentWrap.appendChild(recentLabel);
      var recentGrid = document.createElement('div');
      recentGrid.className = 'xl-tb-color-grid xl-tb-color-recent-grid';
      recentGrid.dataset.which = which;
      recentWrap.appendChild(recentGrid);
      panel.appendChild(recentWrap);

      // 自定义颜色 + 清除按钮
      var customRow = document.createElement('div');
      customRow.className = 'xl-tb-color-custom';
      var picker = document.createElement('input');
      picker.type = 'color';
      picker.value = which === 'fg' ? '#222222' : '#fff36d';
      picker.addEventListener('mousedown', keep);
      picker.addEventListener('input', function () {
        if (which === 'fg') applyColor(picker.value); else applyHighlight(picker.value);
      });
      var pickerLabel = document.createElement('span');
      pickerLabel.textContent = '自定义';
      customRow.appendChild(picker);
      customRow.appendChild(pickerLabel);
      // 清除颜色
      var clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'xl-tb-color-clear';
      clearBtn.textContent = which === 'fg' ? '清除文字颜色' : '清除背景';
      clearBtn.addEventListener('mousedown', keep);
      clearBtn.addEventListener('click', function () {
        closePanels();
        if (which === 'fg') applyColor('#222222'); // 用默认色重置
        else applyHighlight('transparent');
      });
      customRow.appendChild(clearBtn);
      panel.appendChild(customRow);
      return panel;
    }

    fgPanel = buildPanel('fg');
    bgPanel = buildPanel('bg');
    fgBtn.appendChild(fgPanel);
    bgBtn.appendChild(bgPanel);

    function closePanels() {
      [fgPanel, bgPanel].forEach(function (p) { p.classList.remove('open'); });
    }
    fgBtn.addEventListener('mousedown', keep);
    bgBtn.addEventListener('mousedown', keep);
    fgBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var wasOpen = fgPanel.classList.contains('open');
      closePanels();
      if (!wasOpen) fgPanel.classList.add('open');
    });
    bgBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var wasOpen = bgPanel.classList.contains('open');
      closePanels();
      if (!wasOpen) bgPanel.classList.add('open');
    });
    // 点页面其他位置关闭
    document.addEventListener('mousedown', function (e) {
      if (!fgBtn.contains(e.target)) fgPanel.classList.remove('open');
      if (!bgBtn.contains(e.target)) bgPanel.classList.remove('open');
    });

    tb.appendChild(gColor);

    // 清格式按钮
    var gClear = group();
    gClear.appendChild(btn('🧹 清格式', function () { applyClearFormat(); }, { title: '清除选中文字的所有格式（颜色、加粗等）' }));
    tb.appendChild(gClear);

    // 初始化最近用色面板
    refreshRecents();

    banner.appendChild(row);
    banner.appendChild(tb);
    document.body.appendChild(banner);

    // 创建浮动迷你工具栏（选中文字时浮现在选区上方）
    createMiniToolbar();

    saveBtn.addEventListener('click', saveEdits);
    exit.addEventListener('click', requestExit);
    updateSaveBtn();
  }

  // 浮动迷你工具栏（Word-like 选中浮现）
  var miniToolbar = null;
  var miniFgPanel = null;
  var miniBgPanel = null;
  function createMiniToolbar() {
    miniToolbar = document.createElement('div');
    miniToolbar.className = 'xl-mini-toolbar';

    function miniBtn(label, title, fn, cls) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (title) b.title = title;
      if (cls) b.className = cls;
      b.addEventListener('mousedown', keepSel);
      b.addEventListener('click', fn);
      return b;
    }

    miniToolbar.appendChild(miniBtn('B', '加粗 (Ctrl+B)', function () { exec('bold'); }, 'xl-mini-b f-bold'));
    miniToolbar.appendChild(miniBtn('I', '斜体 (Ctrl+I)', function () { exec('italic'); }, 'xl-mini-i f-italic'));
    miniToolbar.appendChild(miniBtn('U', '下划线 (Ctrl+U)', function () { exec('underline'); }, 'xl-mini-u f-underline'));

    // 文字颜色（小型弹层）
    var fg = document.createElement('button');
    fg.type = 'button';
    fg.className = 'xl-mini-fg';
    fg.title = '文字颜色';
    fg.innerHTML = '<span class="xl-mini-fg-letter">A</span><span class="xl-mini-fg-bar"></span>';
    fg.addEventListener('mousedown', keepSel);
    fg.addEventListener('click', function (e) {
      e.stopPropagation();
      miniBgPanel.classList.remove('open');
      miniFgPanel.classList.toggle('open');
    });
    miniToolbar.appendChild(fg);

    // 背景颜色（小型弹层）
    var bg = document.createElement('button');
    bg.type = 'button';
    bg.className = 'xl-mini-bg';
    bg.title = '背景颜色（高亮）';
    bg.innerHTML = '<span class="xl-mini-bg-letter">A</span>';
    bg.addEventListener('mousedown', keepSel);
    bg.addEventListener('click', function (e) {
      e.stopPropagation();
      miniFgPanel.classList.remove('open');
      miniBgPanel.classList.toggle('open');
    });
    miniToolbar.appendChild(bg);

    miniToolbar.appendChild(miniBtn('🧹', '清除格式', applyClearFormat, 'xl-mini-clear'));

    // 复用面板工厂（标准 + 最近 + 自定义，简化版以适合迷你宽度）
    function buildMiniPanel(which) {
      var panel = document.createElement('div');
      panel.className = 'xl-tb-color-panel';
      panel.dataset.which = which;
      var palette = which === 'fg' ? STANDARD_COLORS : STANDARD_BG;
      var grid = document.createElement('div');
      grid.className = 'xl-tb-color-grid';
      palette.forEach(function (c) {
        var sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'xl-tb-color-swatch';
        sw.style.background = c;
        sw.title = c;
        sw.addEventListener('mousedown', keepSel);
        sw.addEventListener('click', function () {
          panel.classList.remove('open');
          if (which === 'fg') applyColor(c); else applyHighlight(c);
        });
        grid.appendChild(sw);
      });
      panel.appendChild(grid);
      return panel;
    }
    miniFgPanel = buildMiniPanel('fg');
    miniBgPanel = buildMiniPanel('bg');
    fg.appendChild(miniFgPanel);
    bg.appendChild(miniBgPanel);

    document.body.appendChild(miniToolbar);

    // 点击面板外关闭
    document.addEventListener('mousedown', function (e) {
      if (!miniToolbar.contains(e.target)) {
        miniFgPanel.classList.remove('open');
        miniBgPanel.classList.remove('open');
      }
    });
  }

  // 显示/隐藏迷你工具栏
  function updateMiniToolbar() {
    if (!miniToolbar) return;
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      miniToolbar.classList.remove('open');
      miniFgPanel && miniFgPanel.classList.remove('open');
      miniBgPanel && miniBgPanel.classList.remove('open');
      return;
    }
    var range = sel.getRangeAt(0);
    // 只在 activeInner 内（编辑中的文本框）显示
    if (!activeInner || !activeInner.contains(range.commonAncestorContainer)) {
      miniToolbar.classList.remove('open');
      return;
    }
    var rect = range.getBoundingClientRect();
    if (!rect || (rect.left === 0 && rect.top === 0 && rect.right === 0)) {
      miniToolbar.classList.remove('open');
      return;
    }
    var top = rect.top - 44;
    var left = rect.left + rect.width / 2;
    // 顶部贴边则放到下方
    if (top < 60) top = rect.bottom + 8;
    // 屏幕左右边界保护
    var margin = 8;
    miniToolbar.style.top = Math.max(margin, Math.min(top, window.innerHeight - 50)) + 'px';
    miniToolbar.style.left = Math.max(margin, Math.min(left, window.innerWidth - 240)) + 'px';
    miniToolbar.classList.add('open');
  }

  // 刷新最近用色面板的格子
  function refreshRecents() {
    [fgPanel, bgPanel].forEach(function (panel) {
      if (!panel) return;
      var which = panel.dataset.which;
      var grid = panel.querySelector('.xl-tb-color-recent-grid');
      if (!grid) return;
      var key = which === 'fg' ? RECENT_COLORS_KEY : RECENT_BG_KEY;
      var list = getRecent(key);
      grid.innerHTML = '';
      if (!list.length) {
        var ph = document.createElement('div');
        ph.className = 'xl-tb-color-recent-empty';
        ph.textContent = '（无）';
        grid.appendChild(ph);
        return;
      }
      list.forEach(function (c) {
        var sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'xl-tb-color-swatch';
        sw.style.background = c;
        sw.title = c;
        sw.addEventListener('mousedown', keepSel);
        sw.addEventListener('click', function () {
          panel.classList.remove('open');
          if (which === 'fg') applyColor(c); else applyHighlight(c);
        });
        grid.appendChild(sw);
      });
    });
  }

  // ---------- 快捷键 ----------
  function onKeyDown(e) {
    if (!active) return;
    var meta = e.ctrlKey || e.metaKey;
    var key = (e.key || '').toLowerCase();
    var t = e.target;
    var typing = !!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')));

    // 保存
    if (meta && key === 's') { e.preventDefault(); saveEdits(); return; }
    // 退出
    if (key === 'escape') { e.preventDefault(); requestExit(); return; }
    // 行内格式（在文本框内才生效）
    if (meta && activeInner && (key === 'b' || key === 'i' || key === 'u')) {
      e.preventDefault();
      exec(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline');
      return;
    }
    // 删除选中块：仅在「没有正在输入」时生效，避免影响正常打字
    if (!typing && (key === 'delete' || key === 'backspace')) {
      if (activeWrap) { e.preventDefault(); deleteActive(); }
    }
  }

  // ---------- 离开前提醒 ----------
  function onBeforeUnload(e) {
    if (!active || !dirty) return undefined;
    e.preventDefault();
    e.returnValue = '';
    return '';
  }

  function requestExit() {
    if (dirty && !window.confirm('有未保存的修改，确定要退出吗？')) return;
    exitEdit(false);
  }

  // ---------- 进入 / 保存 / 退出 ----------
  function open() {
    if (active) return;
    active = true;
    dirty = false;
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
      updateToolbarState();
    });
    c.addEventListener('mousedown', function (e) {
      var w = e.target.closest && e.target.closest('.xl-block');
      if (w) setActive(w);
    });
    // 任何输入都视为「有改动」，让未保存提醒真正生效
    c.addEventListener('input', markDirty);
    document.addEventListener('selectionchange', onSelChange);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('beforeunload', onBeforeUnload);
    toast('已进入布局编辑模式');
  }

  function onSelChange() {
    if (!active) return;
    saveSel();
    updateToolbarState();
    updateMiniToolbar();
  }

  function saveEdits() {
    if (saving) return;
    var blocks = [];
    $all('#xl-edit-blocks .xl-block').forEach(function (wrap) {
      var type = wrap.dataset.type;
      var id = wrap.dataset.bid || genId();
      if (type === 'textbox') {
        var inner = wrap.querySelector('.xl-block-inner');
        blocks.push({ id: id, type: 'textbox', html: inner.innerHTML, style: inner.getAttribute('style') || '' });
      } else if (type === 'image') {
        var img = wrap.querySelector('img');
        blocks.push({ id: id, type: 'image', src: img.getAttribute('src'), alt: img.getAttribute('alt') || '', zoom: Number(wrap.dataset.zoom || 1) });
      } else if (type === 'video') {
        blocks.push({ id: id, type: 'video', url: wrap.dataset.url || '', zoom: Number(wrap.dataset.zoom || 1) });
      }
    });
    saving = true;
    updateSaveBtn();
    fetch('/api/page-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: curPath(), edits: edits, blocks: blocks })
    }).then(function (r) {
      saving = false;
      if (!r.ok) {
        updateSaveBtn();
        window.alert('保存失败（需要以站主账号登录）。');
        return;
      }
      dirty = false;
      updateSaveBtn();
      toast('已保存布局修改');
      exitEdit(true);
    }).catch(function () {
      saving = false;
      updateSaveBtn();
      window.alert('保存失败，请重试。');
    });
  }

  function exitEdit(keep) {
    active = false;
    activeWrap = null; activeInner = null; savedRange = null;
    dirty = false; saving = false;
    document.body.classList.remove('xl-editmode');
    document.removeEventListener('selectionchange', onSelChange);
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('beforeunload', onBeforeUnload);
    var c = document.getElementById('xl-edit-blocks');
    if (c) c.removeEventListener('input', markDirty);
    var b = document.querySelector('.xl-edit-banner');
    if (b) b.remove();
    if (miniToolbar) { miniToolbar.remove(); miniToolbar = null; miniFgPanel = null; miniBgPanel = null; }
    banner = null; saveBtn = null; fgPanel = null; bgPanel = null;
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

  window.XLEdit = { open: open, applySaved: applySaved };

  if (document.readyState !== 'loading') applySaved();
  else document.addEventListener('DOMContentLoaded', applySaved);
})();
