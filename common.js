/* common.js — 小蓝页共享输入增强：文本域自动增高 + 字数计数
 * 用法：
 *   <textarea class="edit-textarea auto-grow" ...></textarea>
 *   <input class="edit-input" id="x" maxlength="200" />
 *   <span class="char-count" data-for="x"></span>
 * 无需手动调用，脚本在 DOM 就绪后自动初始化页面内所有 .auto-grow 与带 maxlength 的字段。
 */
(function () {
  'use strict';

  function autoGrow(el) {
    if (!el.offsetParent) return; // 隐藏时不计算，避免高度被压成 0
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  function getCounter(field) {
    if (!field.id) return null;
    return document.querySelector('.char-count[data-for="' + CSS.escape(field.id) + '"]');
  }

  function updateCounter(field) {
    var c = getCounter(field);
    if (!c) return;
    var max = parseInt(field.getAttribute('maxlength') || '0', 10);
    var len = (field.value || '').length;
    c.textContent = len + ' / ' + max;
    if (len > max) c.classList.add('over');
    else c.classList.remove('over');
  }

  function init() {
    document.querySelectorAll('textarea.auto-grow').forEach(function (t) {
      autoGrow(t);
      t.addEventListener('input', function () { autoGrow(t); updateCounter(t); });
      updateCounter(t);
    });
    document.querySelectorAll('input[maxlength], textarea[maxlength]').forEach(function (f) {
      if (!getCounter(f)) return;
      f.addEventListener('input', function () { updateCounter(f); });
      updateCounter(f);
    });
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();

/* common.js — 流畅动画：滚动揭示 + 图片淡入
 * 与 common.css 配套：仅用透明度过渡（opacity-only），避免与悬浮位移冲突；
 * 排除弹层（.modal / .settings-panel 等）内部元素，避免永久隐藏。
 */
(function () {
  'use strict';
  var d = document;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SKIP = '.modal-overlay,.settings-overlay,.modal,.settings-panel,.pop-menu,.user-popup,.dropdown,.modal-card,.tab-pane';

  function tag() {
    var sel = '.section-card,.prod-card,.feature-card,.card,.post,.user-card,.product-card,.notice-item,.comment-item';
    d.querySelectorAll(sel).forEach(function (el) {
      if (el.closest && el.closest(SKIP)) return;            // 弹层内部不揭示
      if (el.classList.contains('xl-reveal') || el.classList.contains('in')) return;
      el.classList.add('xl-reveal');
    });
  }
  tag();

  if (reduce) {
    d.querySelectorAll('.xl-reveal,.section-card,.prod-card,.feature-card').forEach(function (e) { e.classList.add('in'); });
    return;
  }

  var els = d.querySelectorAll('.xl-reveal,.section-card,.prod-card,.feature-card');
  if (!('IntersectionObserver' in window) || !els.length) {
    els.forEach(function (e) { e.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
  els.forEach(function (e) { io.observe(e); });

  // 图片淡入
  d.querySelectorAll('img').forEach(function (img) {
    if (img.complete) img.classList.add('loaded');
    else img.addEventListener('load', function () { img.classList.add('loaded'); });
  });
})();
