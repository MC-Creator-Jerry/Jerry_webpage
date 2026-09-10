// Cloudflare Pages Function: /api/account/lock
// POST { lock: bool } -> { ok, locked }  (login required; sets/clears account:locked:<login>)
import { getLogin, json } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const login = getLogin(context);
  if (!login) return json({ error: 'unauthorized' }, 401);
  const body = await context.request.json().catch(() => ({}));
  const lock = !!body.lock;
  const kv = context.env.USER_PREFS;
  if (lock) await kv.put('account:locked:' + login, '1');
  else await kv.delete('account:locked:' + login);
  return json({ ok: true, locked: lock });
}
