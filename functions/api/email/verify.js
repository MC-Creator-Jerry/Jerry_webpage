// Cloudflare Pages Function: /api/email/verify
// POST { email, code } -> 校验验证码（一次性），建/取账户，置 xl_sid 会话，返回档案。
// 用于「邮箱登录/注册」：登录意图下未知邮箱将自动注册。
import { sha256hex, getOrCreateByEmail, createSession, sessionCookie, publicProfile } from '../../_lib/account.js';
import { OWNER, json } from '../../_lib/auth.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^\d{6}$/;

export async function onRequestPost(context) {
  const env = context.env;
  let body;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }

  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').trim();
  if (!EMAIL_RE.test(email)) return json({ error: 'bad_email' }, 400);
  if (!CODE_RE.test(code)) return json({ error: 'bad_code' }, 400);

  const key = 'emailcode:' + (await sha256hex(email + '|login'));
  const rec = await env.USER_PREFS.get(key, { type: 'json' });
  if (!rec || rec.expires < Date.now()) {
    try { await env.USER_PREFS.delete(key); } catch (e) {}
    return json({ error: 'expired' }, 400);
  }
  if (rec.code !== code) return json({ error: 'invalid_code' }, 400);
  // 一次性消费
  try { await env.USER_PREFS.delete(key); } catch (e) {}

  const { acct } = await getOrCreateByEmail(env.USER_PREFS, email);
  const isAdmin = acct.login === OWNER;
  const sid = await createSession(env.USER_PREFS, acct.id);

  const resp = json(publicProfile(acct, isAdmin));
  resp.headers.append('Set-Cookie', sessionCookie(sid, 60 * 60 * 24 * 30));
  return resp;
}
