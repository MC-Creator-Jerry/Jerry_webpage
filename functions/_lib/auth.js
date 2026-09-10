// 鉴权辅助：读 gh_user cookie、判定管理员。
// 管理员 = 站主（OWNER）或 KV 中 admin:list 列出的账号。
export const OWNER = 'MC-Creator-Jerry';

export function getCookie(req, name) {
  const h = req.headers.get('cookie');
  if (!h) return null;
  const m = h
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

export function getLogin(context) {
  return getCookie(context.request, 'gh_user');
}

export async function isAdminLogin(context, login) {
  if (!login) return false;
  if (login === OWNER) return true;
  try {
    const raw = await context.env.USER_PREFS.get('admin:list');
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.includes(login)) return true;
    }
  } catch (e) {
    // 忽略解析错误，回退到仅站主
  }
  return false;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
