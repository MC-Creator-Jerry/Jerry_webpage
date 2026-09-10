// Cloudflare Pages Function: /api/post-actions
// 帖子维度的用户操作：关注(follow) / 屏蔽(block) / 举报(report) / 点赞(like) / 收藏(fav)
// GET  ?post=<id>            -> { login, post, followed, blocked, reported, liked, likeCount, faved, favCount }
// GET  ?posts=id1,id2,...    -> { states: { [id]: {...} } }
// GET  ?favs=1               -> { favs:[postId,...] }   (login required)
// POST { post, action, reason? }
//      action: follow|unfollow|block|unblock|report|like|unlike|fav|unfav
//      -> { ok, followed, blocked, reported, liked, likeCount, faved, favCount }
// Storage (KV USER_PREFS):
//   followers:post:<id>  -> [login,...]        关注该帖的用户
//   follow:<login>       -> [postId,...]       该用户关注的帖子
//   block:<login>        -> [postId,...]       该用户屏蔽的帖子
//   reports:post:<id>    -> [{reporter,ts,reason},...]
//   reports:list         -> [{id,postId,reporter,postLogin,title,ts,reason,status}]  (审核后台)
//   likes:post:<id>      -> [login,...]        点赞该帖的用户
//   fav:<login>          -> [postId,...]       该用户收藏的帖子
//   favcount:<id>        -> "N"               帖子的收藏计数
import { getLogin, isAdminLogin, json, OWNER } from '../_lib/auth.js';
import { pushMessage } from '../_lib/notif.js';
import { rateLimit } from '../_lib/rate.js';

const followersKey = (id) => 'followers:post:' + id;
const followKey = (login) => 'follow:' + login;
const blockKey = (login) => 'block:' + login;
const reportKey = (id) => 'reports:post:' + id;
const likesKey = (id) => 'likes:post:' + id;
const favKey = (login) => 'fav:' + login;
const favCountKey = (id) => 'favcount:' + id;
const reportsListKey = 'reports:list';

async function readArr(kv, key) {
  const raw = await kv.get(key);
  const a = raw ? JSON.parse(raw) : [];
  return Array.isArray(a) ? a : [];
}
async function writeArr(kv, key, arr) { await kv.put(key, JSON.stringify(arr)); }
async function readNum(kv, key) {
  const raw = await kv.get(key);
  const n = raw ? parseInt(raw, 10) : 0;
  return isNaN(n) ? 0 : n;
}

async function postExists(kv, postId) {
  const raw = await kv.get('posts:list');
  const list = raw ? JSON.parse(raw) : [];
  return Array.isArray(list) ? list.find((p) => p.id === postId) : null;
}

export async function onRequestGet(context) {
  const login = getLogin(context);
  const kv = context.env.USER_PREFS;
  const url = new URL(context.request.url);
  const multi = url.searchParams.get('posts');

  // 我的收藏列表
  if (url.searchParams.get('favs')) {
    if (!login) return json({ error: 'unauthorized' }, 401);
    const favs = await readArr(kv, favKey(login));
    return json({ favs });
  }

  if (multi) {
    const ids = multi.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
    const states = {};
    let myBlocks = [], myFavs = [];
    if (login) { myBlocks = await readArr(kv, blockKey(login)); myFavs = await readArr(kv, favKey(login)); }
    const myBlockSet = new Set(myBlocks), myFavSet = new Set(myFavs);
    for (const id of ids) {
      let followed = false, reported = false, liked = false;
      const likes = await readArr(kv, likesKey(id));
      const likeCount = likes.length;
      let favCount = await readNum(kv, favCountKey(id));
      if (login) {
        const followers = await readArr(kv, followersKey(id));
        followed = followers.includes(login);
        const reports = await readArr(kv, reportKey(id));
        reported = reports.some((r) => r.reporter === login);
        liked = likes.includes(login);
      }
      states[id] = { followed, blocked: myBlockSet.has(id), reported, liked, likeCount, faved: myFavSet.has(id), favCount };
    }
    return json({ states });
  }

  const postId = url.searchParams.get('post');
  if (!postId) return json({ error: 'missing_post' }, 400);
  const likes = await readArr(kv, likesKey(postId));
  const likeCount = likes.length;
  let favCount = await readNum(kv, favCountKey(postId));
  const res = { login: login || null, post: postId, followed: false, blocked: false, reported: false, liked: false, likeCount, faved: false, favCount };
  if (login) {
    const followers = await readArr(kv, followersKey(postId));
    const blocks = await readArr(kv, blockKey(login));
    const reports = await readArr(kv, reportKey(postId));
    const favs = await readArr(kv, favKey(login));
    res.followed = followers.includes(login);
    res.blocked = blocks.includes(postId);
    res.reported = reports.some((r) => r.reporter === login);
    res.liked = likes.includes(login);
    res.faved = favs.includes(postId);
  }
  return json(res);
}

