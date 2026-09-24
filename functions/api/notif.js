// Cloudflare Pages Function: /api/notif
// GET -> { system:[...], messages:[...], comments:[...], unread:{system,message,comment}, total }
//        system  : 广播系统通知 (notices:list)
//        messages: 定向消息通知 (msg:<login>)
//        comments: 评论通知   (cnotif:<login>)
// 未登录时 system 仍返回（公开广播），messages/comments 为空，unread 全 0。
import { getLogin, json } from '../_lib/auth.js';
import { CNOTIF_SEEN, MSG_SEEN } from '../_lib/notif.js';

export async function onRequestGet(context) {
  const login = getLogin(context);
  const kv = context.env.USER_PREFS;

  const nRaw = await kv.get('notices:list');
  let system = nRaw ? JSON.parse(nRaw) : [];
  if (!Array.isArray(system)) system = [];
  system = system.slice().sort((a, b) => b.ts - a.ts);
  const now = Date.now();
  system = system.filter((n) => !n.expireAt || n.expireAt > now);
  if (login) {
    const cRaw = await kv.get('notices:cleared:' + login);
    let cleared = cRaw ? JSON.parse(cRaw) : [];
    if (!Array.isArray(cleared)) cleared = [];
    const cset = new Set(cleared);
    system = system.filter((n) => !(n.id && cset.has(n.id)));
  }

  let messages = [];
  let comments = [];
  const unread = { system: 0, message: 0, comment: 0 };

  if (login) {
    const mRaw = await kv.get('msg:' + login);
    messages = mRaw ? JSON.parse(mRaw) : [];
    if (!Array.isArray(messages)) messages = [];
    messages = messages.filter((m) => !m.expireAt || m.expireAt > now);

    const cRaw = await kv.get('cnotif:' + login);
    comments = cRaw ? JSON.parse(cRaw) : [];
    if (!Array.isArray(comments)) comments = [];

    const sysSeen = Number(await kv.get('notices:seen:' + login) || 0);
    const msgSeen = Number(await kv.get(MSG_SEEN(login)) || 0);
    const cSeen = Number(await kv.get(CNOTIF_SEEN(login)) || 0);
    unread.system = system.filter((n) => n.ts > sysSeen).length;
    unread.message = messages.filter((n) => n.ts > msgSeen).length;
    unread.comment = comments.filter((n) => n.ts > cSeen).length;
  }

  const total = unread.system + unread.message + unread.comment;
  return json({ system, messages, comments, unread, total });
}
