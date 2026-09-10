// Cloudflare Pages Function: /api/notice
// GET           -> { notices:[{id,ts,title,body}], unread }  (public list; unread only if logged in)
// POST {title,body} -> { ok }  (admin only; forbidden scan)        publish a notice
// DELETE ?id=   -> { ok }  (admin only)                           remove a notice
// Storage: KV "notices:list" (array) + per-user "notices:seen:<login>"
import { getLogin, isAdminLogin, json } from '../_lib/auth.js';
import { scanTexts } from '../_lib/forbidden.js';
import { sanitizeAttachments } from '../_lib/attach.js';

// 暂时消息：30 天后自动失效（GET 时过滤掉已过期）
const TEMP_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function onRequestGet(context) {
  const kv = context.env.USER_PREFS;
  const raw = await kv.get('notices:list');
  let list = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(list)) list = [];
  list = list.slice().sort((a, b) => b.ts - a.ts);
  const now = Date.now();
  list = list.filter((n) => !n.expireAt || n.expireAt > now);

  const login = getLogin(context);
  let unread = 0;
  if (login) {
    const seenRaw = await kv.get('notices:seen:' + login);
    const seen = seenRaw ? Number(seenRaw) : 0;
    unread = list.filter((n) => n.ts > seen).length;
  }
  return json({ notices: list, unread });
}

export async function onRequestPost(context) {
  if (!(await isAdminLogin(context, getLogin(context)))) {
    return json({ error: 'forbidden' }, 403);
  }
  const body = await context.request.json().catch(() => ({}));
  const title = String(body.title || '').slice(0, 120);
  const text = String(body.body || '').slice(0, 2000);
  if (!title.trim() && !text.trim()) return json({ error: 'empty' }, 400);
  const attachments = sanitizeAttachments(body.attachments, 9);
  const bad = scanTexts([title, text].concat(attachments.map((a) => a.url)));
  if (bad) return json({ error: 'forbidden', word: bad }, 400);

  const kv = context.env.USER_PREFS;
  const raw = await kv.get('notices:list');
  let list = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(list)) list = [];
  const permanent = body.permanent !== false;
  const item = { id: String(Date.now()), ts: Date.now(), title, body: text, permanent };
  if (attachments.length) item.attachments = attachments;
  if (!permanent) item.expireAt = Date.now() + TEMP_TTL_MS;
  list.push(item);
  await kv.put('notices:list', JSON.stringify(list));
  return json({ ok: true });
}

export async function onRequestDelete(context) {
  if (!(await isAdminLogin(context, getLogin(context)))) {
    return json({ error: 'forbidden' }, 403);
  }
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');
  const kv = context.env.USER_PREFS;
  const raw = await kv.get('notices:list');
  let list = raw ? JSON.parse(raw) : [];
  if (Array.isArray(list)) list = list.filter((n) => n.id !== id);
  await kv.put('notices:list', JSON.stringify(list));
  return json({ ok: true });
}
