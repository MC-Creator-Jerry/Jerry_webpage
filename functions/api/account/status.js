// Cloudflare Pages Function: /api/account/status
// GET -> 当前会话的绑定状态。
// 保留既有 { login, locked } 供设置页注销卡片使用，并补充邮箱/GitHub 绑定信息。
import { getSessionAcct, peekGhAcct } from '../../_lib/account.js';
import { getCookie, getLogin, OWNER, json } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const kv = context.env.USER_PREFS;

  // 邮箱会话优先（xl_sid）
  const acct = await getSessionAcct(context);
  if (acct) {
    const locked = !!(await kv.get('account:locked:' + acct.login));
    return json({
      login: acct.login,
      locked,
      provider: 'email',
      email: acct.email || null,
      email_verified: !!acct.email_verified,
      github_login: acct.gh_login || null,
      github_linked: !!acct.gh_id,
      isAdmin: acct.login === OWNER
    });
  }

  // GitHub 会话（gh_user）
  const login = getLogin(context);
  if (login) {
    const uid = getCookie(context.request, 'gh_uid');
    const gh = await peekGhAcct(kv, uid, login);
    const locked = !!(await kv.get('account:locked:' + login));
    return json({
      login,
      locked,
      provider: 'github',
      email: gh.email || null,
      email_verified: !!gh.email_verified,
      github_login: login,
      github_linked: !!gh.gh_id,
      isAdmin: login === OWNER
    });
  }

  return json({ error: 'unauthorized' }, 401);
}
