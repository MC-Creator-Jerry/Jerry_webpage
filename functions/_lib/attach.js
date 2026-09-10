// 附件（图片 / 视频）通用校验与清洗
// 仅允许：http(s) 外链、以 / 开头的站内路径、/api/file?... 上传文件
// 防止把任意 javascript: / data: 等非媒体 URL 存进 KV 并在前端渲染成 XSS。
const SAFE_RE = /^https?:\/\//i;
const SITE_RE = /^\//;
const FILE_RE = /^\/api\/file(\?|$)/i;

export function isValidAttachUrl(u) {
  if (typeof u !== 'string') return false;
  u = u.trim();
  if (!u) return false;
  if (SAFE_RE.test(u)) return true;
  if (SITE_RE.test(u)) return true;
  if (FILE_RE.test(u)) return true;
  return false;
}

// 把前端传来的 attachments 数组清洗成受信任的结构：
//   [{ type: 'image' | 'video', url: string }, ...]
// 非法项直接丢弃；最多保留 max 个（默认 9）。
export function sanitizeAttachments(arr, max) {
  max = max || 9;
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (let i = 0; i < arr.length && out.length < max; i++) {
    const a = arr[i];
    if (!a) continue;
    const type = a.type === 'video' ? 'video' : (a.type === 'image' ? 'image' : null);
    if (!type) continue;
    const url = String(a.url || '').trim();
    if (!isValidAttachUrl(url)) continue;
    out.push({ type, url });
  }
  return out;
}
