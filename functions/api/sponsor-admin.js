// Cloudflare Pages Function: /api/sponsor-admin
// 赞助体系的唯一管理入口 —— 仅管理员。
//
// GET  -> { ok, totals, sponsors:[...], codes:[...], conflicts:[...] }
// POST { action:'gen',    count, tier } -> { ok, tier, count, codes:[...] }  生成一批一次性码
// POST { action:'void',   code }        -> { ok }                            作废未使用的码
// POST { action:'revoke', login }       -> { ok }                            撤销某人的赞助（退款/纠纷）
//
// 生成出来的码是明文，是唯一一次能看到的机会——直接贴进爱发电
// 「添加赞助奖励 → 自动随机回复」的输入框里即可。
import { getCookie, isAdminLogin, OWNER, json } from '../_lib/auth.js';
import { generateCodes, voidCode, revokeSponsor, revokeTeahousePlus, sponsorStats, TIERS } from '../_lib/sponsor.js';
import { listPending, claimPending } from '../_lib/sponsor.js';

async function requireAdmin(context) {
  const login = getCookie(context.request, 'gh_user');
  if (!login) return { error: json({ error: 'unauthorized' }, 401) };
  const isAdmin = login === OWNER || (await isAdminLogin(context, login));
  if (!isAdmin) return { error: json({ error: 'forbidden' }, 403) };
  return { login };
}

export async function onRequestGet(context) {
  const gate = await requireAdmin(context);
  if (gate.error) return gate.error;
  const data = await sponsorStats(context);
  const pending = await listPending(context);
  return json(Object.assign({ ok: true, tiers: TIERS, pending }, data));
}

export async function onRequestPost(context) {
  const gate = await requireAdmin(context);
  if (gate.error) return gate.error;

  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ ok: false, error: 'bad_json' }, 400);
  }
  const action = String((body && body.action) || '');

  if (action === 'gen') {
    const r = await generateCodes(context, body.count, body.tier);
    return json(Object.assign({ ok: true, action: 'gen' }, r));
  }

  if (action === 'void') {
    const r = await voidCode(context, body.code);
    return json(Object.assign({ ok: r.ok, action: 'void' }, r), r.ok ? 200 : 400);
  }

  // 把一笔「挂起订单」手动绑到站内账号（付款时没留用户名的那种）
  if (action === 'claim') {
    const login = String(body.login || '').trim();
    const no = String(body.out_trade_no || '').trim();
    if (!login || !no) return json({ ok: false, error: 'missing_params' }, 400);
    const r = await claimPending(context, no, login);
    return json(Object.assign({ ok: r.ok, action: 'claim' }, r), r.ok ? 200 : 400);
  }

  if (action === 'revoke') {
    const login = String(body.login || '').trim();
    if (!login) return json({ ok: false, error: 'missing_login' }, 400);
    await revokeSponsor(context, login);
    return json({ ok: true, action: 'revoke', login });
  }

  // 撤销「茶馆·发布功能升级」（叠加型权益，与主档位互不影响）
  if (action === 'revoke-thplus') {
    const login = String(body.login || '').trim();
    if (!login) return json({ ok: false, error: 'missing_login' }, 400);
    await revokeTeahousePlus(context, login);
    return json({ ok: true, action: 'revoke-thplus', login });
  }

  return json({ ok: false, error: 'unknown_action' }, 400);
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
