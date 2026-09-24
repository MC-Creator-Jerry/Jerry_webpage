// Cloudflare Pages Function: /api/stats
// 流量看板数据（仅管理员可见）
// GET ?days=30 -> { ok, total, today, days:[{date,pv,uv}], topPaths, topRefs, rangeUv,
//                    hours:[24], countries:[{key,count}], rangeNewUv, rangeRetUv }
import { getLogin, isAdminLogin, json } from '../_lib/auth.js';

const DAY_PREFIX = 'stats:daily:';
const FS_PREFIX = 'stats:fs:';
const CACHE_PREFIX = 'stats:cache:';
const CACHE_TTL = 300000;      // 5 分钟
const CACHE_KV_TTL = 600;      // KV 过期 10 分钟，双保险
const FS_READ_CAP = 10000;     // 单窗口访客超过此数则退化为保守估算，避免一次性巨量读取

function dayKey(offsetDays = 0) {
  const now = Date.now() + offsetDays * 86400000;
  return new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

async function readJSON(kv, key, fallback) {
  const raw = await kv.get(key);
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : fallback;
  } catch (e) {
    return fallback;
  }
}

async function listDayKeys(kv) {
  const keys = [];
  let cursor = undefined;
  let guard = 0;
  do {
    const page = await kv.list({ prefix: DAY_PREFIX, cursor });
    (page.keys || []).forEach((k) => keys.push(k.name));
    cursor = page.list_complete ? undefined : page.cursor;
    guard += 1;
  } while (cursor && guard < 20);
  return keys.map((k) => k.slice(DAY_PREFIX.length)).filter(Boolean).sort();
}

function topN(map, n) {
  return Object.keys(map || {})
    .map((k) => ({ key: k, count: map[k] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

export async function onRequestGet(context) {
  const login = getLogin(context);
  if (!login) return json({ error: 'unauthorized' }, 401);
  if (!(await isAdminLogin(context, login))) return json({ error: 'forbidden' }, 403);

  const kv = context.env.USER_PREFS;
  const url = new URL(context.request.url);
  const want = parseInt(url.searchParams.get('days') || '30', 10);
  const days = Number.isFinite(want) ? Math.min(Math.max(want, 1), 90) : 30;

  // 5 分钟结果缓存：把「读全部日 key + firstseen」压缩成 1 次读，反复刷新看板几乎不花 KV
  const cacheKey = CACHE_PREFIX + days;
  try {
    const cached = await kv.get(cacheKey);
    if (cached) {
      const o = JSON.parse(cached);
      if (o && o.ts && Date.now() - o.ts < CACHE_TTL && o.payload) {
        return json(o.payload);
      }
    }
  } catch (e) { /* 缓存解析失败则继续实时计算 */ }

  const allDays = await listDayKeys(kv);
  const window_ = allDays.slice(-days);
  const windowSet = new Set(window_);

  const dayRecs = [];
  const pathAgg = {};
  const refAgg = {};
  const hoursAgg = new Array(24).fill(0);
  const countryAgg = {};
  // 区间 UV = 整个窗口内去重后的独立访客数（不等于每日 UV 之和，否则回访会被重复计数）
  const uvSet = new Set();
  // 全站累计 PV：遍历全部日 key 累加（不再依赖 track.js 写的 stats:total，省 KV 写）
  let totalPv = 0;

  for (const d of allDays) {
    const rec = await readJSON(kv, DAY_PREFIX + d, null);
    if (rec) totalPv += (rec.pv || 0);
    if (!windowSet.has(d)) continue;   // 仅窗口内的进入逐日图表与区间聚合
    if (!rec) { dayRecs.push({ date: d, pv: 0, uv: 0 }); continue; }
    dayRecs.push({ date: d, pv: rec.pv || 0, uv: rec.uv || 0 });
    Object.keys(rec.paths || {}).forEach((p) => { pathAgg[p] = (pathAgg[p] || 0) + rec.paths[p]; });
    Object.keys(rec.refs || {}).forEach((r) => { refAgg[r] = (refAgg[r] || 0) + rec.refs[r]; });
    // 时段分布（24 小时，按访客本地时间）
    if (rec.hours) {
      Object.keys(rec.hours).forEach((h) => {
        const hi = Number(h);
        if (hi >= 0 && hi < 24) hoursAgg[hi] += rec.hours[h];
      });
    }
    // 地理分布（国家 ISO2）
    if (rec.countries) {
      Object.keys(rec.countries).forEach((c) => { countryAgg[c] = (countryAgg[c] || 0) + rec.countries[c]; });
    }
    (rec.vids || []).forEach((v) => uvSet.add(v));
  }
  const rangeUv = uvSet.size;

  // 新访客 vs 回访：从 per-vid 首访 key 读取每个访客的首访日期，按是否落在窗口内划分
  let rangeNewUv = 0;
  let rangeRetUv = 0;
  const vids = Array.from(uvSet);
  if (vids.length <= FS_READ_CAP) {
    const firstSeenList = await Promise.all(vids.map(function (v) { return kv.get(FS_PREFIX + v); }));
    vids.forEach(function (v, i) {
      const fs = firstSeenList[i];
      if (fs && windowSet.has(fs)) rangeNewUv += 1;
      else rangeRetUv += 1;
    });
  } else {
    // 超大规模退化为保守估算（全部计回访），避免一次性巨量读取击穿 KV 额度
    rangeRetUv = vids.length;
  }

  const today = dayKey();
  const todayRec = window_.indexOf(today) !== -1
    ? dayRecs[window_.indexOf(today)]
    : { date: today, pv: 0, uv: 0 };

  const payload = {
    ok: true,
    total: { pv: totalPv, firstDay: allDays[0] || null, lastDay: allDays[allDays.length - 1] || null, days: allDays.length },
    today,
    days: dayRecs,
    rangePv: dayRecs.reduce((s, d) => s + d.pv, 0),
    rangeUv,
    rangeNewUv,
    rangeRetUv,
    hours: hoursAgg,
    countries: topN(countryAgg, 12),
    topPaths: topN(pathAgg, 20),
    topRefs: topN(refAgg, 10),
  };

  // 写回 5 分钟缓存（失败不影响本次返回）
  await kv.put(cacheKey, JSON.stringify({ ts: Date.now(), payload }), { expirationTtl: CACHE_KV_TTL }).catch(() => {});

  return json(payload);
}
