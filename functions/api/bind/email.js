// Cloudflare Pages Function: /api/bind/email
// POST { email, code } -> 已登录状态下绑定/验证邮箱到当前账户（合并）。
// 当前会话可为邮箱会话或 GitHub 会话；绑定后两身份并入同一账户。
import { sha256hex, getSessionAcct, ghSessionAcct, getOrCreateByEmail, putAcct, createSession, sessionCookie, publicProfile } from '../../_lib/account.js';
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

  // 需要已登录
  const cur = (await getSessionAcct(context)) || (await ghSessionAcct(context));
  if (!cur) return json({ error: 'not_logged_in' }, 401);

  const key = 'emailcode:' + (await sha256hex(email + '|bind'));
  const rec = await env.USER_PREFS.get(key, { type: 'json' });
  if (!rec || rec.expires < Date.now()) {
    try { await env.USER_PREFS.delete(key); } catch (e) {}
    return json({ error: 'expired' }, 400);
  }
  if (rec.code !== code) return json({ error: 'invalid_code' }, 400);
  try { await env.USER_PREFS.delete(key); } catch (e) {}

  const target = await getOrCreateByEmail(env.USER_PREFS, email);

  if (target.acct.id !== cur.id) {
    // 合并：把目标账户的可补充字段并入当前账户，键统一指向当前账户
    if (!cur.gh_id && target.acct.gh_id) { cur.gh_id = target.acct.gh_id; cur.gh_login = target.acct.gh_login; }
    if (!cur.email) { cur.email = target.acct.email; cur.email_verified = target.acct.email_verified; }
  }
  cur.email = email;
  cur.email_verified = true;
  await putAcct(env.USER_PREFS, cur);

  // 刷新会话（GitHub 会话也补上 xl_sid，统一身份入口）
  const sid = await createSession(env.USER_PREFS, cur.id);
  const resp = json(publicProfile(cur, cur.login === OWNER));
  resp.headers.append('Set-Cookie', sessionCookie(sid, 60 * 60 * 24 * 30));
  return resp;
}
