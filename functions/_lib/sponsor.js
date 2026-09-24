// 赞助解锁（sponsor）数据层：以 USER_PREFS KV 存储。
//
// 背景：爱发电的付款人身份与站内账号没有天然关联（付款发生在站外，
// 平台只知道「有人付了钱」，不知道他在站内的 login 是谁），所以中间必须有
// 一步显式绑定。这里采用的绑定方式是「一次性兑换码」：
// 创作者在爱发电的「添加赞助奖励」里预填一批码并开启「自动随机回复」，
// 赞助者付款后会立刻收到一条随机码，回站内贴码即完成绑定。
//
// 为什么选兑换码：
//   1. 不依赖爱发电 Web API / webhook —— 那些需要申请开发者权限，不能当必需依赖；
//   2. 续费时平台会再发一条「新的」码 → 他再兑一次 → 到期时间顺延，
//      天然解决续期，我们不需要自己做订阅管理和对账；
//   3. 码是一次性的 = 天然防重放；退款/纠纷时后台作废码 + 撤销赞助即可。
//
// 结构：
//   sponsor:index     -> JSON 数组，当前赞助者 login 列表（后台名单用）
//   sponsor:<login>   -> { login, tier, exp, since, codes:[...] }
//   spcode:<CODE>     -> { code, tier, usedBy, usedAt, createdAt }
//   spcodes:list      -> JSON 数组，本批生成的码（后台查看/导出用，上限 500）
//   sponsor:conflicts -> JSON 数组，竞态冲突记录（KV 无原子性，留痕便于排查）
//
// 时间一律取服务器 Date.now()（Cloudflare Worker 运行时时钟），与 ban.js 一致，
// 绝不使用客户端/设备时间，保证「到期自动失效」以网上时间为准。

export const TIERS = { supporter: '赞助者', pro: '小蓝页·1级成员', teahouse_plus: '茶馆·发布功能升级' };

// 一档 = 31 天。续费当天平台发新码，用户再兑一次即顺延，始终领先于到期时间。
export const SPAN_MS = 31 * 24 * 3600 * 1000;

const PREFIX = 'spcode:';
const SPONSOR = 'sponsor:';
const INDEX = 'sponsor:index';
const CODE_LIST = 'spcodes:list';
const CONFLICT = 'sponsor:conflicts';

// 「茶馆·发布功能升级」是【叠加型】权益，与上面互斥的单档位不同：
// 同一个人可以既是赞助者、又持有茶馆加成，所以它单独存一份记录（thplus:<login>），
// 绝不写进 sponsor:<login>，避免两条并存的权益互相覆盖。
const THPLUS = 'thplus:';
const THPLUS_INDEX = 'thplus:index';

