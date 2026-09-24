import { json, getLogin, isAdminLogin } from '../_lib/auth.js';

const KV_KEY = (id) => `product-meta:${id}`;

const DEFAULTS = {
  cleanopt: {
    id: 'cleanopt',
    name: 'CleanOpt',
    version: '2026.0919.2200',
    icon: '🧹',
    desc: 'Windows 系统清理与内存优化小工具。提供后台静默监控、每日清理、内存压力自动优化、游戏免打扰等功能。',
    downloadUrl: 'https://github.com/MC-Creator-Jerry/CleanOpt/releases/download/v2026.0919.2200/install_CleanOpt_2026.0919.2200.zip',
    disclaimer: '本软件按“原样”提供，作者不对因使用本软件导致的任何数据丢失、系统异常或硬件损坏承担责任。请在下载和使用前自行备份重要数据，并确认您了解相关风险。',
    // 更新日志：从新到旧排列；每项 {version,date,notes}。空数组表示尚无历史记录。
    // 首次发布即写入，便于产品页「历史版本」区块展示，并随后续迭代持续追加。
    history: [
      {
        version: '2026.0919.2200',
        date: '2026-09-19',
        notes: '版本迭代更新，包含稳定性改进与细节优化。'
      },
      {
        version: '2026.0831.1813',
        date: '2026-08-31',
        notes: '初始发布版本。包含六大能力：系统垃圾清理（临时文件/系统缓存/回收站冗余）、内存优化（智能释放占用内存、提升响应）、后台静默运行（常驻不打扰、按需自动维护）、游戏免打扰（检测游戏进程自动暂停清理）、免安装便携版（单文件约 54 KB、不写注册表）、安全优先（仅清理明确安全的系统冗余，操作前可预览并附完整免责声明）。'
      }
    ],
    updatedAt: Date.now()
  }
};

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim().toLowerCase();
  if (!id) return json({ error: 'Missing id' }, 400);

  const kv = env.USER_PREFS;
  let data = null;
  try {
    const raw = await kv.get(KV_KEY(id));
    if (raw) data = JSON.parse(raw);
  } catch (e) {}

  if (!data && DEFAULTS[id]) data = { ...DEFAULTS[id] };
  if (!data) return json({ error: 'Not found' }, 404);

  return json({ ok: true, product: data });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const login = getLogin(context);
  if (!login) return json({ error: 'Unauthorized' }, 401);
  const admin = await isAdminLogin(context, login);
  if (!admin) return json({ error: 'Forbidden' }, 403);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
  const id = (body.id || '').trim().toLowerCase();
  if (!id) return json({ error: 'Missing id' }, 400);

  const kv = env.USER_PREFS;
  let existing = null;
  try {
    const raw = await kv.get(KV_KEY(id));
    if (raw) existing = JSON.parse(raw);
  } catch (e) {}
  if (!existing && DEFAULTS[id]) existing = { ...DEFAULTS[id] };
  if (!existing) existing = { id, name: '', version: '', icon: '', desc: '', downloadUrl: '', disclaimer: '', updatedAt: 0 };

  const fields = ['name', 'version', 'icon', 'desc', 'downloadUrl', 'disclaimer'];
  for (const f of fields) {
    if (typeof body[f] === 'string') existing[f] = body[f].trim();
  }

  // 历史版本（version history）：接受 JSON 数组，逐项做类型/长度校验，避免脏数据写入 KV
  if (Array.isArray(body.history)) {
    existing.history = body.history.slice(0, 200).map(function (h) {
      h = h || {};
      return {
        version: String(h.version || '').slice(0, 64),
        date: String(h.date || '').slice(0, 32),
        notes: String(h.notes || '').slice(0, 2000)
      };
    }).filter(function (h) { return h.version !== ''; });
  }

  existing.updatedAt = Date.now();

  await kv.put(KV_KEY(id), JSON.stringify(existing));
  return json({ ok: true, product: existing });
}
