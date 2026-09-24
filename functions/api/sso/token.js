// SSO 身份提供方（小蓝页）· 换码端点
// POST /api/sso/token
//   body: { code, client_id }            或 form-encoded
//   认证: Authorization: Bearer <secret>   （或 body.client_secret）
//
// 密钥解析顺序（支持按客户端隔离密钥）：
//   1) env['SSO_SECRET_' + client_id 大写]   例：SSO_SECRET_PIANYU
//   2) env.SSO_CLIENT_SECRET                 （全局回退，茶馆等既有客户端走这里）
// 这样新接入的站点可以有自己的密钥，不必轮换既有站点的密钥。
//
// 成功: 200 { ok:true, sub, login, name, avatar_url, provider, isAdmin }
// 失败: 400/401 错误码，不泄露细节
//
// 安全要点：
//   - 授权码一次性（读到即删），120s 过期，且必须与签发时的 client_id 一致
//   - 共享密钥用常量时间比较，避免时序侧信道
//   - 此端点是服务端到服务端调用，身份通过 TLS + 共享密钥保证，不再额外签名
import { getAcct, publicProfile } from '../../_lib/account.js';
import { isAdminLogin, json } from '../../_lib/auth.js';

function timingSafeEqual(a, b) {
  const x = String(a == null ? '' : a);
  const y = String(b == null ? '' : b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function bad(msg, status) {
  return json({ error: msg }, status || 400);
}

// 按 client_id 取该客户端应使用的密钥
function secretFor(env, clientId) {
  const id = String(clientId || '').trim().toUpperCase();
  if (id && /^[A-Z0-9_]+$/.test(id)) {
    const scoped = env['SSO_SECRET_' + id];
    if (scoped) return scoped;
  }
  return env.SSO_CLIENT_SECRET;
}

export async function onRequestPost(context) {
  let body = {};
  try {
    const ct = context.request.headers.get('content-type') || '';
    if (ct.indexOf('application/json') >= 0) {
      body = await context.request.json();
    } else {
      const fd = await context.request.formData();
      body = { code: fd.get('code'), client_id: fd.get('client_id'), client_secret: fd.get('client_secret') };
    }
  } catch (e) {
    return bad('bad_request');
  }

  const code = String(body.code || '');
  const clientId = String(body.client_id || '');
  if (!code || !clientId) return bad('bad_request');

  const expected = secretFor(context.env || {}, clientId);
  if (!expected) {
    // 未配置密钥 → 拒绝一切请求（避免「没配就是人人可登」）
    return json({ error: 'not_configured' }, 500);
  }

  const auth = context.request.headers.get('authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const presented = bearer || body.client_secret || '';
  if (!timingSafeEqual(presented, expected)) {
    return json({ error: 'invalid_client' }, 401);
  }

  const kv = context.env.USER_PREFS;
  const key = 'sso:code:' + code;

  let raw = null;
  try { raw = await kv.get(key); } catch (e) { raw = null; }
  if (!raw) return bad('invalid_code');

  // 一次性：读到立刻删除（并发下第二次 get 会拿不到）
  try { await kv.delete(key); } catch (e) { /* 删除失败也不能放行第二次 */ }

  let payload = null;
  try { payload = JSON.parse(raw); } catch (e) { payload = null; }
  if (!payload || payload.clientId !== clientId) return bad('invalid_code');
  if (!payload.ts || Date.now() - payload.ts > 120000) return bad('expired_code');

  const acct = await getAcct(kv, payload.sub);
  if (!acct) return bad('invalid_code');

  let isAdmin = false;
  try { isAdmin = await isAdminLogin(context, acct.login); } catch (e) { isAdmin = false; }

  const p = publicProfile(acct, isAdmin);
  return json({
    ok: true,
    sub: p.id,
    login: p.login,
    name: p.name,
    avatar_url: p.avatar_url,
    provider: p.provider,
    isAdmin: p.isAdmin
  });
}

// 其它方法一律 405，避免被当成探测入口
export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ error: 'method_not_allowed' }, 405);
}
