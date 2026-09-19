// Cloudflare Pages Function: /api/ban  (小黑屋·违规用户封禁，仅管理员)
// GET            -> { ok, bans:[{login,reason,bannedAt,until}], serverNow }   (serverNow 用于前端以「网上时间」显示剩余时长)
// POST {login, action?, reason?, durationMs?}
//      action 缺省=ban：封禁 login，durationMs 为时长（毫秒，服务器时间推算 until；单次上限 365 天）
//      action=unban：手动解除
// 时间一律使用服务器 Date.now()，到期自动解除（读/写时由 _lib/ban.js 清理）。
import { getLogin, isAdminLogin, json } from '../_lib/auth.js';
import { listBans, banUser, unbanUser } from '../_lib/ban.js';

const OWNER = 'MC-Creator-Jerry';
const DAY = 86400 * 1000;

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

export async function onRequestGet(context) {
  const login = getLogin(context);
  if (!login || !(await isAdminLogin(context, login))) return json({ error: 'forbidden' }, 403);
  const bans = await listBans(context);
  return json({ ok: true, bans, serverNow: Date.now() });
}

export async function onRequestPost(context) {
  const login = getLogin(context);
  if (!login || !(await isAdminLogin(context, login))) return json({ error: 'forbidden' }, 403);

  const body = await context.request.json().catch(() => ({}));
  const target = String(body.login || '').trim();
  if (!target) return json({ error: 'bad_request' }, 400);
  // 兜底：禁止封禁站主自身
  if (target === OWNER) return json({ error: 'cannot_ban_owner' }, 400);

  const action = String(body.action || 'ban');
  if (action === 'unban') {
    await unbanUser(context, target);
    return json({ ok: true });
  }

  const durationMs = Number(body.durationMs) || 0;
  if (!durationMs || durationMs <= 0) return json({ error: 'bad_duration' }, 400);
  const dur = Math.min(durationMs, 365 * DAY); // 单次封禁上限 365 天
  const reason = String(body.reason || '').slice(0, 500).trim();
  await banUser(context, target, reason, dur);
  return json({ ok: true });
}
