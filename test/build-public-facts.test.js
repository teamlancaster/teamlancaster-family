// The public facts file is generated from D1 at build time, and the running Worker never reads D1
// for the public page, the public search, or the public guide.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { projectPublicFacts, renderPublicFactsModule, FactsError } from '../scripts/build-public-facts.js';
import { baseEnv, call, stubFetch } from './helpers.js';

const row = (over = {}) => ({
  role: 'founder', first_name: 'Example', adult_confirmed: 1, public_ok: 1, hidden: 0,
  birth_year: 1950, death_year: null, is_deceased: 0, branch_id: null, ord: 0, ...over,
});
const LOCAL = 'http://localhost:8787';
const devEnv = (o = {}) => baseEnv({ ENVIRONMENT: 'local', ADMIN_ORIGIN: LOCAL, DEV_ADMIN_EMAIL: 'dev@localhost', ...o });

describe('projectPublicFacts', () => {
  it('keeps first names and roles only', () => {
    const facts = projectPublicFacts([
      row(), row({ first_name: 'Sample', birth_year: 1952 }),
      row({ role: 'branch', first_name: 'Test', branch_id: 'b1', birth_year: 1975 }),
    ]);
    expect(facts).toEqual({ founders: ['Example', 'Sample'], branchParents: ['Test'] });
    const rendered = renderPublicFactsModule(facts);
    expect(rendered).not.toMatch(/last_name|birth_year|1950|1975|b1/);
    expect(rendered).toContain('"Example"');
  });
  it('refuses an unconfirmed adult and writes nothing', () => {
    expect(() => projectPublicFacts([row({ first_name: 'Pat', adult_confirmed: 0, birth_year: 1980 })])).toThrow(FactsError);
    expect(() => projectPublicFacts([row({ first_name: 'Pat', adult_confirmed: 0, birth_year: 1980 })])).toThrow(/not a confirmed adult/);
  });
  it('refuses a minor, even one flagged public', () => {
    expect(() => projectPublicFacts([row({ first_name: 'Kid', adult_confirmed: 0, birth_year: 2015 })])).toThrow(/minor/);
  });
  it('refuses a row carrying any field beyond the first name and the role', () => {
    expect(() => projectPublicFacts([row({ last_name: 'Secret-Surname' })])).toThrow(/beyond first name and role/);
    expect(() => projectPublicFacts([row({ id: 'p_real_id' })])).toThrow(/beyond first name and role/);
  });
  it('ignores people who are not on the public page', () => {
    const facts = projectPublicFacts([
      row(), row({ role: 'branch', first_name: 'Hidden', public_ok: 0, adult_confirmed: 0, birth_year: 2016, branch_id: 'b9' }),
    ]);
    expect(facts.branchParents).toEqual([]);
  });
  it('takes one first name per branch, the public partner', () => {
    const facts = projectPublicFacts([
      row({ role: 'branch', first_name: 'Nope', public_ok: 0, adult_confirmed: 0, branch_id: 'b1', ord: 0 }),
      row({ role: 'branch', first_name: 'Demo', branch_id: 'b1', ord: 1 }),
    ]);
    expect(facts.branchParents).toEqual(['Demo']);
  });
});

describe('public routes read the bundled file, never D1', () => {
  const trap = (name) => new Proxy({}, { get: () => { throw new Error(`touched ${name}`); } });
  beforeEach(() => vi.stubGlobal('fetch', stubFetch([])));
  it('front page, public tree and public search succeed with D1 rigged to throw', async () => {
    const env = baseEnv({ DB: trap('DB'), PHOTOS: trap('PHOTOS'), VECTORIZE: trap('VECTORIZE') });
    expect((await call(env, 'https://teamlancaster.com/')).status).toBe(200);
    const tree = await (await call(env, 'https://teamlancaster.com/api/public/tree')).json();
    expect(tree.founders.map((f) => f.first)).toEqual(['Example', 'Sample']);
    const search = await (await call(env, 'https://teamlancaster.com/api/public/search?q=te')).json();
    expect(search.map((p) => p.first)).toEqual(['Test']);
    expect(JSON.stringify(search)).not.toMatch(/Person-One|1975/);
  });
});

describe('POST /api/admin/rebuild-public', () => {
  it('403s without a valid Access JWT', async () => {
    const r = await call(baseEnv(), 'https://teamlancaster.com/api/admin/rebuild-public', { method: 'POST' });
    expect(r.status).toBe(403);
  });
  it('501s and records an audit entry when no deploy hook is configured', async () => {
    const env = devEnv();
    const r = await call(env, LOCAL + '/api/admin/rebuild-public', { method: 'POST', headers: { origin: LOCAL, 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(501);
    expect((await r.json()).error).toBe('Deploy hook not configured');
    const a = await env.DB.prepare("SELECT summary, undoable FROM audit_log WHERE action='rebuild_public'").first();
    expect(a.summary).toBe('Update public page requested');
    expect(a.undoable).toBe(0);
  });
  it('POSTs the hook when configured and never echoes the URL or token', async () => {
    const calls = [];
    vi.stubGlobal('fetch', async (url, init) => { calls.push({ url, init }); return new Response('', { status: 200 }); });
    const env = devEnv({ DEPLOY_HOOK_URL: 'https://example.invalid/hooks/SECRET-URL', DEPLOY_HOOK_TOKEN: 'super-secret-token' });
    const r = await call(env, LOCAL + '/api/admin/rebuild-public', { method: 'POST', headers: { origin: LOCAL, 'content-type': 'application/json' }, body: '{}' });
    const text = await r.text();
    expect(r.status).toBe(200);
    expect(text).toContain('Rebuild and publish started');
    expect(text).not.toContain('SECRET-URL');
    expect(text).not.toContain('super-secret-token');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://example.invalid/hooks/SECRET-URL');
    expect(calls[0].init.headers.authorization).toBe('Bearer super-secret-token');
  });
  it('a failed hook is a 502 that names neither the URL nor the token', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 500 }));
    const env = devEnv({ DEPLOY_HOOK_URL: 'https://example.invalid/hooks/SECRET-URL', DEPLOY_HOOK_TOKEN: 'super-secret-token' });
    const r = await call(env, LOCAL + '/api/admin/rebuild-public', { method: 'POST', headers: { origin: LOCAL, 'content-type': 'application/json' }, body: '{}' });
    const text = await r.text();
    expect(r.status).toBe(502);
    expect(text).not.toContain('SECRET-URL');
    expect(text).not.toContain('super-secret-token');
  });
  it('the dashboard button explains what will happen', async () => {
    const html = await (await call(devEnv(), LOCAL + '/admin')).text();
    expect(html).toContain('id="rebuildPublic"');
    expect(html).toContain('Rebuilds the public names from the database and publishes the front page.');
  });
});
