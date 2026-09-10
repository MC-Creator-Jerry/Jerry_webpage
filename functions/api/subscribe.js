// Cloudflare Pages Function: /api/subscribe
// POST { email }             -> 订阅（写入 KV subscribers 数组，去重）
// GET  ?unsub=<email>        -> 取消订阅（返回确认页）
// 说明：当前免费额度无邮件发送能力，订阅为「收集邮箱 + RSS 源」双轨；
//       邮件群发需后续接入邮件服务，此处先落地订阅名单与 RSS 源。
import { json } from '../_lib/auth.js';
import { rateLimit } from '../_lib/rate.js';

const SUB_KEY = 'subscribers';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function readSubs(kv) {
  const raw = await kv.get(SUB_KEY);
  let arr = raw ? JSON.parse(raw) : [];
  return Array.isArray(arr) ? arr : [];
}

export async function onRequestPost(context) {
  const kv = context.env.USER_PREFS;
  const body = await context.request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: 'bad_email' }, 400);

  const rl = await rateLimit(kv, 'sub', email, { limit: 5, windowSec: 3600 });
  if (!rl.ok) return json({ error: 'rate_limited', retryAfter: rl.retryAfter }, 429);

  const arr = await readSubs(kv);
  if (arr.includes(email)) return json({ ok: true, already: true, count: arr.length });
  arr.push(email);
  await kv.put(SUB_KEY, JSON.stringify(arr));
  return json({ ok: true, count: arr.length });
}

export async function onRequestGet(context) {
  const kv = context.env.USER_PREFS;
  const url = new URL(context.request.url);
  const email = (url.searchParams.get('unsub') || '').trim().toLowerCase();
  if (!email) return json({ error: 'missing_email' }, 400);
  const arr = await readSubs(kv);
  const next = arr.filter((e) => e !== email);
  await kv.put(SUB_KEY, JSON.stringify(next));
  const safe = email.replace(/[<>&]/g, '');
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>已取消订阅</title>' +
    '<body style="font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;text-align:center;color:#1c2733">' +
    '<h2 style="color:#0078d4">已取消订阅</h2>' +
    '<p>邮箱 <b>' + safe + '</b> 已从订阅列表移除。</p>' +
    '<p><a href="/" style="color:#0078d4">返回主页</a></p></body>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
