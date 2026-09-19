// Cloudflare Pages Function: /api/engage
// 互动数据（点赞 / 收藏 / 关注）的统一总览与修复入口 —— 仅管理员。
//
// GET                  -> { ok, totals:{post,files,like,fav,flw}, posts:[{id,title,login,ts,like,fav,flw,status}], orphans:{count,ids} }
// POST { action:'rebuild' } -> { ok, rebuilt, posts }   按权威用户列表重建全部计数快照
// POST { action:'prune' }   -> { ok, pruned:[id,...] }  清理已删帖遗留的孤儿互动快照
//
// 计数快照 engage:<postId> 是展示的唯一权威来源；本端点用于查看总量、
// 一键重建（数据自愈）与清理孤儿，让互动数据有一个「专门的地方」可管。
import { getCookie, isAdminLogin, OWNER, json } from '../_lib/auth.js';
import { safeJSON, readCounts, rebuildCounts, engageKey } from '../_lib/engage.js';

async function requireAdmin(context) {
  const login = getCookie(context.request, 'gh_user');
  if (!login) return { error: json({ error: 'unauthorized' }, 401) };
  const isAdmin = login === OWNER || (await isAdminLogin(context, login));
  if (!isAdmin) return { error: json({ error: 'forbidden' }, 403) };
  return { login };
}

async function readPosts(kv) {
  const list = safeJSON(await kv.get('posts:list'), []);
  return Array.isArray(list) ? list.filter((p) => p && p.id) : [];
}

export async function onRequestGet(context) {
  const gate = await requireAdmin(context);
  if (gate.error) return gate.error;
  const kv = context.env.USER_PREFS;

  const posts = await readPosts(kv);
  const rows = [];
  const totals = { post: posts.length, files: 0, like: 0, fav: 0, flw: 0 };
  for (const p of posts) {
    const c = await readCounts(kv, p.id);
    rows.push({
      id: p.id,
      title: p.title || '（无标题）',
      login: p.login || '',
      ts: p.ts || 0,
      status: p.status || 'published',
      like: c.like,
      fav: c.fav,
      flw: c.flw,
    });
    totals.like += c.like;
    totals.fav += c.fav;
    totals.flw += c.flw;
    totals.files += Array.isArray(p.files) ? p.files.length : 0;
  }

  // 孤儿快照：engage:<id> 存在但帖子已不在 posts:list
  let orphanIds = [];
  try {
    const listed = await kv.list({ prefix: 'engage:' });
    const live = new Set(posts.map((p) => p.id));
    orphanIds = (listed.keys || [])
      .map((k) => String(k.name || '').replace(/^engage:/, ''))
      .filter((id) => id && !live.has(id));
  } catch (e) { /* list 不可用时忽略 */ }

  return json({ ok: true, totals, posts: rows, orphans: { count: orphanIds.length, ids: orphanIds.slice(0, 200) } });
}

export async function onRequestPost(context) {
  const gate = await requireAdmin(context);
  if (gate.error) return gate.error;
  const kv = context.env.USER_PREFS;
  const body = await context.request.json().catch(() => ({}));
  const action = String(body.action || 'rebuild');

  if (action === 'prune') {
    const posts = await readPosts(kv);
    const live = new Set(posts.map((p) => p.id));
    let ids = Array.isArray(body.ids) ? body.ids.map(String) : null;
    if (!ids) {
      try {
        const listed = await kv.list({ prefix: 'engage:' });
        ids = (listed.keys || [])
          .map((k) => String(k.name || '').replace(/^engage:/, ''))
          .filter((id) => id && !live.has(id));
      } catch (e) { ids = []; }
    }
    const pruned = [];
    for (const id of ids) {
      if (!id || live.has(id)) continue;
      try { await kv.delete(engageKey(id)); pruned.push(id); } catch (e) { /* 跳过 */ }
    }
    return json({ ok: true, pruned });
  }

  // 默认 rebuild：按权威用户列表重建全部快照（自愈）
  const posts = await readPosts(kv);
  let rebuilt = 0;
  const rows = [];
  for (const p of posts) {
    const c = await rebuildCounts(kv, p.id);
    rebuilt++;
    rows.push({ id: p.id, title: p.title || '（无标题）', like: c.like, fav: c.fav, flw: c.flw });
  }
  return json({ ok: true, rebuilt, posts: rows });
}

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
