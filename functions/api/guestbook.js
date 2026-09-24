// Cloudflare Pages Function: /api/guestbook
// GET  -> { ok, list:[{id,name,message,ts}], count }   (公开列表，最新 50 条，新在前)
// POST { name?, message } -> { ok, record }            (公开留言；限速 + 违禁词过滤，无需登录)
// 复用 USER_PREFS KV 与 _lib/rate.js、_lib/forbidden.js、_lib/auth.js，不引入第三方服务。
import { rateLimit, clientKey } from '../_lib/rate.js';
import { scanTexts } from '../_lib/forbidden.js';
import { getLogin, json } from '../_lib/auth.js';
import { isBanned } from '../_lib/ban.js';

const KEY = 'guestbook:list';
const MAX_NAME = 40;
const MAX_MSG = 800;
const MAX_STORE = 200;   // KV 中最多保留的留言数（超出丢弃最旧）
const LIST_VIEW = 50;    // GET 对外返回的最新条数

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

async function readAll(kv) {
  try {
    const raw = await kv.get(KEY, { type: 'json' });
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

export async function onRequestGet(context) {
  const arr = await readAll(context.env.USER_PREFS);
  const list = arr.slice(-LIST_VIEW).reverse(); // 最新在前
  return json({ ok: true, list, count: arr.length });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // 限速：同一客户端每分钟最多 10 条公开留言
  const rl = await rateLimit(env.USER_PREFS, 'guestbook', clientKey(context), { limit: 10, windowSec: 60 });
  if (!rl.ok) return json({ ok: false, error: 'rate_limited', retryAfter: rl.retryAfter }, 429);

  // 封禁检查：已登录且处于小黑屋的用户禁止留言（时间以服务器为准）
  const login = getLogin(context);
  if (login) {
    const banned = await isBanned(context, login);
    if (banned) return json({ ok: false, error: 'banned', until: banned.until }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'bad_json' }, 400);
  }

  let name = String(body.name || '').trim();
  const message = String(body.message || '').trim();
  if (!message) return json({ ok: false, error: 'empty' }, 400);
  if (message.length > MAX_MSG) return json({ ok: false, error: 'too_long' }, 400);
  if (name.length > MAX_NAME) name = name.slice(0, MAX_NAME);
  if (!name) name = '匿名访客';

  // 违禁词过滤（后端权威扫描）
  const bad = scanTexts([name, message]);
  if (bad) return json({ ok: false, error: 'forbidden', word: bad }, 400);

  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const record = { id, name, message, ts: Date.now() };

  try {
    const arr = await readAll(env.USER_PREFS);
    arr.push(record);
    const trimmed = arr.length > MAX_STORE ? arr.slice(-MAX_STORE) : arr;
    await env.USER_PREFS.put(KEY, JSON.stringify(trimmed));
  } catch (e) {
    return json({ ok: false, error: 'storage_failed' }, 500);
  }

  return json({ ok: true, record });
}
