// Cloudflare Pages Function: /api/notif/clear
// POST { type: 'system'|'message'|'comment', action: 'read'|'clear' } -> { ok }
//   action 'read'  : 将该分类全部标记为已读（记录时间戳）
//   action 'clear' : 清除该分类全部通知
//       comment  -> 清空 cnotif:<login>
//       message  -> 清空 msg:<login>
//       system   -> 当前广播通知 id 全部加入 per-user 已清除集合 notices:cleared:<login>（并视为已读）
import { getLogin, json } from '../../_lib/auth.js';
import { CNOTIF_SEEN, MSG_SEEN } from '../../_lib/notif.js';

export async function onRequestPost(context) {
  const login = getLogin(context);
  if (!login) return json({ error: 'unauthorized' }, 401);
  const body = await context.request.json().catch(() => ({}));
  const { type, action } = body;
  if (!['system', 'message', 'comment'].includes(type)) return json({ error: 'bad_type' }, 400);
  if (!['read', 'clear'].includes(action)) return json({ error: 'bad_action' }, 400);

  const kv = context.env.USER_PREFS;

  if (action === 'read') {
    const key =
      type === 'system' ? 'notices:seen:' + login :
      type === 'message' ? MSG_SEEN(login) :
      CNOTIF_SEEN(login);
    await kv.put(key, String(Date.now()));
    return json({ ok: true });
  }

  // action === 'clear'
  if (type === 'comment') {
    await kv.put('cnotif:' + login, '[]');
  } else if (type === 'message') {
    await kv.put('msg:' + login, '[]');
  } else if (type === 'system') {
    const raw = await kv.get('notices:list');
    const list = raw ? JSON.parse(raw) : [];
    const ids = Array.isArray(list) ? list.map((n) => n.id).filter(Boolean) : [];
    const cRaw = await kv.get('notices:cleared:' + login);
    let cleared = cRaw ? JSON.parse(cRaw) : [];
    if (!Array.isArray(cleared)) cleared = [];
    const set = new Set(cleared);
    ids.forEach((id) => set.add(id));
    await kv.put('notices:cleared:' + login, JSON.stringify(Array.from(set)));
    await kv.put('notices:seen:' + login, String(Date.now()));
  }
  return json({ ok: true });
}
