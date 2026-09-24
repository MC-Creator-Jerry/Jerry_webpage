// Cloudflare Pages Function: /api/callback
// GitHub OAuth redirect target. Exchanges ?code for a token (using server-side
// GITHUB_CLIENT_SECRET), then sets httpOnly cookies and redirects home.
import { fetchAndCacheAvatar } from '../_lib/avatar.js';
import { linkGithub } from '../_lib/account.js';

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

    // 取 GitHub 主验证邮箱（用于与邮箱账户自动合并；邮箱可能为空=用户设为私有）
    let ghEmail = null;
    try {
      const em = await fetch('https://api.github.com/user/emails', {
        headers: { Authorization: 'Bearer ' + data.access_token, 'User-Agent': 'jerry-webpage' },
      });
      if (em.ok) {
        const arr = await em.json();
        if (Array.isArray(arr)) {
          const primary = arr.find((e) => e.primary && e.verified) || arr.find((e) => e.verified);
          if (primary && primary.email) ghEmail = String(primary.email).toLowerCase();
        }
      }
    } catch (e) { /* 邮箱取不到不影响 GitHub 登录 */ }

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
      await context.env.USER_PREFS.put('ghprofile:id:' + u.id, JSON.stringify(profile), { expirationTtl: 2592000 }); // 30 天：登录名↔id 映射应长期有效，10 分钟会频繁失效
      await context.env.USER_PREFS.put('ghprofile:login:' + u.login, JSON.stringify({ id: u.id }), { expirationTtl: 2592000 });
    } catch (e) {}

    // 合并到统一账户：以「已验证邮箱」为 canonical key；无邮箱则按 gh_id 关联。
    // 这样同一邮箱的 GitHub 登录与邮箱登录会落到同一账户（合并账号功能）。
    try {
      const acct = await linkGithub(context.env.USER_PREFS, ghEmail, u.id, u.login);
      if (u.avatar_url && !acct.avatar_url) {
        acct.avatar_url = u.avatar_url;
        await context.env.USER_PREFS.put('acct:' + acct.id, JSON.stringify(acct));
      }
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
