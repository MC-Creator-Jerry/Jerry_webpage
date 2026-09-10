// Cloudflare Pages Function: /api/account/status
// GET -> { login, locked }  (requires login; reads account:locked:<login>)
import { getLogin, json } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const login = getLogin(context);
  if (!login) return json({ error: 'unauthorized' }, 401);
  const locked = !!(await context.env.USER_PREFS.get('account:locked:' + login));
  return json({ login, locked });
}
