// SSO 身份提供方（小蓝页）· 授权端点
// GET /api/sso/authorize?client_id=teahouse&redirect_uri=...&state=...
//
// 流程（OAuth 2.0 授权码模式，服务端换码）：
//   1. 校验 client_id 与 redirect_uri（白名单严格精确匹配，防开放重定向）
//   2. 读取当前登录态（xl_sid 会话优先，兼容旧 gh_user cookie）
//   3. 已登录 → 生成一次性 code（KV，120s）→ 302 回 redirect_uri?code=&state=
//      未登录 → 返回极简引导页（去小蓝页登录 / 我已登录继续）
//
// 为什么必须走这套：pages.dev 在公共后缀名单里，小蓝页与茶馆属于不同站点，
// Cookie 无法跨子域共享，所以只能做「服务端换码 + 各自种自己的会话」。
import { getSessionAcct, ghSessionAcct } from '../../_lib/account.js';
import { isAdminLogin } from '../../_lib/auth.js';

// 允许的客户端。redirect_uri 必须精确匹配（含协议、域名、路径）。
const CLIENTS = {
  teahouse: {
    name: '茶馆 JerryTeahouse',
    redirect_uris: ['https://jerryteahouse.pages.dev/api/sso/callback']
  },
  pianyu: {
    name: '片屿',
    redirect_uris: [
      'https://jerrypianyu.pages.dev/api/sso/callback',
      'http://localhost:8788/api/sso/callback'
    ]
  },
  bookstation: {
    name: '书栈 BookStation',
    redirect_uris: ['https://jerrybookstation.pages.dev/api/sso/callback']
  }
};

const IDP_HOME = 'https://mc-creator-jerry-webpage.pages.dev/';

function randomToken(bytes) {
  const a = new Uint8Array(bytes);
  (globalThis.crypto || crypto).getRandomValues(a);
  let s = '';
  for (let i = 0; i < a.length; i++) s += a[i].toString(16).padStart(2, '0');
  return s;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function html(body, status) {
  return new Response(
    '<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"/>' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"/>' +
    '<title>单点登录 · 小蓝页</title></head>' +
    '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:#f7f2ea;color:#3a2f26;font:16px/1.7 -apple-system,BlinkMacSystemFont,\'Segoe UI\',\'Microsoft YaHei\',sans-serif">' +
    '<div style="max-width:460px;margin:24px;padding:30px 32px;background:#fffdf9;border:1px solid #e8ddcd;' +
    'border-radius:16px;box-shadow:0 8px 24px rgba(70,52,32,.08)">' + body + '</div></body></html>',
    {
      status: status || 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
    }
  );
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const clientId = url.searchParams.get('client_id') || '';
  const redirectUri = url.searchParams.get('redirect_uri') || '';
  const state = url.searchParams.get('state') || '';

  if (state.length > 200) {
    return html('<h2 style="margin:0 0 10px">参数不合法</h2><p>state 过长。</p>', 400);
  }

  const client = CLIENTS[clientId];
  if (!client) {
    return html('<h2 style="margin:0 0 10px">未知客户端</h2><p>client_id 不在允许列表：<code>' + esc(clientId) + '</code></p>', 400);
  }
  if (!client.redirect_uris.includes(redirectUri)) {
    return html('<h2 style="margin:0 0 10px">回调地址不被允许</h2><p><code>' + esc(redirectUri) + '</code></p>', 400);
  }

  // 当前登录态
  let acct = null;
  try { acct = await getSessionAcct(context); } catch (e) { acct = null; }
  if (!acct) {
    try { acct = await ghSessionAcct(context); } catch (e) { acct = null; }
  }

  if (!acct || !acct.id) {
    // 未登录：给一个引导页。授权 URL 保留在「继续」按钮里，登录后点一次即可。
    const self = esc(url.pathname + url.search);
    return html(
      '<div style="font-size:26px;margin-bottom:6px">🔐</div>' +
      '<h2 style="margin:0 0 10px;font-size:1.25rem">需要先登录小蓝页</h2>' +
      '<p style="color:#5c4d3f;margin:0 0 20px"><b>' + esc(client.name) + '</b> 想使用你的小蓝页账户登录。' +
      '请先在小蓝页完成登录，然后回来点「我已登录，继续」。</p>' +
      '<p style="margin:0 0 10px"><a href="' + IDP_HOME + '" target="_blank" rel="noopener" ' +
      'style="display:block;text-align:center;padding:11px 16px;background:#5f7d5a;color:#fff;' +
      'border-radius:10px;text-decoration:none;font-weight:600">去小蓝页登录 ↗</a></p>' +
      '<p style="margin:0"><a href="' + self + '" ' +
      'style="display:block;text-align:center;padding:11px 16px;background:#fffdf9;color:#3a2f26;' +
      'border:1px solid #d8c9b3;border-radius:10px;text-decoration:none">我已登录，继续</a></p>',
      200
    );
  }

  // 一次性授权码：只在服务端换 token 时被消费，120 秒过期
  const code = randomToken(32);
  try {
    await context.env.USER_PREFS.put(
      'sso:code:' + code,
      JSON.stringify({ sub: String(acct.id), clientId, ts: Date.now() }),
      { expirationTtl: 120 }
    );
  } catch (e) {
    return html('<h2 style="margin:0 0 10px">签发授权码失败</h2><p>请稍后重试。</p>', 500);
  }

  const sep = redirectUri.indexOf('?') >= 0 ? '&' : '?';
  return Response.redirect(
    redirectUri + sep + 'code=' + encodeURIComponent(code) + '&state=' + encodeURIComponent(state),
    302
  );
}

// 供 /api/sso/token 复用的管理员判定（导出避免重复实现）
export async function ssoIsAdmin(context, login) {
  try { return await isAdminLogin(context, login); } catch (e) { return false; }
}
