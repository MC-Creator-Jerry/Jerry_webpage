// Cloudflare Pages Function: /api/logout
// Clears the auth cookies.
export async function onRequestGet() {
  const resp = new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const expire = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
  resp.headers.append('Set-Cookie', `gh_token=; ${expire}`);
  // gh_user 设置时未加 HttpOnly，清除时属性需匹配才能确保被浏览器删除
  resp.headers.append('Set-Cookie', `gh_user=; Path=/; Secure; SameSite=Lax; Max-Age=0`);
  resp.headers.append('Set-Cookie', `gh_uid=; Path=/; Secure; SameSite=Lax; Max-Age=0`);
  return resp;
}
