// Cloudflare Pages Function: /api/notice/seen
// POST -> { ok }  (login required)  marks all current notices as seen for this user.
import { getLogin, json } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const login = getLogin(context);
  if (!login) return json({ error: 'unauthorized' }, 401);
  await context.env.USER_PREFS.put('notices:seen:' + login, String(Date.now()));
  return json({ ok: true });
}
