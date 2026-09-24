// Cloudflare Pages Function: /api/usersettings
// GET  -> { prefs }          (reads gh_user cookie)
// POST { prefs } -> { ok }   (reads gh_user cookie)
// Storage: KV namespace bound as USER_PREFS (key: prefs:<github_login>).
export async function onRequestGet(context) {
  const login = getCookie(context.request, 'gh_user');
  if (!login) return json({ error: 'unauthorized' }, 401);
  const raw = await context.env.USER_PREFS.get('prefs:' + login);
  return json({ prefs: raw ? JSON.parse(raw) : {} });
}

export async function onRequestPost(context) {
  const login = getCookie(context.request, 'gh_user');
  if (!login) return json({ error: 'unauthorized' }, 401);
  const body = await context.request.json().catch(() => ({}));
  if (!body.prefs) return json({ error: 'missing prefs' }, 400);
  await context.env.USER_PREFS.put('prefs:' + login, JSON.stringify(body.prefs));
  return json({ ok: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function getCookie(req, name) {
  const h = req.headers.get('cookie');
  if (!h) return null;
  const m = h.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
