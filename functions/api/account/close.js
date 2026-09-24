// Cloudflare Pages Function: /api/account/close
// POST -> { ok }  (login required; deletes the caller's own account data, then clears auth cookies)
// Rejected with 403 if the account is marked non-cancelable (account:locked:<login>).
import { getLogin, json } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const login = getLogin(context);
  if (!login) return json({ error: 'unauthorized' }, 401);
  const kv = context.env.USER_PREFS;

  // 已设为不可注销则拒绝
  if (await kv.get('account:locked:' + login)) {
    return json({ error: 'account_locked', message: '该账户已设为不可注销' }, 403);
  }

  // 1) 资料 / 头像 / 云端设置 / 通知 / 背景
  await kv.delete('profile:' + login);
  await kv.delete('avatar:' + login);
  await kv.delete('ghavatar:login:' + login);
  await kv.delete('prefs:' + login);
  await kv.delete('banner:' + login);
  await kv.delete('bg:' + login);
  await kv.delete('cnotif:' + login);
  await kv.delete('cnotif:seen:' + login);
  await kv.delete('msg:' + login);
  await kv.delete('msg:seen:' + login);
  await kv.delete('notices:cleared:' + login);
  await kv.delete('account:locked:' + login);

  // 2) 从用户目录移除
  const idxRaw = await kv.get('users:index');
  let idx = idxRaw ? JSON.parse(idxRaw) : [];
  if (Array.isArray(idx)) {
    idx = idx.filter((u) => u.login !== login);
    await kv.put('users:index', JSON.stringify(idx));
  }

  // 3) 清除登录态（与 /api/logout 一致）
  const resp = json({ ok: true });
  const expire = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
  resp.headers.append('Set-Cookie', `gh_token=; ${expire}`);
  resp.headers.append('Set-Cookie', `gh_user=; Path=/; Secure; SameSite=Lax; Max-Age=0`);
  resp.headers.append('Set-Cookie', `gh_uid=; Path=/; Secure; SameSite=Lax; Max-Age=0`);
  return resp;
}
