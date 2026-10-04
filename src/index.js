// teamlancaster-family Worker: static assets + public page + admin (Phase 1-2).
import { withSecurityHeaders, robotsTxt, isBlockedBot, text, json, forbidden, notFound, HttpError } from './lib/http.js';
import { requireAdmin, isAdminPath, isLocalDevBypass, verifyAccessJwt } from './lib/access.js';
import { handlePublic } from './routes/public.js';
import { handleAdminApi } from './routes/admin-api.js';
import { handleAdminPage } from './views/admin.js';

const canonicalHosts = (env) => String(env.CANONICAL_HOSTS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  const p = url.pathname;

  // Archive + AI crawlers are refused everywhere (robots.txt alone is advisory).
  if (isBlockedBot(request.headers.get('user-agent'))) return { res: forbidden() };
  if (p === '/robots.txt') return { res: text(robotsTxt()), cache: 'public' };
  if (p === '/sitemap.xml' || p.startsWith('/sitemap')) return { res: notFound() }; // never a sitemap

  const local = isLocalDevBypass(request, env);
  // Non-canonical hosts (*.workers.dev, preview URLs, anything else) are private in full:
  // every route needs a valid Access JWT there. Fails closed.
  if (!local && !canonicalHosts(env).includes(host)) {
    const v = await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'), env);
    if (!v.ok) return { res: forbidden() };
  }

  // Admin: fail-closed Access JWT check on EVERY admin route, on EVERY host.
  if (isAdminPath(p)) {
    const admin = await requireAdmin(request, env);
    if (!admin.ok) return { res: forbidden() };
    if (p.startsWith('/api/admin')) return { res: await handleAdminApi(request, env, ctx, admin, url) };
    return { res: await handleAdminPage(request, env, admin, url) };
  }

  if (p.startsWith('/assets/') || p === '/favicon.ico') {
    const a = p === '/favicon.ico' ? new Request(new URL('/assets/favicon.png', url), request) : request;
    return { res: await env.ASSETS.fetch(a), cache: 'public' };
  }

  const pub = await handlePublic(request, env, ctx, url);
  if (pub) return { res: pub, cache: p === '/' ? 'public' : 'private' };
  return { res: notFound() };
}

export default {
  async fetch(request, env, ctx) {
    let out;
    try {
      out = await route(request, env, ctx);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error('error', e && e.stack);
      out = { res: json({ error: status === 500 ? 'Something went wrong.' : e.message }, status) };
    }
    const https = new URL(request.url).protocol === 'https:';
    return withSecurityHeaders(out.res, { cache: out.cache || 'private', https });
  },

  // Daily retention (reviewer fix 3 + spec §7).
  async scheduled(event, env, ctx) {
    const db = env.DB;
    // Resolved requests older than 90 days, and their quarantined uploads.
    const { results: q } = await db.prepare(`SELECT uq.id, uq.r2_key, uq.clean_key FROM upload_quarantine uq
      LEFT JOIN change_request r ON r.id=uq.request_id
      WHERE uq.created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days') AND (r.id IS NULL OR r.status <> 'pending' OR uq.state IN ('rejected','quarantined'))`).all();
    for (const row of q) { await env.PHOTOS.delete([row.r2_key, row.clean_key].filter(Boolean)); await db.prepare('DELETE FROM upload_quarantine WHERE id=?').bind(row.id).run(); }
    await db.prepare(`DELETE FROM change_request WHERE status <> 'pending' AND resolved_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days')`).run();
    // Soft-deleted photos: purge R2 objects after 30 days.
    const { results: ph } = await db.prepare(`SELECT id, r2_key, thumb_key FROM photo WHERE deleted_at IS NOT NULL AND deleted_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')`).all();
    for (const row of ph) { await env.PHOTOS.delete([row.r2_key, row.thumb_key].filter(Boolean)); await db.prepare('DELETE FROM photo WHERE id=?').bind(row.id).run(); }
    // Throttle tables.
    const now = Math.floor(Date.now() / 1000);
    await db.prepare('DELETE FROM form_hit WHERE at < ?').bind(now - 86400).run();
    await db.prepare('DELETE FROM login_fail WHERE at < ?').bind(now - 86400).run();
  },
};
