// Cloudflare Access JWT verification. FAILS CLOSED: any missing config, missing header,
// bad signature, wrong issuer/AUD, expired token, or unexpected email => not authorized.
// Applies on EVERY host (teamlancaster.com, *.workers.dev, preview URLs, anything else).
// Docs: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/

const JWKS_TTL_MS = 10 * 60 * 1000;
let jwksCache = { url: '', at: 0, keys: null };
export function _resetJwksCache() { jwksCache = { url: '', at: 0, keys: null }; }

const b64urlToBytes = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

function teamOrigin(env) {
  const d = String(env.ACCESS_TEAM_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  // Must be a real team domain; placeholders fail closed.
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(d) || /replace_me/i.test(d)) return null;
  return `https://${d}`;
}

async function getKeys(certsUrl, fetchImpl, forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && jwksCache.keys && jwksCache.url === certsUrl && now - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetchImpl(certsUrl, { cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error('certs fetch failed');
  const body = await res.json();
  if (!body || !Array.isArray(body.keys)) throw new Error('bad certs');
  jwksCache = { url: certsUrl, at: now, keys: body.keys };
  return body.keys;
}

/**
 * Verify a Cf-Access-Jwt-Assertion token.
 * @returns {Promise<{ok:true,email:string}|{ok:false,reason:string}>}
 */
export async function verifyAccessJwt(token, env, { fetchImpl = fetch, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  try {
    const origin = teamOrigin(env);
    // ACCESS_AUD may list several AUD tags (comma-separated), e.g. the teamlancaster.com admin app
    // plus a workers.dev Access app during development.
    const audList = String(env.ACCESS_AUD || '').split(',').map((s) => s.trim()).filter((s) => s && !/replace_me/i.test(s));
    if (!origin || !audList.length) return { ok: false, reason: 'access-not-configured' };
    if (!token || typeof token !== 'string') return { ok: false, reason: 'no-jwt' };
    const parts = token.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'malformed' };
    const header = b64urlJson(parts[0]);
    const payload = b64urlJson(parts[1]);
    if (header.alg !== 'RS256' || !header.kid) return { ok: false, reason: 'bad-alg' };

    const certsUrl = `${origin}/cdn-cgi/access/certs`;
    let keys = await getKeys(certsUrl, fetchImpl, false);
    let jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) { keys = await getKeys(certsUrl, fetchImpl, true); jwk = keys.find((k) => k.kid === header.kid); }
    if (!jwk || jwk.kty !== 'RSA') return { ok: false, reason: 'unknown-kid' };

    const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return { ok: false, reason: 'bad-signature' };

    if (payload.iss !== origin) return { ok: false, reason: 'bad-issuer' };
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.some((a) => audList.includes(a))) return { ok: false, reason: 'bad-aud' };
    if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return { ok: false, reason: 'expired' };
    if (typeof payload.nbf === 'number' && payload.nbf > nowSec + 60) return { ok: false, reason: 'not-yet-valid' };
    const email = String(payload.email || '').toLowerCase();
    if (!email) return { ok: false, reason: 'no-email' };
    const allow = String(env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
    if (!allow.length || !allow.includes(email)) return { ok: false, reason: 'email-not-allowed' };
    return { ok: true, email };
  } catch {
    return { ok: false, reason: 'verify-error' };
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Dev-only bypass. ALL must hold: ENVIRONMENT==='local' (set only by .dev.vars, which is never
 * deployed; wrangler.jsonc ships "production"), the request URL hostname is a loopback name, AND
 * the Host header is a loopback name. Cloudflare's edge routes by Host, so a deployed Worker can
 * never receive a loopback Host, even if ENVIRONMENT were misconfigured.
 */
export function isLocalDevBypass(request, env) {
  if (env.ENVIRONMENT !== 'local') return false;
  let urlHost;
  try { urlHost = new URL(request.url).hostname; } catch { return false; }
  const hostHdr = String(request.headers.get('host') || '').replace(/:\d+$/, '');
  return LOCAL_HOSTS.has(urlHost) && LOCAL_HOSTS.has(hostHdr);
}

/** True for paths that must be admin-gated. */
export function isAdminPath(pathname) {
  const p = pathname.toLowerCase();
  return p === '/admin' || p.startsWith('/admin/') || p === '/api/admin' || p.startsWith('/api/admin/');
}

/**
 * Gate for admin routes. Returns {ok:true,email} or {ok:false,status:403,reason}.
 * Also enforces the CSRF Origin check on state-changing methods.
 */
export async function requireAdmin(request, env, opts = {}) {
  let ident;
  if (isLocalDevBypass(request, env)) {
    ident = { ok: true, email: String(env.DEV_ADMIN_EMAIL || 'dev@localhost'), dev: true };
  } else {
    ident = await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'), env, opts);
  }
  if (!ident.ok) return { ok: false, status: 403, reason: ident.reason };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    // Local dev bypass compares against the dev server's own origin (any port); production uses ADMIN_ORIGIN.
    const expected = ident.dev ? new URL(request.url).origin : String(env.ADMIN_ORIGIN || '').replace(/\/+$/, '');
    if (!origin || !expected || origin !== expected) return { ok: false, status: 403, reason: 'bad-origin' };
  }
  return ident;
}
