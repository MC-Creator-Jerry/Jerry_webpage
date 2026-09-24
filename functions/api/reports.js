// Cloudflare Pages Function: /api/reports  (举报审核后台，仅管理员)
// GET            -> { reports:[{id,postId,reporter,postLogin,title,ts,reason,status}] }   (newest first)
// POST {id,action}  action: resolve | reopen | delete  -> { ok }
import { getLogin, isAdminLogin, json } from '../_lib/auth.js';

const KEY = 'reports:list';

async function readList(kv) {
  const raw = await kv.get(KEY);
  let list = raw ? JSON.parse(raw) : [];
  return Array.isArray(list) ? list : [];
}

export async function onRequestGet(context) {
  const login = getLogin(context);
  if (!login || !(await isAdminLogin(context, login))) return json({ error: 'forbidden' }, 403);
  const list = await readList(context.env.USER_PREFS);
  list.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return json({ reports: list });
}

export async function onRequestPost(context) {
  const login = getLogin(context);
  if (!login || !(await isAdminLogin(context, login))) return json({ error: 'forbidden' }, 403);
  const kv = context.env.USER_PREFS;
  const body = await context.request.json().catch(() => ({}));
  const id = String(body.id || '');
  const action = String(body.action || '');
  let list = await readList(kv);
  if (action === 'resolve') {
    list = list.map((r) => (r.id === id ? { ...r, status: 'resolved' } : r));
  } else if (action === 'reopen') {
    list = list.map((r) => (r.id === id ? { ...r, status: 'open' } : r));
  } else if (action === 'delete') {
    list = list.filter((r) => r.id !== id);
  } else {
    return json({ error: 'bad_request' }, 400);
  }
  await kv.put(KEY, JSON.stringify(list));
  return json({ ok: true });
}
