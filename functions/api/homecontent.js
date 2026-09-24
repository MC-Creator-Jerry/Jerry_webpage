// Cloudflare Pages Function: /api/homecontent
// GET  -> { content }            (public; returns the published homepage content)
// POST { content } -> { ok }     (auth required; admin may write; forbidden-word scan on all text fields)
// Storage: KV namespace bound as USER_PREFS, key "home:content".
import { getLogin, isAdminLogin, json } from '../_lib/auth.js';
import { scanTexts } from '../_lib/forbidden.js';

export async function onRequestGet(context) {
  const raw = await context.env.USER_PREFS.get('home:content');
  return json({ content: raw ? JSON.parse(raw) : null });
}

export async function onRequestPost(context) {
  if (!(await isAdminLogin(context, getLogin(context)))) {
    return json({ error: 'forbidden' }, 403);
  }
  const body = await context.request.json().catch(() => ({}));
  if (!body || !body.content) return json({ error: 'missing content' }, 400);
  const bad = scanTexts([
    body.content.bio || '',
    body.content.about || '',
    ...(body.content.skills || []),
    ...(body.content.projects || []).flatMap((p) => [p.title || '', p.desc || '']),
  ]);
  if (bad) return json({ error: 'forbidden', word: bad }, 400);
  await context.env.USER_PREFS.put('home:content', JSON.stringify(body.content));
  return json({ ok: true });
}
