// Cloudflare Pages Function: /api/ufollow  (用户级关注 / 好友)
// GET            -> { following:[login...], followers:[login...], count, followerCount }   (需登录)
// GET ?target=L  -> { following:bool, followedBy:bool }                                   (需登录)
// POST {action:'follow'|'unfollow', target:L} -> { ok, following, count }                 (需登录)
import { getLogin, json } from '../_lib/auth.js';

const followKey = (login) => 'ufollow:' + login;        // 我关注的人
const followersKey = (login) => 'ufollowers:' + login;  // 关注我的人

async function readArr(kv, key) {
  const raw = await kv.get(key);
  const a = raw ? JSON.parse(raw) : [];
  return Array.isArray(a) ? a : [];
}
async function writeArr(kv, key, arr) {
  await kv.put(key, JSON.stringify(arr));
}

export async function onRequestGet(context) {
  const kv = context.env.USER_PREFS;
  const me = getLogin(context);
  if (!me) return json({ error: 'unauthorized' }, 401);

  const url = new URL(context.request.url);
  const target = (url.searchParams.get('target') || '').trim();
  if (target) {
    const [following, followers] = await Promise.all([
      readArr(kv, followKey(me)),
      readArr(kv, followersKey(target)),
    ]);
    return json({ following: following.includes(target), followedBy: followers.includes(me) });
  }
  const [following, followers] = await Promise.all([
    readArr(kv, followKey(me)),
    readArr(kv, followersKey(me)),
  ]);
  return json({ following, followers, count: following.length, followerCount: followers.length });
}

export async function onRequestPost(context) {
  const kv = context.env.USER_PREFS;
  const me = getLogin(context);
  if (!me) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await context.request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const target = (body.target || '').trim();
  const action = body.action;
  if (!target || (action !== 'follow' && action !== 'unfollow')) return json({ error: 'invalid' }, 400);
  if (target === me) return json({ error: 'cannot_self' }, 400);

  const mine = await readArr(kv, followKey(me));
  const theirs = await readArr(kv, followersKey(target));
  let following;
  if (action === 'follow') {
    if (!mine.includes(target)) mine.push(target);
    if (!theirs.includes(me)) theirs.push(me);
    following = true;
  } else {
    const i = mine.indexOf(target); if (i !== -1) mine.splice(i, 1);
    const j = theirs.indexOf(me); if (j !== -1) theirs.splice(j, 1);
    following = false;
  }
  await Promise.all([writeArr(kv, followKey(me), mine), writeArr(kv, followersKey(target), theirs)]);
  return json({ ok: true, following, count: mine.length });
}
