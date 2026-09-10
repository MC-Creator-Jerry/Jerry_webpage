// Cloudflare Pages Function: /api/me
// GET -> { login, name, avatar_url, isAdmin } if a session cookie exists.
//
// 关键修复：登录态以 gh_user cookie 为准，不再依赖每次都成功的 GitHub API 调用。
// 切换页面时若 GitHub 偶发限流/超时/5xx，只返回 degraded（仍视为已登录），
// 避免出现「切个页面就莫名登出」的问题。
import { getCookie, isAdminLogin, OWNER, json } from '../_lib/auth.js';
import { fetchAndCacheAvatar, getCachedAvatar } from '../_lib/avatar.js';

const PROFILE_TTL = 600; // 10 分钟：缓存 GitHub 资料，降低限流触发概率

export async function onRequestGet(context) {
  const login = getCookie(context.request, 'gh_user');
  if (!login) return json({ error: 'unauthorized' }, 401);

  const isAdmin = login === OWNER || (await isAdminLogin(context, login));

  // 资料缓存采用「user id 为主键，login 为别名」：即使 GitHub 账号改名，
  // 只要 token 成功刷新过一次，后续无 token 请求也能命中真实头像与新 login。
  async function readById(id) {
    try {
      const c = await context.env.USER_PREFS.get('ghprofile:id:' + id, { type: 'json' });
      if (c && c.avatar_url) return c;
    } catch (e) {}
    return null;
  }
  async function readByLogin(l) {
    try {
      const alias = await context.env.USER_PREFS.get('ghprofile:login:' + l, { type: 'json' });
      if (alias && alias.id) {
        const c = await readById(alias.id);
        if (c) return c;
      }
      // 兼容旧缓存（直接存 profile 的键）
      if (alias && alias.avatar_url) return alias;
    } catch (e) {}
    return null;
  }
  async function writeProfile(profile, oldLogin) {
    try {
      await context.env.USER_PREFS.put('ghprofile:id:' + profile.id, JSON.stringify(profile), { expirationTtl: PROFILE_TTL });
      await context.env.USER_PREFS.put('ghprofile:login:' + profile.login, JSON.stringify({ id: profile.id }), { expirationTtl: PROFILE_TTL });
      if (oldLogin && oldLogin !== profile.login) {
        await context.env.USER_PREFS.put('ghprofile:login:' + oldLogin, JSON.stringify({ id: profile.id }), { expirationTtl: PROFILE_TTL });
      }
    } catch (e) {}
  }

  const token = getCookie(context.request, 'gh_token');

  // 有 token：优先实时刷新；任何失败都回退到缓存，保证头像不缺失
  if (token) {
    try {
      const r = await fetch('https://api.github.com/user', {
        headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'jerry-webpage' },
      });
      if (r.ok) {
        const u = await r.json();
        const cloudAvatar = await fetchAndCacheAvatar(context.env.USER_PREFS, u.avatar_url, u.login, u.id);
        const profile = { id: u.id, login: u.login, name: u.name || u.login, avatar_url: cloudAvatar || u.avatar_url };
        await writeProfile(profile, login);
        try { await recordActiveLogin(context.env.USER_PREFS, u.login); } catch (e) {}
        return json({ id: u.id, login: profile.login, name: profile.name, avatar_url: profile.avatar_url, isAdmin });
      }
    } catch (e) { /* 继续走缓存回退 */ }
    const c = await readByLogin(login);
    if (c) {
      const cloudAvatar = c.id ? await getCachedAvatar(context.env.USER_PREFS, c.login || login, c.id) : null;
      try { await recordActiveLogin(context.env.USER_PREFS, c.login || login); } catch (e) {}
      return json({ id: c.id, login: c.login || login, name: c.name, avatar_url: cloudAvatar || c.avatar_url, isAdmin });
    }
    try { await recordActiveLogin(context.env.USER_PREFS, login); } catch (e) {}
    return json({ login, isAdmin, degraded: true });
  }

  // 无 token：用 login 别名找缓存；命中即可拿到改名后的真实 login/头像
  const c = await readByLogin(login);
  if (c) {
    const cloudAvatar = c.id ? await getCachedAvatar(context.env.USER_PREFS, c.login || login, c.id) : null;
    try { await recordActiveLogin(context.env.USER_PREFS, c.login || login); } catch (e) {}
    return json({ id: c.id, login: c.login || login, name: c.name, avatar_url: cloudAvatar || c.avatar_url, isAdmin });
  }
  try { await recordActiveLogin(context.env.USER_PREFS, login); } catch (e) {}
  return json({ login, isAdmin, degraded: true });
}

// 记录当日活跃登录：每个 UTC+8 自然日最多计 1 次，累计到 logins:<login>
async function recordActiveLogin(kv, login) {
  const now = new Date();
  const d = new Date(now.getTime() + 8 * 3600 * 1000); // 转 UTC+8
  const day = d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
  const dk = 'loginlog:' + login + ':' + day;
  const exists = await kv.get(dk);
  if (exists) return; // 今天已经记过
  await kv.put(dk, '1', { expirationTtl: 60 * 60 * 24 * 45 });
  const cur = parseInt(await kv.get('logins:' + login) || '0', 10) || 0;
  await kv.put('logins:' + login, String(cur + 1));
}
