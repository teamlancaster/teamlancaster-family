// Proves the admin gate fails closed: no JWT, bad/forged JWT, wrong AUD/issuer, expired,
// non-allowlisted email, unconfigured Access, workers.dev host, bad Origin => 403.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { baseEnv, call, makeKeys, signJwt, stubFetch, TEAM, AUD } from './helpers.js';
import { _resetJwksCache, isLocalDevBypass } from '../src/lib/access.js';

let keys, evil, env;
const PROD = 'https://teamlancaster.com';
const ADMIN_ROUTES = ['/admin', '/admin/', '/admin/people', '/admin/branches', '/ADMIN', '/Admin/People', '/api/admin/whoami', '/api/admin/people', '/api/admin/export', '/api/admin/branches'];

beforeAll(async () => { keys = await makeKeys('kid-1'); evil = await makeKeys('kid-1'); });
beforeEach(() => { _resetJwksCache(); vi.stubGlobal('fetch', stubFetch([keys.jwk])); env = baseEnv(); });

describe('admin gate: fails closed', () => {
  it.each(ADMIN_ROUTES)('no JWT -> 403 on %s', async (p) => {
    const r = await call(env, PROD + p);
    expect(r.status).toBe(403);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
  });
  it('garbage JWT -> 403', async () => {
    for (const t of ['abc', 'a.b.c', 'eyJhbGciOiJub25lIn0.eyJlbWFpbCI6ImFkbWluQGV4YW1wbGUuY29tIn0.', '']) {
      expect((await call(env, PROD + '/api/admin/whoami', { headers: { 'cf-access-jwt-assertion': t } })).status).toBe(403);
    }
  });
  it('forged JWT (signed by a different key with the same kid) -> 403', async () => {
    const t = await signJwt(evil);
    expect((await call(env, PROD + '/api/admin/whoami', { headers: { 'cf-access-jwt-assertion': t } })).status).toBe(403);
  });
  it('alg=none / HS256 header -> 403', async () => {
    const t = await signJwt(keys, {}, { alg: 'HS256' });
    expect((await call(env, PROD + '/api/admin/whoami', { headers: { 'cf-access-jwt-assertion': t } })).status).toBe(403);
  });
  it('wrong AUD -> 403', async () => {
    const t = await signJwt(keys, { aud: ['some-other-app'] });
    expect((await call(env, PROD + '/api/admin/whoami', { headers: { 'cf-access-jwt-assertion': t } })).status).toBe(403);
  });
  it('wrong issuer -> 403', async () => {
    const t = await signJwt(keys, { iss: 'https://attacker.cloudflareaccess.com' });
    expect((await call(env, PROD + '/api/admin/whoami', { headers: { 'cf-access-jwt-assertion': t } })).status).toBe(403);
  });
  it('expired -> 403', async () => {
    const t = await signJwt(keys, { exp: Math.floor(Date.now() / 1000) - 10 });
    expect((await call(env, PROD + '/api/admin/whoami', { headers: { 'cf-access-jwt-assertion': t } })).status).toBe(403);
  });
  it('email not on the admin list -> 403', async () => {
    const t = await signJwt(keys, { email: 'someone@else.com' });
    expect((await call(env, PROD + '/api/admin/whoami', { headers: { 'cf-access-jwt-assertion': t } })).status).toBe(403);
  });
  it('Access not configured (placeholders) -> 403 even with a valid token', async () => {
    const t = await signJwt(keys);
    for (const o of [{ ACCESS_AUD: 'REPLACE_ME' }, { ACCESS_TEAM_DOMAIN: 'REPLACE_ME.cloudflareaccess.com' }, { ACCESS_AUD: '' }, { ADMIN_EMAILS: '' }]) {
      expect((await call(baseEnv(o), PROD + '/api/admin/whoami', { headers: { 'cf-access-jwt-assertion': t } })).status).toBe(403);
    }
  });
  it('certs endpoint down -> 403', async () => {
    vi.stubGlobal('fetch', async () => new Response('down', { status: 500 }));
    const t = await signJwt(keys);
    expect((await call(env, PROD + '/api/admin/whoami', { headers: { 'cf-access-jwt-assertion': t } })).status).toBe(403);
  });
  it('JWT in a cookie only (no header) -> 403', async () => {
    const t = await signJwt(keys);
    expect((await call(env, PROD + '/api/admin/whoami', { headers: { cookie: `CF_Authorization=${t}` } })).status).toBe(403);
  });
  it('valid JWT -> 200 on teamlancaster.com', async () => {
    const t = await signJwt(keys);
    const r = await call(env, PROD + '/api/admin/whoami', { headers: { 'cf-access-jwt-assertion': t } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ email: 'admin@example.com', dev: false });
  });
});

