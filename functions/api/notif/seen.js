// Cloudflare Pages Function: /api/notif/seen
// POST { type: 'system' | 'message' | 'comment' } -> { ok }
// 将当前登录用户的该分类通知标记为已读（记录时间戳）。
import { getLogin, json } from '../../_lib/auth.js';
import { CNOTIF_SEEN, MSG_SEEN } from '../../_lib/notif.js';

export async function onRequestPost(context) {
  const login = getLogin(context);
  if (!login) return json({ error: 'unauthorized' }, 401);
  const body = await context.request.json().catch(() => ({}));
  const type = body.type;
  const allowed = ['system', 'message', 'comment'];
  if (!allowed.includes(type)) return json({ error: 'bad_type' }, 400);

  const key =
    type === 'system' ? 'notices:seen:' + login :
    type === 'message' ? MSG_SEEN(login) :
    CNOTIF_SEEN(login);

  await context.env.USER_PREFS.put(key, String(Date.now()));
  return json({ ok: true });
}
