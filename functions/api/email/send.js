// Cloudflare Pages Function: /api/email/send
// POST { email, intent: 'login'|'bind' } -> 发送 6 位验证码到用户邮箱。
// intent 仅影响邮件文案与 KV 键命名，不影响是否允许注册（登录意图下未知邮箱将在 verify 时注册）。
import { sendMail } from '../../_lib/mailer.js';
import { sha256hex, genCode } from '../../_lib/account.js';
import { rateLimit } from '../../_lib/rate.js';
import { json } from '../../_lib/auth.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TTL = 600; // 验证码有效期 10 分钟

export async function onRequestPost(context) {
  const env = context.env;
  let body;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }

  const email = String(body.email || '').trim().toLowerCase();
  const intent = body.intent === 'bind' ? 'bind' : 'login';
  if (!EMAIL_RE.test(email)) return json({ error: 'bad_email' }, 400);

  // 全局限流：每邮箱每 10 分钟最多 5 次
  const rl = await rateLimit(env.USER_PREFS, 'email_send', email, { limit: 5, windowSec: 600 });
  if (!rl.ok) return json({ ok: false, error: 'too_many', retryAfter: rl.retryAfter }, 429);

  // 单次重发冷却 60 秒（避免狂点刷邮件）
  const key = 'emailcode:' + (await sha256hex(email + '|' + intent));
  const existing = await env.USER_PREFS.get(key, { type: 'json' });
  if (existing && existing.sentAt && Date.now() - existing.sentAt < 60000) {
    const wait = Math.ceil((60000 - (Date.now() - existing.sentAt)) / 1000);
    return json({ ok: false, error: 'too_frequent', retryAfter: wait }, 429);
  }

  const code = genCode();
  await env.USER_PREFS.put(key, JSON.stringify({ code, expires: Date.now() + TTL * 1000, sentAt: Date.now() }), { expirationTtl: TTL + 10 });

  const subject = intent === 'bind' ? '绑定邮箱验证码 · Jerry\'s webpage' : '登录/注册验证码 · Jerry\'s webpage';
  const text =
    '你的验证码是 ' + code + '（10 分钟内有效）。\n' +
    (intent === 'bind' ? '你正在绑定该邮箱到已有账户。' : '用此邮箱登录或注册 Jerry\'s webpage。') +
    '\n若非本人操作，请忽略本邮件。\n\nJerry\'s webpage';
  const r = await sendMail(env, { to: email, subject, text });
  if (!r.ok) return json({ ok: false, error: r.error || 'send_failed' }, 200);

  return json({ ok: true });
}
