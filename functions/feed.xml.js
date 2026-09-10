// Cloudflare Pages Function: /feed.xml  (RSS 2.0 订阅源)
// GET /feed.xml -> 返回最新已发布帖子的 RSS（公开，无需登录）
import { htmlToText, sanitizeHtml } from './_lib/sanitize.js';

const KEY = 'posts:list';
const MAX = 20;

async function readList(kv) {
  const raw = await kv.get(KEY);
  let list = raw ? JSON.parse(raw) : [];
  return Array.isArray(list) ? list : [];
}

function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function onRequestGet(context) {
  const kv = context.env.USER_PREFS;
  const url = new URL(context.request.url);
  const origin = url.origin;
  const list = await readList(kv);
  const posts = list.filter((p) => p.status !== 'draft').slice(0, MAX);

  const items = posts.map(function (p) {
    const body = typeof p.body === 'string' ? p.body : '';
    const text = htmlToText(sanitizeHtml(body) || body).replace(/\s+/g, ' ').trim();
    const desc = text.length > 300 ? text.slice(0, 297) + '…' : text;
    const link = origin + '/post/detail/?post=' + encodeURIComponent(p.id);
    const pub = p.ts ? new Date(p.ts).toUTCString() : new Date().toUTCString();
    return (
      '    <item>' +
      '<title>' + escXml(p.title || '(无标题)') + '</title>' +
      '<link>' + link + '</link>' +
      '<guid isPermaLink="false">' + link + '</guid>' +
      '<pubDate>' + pub + '</pubDate>' +
      '<author>' + escXml(p.login || 'unknown') + '@jerry-webpage</author>' +
      '<description>' + escXml(desc) + '</description>' +
      '</item>'
    );
  }).join('\n');

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0">\n' +
    '  <channel>\n' +
    '    <title>Jerry\'s webpage · 帖子</title>\n' +
    '    <link>' + origin + '/</link>\n' +
    '    <description>Jerry\'s webpage 最新帖子订阅源</description>\n' +
    '    <language>zh-CN</language>\n' +
    '    <lastBuildDate>' + new Date().toUTCString() + '</lastBuildDate>\n' +
    items + '\n' +
    '  </channel>\n' +
    '</rss>';

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300'
    }
  });
}
