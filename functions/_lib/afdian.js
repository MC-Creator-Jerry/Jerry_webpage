// 爱发电开放平台客户端（Webhook 验真 + 查订单 / 查赞助者）。
//
// 官方文档：https://guide.afdian.com/creator/developer
// 后台地址：https://afdian.com/dashboard/dev
//
// 签名规则：
//   sign = md5(token + "params" + params + "ts" + ts + "user_id" + user_id)
//   即 token 直接拼具体值，其余按 key/value 顺序直接拼接，中间没有任何连接字符。
//
// ⚠️ 关键安全事实：爱发电的 Webhook 推送【不带签名】——官方示例里请求体只有
// ec / em / data 三个字段，任何人都可以伪造一个「订单」POST 到我们的回调地址。
// 所以本模块的定位是「验真工具」：Webhook 只当作「有新订单了」的通知，
// 真正的判定一律用这里带签名的 query-order 去官方反查确认，伪造的订单查不到。
//
// 需要的环境变量（Cloudflare Pages，加密 Secret）：
//   AFDIAN_USER_ID  爱发电开发者后台的 user_id（非机密）
//   AFDIAN_TOKEN    爱发电开发者后台生成的 API Token（机密，绝不能进源码/对话）
import { md5Hex } from './md5.js';

const API_BASE = 'https://afdian.com/api/open';

export function afdianSign(token, userId, params, ts) {
  return md5Hex(token + 'params' + params + 'ts' + ts + 'user_id' + userId);
}

async function call(env, path, params) {
  const userId = env.AFDIAN_USER_ID;
  const token = env.AFDIAN_TOKEN;
  if (!userId || !token) return { ok: false, error: 'not_configured' };

  const p = JSON.stringify(params || {});
  const ts = Math.floor(Date.now() / 1000);
  const sign = afdianSign(token, userId, p, ts);

  const r = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: userId, params: p, ts, sign }),
  }).catch(() => null);
  if (!r) return { ok: false, error: 'network' };

  const j = await r.json().catch(() => null);
  if (!j) return { ok: false, error: 'bad_json' };
  if (j.ec !== 200) return { ok: false, error: 'ec_' + j.ec, em: j.em || '' };
  return { ok: true, data: j.data };
}

// 用订单号反查官方订单。这是 Webhook 验真的唯一依据。
export async function queryOrder(env, outTradeNo) {
  const r = await call(env, '/query-order', { out_trade_no: outTradeNo });
  if (!r.ok) return r;
  const list = (r.data && r.data.list) || [];
  const hit = list.find((o) => o && String(o.out_trade_no) === String(outTradeNo));
  return { ok: true, order: hit || null };
}

// 查赞助者名单（分页，每页 20）
export async function querySponsor(env, page) {
  const r = await call(env, '/query-sponsor', { page: parseInt(page, 10) || 1 });
  if (!r.ok) return r;
  return { ok: true, list: (r.data && r.data.list) || [], total: (r.data && r.data.total_count) || 0 };
}

// 自检：签名是否正确（官方 ping 接口）
export async function ping(env) {
  return call(env, '/ping', {});
}