// 去掉了容易看错的 I / O / 0 / 1，共 32 个字符。
// 32 能整除 256，所以 `byte % 32` 是均匀的，不会引入偏差。
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function safeJSON(raw, fallback) {
  if (raw == null) return fallback;
  try {
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function safeArr(raw) {
  const v = safeJSON(raw, []);
  return Array.isArray(v) ? v : [];
}

// 生成一条码（内部形式无分隔符，展示时再加短横线）
function randCode() {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

// 用户可能带短横线、空格、小写，统一兼容
export function normalizeCode(raw) {
  return String(raw == null ? '' : raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatCode(code) {
  const c = normalizeCode(code);
  return c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : c;
}

function isValidTier(t) {
  return Object.prototype.hasOwnProperty.call(TIERS, t);
}

// ---------------------------------------------------------------------------
// 生成码
// ---------------------------------------------------------------------------
// 一次性生成一批，创作者贴进爱发电的「自动随机回复」框里。
// 返回明文码列表（这是唯一一次能看到明文的机会，之后只存在 KV 里）。
export async function generateCodes(context, count, tier) {
  const kv = context.env.USER_PREFS;
  let n = parseInt(count, 10);
  if (!Number.isFinite(n) || n <= 0) n = 20;
  n = Math.min(n, 500); // 一次最多 500 条，避免 KV 写入压力
  const t = isValidTier(tier) ? tier : 'supporter';
  const now = Date.now();

  const made = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    // 极小概率撞码，撞了就重抽
    let code = randCode();
    let guard = 0;
    while (seen.has(code) && guard++ < 8) code = randCode();
    seen.add(code);

    const rec = { code, tier: t, usedBy: null, usedAt: 0, createdAt: now };
    try {
      await kv.put(PREFIX + code, JSON.stringify(rec));
    } catch (e) {
      continue; // 单条写失败不中断整批
    }
    made.push(code);
  }

  // 追加到批次列表（只留最近 500 条，防止键值无限膨胀）
  if (made.length) {
    const prev = safeArr(await kv.get(CODE_LIST).catch(() => null))
      .filter((x) => x && x.code);
    const merged = prev.concat(made.map((c) => ({ code: c, tier: t, createdAt: now })));
    const trimmed = merged.slice(-500);
    try { await kv.put(CODE_LIST, JSON.stringify(trimmed)); } catch (e) {}
  }

  return { tier: t, count: made.length, codes: made.map(formatCode) };
}

// ---------------------------------------------------------------------------
// 读取赞助者
// ---------------------------------------------------------------------------
// 已过期则顺手清理（明细 + 索引）并返回 null，逻辑与 ban.js 的 isBanned 对齐。
export async function readSponsor(context, login) {
  if (!login) return null;
  const kv = context.env.USER_PREFS;
  const raw = await kv.get(SPONSOR + login).catch(() => null);
  if (!raw) return null;
  const rec = safeJSON(raw, null);
  if (!rec) return null;

  const now = Date.now();
  if (rec.exp && now > rec.exp) {
    try { await kv.delete(SPONSOR + login); } catch (e) {}
    try { await removeFromIndex(kv, login); } catch (e) {}
    return null;
  }
  return rec;
}

// 给 /api/me 用的精简形态（不外泄内部字段）
export function publicSponsor(rec) {
  if (!rec) return null;
  return { tier: rec.tier, label: TIERS[rec.tier] || rec.tier, exp: rec.exp, since: rec.since };
}

async function removeFromIndex(kv, login) {
  const idx = safeArr(await kv.get(INDEX).catch(() => null));
  const next = idx.filter((l) => l !== login);
  if (next.length !== idx.length) await kv.put(INDEX, JSON.stringify(next));
}

async function addToIndex(kv, login) {
  const idx = safeArr(await kv.get(INDEX).catch(() => null));
  if (!idx.includes(login)) {
    idx.push(login);
    await kv.put(INDEX, JSON.stringify(idx));
  }
}

// ---------------------------------------------------------------------------
// 兑换
// ---------------------------------------------------------------------------
// 返回 { ok, reason, sponsor } —— reason 用于给用户看的文案。
// 竞态说明：KV 没有 compare-and-swap，两个人同时贴同一条码理论上有极小概率
// 都兑成功。这里用「先占位 → 立即回读确认」做尽力而为的互斥，并把疑似冲突
// 记到 sponsor:conflicts 留痕。几十人规模下概率可忽略；真有量了应迁到
// Cloudflare D1（有唯一索引和事务），这也是商业化方案里建议 D1 的原因。
export async function redeemCode(context, rawCode, login) {
  const kv = context.env.USER_PREFS;
  const code = normalizeCode(rawCode);
  if (!login) return { ok: false, reason: 'unauthorized' };
  if (code.length !== 8) return { ok: false, reason: 'format' };

  const key = PREFIX + code;
  const raw = await kv.get(key).catch(() => null);
  if (!raw) return { ok: false, reason: 'notfound' };
  const rec = safeJSON(raw, null);
  if (!rec) return { ok: false, reason: 'notfound' };

  // 茶馆加成码走独立通道（tier 标记不同），避免污染 sponsor:<login>
  if (rec.tier === 'teahouse_plus') return redeemTeahousePlus(context, rawCode, login);

  // 已被别人用过
  if (rec.usedBy && rec.usedBy !== login) return { ok: false, reason: 'used' };
  // 同一个人重复贴同一条码：不报错、也不重复加时间（防止误操作把时长刷上去）
  if (rec.usedBy === login) {
    const cur = await readSponsor(context, login);
    return { ok: true, reason: 'already', sponsor: publicSponsor(cur) };
  }

  // 占位 + 回读确认（尽力而为的互斥）
  const claim = Object.assign({}, rec, { usedBy: login, usedAt: Date.now() });
  try {
    await kv.put(key, JSON.stringify(claim));
  } catch (e) {
    return { ok: false, reason: 'error' };
  }
  const back = safeJSON(await kv.get(key).catch(() => null), null);
  if (!back || back.usedBy !== login) {
    try {
      const cf = safeArr(await kv.get(CONFLICT).catch(() => null));
      cf.push({ code: formatCode(code), winner: back && back.usedBy, loser: login, ts: Date.now() });
      await kv.put(CONFLICT, JSON.stringify(cf.slice(-100)));
    } catch (e) {}
    return { ok: false, reason: 'used' };
  }

  // 写入/顺延赞助者记录：exp = max(now, 现有 exp) + 31 天
  const prev = await readSponsor(context, login);
  const now = Date.now();
  const base = prev && prev.exp && prev.exp > now ? prev.exp : now;
  const next = {
    login,
    tier: rec.tier || 'supporter',
    exp: base + SPAN_MS,
    since: (prev && prev.since) || now,
    codes: ((prev && prev.codes) || []).concat([formatCode(code)]).slice(-20),
  };
  await kv.put(SPONSOR + login, JSON.stringify(next));
  await addToIndex(kv, login);

  return { ok: true, reason: prev ? 'extended' : 'new', sponsor: publicSponsor(next) };
}

// ---------------------------------------------------------------------------
// 后台：名单与撤销
// ---------------------------------------------------------------------------
export async function listSponsors(context) {
  const kv = context.env.USER_PREFS;
  const idx = safeArr(await kv.get(INDEX).catch(() => null));
  const out = [];
  const alive = [];
  for (const login of idx) {
    const rec = await readSponsor(context, login); // 内部会清理过期项
    if (rec) {
      out.push({ login: rec.login, tier: rec.tier, label: TIERS[rec.tier] || rec.tier, exp: rec.exp, since: rec.since, codes: rec.codes || [] });
      alive.push(login);
    }
  }
  if (alive.length !== idx.length) {
    try { await kv.put(INDEX, JSON.stringify(alive)); } catch (e) {}
  }
  out.sort((a, b) => (b.since || 0) - (a.since || 0));
  return out;
}

export async function revokeSponsor(context, login) {
  const kv = context.env.USER_PREFS;
  if (!login) return false;
  await kv.delete(SPONSOR + login).catch(() => {});
  await removeFromIndex(kv, login).catch(() => {});
  return true;
}

// ---------------------------------------------------------------------------
// 茶馆·发布功能升级（叠加型权益，独立于 sponsor:<login>）
// ---------------------------------------------------------------------------
// 为什么单独一份记录：sponsor:<login> 只存一个 tier，若把茶馆加成塞进同一条，
// 用户先买赞助者、再买茶馆加成就会互相覆盖。茶馆加成本质是「在原有基础上 +10」，
// 天然可叠加，所以用独立的 thplus:<login> 存，顺延规则与主档位完全一致（31 天/月）。
export function publicTeahousePlus(rec) {
  if (!rec) return null;
  return { active: true, tier: 'teahouse_plus', label: TIERS.teahouse_plus, exp: rec.exp, since: rec.since };
}

export async function readTeahousePlus(context, login) {
  if (!login) return null;
  const kv = context.env.USER_PREFS;
  const raw = await kv.get(THPLUS + login).catch(() => null);
  if (!raw) return null;
  const rec = safeJSON(raw, null);
  if (!rec) return null;
  const now = Date.now();
  if (rec.exp && now > rec.exp) {
    try { await kv.delete(THPLUS + login); } catch (e) {}
    try { await removeFromThplusIndex(kv, login); } catch (e) {}
    return null;
  }
  return rec;
}

async function removeFromThplusIndex(kv, login) {
  const idx = safeArr(await kv.get(THPLUS_INDEX).catch(() => null));
  const next = idx.filter((l) => l !== login);
  if (next.length !== idx.length) await kv.put(THPLUS_INDEX, JSON.stringify(next));
}

async function addToThplusIndex(kv, login) {
  const idx = safeArr(await kv.get(THPLUS_INDEX).catch(() => null));
  if (!idx.includes(login)) {
    idx.push(login);
    await kv.put(THPLUS_INDEX, JSON.stringify(idx));
  }
}

// 发放/顺延茶馆加成（months 为月数，规则与 grantSponsor 相同）
export async function grantTeahousePlus(context, login, months, ref) {
  const kv = context.env.USER_PREFS;
  if (!login) return null;
  const n = Math.max(1, Math.min(36, parseInt(months, 10) || 1));
  const prev = await readTeahousePlus(context, login);
  const now = Date.now();
  const base = prev && prev.exp && prev.exp > now ? prev.exp : now;
  const next = {
    login,
    tier: 'teahouse_plus',
    exp: base + SPAN_MS * n,
    since: (prev && prev.since) || now,
    refs: ((prev && prev.refs) || []).concat([ref ? String(ref) : 'direct']).slice(-20),
  };
  await kv.put(THPLUS + login, JSON.stringify(next));
  await addToThplusIndex(kv, login);
  return publicTeahousePlus(next);
}

// 兑换一条「茶馆·发布功能升级」的一次性码（码记录的 tier = teahouse_plus）
export async function redeemTeahousePlus(context, rawCode, login) {
  const kv = context.env.USER_PREFS;
  const code = normalizeCode(rawCode);
  if (!login) return { ok: false, reason: 'unauthorized' };
  if (code.length !== 8) return { ok: false, reason: 'format' };

  const key = PREFIX + code;
  const rec = safeJSON(await kv.get(key).catch(() => null), null);
  if (!rec) return { ok: false, reason: 'notfound' };
  // 防串档：普通赞助码绝不能从这条通道发放茶馆加成（反之亦然，见 redeemCode 的分流）
  if (rec.tier && rec.tier !== 'teahouse_plus') return { ok: false, reason: 'notfound' };
  if (rec.usedBy && rec.usedBy !== login) return { ok: false, reason: 'used' };
  if (rec.usedBy === login) {
    const cur = await readTeahousePlus(context, login);
    return { ok: true, reason: 'already', teahousePlus: publicTeahousePlus(cur) };
  }

  const claim = Object.assign({}, rec, { usedBy: login, usedAt: Date.now() });
  try {
    await kv.put(key, JSON.stringify(claim));
  } catch (e) {
    return { ok: false, reason: 'error' };
  }
  const back = safeJSON(await kv.get(key).catch(() => null), null);
  if (!back || back.usedBy !== login) {
    try {
      const cf = safeArr(await kv.get(CONFLICT).catch(() => null));
      cf.push({ code: formatCode(code), winner: back && back.usedBy, loser: login, ts: Date.now() });
      await kv.put(CONFLICT, JSON.stringify(cf.slice(-100)));
    } catch (e) {}
    return { ok: false, reason: 'used' };
  }

  const prev = await readTeahousePlus(context, login);
  const tp = await grantTeahousePlus(context, login, 1, 'code:' + formatCode(code));
  return { ok: true, reason: prev ? 'extended' : 'new', teahousePlus: tp };
}

export async function listTeahousePlus(context) {
  const kv = context.env.USER_PREFS;
  const idx = safeArr(await kv.get(THPLUS_INDEX).catch(() => null));
  const out = [];
  const alive = [];
  for (const login of idx) {
    const rec = await readTeahousePlus(context, login); // 内部会清理过期项
    if (rec) {
      out.push({ login: rec.login, tier: 'teahouse_plus', label: TIERS.teahouse_plus, exp: rec.exp, since: rec.since, refs: rec.refs || [] });
      alive.push(login);
    }
  }
  if (alive.length !== idx.length) {
    try { await kv.put(THPLUS_INDEX, JSON.stringify(alive)); } catch (e) {}
  }
  out.sort((a, b) => (b.since || 0) - (a.since || 0));
  return out;
}

export async function revokeTeahousePlus(context, login) {
  const kv = context.env.USER_PREFS;
  if (!login) return false;
  await kv.delete(THPLUS + login).catch(() => {});
  await removeFromThplusIndex(kv, login).catch(() => {});
  return true;
}

// 供茶馆 /api/sponsor-check 使用：一次拿到「主档位 + 茶馆加成」现状
export async function teahousePlusStatus(context, login) {
  if (!login) return { login: '', sponsor: null, teahouse_plus: null };
  const sp = await readSponsor(context, login);
  const tp = await readTeahousePlus(context, login);
  return {
    login,
    sponsor: publicSponsor(sp),
    teahouse_plus: tp ? publicTeahousePlus(tp) : null,
  };
}

// 管理台总览：赞助者 + 码使用情况
export async function sponsorStats(context) {
  const kv = context.env.USER_PREFS;
  const sponsors = await listSponsors(context);
  const list = safeArr(await kv.get(CODE_LIST).catch(() => null));

  let used = 0;
  const rows = [];
  for (const item of list) {
    const code = item && item.code;
    if (!code) continue;
    const rec = safeJSON(await kv.get(PREFIX + code).catch(() => null), null);
    if (!rec) continue;
    if (rec.usedBy) used++;
    rows.push({ code: formatCode(code), tier: rec.tier || 'supporter', usedBy: rec.usedBy || '', usedAt: rec.usedAt || 0 });
  }
  rows.sort((a, b) => (b.usedAt || 0) - (a.usedAt || 0));

  const conflicts = safeArr(await kv.get(CONFLICT).catch(() => null));
  const teahousePlus = await listTeahousePlus(context);
  return {
    totals: {
      sponsors: sponsors.length,
      codes: rows.length,
      used,
      unused: rows.length - used,
      conflicts: conflicts.length,
      teahousePlus: teahousePlus.length,
    },
    sponsors,
    teahousePlus,
    codes: rows,
    conflicts: conflicts.slice(-20),
  };
}

// 作废一条未使用的码（已使用的码作废不掉，需要走撤销赞助）
export async function voidCode(context, rawCode) {
  const kv = context.env.USER_PREFS;
  const code = normalizeCode(rawCode);
  if (code.length !== 8) return { ok: false, reason: 'format' };
  const key = PREFIX + code;
  const rec = safeJSON(await kv.get(key).catch(() => null), null);
  if (!rec) return { ok: false, reason: 'notfound' };
  if (rec.usedBy) return { ok: false, reason: 'used' };
  await kv.delete(key).catch(() => {});
  const list = safeArr(await kv.get(CODE_LIST).catch(() => null)).filter((x) => x && x.code !== code);
  try { await kv.put(CODE_LIST, JSON.stringify(list)); } catch (e) {}
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Webhook 直接发放（不经过兑换码）
// ---------------------------------------------------------------------------
// 爱发电付款成功后由 Webhook 触发。与兑换码路径共用同一份 sponsor:<login> 记录，
// 所以两种方式是等价的：谁先到都算，续期规则也完全一致。
const ORDER_PREFIX = 'afdian:order:';
const PENDING_PREFIX = 'afdian:pending:';

// 按金额判定档位。低于最低档视为纯打赏，不解锁权益。
// 想改档位门槛就改这一张表（金额单位：元）。
// 爱发电当前档位：赞助者 ¥20/月、小蓝页·1级成员 ¥32.50/月（年付 ¥360）。
const TIER_BY_AMOUNT = [
  { min: 32.5, tier: 'pro' },
  { min: 20, tier: 'supporter' },
  { min: 13.25, tier: 'teahouse_plus' }, // 茶馆·发布功能升级（叠加型，走独立发放通道）
];

export function tierFromAmount(raw) {
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  for (const r of TIER_BY_AMOUNT) if (n >= r.min) return r.tier;
  return null; // 纯打赏
}

// 直接发放/顺延赞助（months 为爱发电订单的 month 字段，即赞助月数）
export async function grantSponsor(context, login, tier, months, ref) {
  const kv = context.env.USER_PREFS;
  if (!login) return null;
  const t = isValidTier(tier) ? tier : 'supporter';
  const n = Math.max(1, Math.min(36, parseInt(months, 10) || 1));
  const prev = await readSponsor(context, login);
  const now = Date.now();
  const base = prev && prev.exp && prev.exp > now ? prev.exp : now;
  const next = {
    login,
    tier: t,
    exp: base + SPAN_MS * n,
    since: (prev && prev.since) || now,
    codes: ((prev && prev.codes) || []).concat([ref ? 'webhook:' + ref : 'webhook']).slice(-20),
  };
  await kv.put(SPONSOR + login, JSON.stringify(next));
  await addToIndex(kv, login);
  return publicSponsor(next);
}

// 幂等：同一笔订单只处理一次（官方明确说可能重复推送）
export async function isOrderProcessed(context, outTradeNo) {
  const kv = context.env.USER_PREFS;
  const raw = await kv.get(ORDER_PREFIX + outTradeNo).catch(() => null);
  return safeJSON(raw, null);
}

export async function markOrderProcessed(context, outTradeNo, login, months, tier) {
  const kv = context.env.USER_PREFS;
  await kv.put(ORDER_PREFIX + outTradeNo, JSON.stringify({
    out_trade_no: outTradeNo, login: login || '', tier: tier || '', months: months || 1, ts: Date.now(),
  }));
}

// 认领不到 login 的订单（比如付款时没留用户名）先挂起，等管理员手动绑定
export async function addPending(context, order) {
  const kv = context.env.USER_PREFS;
  const no = String(order.out_trade_no || '');
  if (!no) return null;

  // 上限保护：Webhook 是公开地址，谁都能 POST。若被人刷，最多堆 MAX_PENDING 条，
  // 超出就淘汰最旧的，避免把 KV 每日写入额度（1000 次）打满。
  const MAX_PENDING = 100;
  try {
    const listed = await kv.list({ prefix: PENDING_PREFIX });
    const keys = (listed.keys || []).map((k) => k.name);
    if (keys.length >= MAX_PENDING) {
      const rows = [];
      for (const k of keys) {
        const r = safeJSON(await kv.get(k).catch(() => null), null);
        if (r) rows.push({ k, ts: r.ts || 0 });
      }
      rows.sort((a, b) => a.ts - b.ts);
      const drop = rows.slice(0, Math.max(1, keys.length - MAX_PENDING + 1));
      for (const d of drop) await kv.delete(d.k).catch(() => {});
    }
  } catch (e) { /* list 不可用时跳过淘汰 */ }

  const rec = {
    out_trade_no: no,
    user_id: order.user_id || '',
    plan_id: order.plan_id || '',
    amount: order.total_amount || order.show_amount || '',
    month: order.month || 1,
    status: order.status,
    remark: String(order.remark || '').slice(0, 200),
    ts: Date.now(),
  };
  await kv.put(PENDING_PREFIX + no, JSON.stringify(rec));
  return rec;
}

export async function listPending(context) {
  const kv = context.env.USER_PREFS;
  const out = [];
  try {
    const listed = await kv.list({ prefix: PENDING_PREFIX });
    for (const k of listed.keys || []) {
      const rec = safeJSON(await kv.get(k.name).catch(() => null), null);
      if (rec) out.push(rec);
    }
  } catch (e) { /* list 不可用时忽略 */ }
  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return out;
}

// 管理员把一笔挂起订单绑到某个登录名上
export async function claimPending(context, outTradeNo, login) {
  const kv = context.env.USER_PREFS;
  const key = PENDING_PREFIX + String(outTradeNo || '');
  const rec = safeJSON(await kv.get(key).catch(() => null), null);
  if (!rec) return { ok: false, reason: 'notfound' };
  if (!login) return { ok: false, reason: 'missing_login' };
  const tier = tierFromAmount(rec.amount) || 'supporter';
  await markOrderProcessed(context, rec.out_trade_no, login, rec.month, tier);
  await kv.delete(key).catch(() => {});
  // 茶馆加成走独立记录，绝不用 grantSponsor 覆盖主档位
  if (tier === 'teahouse_plus') {
    const tp = await grantTeahousePlus(context, login, rec.month, rec.out_trade_no);
    return { ok: true, teahousePlus: tp };
  }
  const sp = await grantSponsor(context, login, tier, rec.month, rec.out_trade_no);
  return { ok: true, sponsor: sp };
}
