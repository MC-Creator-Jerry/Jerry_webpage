// Cloudflare Pages Function: /api/callback
// GitHub OAuth redirect target. Exchanges ?code for a token (using server-side
// GITHUB_CLIENT_SECRET), then sets httpOnly cookies and redirects home.
import { fetchAndCacheAvatar } from '../_lib/avatar.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const code = url.searchParams.get('code');
  if (!code) return json({ error: 'missing_code' }, 400);

  const body = new URLSearchParams({
    client_id: context.env.GITHUB_CLIENT_ID,
    client_secret: context.env.GITHUB_CLIENT_SECRET,
    code: code,
    redirect_uri: url.origin + '/api/callback',
  });

  try {
    const r = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    });
    const data = await r.json();
    if (!data.access_token) return json({ error: 'exchange_failed' }, 400);

    // resolve login
    const gu = await fetch('https://api.github.com/user', {
      headers: { Authorization: 'Bearer ' + data.access_token, 'User-Agent': 'jerry-webpage' },
    });
    const u = await gu.json();

    const maxAge = 60 * 60 * 24 * 30;
    const resp = new Response(null, { status: 302, headers: { Location: url.origin + '/' } });
    resp.headers.append('Set-Cookie',
      `gh_token=${data.access_token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
    // gh_user 需要被 JS 读取（boot.js 加载动画显示用户名），故不加 HttpOnly；gh_token 必须保持 HttpOnly
    resp.headers.append('Set-Cookie',
      `gh_user=${encodeURIComponent(u.login)}; Path=/; Secure; SameSite=Lax; Max-Age=${maxAge}`);
    // user id 是公开且稳定的标识，用于头像兜底与改名自愈
    resp.headers.append('Set-Cookie',
      `gh_uid=${u.id}; Path=/; Secure; SameSite=Lax; Max-Age=${maxAge}`);
    // 同时把首次登录的资料写进 KV 别名，并把头像二进制缓存到云端，供后续无 token/改名后使用
    try {
      const cloudAvatar = await fetchAndCacheAvatar(context.env.USER_PREFS, u.avatar_url, u.login, u.id);
      const profile = { id: u.id, login: u.login, name: u.name || u.login, avatar_url: cloudAvatar || u.avatar_url };
      await context.env.USER_PREFS.put('ghprofile:id:' + u.id, JSON.stringify(profile), { expirationTtl: 600 });
      await context.env.USER_PREFS.put('ghprofile:login:' + u.login, JSON.stringify({ id: u.id }), { expirationTtl: 600 });
    } catch (e) {}
    return resp;
  } catch (e) {
    return json({ error: 'exchange_error' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
