// /api/group
// GET  (no id) -> { groups:[{id,name,desc,owner,ts,memberCount}] }           (discovery list, newest first)
// GET  ?id=<id> -> { group, isMember, isOwner, members:[login] }
// POST { action, ... }  (login required)
//   create { name, desc } -> { ok, id }            (creator becomes owner+member)
//   join   { id }        -> { ok, isMember:true }
//   leave  { id }        -> { ok, isMember:false, deleted? }
//   remove { id, user }  -> owner only; remove a member (transfer owner if needed)
//   delete { id }        -> owner only
// KV: group:<id>  = { id, name, desc, owner, members:[login], ts }
//     groups:index = [{ id, name, desc, owner, ts }]   (discovery list)
import { getLogin, isAdminLogin, json, OWNER } from '../_lib/auth.js';
import { scanTexts } from '../_lib/forbidden.js';
import { rateLimit } from '../_lib/rate.js';

const gKey = (id) => 'group:' + id;
const INDEX = 'groups:index';

function genId() { return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

async function readIndex(kv) { const raw = await kv.get(INDEX); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : []; }
async function writeIndex(kv, list) { await kv.put(INDEX, JSON.stringify(list)); }
async function readGroup(kv, id) {
  const raw = await kv.get(gKey(id));
  if (!raw) return null;
  try { const g = JSON.parse(raw); return g && g.id ? g : null; } catch (e) { return null; }
}
function publicGroup(g) { return { id: g.id, name: g.name, desc: g.desc || '', owner: g.owner, ts: g.ts, memberCount: (g.members || []).length }; }

export async function onRequestGet(context) {
  const kv = context.env.USER_PREFS;
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');
  const login = getLogin(context);
  if (id) {
    const g = await readGroup(kv, id);
    if (!g) return json({ error: 'not_found' }, 404);
    const members = (g.members || []).slice();
    return json({
      group: publicGroup(g),
      isMember: login ? members.includes(login) : false,
      isOwner: login ? (g.owner === login || (await isAdminLogin(context, login))) : false,
      members
    });
  }
  const idx = await readIndex(kv);
  const groups = idx.map(publicGroup).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
  return json({ groups });
}

export async function onRequestPost(context) {
  const login = getLogin(context);
  if (!login) return json({ error: 'unauthorized' }, 401);
  const rl = await rateLimit(context.env.USER_PREFS, 'group', login, { limit: 30, windowSec: 60 });
  if (!rl.ok) return json({ error: 'rate_limited', retryAfter: rl.retryAfter }, 429);

  const kv = context.env.USER_PREFS;
  const body = await context.request.json().catch(() => ({}));
  const action = String(body.action || '');

  if (action === 'create') {
    const name = String(body.name || '').slice(0, 60).trim();
    const desc = String(body.desc || '').slice(0, 280).trim();
    if (!name) return json({ error: 'empty_name' }, 400);
    const bad = scanTexts([name, desc]);
    if (bad) return json({ error: 'forbidden', word: bad }, 400);
    const id = genId();
    const g = { id, name, desc, owner: login, members: [login], ts: Date.now() };
    await kv.put(gKey(id), JSON.stringify(g));
    const idx = await readIndex(kv);
    idx.unshift(publicGroup(g));
    await writeIndex(kv, idx);
    return json({ ok: true, id });
  }

  const id = String(body.id || '');
  if (!id) return json({ error: 'missing_id' }, 400);
  const g = await readGroup(kv, id);
  if (!g) return json({ error: 'not_found' }, 404);
  const members = g.members || [];
  const isOwner = g.owner === login || (await isAdminLogin(context, login));

  if (action === 'join') {
    if (!members.includes(login)) { members.push(login); g.members = members; await kv.put(gKey(id), JSON.stringify(g)); await syncIndex(kv, g); }
    return json({ ok: true, isMember: true });
  }
  if (action === 'leave') {
    if (isOwner && members.length > 1) {
      const next = members.find(function (m) { return m !== login; });
      if (next) g.owner = next;
    }
    const i = members.indexOf(login);
    if (i !== -1) members.splice(i, 1);
    g.members = members;
    if (members.length === 0) { await kv.delete(gKey(id)); await removeIndex(kv, id); return json({ ok: true, isMember: false, deleted: true }); }
    await kv.put(gKey(id), JSON.stringify(g));
    await syncIndex(kv, g);
    return json({ ok: true, isMember: false });
  }
  if (action === 'remove') {
    if (!isOwner) return json({ error: 'forbidden' }, 403);
    const user = String(body.user || '');
    if (!user || !members.includes(user)) return json({ error: 'no_member' }, 400);
    const i = members.indexOf(user);
    if (i !== -1) members.splice(i, 1);
    g.members = members;
    if (members.length === 0) { await kv.delete(gKey(id)); await removeIndex(kv, id); return json({ ok: true, deleted: true }); }
    if (g.owner === user && members.length) g.owner = members[0];
    await kv.put(gKey(id), JSON.stringify(g));
    await syncIndex(kv, g);
    return json({ ok: true });
  }
  if (action === 'delete') {
    if (!isOwner) return json({ error: 'forbidden' }, 403);
    await kv.delete(gKey(id));
    await removeIndex(kv, id);
    return json({ ok: true });
  }
  return json({ error: 'bad_action' }, 400);
}

async function syncIndex(kv, g) {
  const idx = await readIndex(kv);
  const i = idx.findIndex(function (x) { return x.id === g.id; });
  if (i !== -1) { idx[i] = publicGroup(g); await writeIndex(kv, idx); }
}
async function removeIndex(kv, id) {
  const idx = await readIndex(kv);
  const next = idx.filter(function (x) { return x.id !== id; });
  await writeIndex(kv, next);
}
