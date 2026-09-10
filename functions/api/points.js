// Cloudflare Pages Function: /api/points  (排行榜)
// GET            -> {
//   postBoard:  [{ login, name, posts, points, rank }],   // 帖子榜：按发帖数降序，前 50
//   loginBoard: [{ login, name, logins, lv, lvProgress, rank }], // 登录榜：按活跃天数降序，前 50
//   perPost: 10
// }
// GET ?user=<l>  -> { login, name, posts, points, logins, lv, lvProgress, postRank, loginRank }
//
// 积分规则（MVP，纯计算、无需写入）：
//   帖子榜：每发布 1 篇帖子 = 10 分；积分 = 帖子数 × 10。
//   登录榜：累计「活跃天数」（每次 /api/me 且当天未记过时 +1），每 10 天升 1 级（Lv）。
//   Lv = floor(logins / 10) + 1；lvProgress = (logins % 10) / 10（升下一级的进度）。
import { json, OWNER } from '../_lib/auth.js';

const PER_POST = 10;

// 登录榜等级规则（越升越难 + 上限）：
//   - Lv: 1 → 2 需要 BASE 天；
//   - 之后每升一级，所需天数再 + STEP（Lv k→k+1 需 BASE + STEP*(k-1) 天）；
//   - 最高 LvMax，到顶后不再升级，进度锁定为 100%。
const LV_MAX = 100;         // 等级上限
const LV_BASE = 10;         // 第 1 级升第 2 级所需活跃天数
const LV_STEP = 5;          // 每往上一档，额外多需的天数

// 从 Lv L 升到 Lv(L+1) 所需的天数
function reqForLevel(L) {
  return LV_BASE + LV_STEP * (L - 1);
}
// 到达 Lv L 累计所需的总活跃天数（L >= 1）
function cumForLevel(L) {
  if (L <= 1) return 0;
  const k = L - 1;
  return k * LV_BASE + LV_STEP * k * (k - 1) / 2;
}

// 给定累计活跃天数 n，算等级信息
function levelInfo(n, login) {
  n = Number(n) || 0;
  // 站主等级直接满级（管理员授权，无需累积登录天数）
  if (login && login === OWNER) {
    return { lv: LV_MAX, lvProgress: 1, lvDaysLeft: 0, lvMax: LV_MAX, lvCapped: true };
  }
  let lv = 1;
  while (lv < LV_MAX && cumForLevel(lv + 1) <= n) lv++;
  if (lv >= LV_MAX) {
    return { lv: LV_MAX, lvProgress: 1, lvDaysLeft: 0, lvMax: LV_MAX, lvCapped: true };
  }
  const baseDays = cumForLevel(lv);
  const span = reqForLevel(lv);
  const into = n - baseDays;
  const progress = span > 0 ? into / span : 0;
  return {
    lv,
    lvProgress: Math.max(0, Math.min(1, progress)),
    lvDaysLeft: Math.max(0, span - into),
    lvMax: LV_MAX,
    lvCapped: false,
  };
}

async function readArr(kv, key) {
  const raw = await kv.get(key);
  const a = raw ? JSON.parse(raw) : [];
  return Array.isArray(a) ? a : [];
}

async function readLoginMap(kv) {
  const map = {};
  try {
    const out = await kv.list({ prefix: 'logins:' });
    const keys = (out.keys || []).map((k) => k.name);
    await Promise.all(keys.map(async (nm) => {
      const login = nm.slice('logins:'.length);
      const v = parseInt((await kv.get(nm)) || '0', 10) || 0;
      if (login) map[login] = v;
    }));
  } catch (e) { /* 读取失败则登录榜为空 */ }
  return map;
}

export async function onRequestGet(context) {
  const kv = context.env.USER_PREFS;
  const url = new URL(context.request.url);
  const user = (url.searchParams.get('user') || '').trim();

  const [list, idx, loginMap] = await Promise.all([
    readArr(kv, 'posts:list'),
    readArr(kv, 'users:index'),
    readLoginMap(kv),
  ]);

  const published = list.filter((p) => p && p.status !== 'draft');
  const postCount = {};
  published.forEach((p) => { if (p.login) postCount[p.login] = (postCount[p.login] || 0) + 1; });

  const nameOf = {};
  idx.forEach((u) => { if (u.login) nameOf[u.login] = u.name || u.login; });

  const postRows = Object.keys(postCount).map((login) => ({
    login,
    name: nameOf[login] || login,
    posts: postCount[login],
    points: postCount[login] * PER_POST,
  })).sort((a, b) => b.points - a.points);

  const loginRows = Object.keys(loginMap).map((login) => {
    const info = levelInfo(loginMap[login], login);
    return Object.assign(
      { login, name: nameOf[login] || login, logins: loginMap[login] },
      info
    );
  }).sort((a, b) => b.logins - a.logins);

  if (user) {
    const pi = postRows.findIndex((r) => r.login === user);
    const li = loginRows.findIndex((r) => r.login === user);
    const isL = li === -1 ? 0 : loginMap[user];
    const info = levelInfo(isL, user);
    return json(Object.assign(
      {
        login: user,
        name: nameOf[user] || user,
        posts: postCount[user] || 0,
        points: (postCount[user] || 0) * PER_POST,
        logins: isL,
        postRank: pi === -1 ? null : pi + 1,
        loginRank: li === -1 ? null : li + 1,
      },
      info,
      { lvBaseDays: LV_BASE, lvStepDays: LV_STEP, perPost: PER_POST }
    ));
  }

  const withRank = (rows, key) => rows.slice(0, 50).map((r, i) => Object.assign({ rank: i + 1 }, r));
  return json({
    postBoard: withRank(postRows, 'points'),
    loginBoard: withRank(loginRows, 'logins'),
    lvMax: LV_MAX,
    lvBaseDays: LV_BASE,
    lvStepDays: LV_STEP,
    perPost: PER_POST,
    perLevel: LV_BASE,
  });
}
