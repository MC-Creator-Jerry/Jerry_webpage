import { json, getLogin, isAdminLogin } from '../_lib/auth.js';

const KV_KEY = 'home-feature:v1';

const DEFAULT_FEATURE = {
  enabled: true,
  title: '新发布：CleanOpt',
  desc: 'Windows 清理与内存优化小工具，后台静默监控，游戏免打扰。',
  link: '/products/cleanopt/',
  label: '查看详情',
  productId: 'cleanopt',
  updatedAt: Date.now()
};

export async function onRequestGet({ request, env }) {
  const kv = env.USER_PREFS;
  let data = null;
  try {
    const raw = await kv.get(KV_KEY);
    if (raw) data = JSON.parse(raw);
  } catch (e) {}
  if (!data) data = { ...DEFAULT_FEATURE };
  return json({ ok: true, feature: data });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const login = getLogin(context);
  if (!login) return json({ error: 'Unauthorized' }, 401);
  const admin = await isAdminLogin(context, login);
  if (!admin) return json({ error: 'Forbidden' }, 403);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400); }

  const kv = env.USER_PREFS;
  let existing = null;
  try {
    const raw = await kv.get(KV_KEY);
    if (raw) existing = JSON.parse(raw);
  } catch (e) {}
  if (!existing) existing = { ...DEFAULT_FEATURE };

  if (typeof body.enabled === 'boolean') existing.enabled = body.enabled;
  const stringFields = ['title', 'desc', 'link', 'label', 'productId'];
  for (const f of stringFields) {
    if (typeof body[f] === 'string') existing[f] = body[f].trim();
  }
  existing.updatedAt = Date.now();

  await kv.put(KV_KEY, JSON.stringify(existing));
  return json({ ok: true, feature: existing });
}