describe('workers.dev / preview / unknown hosts are blocked', () => {
  const hosts = ['https://teamlancaster-family.chris.workers.dev', 'https://abc123-teamlancaster-family.chris.workers.dev', 'https://evil.example.com'];
  it.each(hosts)('%s: admin without JWT -> 403', async (h) => {
    expect((await call(env, h + '/admin')).status).toBe(403);
    expect((await call(env, h + '/api/admin/whoami')).status).toBe(403);
  });
  it.each(hosts)('%s: even the public page needs Access -> 403', async (h) => {
    expect((await call(env, h + '/')).status).toBe(403);
  });
  it('workers.dev with ENVIRONMENT=local (misconfig) is still blocked', async () => {
    const e = baseEnv({ ENVIRONMENT: 'local' });
    expect((await call(e, hosts[0] + '/admin')).status).toBe(403);
    expect((await call(e, hosts[0] + '/api/admin/whoami', { headers: { host: 'localhost:8787' } })).status).toBe(403);
  });
  it('workers.dev with a forged JWT -> 403', async () => {
    const t = await signJwt(evil);
    expect((await call(env, hosts[0] + '/api/admin/whoami', { headers: { 'cf-access-jwt-assertion': t } })).status).toBe(403);
  });
});

describe('local dev bypass is impossible outside local+localhost', () => {
  it('localhost + ENVIRONMENT=production -> 403', async () => {
    expect((await call(baseEnv(), 'http://localhost:8787/api/admin/whoami')).status).toBe(403);
  });
  it('localhost + ENVIRONMENT unset -> 403', async () => {
    expect((await call(baseEnv({ ENVIRONMENT: undefined }), 'http://localhost:8787/api/admin/whoami')).status).toBe(403);
  });
  it('teamlancaster.com + ENVIRONMENT=local -> 403 (bypass needs a loopback host)', async () => {
    expect((await call(baseEnv({ ENVIRONMENT: 'local' }), PROD + '/api/admin/whoami')).status).toBe(403);
  });
  it('localhost URL but non-loopback Host header -> 403', async () => {
    const e = baseEnv({ ENVIRONMENT: 'local' });
    expect((await call(e, 'http://localhost:8787/api/admin/whoami', { headers: { host: 'teamlancaster.com' } })).status).toBe(403);
  });
  it('localhost + ENVIRONMENT=local -> allowed (dev only)', async () => {
    const r = await call(baseEnv({ ENVIRONMENT: 'local', DEV_ADMIN_EMAIL: 'dev@localhost' }), 'http://localhost:8787/api/admin/whoami');
    expect(r.status).toBe(200);
    expect((await r.json()).dev).toBe(true);
  });
  it('isLocalDevBypass unit checks', () => {
    const req = (u, h) => new Request(u, { headers: { host: h } });
    expect(isLocalDevBypass(req('http://localhost/', 'localhost'), { ENVIRONMENT: 'local' })).toBe(true);
    expect(isLocalDevBypass(req('http://127.0.0.1:8787/', '127.0.0.1:8787'), { ENVIRONMENT: 'local' })).toBe(true);
    expect(isLocalDevBypass(req('http://localhost/', 'localhost'), { ENVIRONMENT: 'Local' })).toBe(false);
    expect(isLocalDevBypass(req('https://x.workers.dev/', 'x.workers.dev'), { ENVIRONMENT: 'local' })).toBe(false);
    expect(isLocalDevBypass(req('http://localhost.evil.com/', 'localhost.evil.com'), { ENVIRONMENT: 'local' })).toBe(false);
  });
});

describe('CSRF Origin check on state-changing admin requests', () => {
  it('POST with valid JWT but no/foreign Origin -> 403', async () => {
    const t = await signJwt(keys);
    for (const origin of [null, 'https://evil.example.com', 'https://teamlancaster.com.evil.com', 'http://teamlancaster.com', 'null']) {
      const headers = { 'cf-access-jwt-assertion': t, 'content-type': 'application/json' };
      if (origin) headers.origin = origin;
      const r = await call(env, PROD + '/api/admin/people', { method: 'POST', headers, body: JSON.stringify({ first_name: 'Example' }) });
      expect(r.status).toBe(403);
    }
  });
  it('POST with valid JWT and the right Origin -> allowed', async () => {
    const t = await signJwt(keys);
    const r = await call(env, PROD + '/api/admin/people', { method: 'POST', headers: { 'cf-access-jwt-assertion': t, origin: PROD, 'content-type': 'application/json' }, body: JSON.stringify({ first_name: 'Example', last_name: 'Person' }) });
    expect(r.status).toBe(201);
  });
});
