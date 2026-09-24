// Cloudflare Pages Function 邮件发送库：直连 SMTP（默认 163，465 隐式 TLS）发信，无第三方依赖。
// 依赖 Workers 运行时内置的 cloudflare:sockets（Pages Functions 同源可用）。
// 凭据一律从环境变量读取：SMTP_PASS（授权码，必填，用 Cloudflare 加密 Secret 存储）；
// 可选 SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_FROM / SMTP_FROM_NAME。
import { connect } from 'cloudflare:sockets';

function toB64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function wrap76(b64) {
  return b64.replace(/(.{76})/g, '$1\r\n');
}

// 发送一封纯文本邮件；返回 { ok, error? }。失败不 throw，交由调用方决定是否忽略。
export async function sendMail(env, { to, subject, text }) {
  const host = env.SMTP_HOST || 'smtp.163.com';
  const port = Number(env.SMTP_PORT || 465);
  const user = env.SMTP_USER || 'jerryprdservice@163.com';
  const pass = env.SMTP_PASS;
  const from = env.SMTP_FROM || user;
  const fromName = env.SMTP_FROM_NAME || 'Jerry';
  if (!pass) return { ok: false, error: 'not_configured' };
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, error: 'bad_recipient' };

  let socket;
  let writer;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buf = '';

  try {
    socket = connect({ hostname: host, port }, { secureTransport: 'on', allowHalfOpen: false });
    const reader = socket.readable.getReader();
    writer = socket.writable.getWriter();

    async function readResp() {
      // 累积直到出现“最终响应行”（3 位码 + 空格）
      for (let guard = 0; guard < 64; guard++) {
        if (/(?:^|\r\n)\d{3} [^\r\n]*\r\n$/.test(buf)) break;
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
      }
      const out = buf;
      buf = '';
      if (!out) throw new Error('smtp_no_response');
      return out;
    }
    async function cmd(line, expect) {
      await writer.write(enc.encode(line + '\r\n'));
      const r = await readResp();
      const code = r.slice(0, 3);
      if (expect && code !== expect) throw new Error('smtp_cmd_fail:' + line.split(' ')[0] + ':' + code);
      return r;
    }

    const greet = await readResp();
    if (greet.slice(0, 3) !== '220') throw new Error('smtp_greet:' + greet.slice(0, 3));
    await cmd('EHLO mc-creator-jerry-webpage.pages.dev', '250');
    await cmd('AUTH LOGIN', '334');
    await cmd(toB64Utf8(user), '334');
    await cmd(toB64Utf8(pass), '235');
    await cmd('MAIL FROM:<' + from + '>', '250');
    await cmd('RCPT TO:<' + to + '>', '250');
    await cmd('DATA', '354');

    const headers =
      'From: ' + fromName + ' <' + from + '>\r\n' +
      'To: <' + to + '>\r\n' +
      'Subject: =?UTF-8?B?' + toB64Utf8(subject) + '?=\r\n' +
      'MIME-Version: 1.0\r\n' +
      'Content-Type: text/plain; charset=UTF-8\r\n' +
      'Content-Transfer-Encoding: base64\r\n' +
      'Date: ' + new Date().toUTCString() + '\r\n';
    const body = wrap76(toB64Utf8(text));
    await writer.write(enc.encode(headers + '\r\n' + body + '\r\n.\r\n'));
    const done = await readResp();
    if (done.slice(0, 3) !== '250') throw new Error('smtp_data:' + done.slice(0, 3));

    try { await cmd('QUIT'); } catch (e) { /* ignore */ }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    try { if (writer) writer.releaseLock(); } catch (e) { /* ignore */ }
    try { if (socket) await socket.close(); } catch (e) { /* ignore */ }
  }
}
