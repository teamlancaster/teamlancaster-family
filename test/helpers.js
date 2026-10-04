// Test harness: a D1-compatible adapter over node:sqlite, fake R2, and an Access JWT minting kit.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';

export function makeD1({ seed = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  if (seed) db.exec(readFileSync(new URL('../scripts/seed-dev.sql', import.meta.url), 'utf8'));
  const stmt = (sql, params = []) => ({
    bind: (...p) => stmt(sql, p),
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    first: async () => db.prepare(sql).get(...params) ?? null,
    run: async () => { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: r.changes } }; },
  });
  return { prepare: (sql) => stmt(sql), _raw: db };
}

export function makeR2() {
  const m = new Map();
  return { _m: m,
    put: async (k, v) => { m.set(k, v); },
    get: async (k) => (m.has(k) ? { body: m.get(k) } : null),
    delete: async (ks) => { for (const k of [].concat(ks)) m.delete(k); } };
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const TEAM = 'example-team.cloudflareaccess.com';
export const AUD = 'aud-test-1234567890';
export const ADMIN = 'admin@example.com';

export async function makeKeys(kid = 'kid-1') {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  return { kid, kp, jwk: { kty: 'RSA', n: jwk.n, e: jwk.e, kid, alg: 'RS256', use: 'sig' } };
}
export async function signJwt(keys, claims = {}, header = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = { alg: 'RS256', kid: keys.kid, typ: 'JWT', ...header };
  const p = { iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: now, nbf: now, exp: now + 3600, sub: 'x', ...claims };
  const data = `${b64url(JSON.stringify(h))}.${b64url(JSON.stringify(p))}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.kp.privateKey, new TextEncoder().encode(data));
  return `${data}.${b64url(sig)}`;
}

/** Global fetch stub: serves the team JWKS, Turnstile siteverify, and records Resend calls. */
export function stubFetch(jwks, calls = []) {
  return async (url, init) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u === `https://${TEAM}/cdn-cgi/access/certs`) return new Response(JSON.stringify({ keys: jwks }), { headers: { 'content-type': 'application/json' } });
    if (u.includes('turnstile/v0/siteverify')) { const tok = init.body.get('response'); return Response.json({ success: tok === 'good-token' }); }
    if (u.startsWith('https://api.resend.com/')) return Response.json({ id: 'email_1' });
    return new Response('not stubbed', { status: 599 });
  };
}

export function baseEnv(overrides = {}) {
  return {
    ENVIRONMENT: 'production',
    CANONICAL_HOSTS: 'teamlancaster.com,www.teamlancaster.com',
    ADMIN_ORIGIN: 'https://teamlancaster.com',
    SITE_URL: 'https://teamlancaster.com',
    ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN,
    NOTIFY_TO: 'lancaster-ai@teamlancaster.com', NOTIFY_FROM: 'Team Lancaster <notify@notify.teamlancaster.com>',
    TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET: 'secret', IP_HASH_PEPPER: 'pepper', COOKIE_HMAC_KEY: 'cookie',
    RESEND_API_KEY: 're_test_dummy',
    DB: makeD1(), PHOTOS: makeR2(),
    ASSETS: { fetch: async () => new Response('asset', { headers: { 'content-type': 'text/css' } }) },
    ...overrides,
  };
}

export async function call(env, url, init = {}) {
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p), passThroughOnException() {} };
  const headers = new Headers(init.headers || {});
  if (!headers.has('host')) headers.set('host', new URL(url).host);
  const res = await worker.fetch(new Request(url, { ...init, headers }), env, ctx);
  await Promise.all(waits);
  return res;
}
