// prefs.js — 站点偏好统一应用（主题 / 字号 / 圆角 / 双语）
//
// 背景：站内 23 个页面用了 data-zh / data-en 双语标记，但其中 11 个页面
// 只有标记、没有「应用偏好」的脚本，导致在这些页面上切换语言完全无效
// （标记静静躺在 HTML 里，永远显示中文）。这个文件就是给这些页面补上引擎。
//
// 已自带内联偏好脚本的页面（index / helpcenter 等）不要重复引入本文件，
// 否则两套引擎会各应用一次（虽不致命，但会在动态插入节点后互相覆盖）。
//
// 同时把 applyAll 暴露到 window，供 auth.js 与 post/center 等页面
// 在「动态渲染完内容后」重新套用一次语言与主题。
(function () {
  'use strict';
  var K = { lang: 'xl_lang', theme: 'xl_theme', font: 'xl_font', radius: 'xl_radius' };
  function get(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }

  function applyTheme() {
    var t = get(K.theme, 'light');
    document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
  }
  function applyFont() {
    document.documentElement.style.setProperty('--font-scale', get(K.font, '1'));
  }
  function applyRadius() {
    document.documentElement.style.setProperty('--radius', get(K.radius, '14') + 'px');
  }
  function applyLang() {
    var en = get(K.lang, 'zh') === 'en';
    document.documentElement.lang = en ? 'en' : 'zh-CN';
    var nodes = document.querySelectorAll('[data-zh]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var txt = en ? (n.getAttribute('data-en') || n.textContent) : n.getAttribute('data-zh');
      if (txt != null) n.textContent = txt;
    }
  }
  function applyAll() { applyTheme(); applyFont(); applyRadius(); applyLang(); }

  // 暴露给 auth.js（登录同步云端设置后）与各页面动态渲染后重新调用
  window.applyAll = applyAll;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyAll);
  else applyAll();
})();
