// Minor rules, public projection (no surnames / minors / in-branch names), fix 7 server enforcement.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { baseEnv, call, stubFetch, makeD1 } from './helpers.js';
import { isMinor, validatePersonPatch, branchNameViolation } from '../src/lib/privacy.js';
import { publicTree } from '../src/lib/data.js';

const LOCAL = 'http://localhost:8787';
const devEnv = (o = {}) => baseEnv({ ENVIRONMENT: 'local', ADMIN_ORIGIN: LOCAL, DEV_ADMIN_EMAIL: 'dev@localhost', ...o });
const post = (env, path, body, method = 'POST') => call(env, LOCAL + path, { method, headers: { origin: LOCAL, 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => vi.stubGlobal('fetch', stubFetch([])));

const SURNAMES = ['Founder-A', 'Founder-B', 'Person-One', 'Person-Two', 'Person-Three', 'Partner-One', 'Partner-Two', 'Kid-One', 'NoYear'];
const NON_PUBLIC_FIRST = ['Placeholder', 'Dummy', 'Mock', 'Fake'];

describe('isMinor', () => {
  const Y = 2026;
  it('no birth year => minor', () => expect(isMinor({ birth_year: null }, Y)).toBe(true));
  it('under 18 => minor', () => expect(isMinor({ birth_year: 2010 }, Y)).toBe(true));
  it('18+ => adult', () => expect(isMinor({ birth_year: 2008 }, Y)).toBe(false));
  it('adult_confirmed overrides', () => expect(isMinor({ birth_year: null, adult_confirmed: 1 }, Y)).toBe(false));
});

describe('validation', () => {
  it('public_ok requires adult_confirmed (fix 7)', () => {
    expect(() => validatePersonPatch({ first_name: 'A', public_ok: 1, adult_confirmed: 0, birth_year: 1950 })).toThrow(/Confirmed adult/);
    expect(() => validatePersonPatch({ first_name: 'A', public_ok: 1, adult_confirmed: 1 })).not.toThrow();
  });
  it('branch names cannot contain a minor first name', () => {
    expect(branchNameViolation('placeholder-branch', 'X', [{ first_name: 'Placeholder' }])).toBe('Placeholder');
    expect(branchNameViolation('example-one', 'Example One', [{ first_name: 'Placeholder' }])).toBeNull();
  });
  it('DB CHECK constraint also blocks public_ok without adult_confirmed', () => {
    const d = makeD1();
    expect(() => d._raw.exec("UPDATE person SET public_ok=1, adult_confirmed=0 WHERE id='p_c3'")).toThrow(/CHECK/);
  });
  it('API: PATCH public_ok on a non-confirmed person -> 422', async () => {
    const env = devEnv();
    const r = await post(env, '/api/admin/people/p_k1', { public_ok: true }, 'PATCH');
    expect(r.status).toBe(422);
    expect((await r.json()).error).toMatch(/Confirmed adult/);
  });
  it('API: turning off adult_confirmed with public_ok on -> 422 (no silent public minor)', async () => {
    const env = devEnv();
    expect((await post(env, '/api/admin/people/p_c1', { adult_confirmed: false, public_ok: true }, 'PATCH')).status).toBe(422);
  });
  it('person page renders the public toggle disabled for a non-confirmed person', async () => {
    const h = await (await call(devEnv(), LOCAL + '/admin/people/p_k1')).text();
    expect(h).toMatch(/data-tog="public_ok"[^>]*disabled/);
    const h2 = await (await call(devEnv(), LOCAL + '/admin/people/p_c1')).text();
    expect(h2).not.toMatch(/data-tog="public_ok"[^>]*disabled/);
  });
  it('API: creating a branch named after a minor -> 422', async () => {
    expect((await post(devEnv(), '/api/admin/branches', { slug: 'placeholder-kids', display_name: 'Placeholder Kids' })).status).toBe(422);
  });
  it('API: parent link loop -> 422', async () => {
    expect((await post(devEnv(), '/api/admin/links/parent', { parent_id: 'p_k1', child_id: 'p_fa', kind: 'bio' })).status).toBe(422);
  });
});

describe('public projection', () => {
  it('public JSON has only first names of eligible founders/branch parents', async () => {
    const env = baseEnv();
    const s = JSON.stringify(await publicTree(env.DB));
    for (const n of [...SURNAMES, ...NON_PUBLIC_FIRST]) expect(s).not.toContain(n);
    expect(s).not.toMatch(/p_[a-z0-9]+|19\d\d|20\d\d/); // no D1 ids, no years
    const t = JSON.parse(s);
    expect(t.founders.map((f) => f.first)).toEqual(['Example', 'Sample']);
    expect(t.branches.map((b) => b.first)).toEqual(['Test', 'Demo']);
  });
  it('front page + search responses contain no surnames, minors or in-branch-only names', async () => {
    const env = baseEnv();
    const bodies = [await (await call(env, 'https://teamlancaster.com/')).text()];
    for (const q of ['e', 'a', 'kid', 'placeholder', 'fake', 'one', 'dummy']) bodies.push(await (await call(env, `https://teamlancaster.com/api/public/search?q=${q}`)).text());
    for (const b of bodies) for (const n of [...SURNAMES, ...NON_PUBLIC_FIRST]) expect(b).not.toContain(n);
  });
  it('hiding a branch parent removes the name from public immediately', async () => {
    const env = devEnv();
    await post(env, '/api/admin/people/p_c1/hide', {});
    const t = await publicTree(env.DB);
    expect(JSON.stringify(t)).not.toContain('Test');
  });
});
