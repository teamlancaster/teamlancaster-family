// Response helpers + the family-only header policy applied to EVERY response.

// Spec + Chris's 4:20 PM decision: no indexing, no archiving, no snippets, no image indexing.
export const ROBOTS_HEADER = 'noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate';
export const ROBOTS_META = 'noindex,nofollow,noarchive,nosnippet,noimageindex';

// Archive + AI crawlers: disallowed in robots.txt AND refused by the Worker (403).
// Search engines are deliberately NOT blocked: they must fetch pages to see the noindex.
export const BLOCKED_BOTS = [
  'ia_archiver', 'archive.org_bot', 'special_archiver', 'Wayback', 'heritrix', 'Arquivo-web-crawler',
  'CCBot', 'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-Web', 'anthropic-ai',
  'Google-Extended', 'PerplexityBot', 'Perplexity-User', 'Bytespider', 'Amazonbot', 'Applebot-Extended',
  'meta-externalagent', 'FacebookBot', 'cohere-ai', 'Diffbot', 'ImagesiftBot', 'Omgilibot', 'YouBot',
  'Timpibot', 'AI2Bot', 'img2dataset',
];
const BOT_RE = new RegExp(BLOCKED_BOTS.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
export const isBlockedBot = (ua) => !!ua && BOT_RE.test(ua);

export function robotsTxt() {
  // No Sitemap line, ever. No blanket Disallow: search engines must be able to read the noindex.
  const lines = ['# Family-only site. Not for indexing, archiving, or AI training.'];
  for (const b of BLOCKED_BOTS) lines.push(`User-agent: ${b}`, 'Disallow: /', '');
  lines.push('User-agent: *', 'Disallow: /admin', 'Disallow: /api/', '');
  return lines.join('\n');
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

/** Apply the security + noindex headers. `cache`: 'public' (front page/assets) or 'private'. */
export function withSecurityHeaders(res, { cache = 'private', https = true } = {}) {
  const r = new Response(res.body, res);
  const h = r.headers;
  h.set('X-Robots-Tag', ROBOTS_HEADER);
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  if (!h.has('Content-Security-Policy')) h.set('Content-Security-Policy', CSP);
  if (https) h.set('Strict-Transport-Security', 'max-age=31536000');
  if (cache === 'public') {
    if (!h.has('Cache-Control')) h.set('Cache-Control', 'public, max-age=300');
  } else {
    h.set('Cache-Control', 'private, no-store');
  }
  return r;
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
export const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
export const text = (body, status = 200, type = 'text/plain; charset=utf-8') =>
  new Response(body, { status, headers: { 'content-type': type } });
export const forbidden = () => text('Forbidden', 403);
export const notFound = () => text('Not found', 404);

export const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));

export async function readJson(request, maxBytes = 64 * 1024) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBytes) throw new HttpError(413, 'Too large');
  const t = await request.text();
  if (t.length > maxBytes) throw new HttpError(413, 'Too large');
  try { return JSON.parse(t || '{}'); } catch { throw new HttpError(400, 'Bad JSON'); }
}
export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
