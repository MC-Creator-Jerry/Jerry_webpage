// 头像云端缓存：把 GitHub 头像二进制拉取后转为 data URL 存 KV，
// 避免账号改名/GitHub URL 变化导致头像 404，同时减轻对 GitHub CDN 的依赖。
const GHAVATAR_TTL = 60 * 60 * 24 * 30; // 30 天

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// 从给定 URL 拉取头像并缓存；失败时返回 null，不抛异常
export async function fetchAndCacheAvatar(kv, avatarUrl, login, id) {
  const url = avatarUrl || (id ? `https://avatars.githubusercontent.com/u/${id}?v=4` : null);
  if (!url) return null;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'jerry-webpage' } });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || 'image/jpeg';
    if (!ct.startsWith('image/')) return null;
    const dataUrl = `data:${ct};base64,${bufToBase64(await r.arrayBuffer())}`;
    if (login) await kv.put(`ghavatar:login:${login}`, dataUrl, { expirationTtl: GHAVATAR_TTL });
    if (id) await kv.put(`ghavatar:id:${id}`, dataUrl, { expirationTtl: GHAVATAR_TTL });
    return dataUrl;
  } catch (e) {
    return null;
  }
}

// 读取已缓存的云端头像；支持通过 id 或 login 查找，login 会尝试走 ghprofile 别名解析 id
export async function getCachedAvatar(kv, login, id) {
  try {
    if (id) {
      const byId = await kv.get(`ghavatar:id:${id}`);
      if (byId) return byId;
    }
    if (login) {
      const byLogin = await kv.get(`ghavatar:login:${login}`);
      if (byLogin) return byLogin;
      const alias = await kv.get(`ghprofile:login:${login}`, { type: 'json' });
      if (alias && alias.id) {
        const byId = await kv.get(`ghavatar:id:${alias.id}`);
        if (byId) return byId;
      }
    }
  } catch (e) {}
  return null;
}
