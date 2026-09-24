// Cloudflare Pages Function: /api/sponsor-check
// GET /api/sponsor-check?login=<login>
//   认证: Authorization: Bearer <SSO_CLIENT_SECRET>
//
// 用途：茶馆（服务端到服务端）查询某用户的小蓝页赞助状态与「茶馆·发布功能升级」加成。
// 返回: { ok, login, sponsor, teahouse_plus }
//   sponsor       { tier, label, exp, since } | null   小蓝页主档位（互斥）
//   teahouse_plus { active, tier, label, exp, since } | null   茶馆加成（叠加）
//
// 安全：与 /api/sso/token 同款共享密钥 + 常量时间比较，服务端到服务端经 TLS 保证；
//       只返回该 login 的赞助事实，不含兑换码、不含任何他人数据。
import { json } from '../_lib/auth.js';
import { teahousePlusStatus } from '../_lib/sponsor.js';

function timingSafeEqual(a, b) {
  const x = String(a == null ? '' : a);
  const y = String(b == null ? '' : b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export async function onRequestGet(context) {
  const expected = context.env.SSO_CLIENT_SECRET;
  // 未配置密钥 → 拒绝一切请求（避免「没配就是人人可查」）
  if (!expected) return json({ error: 'not_configured' }, 500);

  const auth = context.request.headers.get('authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!timingSafeEqual(bearer, expected)) return json({ error: 'invalid_client' }, 401);

  const url = new URL(context.request.url);
  const login = String(url.searchParams.get('login') || '').trim();
  if (!login) return json({ error: 'bad_request' }, 400);

  const status = await teahousePlusStatus(context, login);
  return json(Object.assign({ ok: true }, status));
}

// 其它方法一律 405，避免被当成探测入口
export async function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  return json({ error: 'method_not_allowed' }, 405);
}
