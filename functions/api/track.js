// Cloudflare Pages Function: /api/track
// 站点流量埋点（公开，无需登录）。前端 common.js 在页面加载后用 sendBeacon 上报。
// POST { path, title, ref, vid }  -> { ok: true }
//
// 存储（KV USER_PREFS）：
//   stats:daily:<YYYY-MM-DD> -> { pv, uv, paths:{path:n}, refs:{ref:n}, vids:[vid,...],
//                                 hours:{0..23:n}, countries:{ISO2:n} }
//   stats:total              -> { pv, firstDay, lastDay }
//   stats:fs:<vid>           -> 首次访问日期（per-vid key，长 TTL；用于区分新访客 / 回访）
// 注意：KV 最终一致 + 无原子自增，高并发下计数可能略有丢失；个人站点量级可忽略。
// 日期按 Asia/Shanghai (UTC+8) 切天。
import { json } from '../_lib/auth.js';

const DAY_PREFIX = 'stats:daily:';
const TOTAL_KEY = 'stats:total';
const FS_PREFIX = 'stats:fs:'; // stats:fs:<vid> -> 首次访问日期
const FS_TTL = 31536000;      // 1 年（KV expirationTtl 上限），到期回流访客可能重新计为新，可接受
const MAX_VIDS = 20000;   // 单日独立访客上限，防止无限膨胀
const MAX_BUCKETS = 300;  // 单日 paths / refs 桶上限

// 常见爬虫/无头浏览器的 UA 关键字：命中则不计入，避免污染真人数据、也避免白烧 KV 读额度
const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot|preview|headless|python-requests|python-urllib|curl|wget|go-http|okhttp|java\/|libwww|semrush|ahrefs|mj12|dotbot|petalbot|applebot|baiduspider|yandex|sogou|bytespider|cloudsystem|scrapy|httpx|go-resty|axios|node-fetch|undici|postmanruntime|insomnia|feedfetcher|wp-;/i;

// 静态资源路径直接忽略埋点（被爬虫抓 /common.js、/favicon 等不应计入，也省 KV 读）
const ASSET_RE = /\.(js|css|png|jpe?g|gif|svg|ico|woff2?|ttf|json|webp|mp4|ogg|map|webmanifest)$/i;

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

function bump(map, k) {
  if (!k) return;
  if (Object.keys(map).length >= MAX_BUCKETS && !(k in map)) return;
  map[k] = (map[k] || 0) + 1;
}

function clean(str, max) {
  return String(str || '').slice(0, max);
}

// 归一化页面路径：去掉缓存版本参数 v、去掉末尾 index.html，保留其它 query（如帖子 id）
// 这样 /?v=20260829g 与 / 合并，/post/detail/index.html?id=1 与 /post/detail/?id=1 合并
function normalizePath(raw) {
  if (!raw) return '/';
  let path = raw;
  let q = '';
  const qi = raw.indexOf('?');
  if (qi !== -1) { path = raw.slice(0, qi); q = raw.slice(qi + 1); }
  if (!path) path = '/';
  path = path.replace(/index\.html$/, '');
  if (q) {
    try {
      const p = new URLSearchParams(q);
      p.delete('v'); // 仅剔除缓存版本号，保留业务参数
      q = p.toString();
    } catch (e) { q = ''; }
  }
  return q ? path + '?' + q : path;
}

// 来源只保留 host（如 www.google.com），丢弃路径/query，避免同一站点被拆成无数条
function normalizeRef(raw) {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return u.host || raw.slice(0, 300);
  } catch (e) {
    return raw.slice(0, 300);
  }
}

export async function onRequestPost(context) {
  const ua = context.request.headers.get('user-agent') || '';
  if (BOT_RE.test(ua)) return json({ ok: true, ignored: 'bot' });
  // Cloudflare 标记的已验证爬虫（需 Bot Management；免费版通常为 undefined，此时不拦截）
  if (context.request.cf && context.request.cf.bot) return json({ ok: true, ignored: 'cfbot' });

  const kv = context.env.USER_PREFS;
  const data = await context.request.json().catch(() => ({}));

  const path = normalizePath(clean(data.path, 300));
  if (!path) return json({ error: 'missing_path' }, 400);
  if (ASSET_RE.test(path)) return json({ ok: true, ignored: 'asset' });

  const ref = normalizeRef(clean(data.ref, 500));
  const vid = clean(data.vid, 64);
  const day = dayKey();

  // 访客本地小时：优先用客户端上报的 hour（更准确），缺省回退服务端 UTC 小时
  let hour = Number(data.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) hour = new Date().getUTCHours();
  // 国家：Cloudflare 在 request.cf.country 提供 ISO-3166 两位码，零成本、不可被客户端伪造
  const country = clean((context.request.cf && context.request.cf.country) || '', 2).toUpperCase() || 'XX';

  const rec = await readJSON(kv, DAY_PREFIX + day, null);
  const cur = rec && typeof rec === 'object'
    ? rec
    : { pv: 0, uv: 0, paths: {}, refs: {}, vids: [], hours: {}, countries: {} };
  if (!cur.paths || typeof cur.paths !== 'object') cur.paths = {};
  if (!cur.refs || typeof cur.refs !== 'object') cur.refs = {};
  if (!Array.isArray(cur.vids)) cur.vids = [];
  if (!cur.hours || typeof cur.hours !== 'object') cur.hours = {};
  if (!cur.countries || typeof cur.countries !== 'object') cur.countries = {};

  cur.pv = (cur.pv || 0) + 1;
  bump(cur.paths, path);
  if (ref) bump(cur.refs, ref);
  cur.hours[hour] = (cur.hours[hour] || 0) + 1;
  cur.countries[country] = (cur.countries[country] || 0) + 1;

  let addedToday = false;
  if (vid && cur.vids.length < MAX_VIDS && cur.vids.indexOf(vid) === -1) {
    cur.vids.push(vid);
    addedToday = true;
  }
  cur.uv = cur.vids.length;
  await kv.put(DAY_PREFIX + day, JSON.stringify(cur));

  // 首次访问记录：per-vid key，仅当该 vid 尚无记录时写一次（避免整张大 Map 反复读改写）
  if (addedToday && vid) {
    const fsKey = FS_PREFIX + vid;
    const existing = await kv.get(fsKey);
    if (!existing) {
      await kv.put(fsKey, day, { expirationTtl: FS_TTL }).catch(() => {});
    }
  }

  // 全站总览
  const total = await readJSON(kv, TOTAL_KEY, null);
  const t = total && typeof total === 'object' ? total : { pv: 0, firstDay: day, lastDay: day };
  t.pv = (t.pv || 0) + 1;
  if (!t.firstDay || day < t.firstDay) t.firstDay = day;
  if (!t.lastDay || day > t.lastDay) t.lastDay = day;
  await kv.put(TOTAL_KEY, JSON.stringify(t));

  return json({ ok: true, day, pv: cur.pv, uv: cur.uv });
}

export async function onRequestGet(context) {
  // 轻量探活：返回今日概览（不含明细，便于排查埋点是否生效）
  const kv = context.env.USER_PREFS;
  const day = dayKey();
  const rec = await readJSON(kv, DAY_PREFIX + day, { pv: 0, uv: 0 });
  return json({ ok: true, day, pv: rec.pv || 0, uv: rec.uv || 0 });
}
