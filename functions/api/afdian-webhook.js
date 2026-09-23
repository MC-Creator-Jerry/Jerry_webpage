// Cloudflare Pages Function: /api/afdian-webhook
// 爱发电「订单推送」的回调地址（填进 https://afdian.com/dashboard/dev 的通知地址）。
//
// ⚠️ 安全前提（务必看懂再改）：
// 爱发电的 Webhook 推送【不带签名】——官方文档的示例请求体里只有 ec / em / data，
// 没有任何签名字段。也就是说**任何人都可以伪造一个「订单」POST 到这个地址**。
// 所以这里的流程刻意只信一件事：
//   1. 从 Webhook 里只取 out_trade_no（订单号）这一个值，其余字段一律不信；
//   2. 用【带签名的】官方 query-order 接口去反查这笔订单；
//   3. 官方确认存在、且 status === 2（交易成功），才发放权益。
// 伪造的订单号在官方那边查不到，自然被挡掉。
//
// 响应必须返回 {"ec":200,"em":""}，否则平台认为回调失败会重试。
// 官方文档明确提示可能重复推送，所以用 out_trade_no 做幂等。
//
// 订单里的 user_id 是爱发电的用户 ID，不是站内登录名，所以我们靠 remark（订单留言）
// 找站内账号；找不到就挂起到待认领列表，由管理员在 /admin/sponsors/ 手动绑定。
import { json, getCookie, isAdminLogin, OWNER } from '../_lib/auth.js';
import { queryOrder } from '../_lib/afdian.js';
import {
  isOrderProcessed, markOrderProcessed, grantSponsor, grantTeahousePlus,
  addPending, listPending, tierFromAmount,
} from '../_lib/sponsor.js';

const OK = { ec: 200, em: '' };

// 从订单留言里找站内登录名：
//   1) 形如 "@MC-Creator-Jerry" 优先；
//   2) 整条留言就是一个合法用户名（无空格、无中文）也算。
function extractLogin(remark) {
  const s = String(remark == null ? '' : remark).trim();
  if (!s) return '';
  const m = s.match(/@([A-Za-z0-9][A-Za-z0-9-]{1,38})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9][A-Za-z0-9-]{1,38}$/.test(s)) return s;
  return '';
}

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => null);
  const order = (body && body.data && body.data.order) || null;
  const no = order && String(order.out_trade_no || '').trim();
  if (!no) return json({ ec: 400, em: 'no out_trade_no' }, 200);

  // 幂等：同一订单只处理一次
  if (await isOrderProcessed(context, no)) return json(OK);

  const hasCreds = !!(context.env.AFDIAN_USER_ID && context.env.AFDIAN_TOKEN);

  // 没配凭据：无法验真，一律挂起等管理员确认，绝不放行
  if (!hasCreds) {
    await addPending(context, Object.assign({}, order, {
      out_trade_no: no,
      remark: String(order.remark || '') + ' [未配置 AFDIAN_TOKEN，未验真]',
    }));
    return json(OK);
  }

  // 反查验真（这是唯一可信的判定依据）
  const q = await queryOrder(context.env, no);
  if (!q.ok || !q.order) {
    await addPending(context, Object.assign({}, order, {
      out_trade_no: no,
      remark: String(order.remark || '') + ' [官方反查未确认]',
    }));
    return json(OK);
  }

  const o = q.order;
  if (String(o.status) !== '2') return json(OK); // 非「交易成功」不处理

  const tier = tierFromAmount(o.total_amount || o.show_amount);
  if (!tier) { // 金额低于最低档 = 纯打赏，不解锁权益，但记账避免重复处理
    await markOrderProcessed(context, no, '', o.month || 1, 'tip');
    return json(OK);
  }

  const months = Math.max(1, parseInt(o.month, 10) || 1);
  const login = extractLogin(o.remark);
  if (login) {
    // 茶馆·发布功能升级是叠加型权益 → 走独立记录，不能覆盖主档位
    if (tier === 'teahouse_plus') {
      await grantTeahousePlus(context, login, months, o.out_trade_no);
    } else {
      await grantSponsor(context, login, tier, months, o.out_trade_no);
    }
    await markOrderProcessed(context, no, login, months, tier);
  } else {
    // 留言里没写站内用户名 → 挂起，等管理员手动绑定
    await addPending(context, o);
  }
  return json(OK);
}

// GET：自检用（仅管理员）。看凭据配好没、有没有待认领订单。
export async function onRequestGet(context) {
  const login = getCookie(context.request, 'gh_user');
  if (!login) return json({ error: 'unauthorized' }, 401);
  const isAdmin = login === OWNER || (await isAdminLogin(context, login));
  if (!isAdmin) return json({ error: 'forbidden' }, 403);

  const pending = await listPending(context);
  return json({
    ok: true,
    configured: {
      user_id: !!context.env.AFDIAN_USER_ID,
      token: !!context.env.AFDIAN_TOKEN,
    },
    pending: { count: pending.length, list: pending.slice(0, 50) },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}
