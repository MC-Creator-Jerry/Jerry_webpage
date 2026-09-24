// Cloudflare Pages Function: /api/bg
// GET  ?user=login -> { banner, bg }  (public; null if unset)
//   banner = 超长背景（主页顶部长条），bg = 大背景（正文下方）
// POST { user, banner, bg } -> { ok, banner, bg }  (login required; owner or admin only)
//   每个字段：undefined = 保持不变；'' = 清除；其余须为 data:image/... 或 http(s):// 链接（≤10MB）
// Storage: KV "banner:<login>" / "bg:<login>"
import { getLogin, isAdminLogin, json } from '../_lib/auth.js';

const MAX = 10000000; // ~10MB 字符上限（base64 后约 7.5MB 原图）

function validateImage(value) {
  if (typeof value !== 'string') return undefined; // 未提供
  const v = value.trim();
  if (v === '') return ''; // 清除
  if (v.startsWith('data:image/')) return v.length <= MAX ? v : null; // 过大
  if (/^https?:\/\//i.test(v)) return v;
  return null; // 非法
}

async function read(kv, login, field) {
  const raw = await kv.get(field + ':' + login);
  return raw || null;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const user = url.searchParams.get('user');
  if (!user) return json({ error: 'missing_user' }, 400);
  const kv = context.env.USER_PREFS;
  const banner = await read(kv, user, 'banner');
  const bg = await read(kv, user, 'bg');
  return json({ banner: banner || null, bg: bg || null });
}

export async function onRequestPost(context) {
  const login = getLogin(context);
  if (!login) return json({ error: 'unauthorized' }, 401);
  const body = await context.request.json().catch(() => ({}));
  const user = String(body.user || '');
  if (!user) return json({ error: 'missing_user' }, 400);
  const admin = await isAdminLogin(context, login);
  if (user !== login && !admin) return json({ error: 'forbidden' }, 403);

  const kv = context.env.USER_PREFS;
  let banner = await read(kv, user, 'banner');
  let bg = await read(kv, user, 'bg');

  if (Object.prototype.hasOwnProperty.call(body, 'banner')) {
    const val = validateImage(body.banner);
    if (val === null) return json({ error: 'invalid_banner' }, 400);
    if (val === '') { await kv.delete('banner:' + user); banner = null; }
    else { await kv.put('banner:' + user, val); banner = val; }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'bg')) {
    const val = validateImage(body.bg);
    if (val === null) return json({ error: 'invalid_bg' }, 400);
    if (val === '') { await kv.delete('bg:' + user); bg = null; }
    else { await kv.put('bg:' + user, val); bg = val; }
  }

  return json({ ok: true, banner: banner || null, bg: bg || null });
}
