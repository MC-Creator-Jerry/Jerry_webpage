// Cloudflare Pages Function: /api/profile
// GET  ?user=login        -> { login, exists, avatar, name, bio, about, skills, links, ghAvatar, themeColor, themeId }  (public)
// GET  (no user)         -> own profile (requires login)
// POST { name, bio, about, skills[], links[{label,url}], avatar?, ghAvatar?, themeColor?, themeId?, bannerMode? } -> { ok } (login required; forbidden scan)
//   ghAvatar:  true -> 始终使用 GitHub 头像（忽略自定义头像）
//   themeColor: 个人主页主题色（6px 色条），空串表示清除
//   themeId:    内置主题 id（预设配色 + 头图渐变），空串表示不套用预设
//   bannerMode: 头图来源选择：''（沿用旧逻辑，自定义图优先）/ 'theme'（强制显示主题渐变头图）/ 'image'（强制显示自定义头图）
// Storage: KV "profile:<login>" + avatar in "avatar:<login>" + directory "users:index" (array of {login,name,bio,avatar}).
import { getLogin, json } from '../_lib/auth.js';
import { scanTexts } from '../_lib/forbidden.js';
import { getCachedAvatar } from '../_lib/avatar.js';

const OWNER = 'MC-Creator-Jerry';
const OWNER_BILI = 'https://space.bilibili.com/3494373002054218';

// 主题 id 只做白名单式校验：小写字母/数字/短横线，且必须已存在于前端 THEMES 列表。
// 这里只限制字符集（防止注入任意字符串），具体配色由前端常量决定，不存到 KV 里。
const THEME_ID_RE = /^[a-z0-9-]{1,24}$/;

function defaultAvatar(login) {
  return 'https://github.com/' + encodeURIComponent(login) + '.png';
}

// 站长的默认资料：自动带上 B 站链接（"到时候自动帮我填"）。
function ownerDefault() {
  return {
    login: OWNER,
    name: OWNER,
    about: 'B站UP主，热爱创作与分享。',
    skills: [],
    links: [{ label: '哔哩哔哩', url: OWNER_BILI }],
    ghAvatar: false,
    themeColor: '',
    themeId: '',
    bannerMode: '',
  };
}

async function getAvatar(kv, login, profAvatar, forceGithub) {
  if (forceGithub) {
    const cloud = await getCachedAvatar(kv, login, null);
    return cloud || defaultAvatar(login);
  }
  const a = await kv.get('avatar:' + login);
  if (a) return a;
  if (profAvatar) return profAvatar;
  const cloud = await getCachedAvatar(kv, login, null);
  return cloud || defaultAvatar(login);
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const target = url.searchParams.get('user');
  const kv = context.env.USER_PREFS;

  if (target) {
    const raw = await kv.get('profile:' + target);
    const p = raw ? JSON.parse(raw) : null;
    if (!p && target === OWNER) {
      const d = ownerDefault();
      return json({
        login: target, exists: false,
        avatar: defaultAvatar(target),
        name: d.name, about: d.about, skills: d.skills, links: d.links,
        ghAvatar: d.ghAvatar, themeColor: d.themeColor, themeId: d.themeId, bannerMode: d.bannerMode,
      });
    }
    if (!p) return json({ login: target, exists: false, avatar: defaultAvatar(target), ghAvatar: false, themeColor: '', themeId: '', bannerMode: '' });
    return json({
      login: target,
      exists: true,
      avatar: await getAvatar(kv, target, p.avatar, !!p.ghAvatar),
      name: p.name || '',
      about: p.about || '',
      skills: p.skills || [],
      links: p.links || [],
      ghAvatar: !!p.ghAvatar,
      themeColor: p.themeColor || '',
      themeId: p.themeId || '',
      bannerMode: p.bannerMode || '',
    });
  }

  const login = getLogin(context);
  if (!login) return json({ error: 'unauthorized' }, 401);
  const raw = await kv.get('profile:' + login);
  const p = raw ? JSON.parse(raw) : null;
  if (!p && login === OWNER) {
    const d = ownerDefault();
    return json({
      login, exists: false,
      avatar: defaultAvatar(login),
      name: d.name, about: d.about, skills: d.skills, links: d.links,
      ghAvatar: d.ghAvatar, themeColor: d.themeColor, themeId: d.themeId, bannerMode: d.bannerMode,
    });
  }
  return json({
    login,
    exists: !!p,
    avatar: await getAvatar(kv, login, p && p.avatar, !!(p && p.ghAvatar)),
    name: p ? p.name : '',
    about: p ? p.about : '',
    skills: p ? p.skills : [],
    links: p ? p.links : [],
    ghAvatar: !!(p && p.ghAvatar),
    themeColor: (p && p.themeColor) || '',
    themeId: (p && p.themeId) || '',
    bannerMode: (p && p.bannerMode) || '',
  });
}

