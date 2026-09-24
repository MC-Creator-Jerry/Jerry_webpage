// Cloudflare Pages Function: /api/search
// GET ?q=term -> { users:[{login,name,bio}] }
// 全站搜索：仅用户。（注：帖子/话题搜索随小蓝页帖子系统下线一并移除，2026-09-23）
import { json } from '../_lib/auth.js';

export async function onRequestGet(context) {
  const q = (new URL(context.request.url).searchParams.get('q') || '').trim();
  if (!q) return json({ users: [] });
  const kv = context.env.USER_PREFS;
  const low = q.toLowerCase();

  // ---- 用户 ----
  let idx = [];
  try {
    const raw = await kv.get('users:index');
    idx = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(idx)) idx = [];
  } catch (e) { idx = []; }
  const users = idx
    .filter((u) =>
      (u.login || '').toLowerCase().indexOf(low) !== -1 ||
      (u.name || '').toLowerCase().indexOf(low) !== -1 ||
      (u.bio || '').toLowerCase().indexOf(low) !== -1
    )
    .slice(0, 20)
    .map((u) => ({ login: u.login, name: u.name || u.login, bio: u.bio || '' }));

  return json({ users });
}
