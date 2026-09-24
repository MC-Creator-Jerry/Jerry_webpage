// 邮箱账户体系共享库（USER_PREFS KV）。
// 设计要点：
//  - 以「已验证邮箱」为 canonical key（acct:email:<email> → acct:<id>）。
//  - GitHub 身份另存 acct:gh:<gh_id> → acct:<id>，回调时按邮箱自动合并到同一账户。
//  - 会话用 opaque cookie xl_sid（HttpOnly+Secure+SameSite=Lax），服务端校验，
//    规避既有 gh_user 可被 JS 伪造的隐患（P0-1）。GitHub 路径保留不动。
import { getCookie } from './auth.js';

// —— 基础工具 ——
export async function sha256hex(str) {
  const data = new TextEncoder().encode(String(str));
  const buf = await crypto.subtle.digest('SHA-256', data);
  const arr = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, '0');
  return s;
}

export function genCode() {
  const a = new Uint8Array(6);
  (globalThis.crypto || crypto).getRandomValues(a);
  let s = '';
  for (let i = 0; i < 6; i++) s += String(a[i] % 10);
  return s;
}

function newId() {
  return (globalThis.crypto || crypto).randomUUID();
}

// —— 账户读写 ——
export function newAccountByEmail(email) {
  const local = String(email.split('@')[0] || 'user');
  return {
    id: newId(),
    email: email.toLowerCase(),
    email_verified: true, // 注册即代表刚验证过验证码
    login: email.toLowerCase(),
    display_name: local,
    avatar_url: '',
    gh_id: null,
    gh_login: null,
    created_at: Date.now()
  };
}

export function newAccountByGithub(ghId, ghLogin, email) {
  return {
    id: newId(),
    email: email ? email.toLowerCase() : null,
    email_verified: !!email, // GitHub 主邮箱由 GitHub 验证过
    login: ghLogin,
    display_name: ghLogin,
    avatar_url: '',
    gh_id: ghId ? Number(ghId) : null,
    gh_login: ghLogin,
    created_at: Date.now()
  };
}

export async function putAcct(kv, acct) {
  try {
    await kv.put('acct:' + acct.id, JSON.stringify(acct));
    if (acct.email) await kv.put('acct:email:' + acct.email.toLowerCase(), acct.id);
    if (acct.gh_id) await kv.put('acct:gh:' + acct.gh_id, acct.id);
  } catch (e) { /* KV 写入失败不影响主流程，调用方决定 */ }
}

export async function getAcct(kv, id) {
  if (!id) return null;
  try { return await kv.get('acct:' + id, { type: 'json' }); } catch (e) { return null; }
}

export async function getOrCreateByEmail(kv, email) {
  const id = await kv.get('acct:email:' + email.toLowerCase());
  if (id) {
    const a = await getAcct(kv, id);
    if (a) return { acct: a, created: false };
  }
  const acct = newAccountByEmail(email);
  await putAcct(kv, acct);
  return { acct, created: true };
}

export async function getOrCreateGhAcct(kv, ghId, ghLogin) {
  if (ghId) {
    const id = await kv.get('acct:gh:' + ghId);
    if (id) { const a = await getAcct(kv, id); if (a) return a; }
  }
  const acct = newAccountByGithub(ghId, ghLogin, null);
  await putAcct(kv, acct);
  return acct;
}

// 只读窥探 GitHub 会话对应的账户（不创建），供 /api/account/status 使用
export async function peekGhAcct(kv, ghId, ghLogin) {
  if (ghId) {
    const id = await kv.get('acct:gh:' + ghId);
    if (id) { const a = await getAcct(kv, id); if (a) return a; }
  }
  return {
    id: null, login: ghLogin, gh_id: ghId ? Number(ghId) : null, gh_login: ghLogin,
    email: null, email_verified: false, display_name: ghLogin
  };
}

// GitHub 回调合并：邮箱优先，否则 gh_id；都不存在则新建
export async function linkGithub(kv, email, ghId, ghLogin) {
  let acct = null;
  if (email) {
    const id = await kv.get('acct:email:' + email.toLowerCase());
    if (id) acct = await getAcct(kv, id);
  }
  if (!acct && ghId) {
    const id = await kv.get('acct:gh:' + ghId);
    if (id) acct = await getAcct(kv, id);
  }
  if (!acct) {
    acct = newAccountByGithub(ghId, ghLogin, email);
  } else {
    acct.gh_id = ghId ? Number(ghId) : acct.gh_id;
    acct.gh_login = ghLogin;
    if (email && !acct.email) { acct.email = email.toLowerCase(); acct.email_verified = true; }
  }
  await putAcct(kv, acct);
  return acct;
}

// —— 会话 ——
export async function createSession(kv, acctId) {
  const sid = newId();
  await kv.put('sess:' + sid, acctId, { expirationTtl: 60 * 60 * 24 * 30 });
  return sid;
}

export function sessionCookie(sid, maxAge) {
  return `xl_sid=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function getSessionAcct(context) {
  const sid = getCookie(context.request, 'xl_sid');
  if (!sid) return null;
  const id = await context.env.USER_PREFS.get('sess:' + sid);
  if (!id) return null;
  return getAcct(context.env.USER_PREFS, id);
}

// 当前 GitHub 会话对应的账户（不存在则创建，供绑定流程使用）
export async function ghSessionAcct(context) {
  const uid = getCookie(context.request, 'gh_uid');
  const login = getCookie(context.request, 'gh_user');
  if (!uid && !login) return null;
  return getOrCreateGhAcct(context.env.USER_PREFS, uid, login);
}

// —— 对外档案（与 me.js gh 路径字段对齐：login/id/name/display_name/avatar_url/isAdmin）——
export function publicProfile(acct, isAdmin) {
  return {
    id: acct.id || null,
    login: acct.login,
    name: acct.display_name || acct.login,
    display_name: acct.display_name || acct.login,
    avatar_url: acct.avatar_url || '',
    isAdmin: !!isAdmin,
    provider: acct.gh_id ? 'github' : 'email',
    email: acct.email || null,
    email_verified: !!acct.email_verified,
    github_login: acct.gh_login || null
  };
}
