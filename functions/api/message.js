// Cloudflare Pages Function: /api/message  (用户间私信)
// GET            -> { conversations:[{peer,last,ts,unread}] }   (登录用户的会话列表)
// GET ?with=<l>  -> { peer, messages:[{id,from,to,body,ts,read}] }   (与某人的会话；自动标记已读)
// POST {to,body} -> { ok, message }   (发送；会推送一条“消息”通知给收件人)
// Storage (KV USER_PREFS):
//   msg:<id>        -> 单条私信 {id,from,to,body,ts,read}
//   inbox:<login>   -> [message,...]   该用户的所有私信（收发都在内，按 ts 升序）
//   消息通知同时写入 msg:<login>（通知系统“消息”分类，复用既有红点）
import { getLogin, isAdminLogin, json } from '../_lib/auth.js';
import { pushMessage } from '../_lib/notif.js';
import { rateLimit } from '../_lib/rate.js';

const msgKey = (id) => 'msg:' + id;
const inboxKey = (login) => 'inbox:' + login;
const MAX = 200;
const BODY_MAX = 2000;

async function readArr(kv, key) {
  const raw = await kv.get(key);
  const a = raw ? JSON.parse(raw) : [];
  return Array.isArray(a) ? a : [];
}

export async function onRequestGet(context) {
  const login = getLogin(context);
  if (!login) return json({ error: 'unauthorized' }, 401);
  const kv = context.env.USER_PREFS;
  const url = new URL(context.request.url);
  const withLogin = (url.searchParams.get('with') || '').trim();
  const inbox = await readArr(kv, inboxKey(login));

  if (withLogin) {
    const msgs = inbox
      .filter((m) => (m.from === withLogin && m.to === login) || (m.to === withLogin && m.from === login))
      .sort((a, b) => a.ts - b.ts);
    let changed = false;
    const updated = inbox.map((m) => {
      if (m.to === login && !m.read && ((m.from === withLogin && m.to === login) || (m.to === withLogin && m.from === login))) {
        changed = true;
        return { ...m, read: true };
      }
      return m;
    });
    if (changed) await kv.put(inboxKey(login), JSON.stringify(updated));
    return json({ peer: withLogin, messages: msgs });
  }

  // 会话列表：按对端聚合
  const peers = {};
  inbox.forEach((m) => {
    const peer = m.from === login ? m.to : m.from;
    if (!peers[peer]) peers[peer] = { peer, last: m.body, ts: m.ts, unread: 0 };
    if (m.ts > peers[peer].ts) { peers[peer].ts = m.ts; peers[peer].last = m.body; }
    if (m.to === login && !m.read) peers[peer].unread += 1;
  });
  const list = Object.values(peers).sort((a, b) => b.ts - a.ts);
  return json({ conversations: list });
}

export async function onRequestPost(context) {
  const login = getLogin(context);
  if (!login) return json({ error: 'unauthorized' }, 401);
  const rl = await rateLimit(context.env.USER_PREFS, 'dm', login, { limit: 30, windowSec: 60 });
  if (!rl.ok) return json({ error: 'rate_limited', retryAfter: rl.retryAfter }, 429);

  const kv = context.env.USER_PREFS;
  const body = await context.request.json().catch(() => ({}));
  const to = String(body.to || '').trim();
  const text = String(body.body || '').slice(0, BODY_MAX).trim();
  if (!to || !text) return json({ error: 'bad_request' }, 400);
  if (to === login) return json({ error: 'cannot_self' }, 400);

  // 收件人须是已知用户
  const idx = await readArr(kv, 'users:index');
  if (!idx.some((u) => u.login === to)) return json({ error: 'no_recipient' }, 404);

  const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const msg = { id, from: login, to, body: text, ts: Date.now(), read: false };
  await kv.put(msgKey(id), JSON.stringify(msg));

  const myIn = await readArr(kv, inboxKey(login));
  myIn.push(msg); if (myIn.length > MAX) myIn.length = MAX;
  await kv.put(inboxKey(login), JSON.stringify(myIn));
  const peerIn = await readArr(kv, inboxKey(to));
  peerIn.push(msg); if (peerIn.length > MAX) peerIn.length = MAX;
  await kv.put(inboxKey(to), JSON.stringify(peerIn));

  // 推送“消息”通知（复用既有通知红点）
  try {
    await pushMessage(kv, to, { from: login, title: '新私信', body: text.slice(0, 80), ts: Date.now(), kind: 'dm' });
  } catch (e) { /* 不影响私信发送 */ }

  return json({ ok: true, message: msg });
}
