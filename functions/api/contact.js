// Cloudflare Pages Function: /api/contact
// POST { name, email, msg, category?, page? } -> 校验后置入 USER_PREFS KV（含速率限制），
//      并邮件通知站长 + 自动回复访客；返回 { ok:true, id, category, notify, autoReply }
// GET    (仅管理员)          -> 返回最近反馈完整列表 { ok:true, list }
// DELETE ?id=<id> (仅管理员) -> 删除某条反馈 { ok:true }
//
// 复用现有 USER_PREFS KV 绑定与 _lib/rate.js、_lib/auth.js、_lib/mailer.js。
import { rateLimit, clientKey } from '../_lib/rate.js';
import { getCookie, isAdminLogin, OWNER, json } from '../_lib/auth.js';
import { sendMail } from '../_lib/mailer.js';

const TTL = 60 * 60 * 24 * 365; // 1 年
const MAX = { name: 60, email: 120, msg: 2000, page: 200 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CATEGORIES = ['建议', 'Bug', '功能', '其他'];
const INDEX_MAX = 200;

// 自动回复文案（中英双语）。来源邮箱凭据走环境变量 SMTP_PASS，不落库不落码。
const AUTO_REPLY_SUBJECT = 'Jerry 已收到您的来信 / Thanks for your message';
const AUTO_REPLY_TEXT =
  '您好，感谢您的来信！\n\n' +
  '这是 Jerry 的自动回复。您的邮件我已经收到，会尽快亲自回复您。\n\n' +
  '如果想先了解我在做的项目，欢迎访问我的主页 / 小蓝页工具箱：\n' +
  'https://mc-creator-jerry-webpage.pages.dev\n\n' +
  '再次感谢您的关注与支持！\n—— Jerry\n\n' +
  '----------------------------------------\n\n' +
  'Hi, thanks for reaching out! This is Jerry\'s auto-reply.\n' +
  'I have received your message and will get back to you personally soon.\n\n' +
  'Meanwhile, feel free to check out my homepage / toolbox:\n' +
  'https://mc-creator-jerry-webpage.pages.dev\n\n' +
  'Best,\nJerry\n';

// 把正文压成一行并截断，用于邮件主题摘要
function clip(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, GET, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}

async function readIndex(env) {
  try {
    const raw = await env.USER_PREFS.get('contact:index', { type: 'json' });
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

// 管理员门禁：返回 { error: Response } 或 { login }
async function requireAdmin(context) {
  const login = getCookie(context.request, 'gh_user');
  if (!login) return { error: json({ error: 'unauthorized' }, 401) };
  const isAdmin = login === OWNER || (await isAdminLogin(context, login));
  if (!isAdmin) return { error: json({ error: 'forbidden' }, 403) };
  return { login };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // 速率限制：同一客户端每 10 分钟最多 5 条留言
  const rl = await rateLimit(env.USER_PREFS, 'contact', clientKey(context), { limit: 5, windowSec: 600 });
  if (!rl.ok) return json({ ok: false, error: 'rate_limited', retryAfter: rl.retryAfter }, 429);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'bad_json' }, 400);
  }

  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const msg = String(body.msg || '').trim();
  const catRaw = String(body.category || '').trim();
  const category = CATEGORIES.includes(catRaw) ? catRaw : '其他';
  const page = String(body.page || '').trim().slice(0, MAX.page);

  if (!name || !email || !msg) return json({ ok: false, error: 'missing_fields' }, 400);
  if (name.length > MAX.name || email.length > MAX.email || msg.length > MAX.msg) {
    return json({ ok: false, error: 'too_long' }, 400);
  }
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'bad_email' }, 400);

  // 访客 IP（Cloudflare 边缘注入，取首个）
  const ip = (request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '')
    .split(',')[0]
    .trim();

  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const record = { id, name, email, category, page, ip, ts: Date.now(), msg };

  try {
    await env.USER_PREFS.put('contact:' + id, JSON.stringify(record), { expirationTtl: TTL });
    // 维护最近索引（存完整记录，管理页直接读取）
    let idx = await readIndex(env);
    idx.unshift(record);
    if (idx.length > INDEX_MAX) idx = idx.slice(0, INDEX_MAX);
    await env.USER_PREFS.put('contact:index', JSON.stringify(idx), { expirationTtl: TTL });
  } catch (e) {
    return json({ ok: false, error: 'storage_failed' }, 500);
  }

  // 邮件通知（未配置 SMTP_PASS 时全部自动跳过，不影响留言入库）：
  //   ① 把反馈转发给站长（默认反馈邮箱），让站长「看得到反馈」；
  //   ② 给提交者发一封自动回复确认信。
  let autoReply = 'skipped';
  let notify = 'skipped';
  if (env.SMTP_PASS) {
    const toOwner = env.CONTACT_TO || env.SMTP_USER || 'jerryprdservice@163.com';
    const ownerTask = sendMail(env, {
      to: toOwner,
      subject: '【小蓝页·' + category + '】' + name + '：' + clip(msg, 24),
      text:
        '分类：' + category + '\n' +
        '姓名：' + name + '\n' +
        '邮箱：' + email + '\n' +
        '来源页面：' + (page || '（未知）') + '\n' +
        'IP：' + (ip || '（未知）') + '\n' +
        '时间：' + new Date(record.ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + '\n\n' +
        '内容：\n' + msg + '\n',
    }).then(function (r) { notify = r.ok ? 'sent' : 'failed'; })
      .catch(function () { notify = 'failed'; });
    const visitorTask = sendMail(env, {
      to: email,
      subject: AUTO_REPLY_SUBJECT,
      text: AUTO_REPLY_TEXT,
    }).then(function (r) { autoReply = r.ok ? 'sent' : 'failed'; })
      .catch(function () { autoReply = 'failed'; });
    const both = Promise.all([ownerTask, visitorTask]);
    if (typeof context.waitUntil === 'function') context.waitUntil(both);
    await both; // 等待结果，便于前端/运维观测（失败不影响已入库的留言）
  }

  return json({ ok: true, id, category, notify, autoReply });
}

export async function onRequestGet(context) {
  const gate = await requireAdmin(context);
  if (gate.error) return gate.error;
  const list = await readIndex(context.env);
  return json({ ok: true, list });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const gate = await requireAdmin(context);
  if (gate.error) return gate.error;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ ok: false, error: 'missing_id' }, 400);

  try {
    await env.USER_PREFS.delete('contact:' + id);
    let idx = await readIndex(env);
    idx = idx.filter(function (r) { return r && r.id !== id; });
    await env.USER_PREFS.put('contact:index', JSON.stringify(idx), { expirationTtl: TTL });
  } catch (e) {
    return json({ ok: false, error: 'delete_failed' }, 500);
  }
  return json({ ok: true });
}
