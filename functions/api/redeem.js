// Cloudflare Pages Function: /api/redeem
// 赞助兑换码的兑换入口。
//
// GET  -> { ok, sponsor }   当前登录用户的赞助状态（未登录 401）
// POST { code } -> { ok, reason, sponsor }  兑换/顺延
//
// reason 取值与前端文案对应：
//   new        首次兑换成功
//   extended   已有赞助，本次为续期顺延
//   already    同一条码本人已兑过（不重复加时长，幂等）
//   notfound   码不存在（或已被管理员作废）
//   used       码已被别人使用
//   format     码格式不对
//
// 说明：爱发电的付款人身份与站内账号没有天然关联，本接口就是那个「绑定」动作——
// 用户把从爱发电收到的一次性码贴进来，我们才知道该给谁开权限。
import { getLogin, json } from '../_lib/auth.js';
import { isBanned } from '../_lib/ban.js';
import { rateLimit, clientKey } from '../_lib/rate.js';
import { redeemCode, readSponsor, publicSponsor } from '../_lib/sponsor.js';

export async function onRequestGet(context) {
  const login = getLogin(context);
  if (!login) return json({ error: 'unauthorized' }, 401);
  const rec = await readSponsor(context, login);
  return json({ ok: true, sponsor: publicSponsor(rec) });
}

export async function onRequestPost(context) {
  const login = getLogin(context);
  if (!login) return json({ ok: false, error: 'unauthorized' }, 401);

  // 限速：同一客户端每分钟最多 10 次，防止有人拿脚本撞码
  const rl = await rateLimit(context.env.USER_PREFS, 'redeem', clientKey(context), { limit: 10, windowSec: 60 });
  if (!rl.ok) return json({ ok: false, error: 'rate_limited', retryAfter: rl.retryAfter }, 429);

  // 封禁检查：小黑屋用户不能兑换（时间以服务器为准）
  const banned = await isBanned(context, login);
  if (banned) return json({ ok: false, error: 'banned', until: banned.until }, 403);

  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ ok: false, error: 'bad_json' }, 400);
  }

  const r = await redeemCode(context, body && body.code, login);
  if (!r.ok) {
    const status = r.reason === 'format' ? 400 : r.reason === 'error' ? 500 : 200;
    return json({ ok: false, error: r.reason, sponsor: r.sponsor || null }, status);
  }
  return json({ ok: true, reason: r.reason, sponsor: r.sponsor });
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
