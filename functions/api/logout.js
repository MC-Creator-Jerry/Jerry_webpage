// Cloudflare Pages Function: /api/logout
// Clears the auth cookies.
export async function onRequestGet(context) {
  const resp = new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const expire = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
  resp.headers.append('Set-Cookie', `gh_token=; ${expire}`);
  // gh_user 设置时未加 HttpOnly，清除时属性需匹配才能确保被浏览器删除
  resp.headers.append('Set-Cookie', `gh_user=; Path=/; Secure; SameSite=Lax; Max-Age=0`);
  resp.headers.append('Set-Cookie', `gh_uid=; Path=/; Secure; SameSite=Lax; Max-Age=0`);

  // 清除邮箱会话 xl_sid（服务端删除会话记录 + 让浏览器过期 cookie）
  try {
    const h = (context.request && context.request.headers.get('cookie')) || '';
    const m = h.split(';').map((s) => s.trim()).find((s) => s.indexOf('xl_sid=') === 0);
    if (m) {
      const val = decodeURIComponent(m.slice('xl_sid='.length));
      if (val && context.env && context.env.USER_PREFS) await context.env.USER_PREFS.delete('sess:' + val);
    }
  } catch (e) { /* ignore */ }
  resp.headers.append('Set-Cookie', `xl_sid=; ${expire}`);

  return resp;
}
