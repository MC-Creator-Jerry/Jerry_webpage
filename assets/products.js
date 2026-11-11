/* products.js — 产品清单的「单一真相源」加载与渲染
 *
 * 数据源：/data/products.json
 *   —— 站主的所有产品（软件 / 网站）都在这一份清单里；
 *      改这一个文件，小蓝页「产品」页、帮助中心、顶栏搜索就同时更新。
 *
 * 用法（页面里放好容器即可）：
 *   <div class="prod-grid"     data-prod-list="software" data-prod-style="card"></div>
 *   <div class="prod-grid"     data-prod-list="site"    data-prod-style="card"></div>
 *   <div class="help-prod-grid" data-prod-list="software" data-prod-style="btn"></div>
 *   <div class="help-prod-grid" data-prod-list="site"    data-prod-style="btn"></div>
 *
 *   然后：<script src="assets/products.js"></script> + window.XL_PRODUCTS.load()
 *
 * 说明：
 *   - data-prod-style="card" → 渲染成产品卡片（带 data-pin-* 属性，可被「固定」功能识别）
 *   - data-prod-style="btn"  → 渲染成帮助中心那种按钮，链接指向该产品的文档页 doc
 *   - 名称/简介都带 data-zh / data-en，切换语言时由站点既有的 applyLang 统一翻译
 */
(function () {
  'use strict';

  var DATA_URL = '/data/products.json';
  var _data = null;
  var _loading = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isEn() {
    try { return (localStorage.getItem('xl_lang') || 'zh') === 'en'; } catch (e) { return false; }
  }
  function pick(p, zhKey, enKey) {
    if (!isEn()) return p[zhKey] || '';
    return p[enKey] || p[zhKey] || '';
  }

  function fetchData() {
    if (_data) return Promise.resolve(_data);
    if (_loading) return _loading;
    _loading = fetch(DATA_URL, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.products || !d.products.length) throw new Error('products.json 解析失败');
        _data = d;
        _loading = null;
        return d;
      })
      .catch(function (e) {
        _loading = null;
        console.warn('[products] 载入失败：', e);
        return null;
      });
    return _loading;
  }

  function cardHTML(p) {
    var href = esc(p.url);
    var ext = p.external ? ' target="_blank" rel="noopener"' : '';
    var shape = p.shape === 'sq' ? 'prod-icon-sq' : 'prod-icon-round';
    var proj = p.id ? ' data-proj="' + esc(p.id) + '"' : '';
    if (p.since) proj += ' data-proj-since="' + esc(p.since) + '"';
    var html = '<a class="prod-card" href="' + href + '"' + ext + proj +
      ' data-pin-icon="' + esc(p.img) + '"' +
      ' data-pin-name="' + esc(p.name) + '"' +
      ' data-pin-en="' + esc(p.en || '') + '"' +
      ' data-pin-url="' + esc(p.url) + '"' +
      ' data-pin-desc="' + esc(p.desc || '') + '"' +
      ' data-pin-desc-en="' + esc(p.descEn || '') + '">' +
      '<img class="' + shape + '" src="' + esc(p.img) + '" alt="' + esc(p.name) + '" loading="lazy">' +
      '<div class="prod-name" data-zh="' + esc(p.name) + '" data-en="' + esc(p.en || p.name) + '">' +
        esc(pick(p, 'name', 'en')) + '</div>' +
      '<div class="prod-desc" data-zh="' + esc(p.desc || '') + '" data-en="' + esc(p.descEn || '') + '">' +
        esc(pick(p, 'desc', 'descEn')) + '</div>';
    if (p.verId) {
      html += '<div class="prod-soon" id="' + esc(p.verId) + '"' +
        ' data-zh="' + esc(p.verZh || '') + '" data-en="' + esc(p.verEn || '') + '">' +
        esc(isEn() ? (p.verEn || p.verZh || '') : (p.verZh || '')) + '</div>';
    }
    if (p.tag) {
      html += '<span class="prod-tag t-live"><i class="ic" data-ic="check-circle" aria-hidden="true"></i>' +
        '<span data-zh="' + esc(p.tag.zh || '') + '" data-en="' + esc(p.tag.en || '') + '">' +
        esc(isEn() ? (p.tag.en || p.tag.zh || '') : (p.tag.zh || '')) + '</span></span>';
    }
    if (p.new) {
      // 「新上线」徽章：products.json 里显式 "new": true 才挂，完全手动可控
      html += '<span class="prod-tag t-live"><i class="ic" data-ic="check-circle" aria-hidden="true"></i>' +
        '<span data-zh="新上线" data-en="New">新上线</span></span>';
    }
    html += '<span class="prod-pin" role="button" tabindex="0" aria-label="固定">' +
      '<i class="ic" data-ic="star" aria-hidden="true"></i></span></a>';
    return html;
  }

  function btnHTML(p) {
    var href = esc(p.doc || p.url);
    return '<a class="help-prod-btn" href="' + href + '"' +
      ' data-zh="' + esc(p.name) + '" data-en="' + esc(p.en || p.name) + '"' +
      ' data-desc="' + esc(p.desc || '') + '">' +
      esc(pick(p, 'name', 'en')) + '</a>';
  }

  function renderAll(d) {
    if (!d) return;
    var list = d.products || [];
    var nodes = document.querySelectorAll('[data-prod-list]');
    for (var i = 0; i < nodes.length; i++) {
      var host = nodes[i];
      var type = host.getAttribute('data-prod-list');
      var style = host.getAttribute('data-prod-style') || 'card';
      var html = '';
      for (var j = 0; j < list.length; j++) {
        if (list[j].type !== type) continue;
        html += (style === 'btn') ? btnHTML(list[j]) : cardHTML(list[j]);
      }
      host.innerHTML = html;
      // 修复（2026-10-29）：common.js 的滚动揭示在页面载入时对 .prod-card 做了一次性
      // 快照并交给 IntersectionObserver；products.js 之后异步注入的卡片不在快照里、
      // 永远不会被观察 → 永远停在 opacity:0（表现为产品页/帮助中心「大片空白」）。
      // 这里给刚注入的卡片直接补 .in，立即可见。静态卡片仍走原有的滚动揭示动画。
      var _inj = host.querySelectorAll('.prod-card, .xl-reveal, .feature-card, .section-card');
      for (var _k = 0; _k < _inj.length; _k++) _inj[_k].classList.add('in');
    }
    // 渲染完通知外部（例如产品页需要重新绑定「固定」按钮状态）
    if (typeof window.__xlAfterProductsRender === 'function') {
      try { window.__xlAfterProductsRender(); } catch (e) {}
    }
  }

  function load() {
    return fetchData().then(function (d) {
      renderAll(d);
      return d;
    });
  }

  // 切换语言后重渲染（静态卡片的文案是内联生成的，需要按当前语言重新生成一次）
  function rerender() {
    renderAll(_data);
  }

  window.XL_PRODUCTS = {
    load: load,
    rerender: rerender,
    get: function () { return _data; },
    fetchData: fetchData
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { load(); });
  } else {
    load();
  }
})();
