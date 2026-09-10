// Cloudflare Pages Function: /api/search
// GET ?q=term -> { posts:[{id,login,title,ts}], users:[{login,name,bio}], topics:[{name,count}] }
// 全站搜索：标题/正文/话题/用户。草稿不计入。
import { json } from '../_lib/auth.js';
import { htmlToText } from '../_lib/sanitize.js';

export async function onRequestGet(context) {
  const q = (new URL(context.request.url).searchParams.get('q') || '').trim();
  if (!q) return json({ posts: [], users: [], topics: [] });
  const kv = context.env.USER_PREFS;
  const low = q.toLowerCase();

  // ---- 帖子（标题 + 正文纯文本）----
  let list = [];
  try {
    const raw = await kv.get('posts:list');
    list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
  } catch (e) { list = []; }
  const published = list.filter((p) => p && p.status !== 'draft');

  const posts = published
    .map((p) => ({
      id: p.id,
      login: p.login,
      title: p.title || '',
      body: typeof p.body === 'string' ? p.body : '',
      topics: Array.isArray(p.topics) ? p.topics : [],
    }))
    .filter((p) => {
      const text = (htmlToText(p.body) + ' ' + p.title).toLowerCase();
      return text.indexOf(low) !== -1 || p.topics.some((t) => String(t).toLowerCase().indexOf(low) !== -1);
    })
    .slice(0, 20)
    .map((p) => ({ id: p.id, login: p.login, title: p.title, ts: p.ts }));

  // ---- 话题 ----
  const topicCount = {};
  published.forEach((p) => {
    (p.topics || []).forEach((t) => {
      const tl = String(t).toLowerCase();
      if (tl.indexOf(low) !== -1) topicCount[tl] = (topicCount[tl] || 0) + 1;
    });
  });
  const topics = Object.keys(topicCount)
    .slice(0, 20)
    .map((t) => ({ name: t, count: topicCount[t] }));

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

  return json({ posts, users, topics });
}
