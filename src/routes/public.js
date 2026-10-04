// Public routes. First names only, no photos, no surnames, no minors (spec + reviewer fix 1/2).
import { json, readJson, HttpError, html } from '../lib/http.js';
import { publicFactsTree, publicFactsSearch } from '../lib/public-dataset.js';
import { answerGuide, guideEnv } from '../lib/guide.js';
import { verifyTurnstile } from '../lib/turnstile.js';
import { ipHash } from '../lib/crypto.js';
import { sendPointerEmail } from '../lib/notify.js';
import { publicPage } from '../views/public.js';

export const LIMITS = { name: 80, person: 200, change: 2000, perHour: 3 };
const KINDS = ['edit', 'add', 'privacy', 'other'];

export async function handlePublic(request, env, ctx, url) {
  const { pathname } = url;
  const ip = request.headers.get('cf-connecting-ip') || '';

  if (pathname === '/' && request.method === 'GET') {
    return html(publicPage({ tree: publicFactsTree(), siteKey: env.TURNSTILE_SITE_KEY }));
  }
  if (pathname === '/api/public/tree' && request.method === 'GET') return json(publicFactsTree());
  if (pathname === '/api/public/search' && request.method === 'GET') return json(publicFactsSearch(url.searchParams.get('q')));

  if (pathname === '/api/guide' && request.method === 'POST') {
    const { q } = await readJson(request, 4096);
    // guideEnv() hands the guide ONLY AI + its KV + limits. No DB, no R2, no Vectorize.
    return json(await answerGuide(q, guideEnv(env), ip));
  }

  if (pathname === '/api/request' && request.method === 'POST') {
    // Public form is TEXT ONLY: multipart (file uploads) is refused outright.
    const ct = request.headers.get('content-type') || '';
    if (!ct.startsWith('application/json')) throw new HttpError(415, 'Text only.');
    const b = await readJson(request, 8 * 1024);
    const name = String(b.name || '').trim(), person = String(b.person || '').trim(), change = String(b.change || '').trim();
    if (!name || !person || !change) throw new HttpError(422, 'Please fill in your name, who it is about, and what should change.');
    if (name.length > LIMITS.name || person.length > LIMITS.person || change.length > LIMITS.change) throw new HttpError(422, 'That is a bit long. Please shorten it.');
    if (!(await verifyTurnstile(env, b.turnstile, ip))) throw new HttpError(403, 'Please complete the check and try again.');
    const h = await ipHash(env, ip);
    const now = Math.floor(Date.now() / 1000);
    const hits = await env.DB.prepare('SELECT COUNT(*) AS n FROM form_hit WHERE ip_hash=? AND at>?').bind(h, now - 3600).first();
    if ((hits?.n || 0) >= LIMITS.perHour) throw new HttpError(429, 'Too many requests from here. Please try again in an hour.');
    await env.DB.prepare('INSERT INTO form_hit (ip_hash, at) VALUES (?,?)').bind(h, now).run();
    const kind = KINDS.includes(b.kind) ? b.kind : 'edit';
    // Stored as untrusted text. branch_id is NULL: public requests are never attributed to a branch.
    const r = await env.DB.prepare(`INSERT INTO change_request (source, branch_id, requester_name, person_text, change_text, kind, ip_hash)
      VALUES ('public', NULL, ?, ?, ?, ?, ?) RETURNING id`).bind(name, person, change, kind, h).first();
    ctx.waitUntil((async () => {
      const res = await sendPointerEmail(env, { id: r.id, branchLabel: null });
      if (res.ok) await env.DB.prepare("UPDATE change_request SET notified_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(r.id).run();
    })().catch(() => {}));
    return json({ ok: true, message: 'Thank you. A family admin will review your request.' }, 201);
  }
  return null;
}