export async function onRequestPost(context) {
  const login = getLogin(context);
  if (!login) return json({ error: 'unauthorized' }, 401);

  const body = await context.request.json().catch(() => ({}));
  const name = String(body.name || '').slice(0, 40);
  const about = String(body.about || '').slice(0, 2000);
  const skills = Array.isArray(body.skills)
    ? body.skills.map((s) => String(s).slice(0, 30)).filter(Boolean).slice(0, 20)
    : [];
  const links = Array.isArray(body.links)
    ? body.links
        .map((l) => ({ label: String(l.label || '').slice(0, 40), url: String(l.url || '').slice(0, 500) }))
        .slice(0, 10)
    : [];
  const ghAvatar = typeof body.ghAvatar === 'boolean' ? body.ghAvatar : false;
  let themeColor = String(body.themeColor || '').trim();
  if (themeColor && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(themeColor)) themeColor = '';
  // 主题 id：只放行安全字符集，不合法就清空（配色本身由前端常量提供）
  let themeId = String(body.themeId || '').trim().toLowerCase();
  if (themeId && !THEME_ID_RE.test(themeId)) themeId = '';
  // 头图来源：仅放行 'theme' / 'image'，其余（含空串）视为"沿用旧逻辑"
  let bannerMode = String(body.bannerMode || '').trim().toLowerCase();
  if (bannerMode !== 'theme' && bannerMode !== 'image') bannerMode = '';

  const bad = scanTexts([
    name,
    about,
    ...skills,
    ...links.map((l) => l.label + ' ' + l.url),
  ]);
  if (bad) return json({ error: 'forbidden', word: bad }, 400);

  const prof = { name, about, skills, links, ghAvatar, themeColor, themeId, bannerMode, updated: Date.now() };
  await context.env.USER_PREFS.put('profile:' + login, JSON.stringify(prof));

  // 头像单独存 KV（可存 data URL 大图），此处放行到 3MB；空串表示恢复默认
  if (typeof body.avatar === 'string') {
    if (body.avatar) await context.env.USER_PREFS.put('avatar:' + login, body.avatar.slice(0, 3000000));
    else await context.env.USER_PREFS.delete('avatar:' + login);
  }

  // upsert 到用户目录
  let idxRaw = await context.env.USER_PREFS.get('users:index');
  let idx = idxRaw ? JSON.parse(idxRaw) : [];
  if (!Array.isArray(idx)) idx = [];
  const finalAvatar = ghAvatar ? defaultAvatar(login) : (body.avatar ? body.avatar : defaultAvatar(login));
  const entry = { login, name: name || login, bio: about.slice(0, 160), avatar: finalAvatar };
  const i = idx.findIndex((u) => u.login === login);
  if (i >= 0) idx[i] = entry;
  else idx.push(entry);
  await context.env.USER_PREFS.put('users:index', JSON.stringify(idx));

  return json({ ok: true });
}
