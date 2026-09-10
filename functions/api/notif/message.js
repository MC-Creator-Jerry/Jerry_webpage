// Cloudflare Pages Function: /api/notif/message
// POST { to, title, body } -> { ok }   (admin only)  发送定向「消息通知」给某用户
import { getLogin, isAdminLogin, json } from '../../_lib/auth.js';
import { scanTexts } from '../../_lib/forbidden.js';
import { pushMessage } from '../../_lib/notif.js';
import { sanitizeAttachments } from '../../_lib/attach.js';

// 暂时消息：30 天后自动失效（读取时由 GET /api/notif 过滤）
const TEMP_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function onRequestPost(context) {
  if (!(await isAdminLogin(context, getLogin(context)))) {
    return json({ error: 'forbidden' }, 403);
  }
  const body = await context.request.json().catch(() => ({}));
  const to = String(body.to || '').trim();
  const title = String(body.title || '').slice(0, 120);
  const text = String(body.body || '').slice(0, 2000);
  if (!to) return json({ error: 'missing_to' }, 400);
  if (!title.trim() && !text.trim()) return json({ error: 'empty' }, 400);
  const attachments = sanitizeAttachments(body.attachments, 9);
  const bad = scanTexts([title, text].concat(attachments.map((a) => a.url)));
  if (bad) return json({ error: 'forbidden', word: bad }, 400);

  const permanent = body.permanent !== false;
  const msg = {
    id: String(Date.now()) + '-' + to,
    ts: Date.now(),
    from: getLogin(context),
    title,
    body: text,
    permanent,
  };
  if (attachments.length) msg.attachments = attachments;
  if (!permanent) msg.expireAt = Date.now() + TEMP_TTL_MS;
  await pushMessage(context.env.USER_PREFS, to, msg);
  return json({ ok: true });
}