export async function onRequestPost(context) {
  const login = getLogin(context);
  if (!login) return json({ error: 'unauthorized' }, 401);
  const rl = await rateLimit(context.env.USER_PREFS, 'act', login, { limit: 60, windowSec: 60 });
  if (!rl.ok) return json({ error: 'rate_limited', retryAfter: rl.retryAfter }, 429);

  const kv = context.env.USER_PREFS;
  const body = await context.request.json().catch(() => ({}));
  const postId = String(body.post || '');
  const action = String(body.action || '');
  const allowed = ['follow', 'unfollow', 'block', 'unblock', 'report', 'like', 'unlike', 'fav', 'unfav'];
  if (!postId || !allowed.includes(action)) return json({ error: 'bad_request' }, 400);
  const post = await postExists(kv, postId);
  if (!post) return json({ error: 'post_not_found' }, 404);

  let followed = false, blocked = false, reported = false, liked = false, faved = false;

  if (action === 'follow' || action === 'unfollow') {
    const followers = await readArr(kv, followersKey(postId));
    let fi = followers.indexOf(login);
    if (action === 'follow') { if (fi === -1) followers.push(login); }
    else { if (fi !== -1) followers.splice(fi, 1); }
    await writeArr(kv, followersKey(postId), followers);
    const my = await readArr(kv, followKey(login));
    let mi = my.indexOf(postId);
    if (action === 'follow') { if (mi === -1) my.push(postId); }
    else { if (mi !== -1) my.splice(mi, 1); }
    await writeArr(kv, followKey(login), my);
    followed = action === 'follow';
  } else if (action === 'block' || action === 'unblock') {
    if (action === 'block' && post.login === OWNER) return json({ error: 'block_owner_forbidden' }, 403);
    const blocks = await readArr(kv, blockKey(login));
    let bi = blocks.indexOf(postId);
    if (action === 'block') { if (bi === -1) blocks.push(postId); }
    else { if (bi !== -1) blocks.splice(bi, 1); }
    await writeArr(kv, blockKey(login), blocks);
    blocked = action === 'block';
  } else if (action === 'report') {
    const reason = String(body.reason || '').slice(0, 200);
    const reports = await readArr(kv, reportKey(postId));
    if (!reports.some((r) => r.reporter === login)) {
      reports.unshift({ reporter: login, ts: Date.now(), reason });
      await writeArr(kv, reportKey(postId), reports);
    }
    reported = true;
    // 写入审核后台列表（结构化的举报工单）
    try {
      const list = await readArr(kv, reportsListKey);
      const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      list.unshift({
        id,
        postId,
        reporter: login,
        postLogin: post.login || '',
        title: post.title || '（无标题）',
        ts: Date.now(),
        reason,
        status: 'open',
      });
      if (list.length > 500) list.length = 500;
      await kv.put(reportsListKey, JSON.stringify(list));
    } catch (e) { /* 不影响举报结果 */ }
    try {
      await pushMessage(kv, OWNER, {
        from: login,
        title: '帖子被举报',
        body: '帖子《' + (post.title || '（无标题）') + '》被 @' + login + ' 举报。' + (reason ? ' 理由：' + reason : ''),
        ts: Date.now(),
        postId,
      });
    } catch (e) { /* 通知失败不影响举报结果 */ }
  } else if (action === 'like' || action === 'unlike') {
    const likes = await readArr(kv, likesKey(postId));
    let li = likes.indexOf(login);
    if (action === 'like') { if (li === -1) likes.push(login); }
    else { if (li !== -1) likes.splice(li, 1); }
    await writeArr(kv, likesKey(postId), likes);
    liked = action === 'like';
  } else if (action === 'fav' || action === 'unfav') {
    const favs = await readArr(kv, favKey(login));
    let fi = favs.indexOf(postId);
    const willFav = action === 'fav';
    if (willFav) { if (fi === -1) favs.push(postId); }
    else { if (fi !== -1) favs.splice(fi, 1); }
    await writeArr(kv, favKey(login), favs);
    let fc = await readNum(kv, favCountKey(postId));
    fc = Math.max(0, fc + (willFav ? 1 : -1));
    await kv.put(favCountKey(postId), String(fc));
    faved = willFav;
  }

  // 重新计算状态
  const followers = await readArr(kv, followersKey(postId));
  const blocks = await readArr(kv, blockKey(login));
  const reports = await readArr(kv, reportKey(postId));
  const likes = await readArr(kv, likesKey(postId));
  const favs = await readArr(kv, favKey(login));
  let favCount = await readNum(kv, favCountKey(postId));
  return json({
    ok: true,
    followed: followers.includes(login),
    blocked: blocks.includes(postId),
    reported: reports.some((r) => r.reporter === login),
    liked: likes.includes(login),
    likeCount: likes.length,
    faved: favs.includes(postId),
    favCount,
  });
}
