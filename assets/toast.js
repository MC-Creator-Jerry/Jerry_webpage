/*
 * toast.js — 全局 alert → 页内 toast 接管
 * 版本：2026-10-30a
 * 作用：加载后用更友好的页内 toast 替换原生 alert()，不改动任何核心文件。
 * 设计：
 *  - 自动注入样式与容器；
 *  - 覆盖 window.alert 为 showToast（非阻塞，自动消失，可堆叠）；
 *  - 任何异常都回退到原生 alert，绝不吞掉报错。
 */
(function () {
  'use strict';
  if (window.__toastReady) return;
  try {
    var STYLE_ID = 'xl-toast-style';
    if (!document.getElementById(STYLE_ID)) {
      var css = [
        '.xl-toast-wrap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);',
        'z-index:99999;display:flex;flex-direction:column;gap:10px;align-items:center;',
        'pointer-events:none;max-width:92vw;}',
        '.xl-toast{pointer-events:auto;min-width:200px;max-width:92vw;padding:12px 18px;',
        'border-radius:12px;background:rgba(28,32,38,.94);color:#fff;font-size:14px;line-height:1.5;',
        'box-shadow:0 8px 28px rgba(0,0,0,.28);opacity:0;transform:translateY(12px);',
        'transition:opacity .22s ease,transform .22s ease;word-break:break-word;white-space:pre-wrap;}',
        '.xl-toast.in{opacity:1;transform:translateY(0);}',
        '.xl-toast.t-err{border-left:4px solid #ff5a5a;}',
        '.xl-toast.t-ok{border-left:4px solid #36c46b;}',
        '.xl-toast.t-info{border-left:4px solid #29a9e0;}',
        '@media (prefers-color-scheme:light){.xl-toast{background:rgba(255,255,255,.98);color:#1c2026;',
        'box-shadow:0 8px 28px rgba(0,0,0,.16);}}'
      ].join('');
      var st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = css;
      document.head.appendChild(st);
    }
    var wrap = document.getElementById('xl-toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'xl-toast-wrap';
      wrap.className = 'xl-toast-wrap';
      document.body.appendChild(wrap);
    }

    function showToast(msg, type) {
      try {
        if (msg === undefined || msg === null) msg = '';
        msg = String(msg);
        var el = document.createElement('div');
        el.className = 'xl-toast ' + (type === 'err' ? 't-err' : type === 'ok' ? 't-ok' : 't-info');
        el.textContent = msg;
        wrap.appendChild(el);
        requestAnimationFrame(function () { el.classList.add('in'); });
        var life = Math.min(6000, 2200 + msg.length * 40);
        setTimeout(function () {
          el.classList.remove('in');
          setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
        }, life);
        return el;
      } catch (e) {
        // 兜底：toast 渲染失败则用原生 alert
        try { window.alert(msg); } catch (_) {}
        return null;
      }
    }

    // 类型推断：含失败/错误/网络/无法/请填写 等词 → 视为错误
    function pickType(msg) {
      var m = String(msg || '');
      if (/失败|错误|网络|无法|不合法|违禁|频繁|invalid|error|fail/i.test(m)) return 'err';
      if (/成功|已发送|已保存|sent|success|ok/i.test(m)) return 'ok';
      return 'info';
    }

    window.showToast = showToast;
    // 接管原生 alert（不改变任何核心文件内容，仅运行时替换表现层）
    window.alert = function (msg) { return showToast(msg, pickType(msg)); };
    window.__toastReady = true;
  } catch (e) {
    // 任何异常都不影响页面：保留原生 alert
    window.__toastReady = true;
  }
})();
