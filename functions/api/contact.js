// Cloudflare Pages Function: /api/contact
// POST { name, email, msg } -> 校验后置入 USER_PREFS KV（含速率限制），返回 { ok:true, id }
// GET  (仅管理员)          -> 返回最近留言索引列表 { ok:true, list }
//
// 复用现有 USER_PREFS KV 绑定与 _lib/rate.js、_lib/auth.js，不引入第三方服务。
import { rateLimit, clientKey } from '../_lib/rate.js';
import { getCookie, isAdminLogin, OWNER, json } from '../_lib/auth.js';

const TTL = 60 * 60 * 24 * 365; // 1 年
const MAX = { name: 60, email: 120, msg: 2000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // 速率限制：同一客户端每 10 分钟最多 5 条留言
  const rl = await rateLimit(env.USER_PREFS, 'contact', clientKey(context), { limit: 5, windowSec: 600 });
  if (!rl.ok) return json({ ok: false, error: 'rate_limited', retryAfter: rl.retryAfter }, 429);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'bad_json' }, 400);
  }

  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const msg = String(body.msg || '').trim();

  if (!name || !email || !msg) return json({ ok: false, error: 'missing_fields' }, 400);
  if (name.length > MAX.name || email.length > MAX.email || msg.length > MAX.msg) {
    return json({ ok: false, error: 'too_long' }, 400);
  }
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'bad_email' }, 400);

  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const record = { id, name, email, msg, ts: Date.now() };

  try {
    await env.USER_PREFS.put('contact:' + id, JSON.stringify(record), { expirationTtl: TTL });
    // 维护最近索引，便于管理员读取
    let idx = [];
    try {
      const raw = await env.USER_PREFS.get('contact:index', { type: 'json' });
      if (Array.isArray(raw)) idx = raw;
    } catch (e) { /* ignore */ }
    idx.unshift({ id, name, email, ts: record.ts });
    if (idx.length > 200) idx = idx.slice(0, 200);
    await env.USER_PREFS.put('contact:index', JSON.stringify(idx), { expirationTtl: TTL });
  } catch (e) {
    return json({ ok: false, error: 'storage_failed' }, 500);
  }

  return json({ ok: true, id });
}

export async function onRequestGet(context) {
  const { env } = context;
  const login = getCookie(context.request, 'gh_user');
  if (!login) return json({ error: 'unauthorized' }, 401);
  const isAdmin = login === OWNER || (await isAdminLogin(context, login));
  if (!isAdmin) return json({ error: 'forbidden' }, 403);

  let idx = [];
  try {
    const raw = await env.USER_PREFS.get('contact:index', { type: 'json' });
    if (Array.isArray(raw)) idx = raw;
  } catch (e) { /* ignore */ }

  return json({ ok: true, list: idx });
}
