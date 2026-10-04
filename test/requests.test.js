// Fixes 2-5: text-only public form, Turnstile + 3/hour + length caps, pointer-only email,
// diff-before-apply, Hide now, passphrase rotation (confirm, not logged, not undoable).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { baseEnv, call, stubFetch } from './helpers.js';
import { buildPointerEmail } from '../src/lib/notify.js';

const PROD = 'https://teamlancaster.com';
const LOCAL = 'http://localhost:8787';
let calls;
beforeEach(() => { calls = []; vi.stubGlobal('fetch', stubFetch([], calls)); });
const devEnv = (o = {}) => baseEnv({ ENVIRONMENT: 'local', ADMIN_ORIGIN: LOCAL, DEV_ADMIN_EMAIL: 'dev@localhost', ...o });
const adm = (env, path, body, method = 'POST') => call(env, LOCAL + path, { method, headers: { origin: LOCAL, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const SECRET_TEXT = 'Please change Uncle Zebediah birth year to 1961, he lives on Maple Street';
const form = (env, body, ip = '203.0.113.7', headers = {}) => call(env, PROD + '/api/request', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...headers }, body: JSON.stringify(body) });
const good = { name: 'Example Visitor', person: 'Uncle Zebediah', change: SECRET_TEXT, kind: 'edit', turnstile: 'good-token' };

describe('public request form (fix 2)', () => {
  it('accepts a text request, stores it as public/unverified, no branch', async () => {
    const env = baseEnv();
    const r = await form(env, good);
    expect(r.status).toBe(201);
    const row = await env.DB.prepare('SELECT * FROM change_request ORDER BY id DESC LIMIT 1').first();
    expect(row.source).toBe('public'); expect(row.branch_id).toBeNull(); expect(row.change_text).toBe(SECRET_TEXT);
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/); // salted hash, never a raw IP
  });
  it('multipart / file uploads are refused (415)', async () => {
    const fd = new FormData(); fd.append('name', 'x'); fd.append('photo', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])]), 'a.jpg');
    const r = await call(baseEnv(), PROD + '/api/request', { method: 'POST', body: fd });
    expect(r.status).toBe(415);
  });
  it('Turnstile failure -> 403', async () => { expect((await form(baseEnv(), { ...good, turnstile: 'bad' })).status).toBe(403); });
  it('length caps -> 422', async () => {
    expect((await form(baseEnv(), { ...good, change: 'x'.repeat(2001) })).status).toBe(422);
    expect((await form(baseEnv(), { ...good, name: 'x'.repeat(81) })).status).toBe(422);
    expect((await form(baseEnv(), { ...good, person: '' })).status).toBe(422);
  });
  it('3 per hour per ip_hash, then 429', async () => {
    const env = baseEnv();
    for (let i = 0; i < 3; i++) expect((await form(env, good)).status).toBe(201);
    expect((await form(env, good)).status).toBe(429);
    expect((await form(env, good, '198.51.100.9')).status).toBe(201); // different IP unaffected
  });
});

describe('pointer-only notification email (fix 3)', () => {
  it('Resend payload has request number + admin link and NO request content', async () => {
    const env = baseEnv();
    await form(env, good);
    const c = calls.find((x) => x.url === 'https://api.resend.com/emails');
    expect(c).toBeTruthy();
    const body = c.init.body;
    const m = JSON.parse(body);
    expect(m.to).toEqual(['lancaster-ai@teamlancaster.com']);
    expect(m.subject).toMatch(/^New change request #\d+ \(public form\)$/);
    expect(m.text).toMatch(/https:\/\/teamlancaster\.com\/admin\/requests#r\d+/);
    for (const leak of ['Zebediah', 'Maple', '1961', 'Example Visitor', 'birth year']) expect(body).not.toContain(leak);
    expect(m.attachments).toBeUndefined(); expect(m.html).toBeUndefined();
  });
  it('branch label only for branch requests', () => {
    const m = buildPointerEmail({ id: 123, branchLabel: 'Branch B' }, baseEnv());
    expect(m.subject).toBe('New change request #123 (Branch B)');
  });
});

describe('approve & apply shows the exact diff first (fix 4)', () => {
  const change = [{ person_id: 'p_c1', field: 'birth_year', value: '1974' }];
  it('apply without a preview token -> 409, nothing written', async () => {
    const env = devEnv();
    const r = await adm(env, '/api/admin/requests/1/apply', { changes: change });
    expect(r.status).toBe(409);
    expect((await env.DB.prepare("SELECT birth_year FROM person WHERE id='p_c1'").first()).birth_year).toBe(1975);
  });
  it('preview returns before/after, apply with token writes exactly that', async () => {
    const env = devEnv();
    const pv = await (await adm(env, '/api/admin/requests/1/preview', { changes: change })).json();
    expect(pv.unverified).toBe(true);
    expect(pv.items[0]).toMatchObject({ field: 'birth_year', before: 1975, after: 1974 });
    const r = await adm(env, '/api/admin/requests/1/apply', { changes: change, token: pv.token });
    expect(r.status).toBe(200);
    expect((await env.DB.prepare("SELECT birth_year FROM person WHERE id='p_c1'").first()).birth_year).toBe(1974);
    expect((await env.DB.prepare('SELECT status FROM change_request WHERE id=1').first()).status).toBe('applied');
  });
  it('changing the changes after preview -> 409', async () => {
    const env = devEnv();
    const pv = await (await adm(env, '/api/admin/requests/1/preview', { changes: change })).json();
    const r = await adm(env, '/api/admin/requests/1/apply', { changes: [{ ...change[0], value: '1900' }], token: pv.token });
    expect(r.status).toBe(409);
  });
  it('requests cannot publish people (public_ok is not an allowed field)', async () => {
    const r = await adm(devEnv(), '/api/admin/requests/1/preview', { changes: [{ person_id: 'p_c3', field: 'public_ok', value: true }] });
    expect(r.status).toBe(422);
  });
  it('Hide now hides the person immediately and resolves the request', async () => {
    const env = devEnv();
    expect((await adm(env, '/api/admin/requests/3/hide-now', { person_id: 'p_c2' })).status).toBe(200);
    const p = await env.DB.prepare("SELECT hidden, public_ok FROM person WHERE id='p_c2'").first();
    expect(p).toEqual({ hidden: 1, public_ok: 0 });
    expect((await env.DB.prepare('SELECT status FROM change_request WHERE id=3').first()).status).toBe('hidden');
  });
});

describe('passphrases (fix 5)', () => {
  it('rotate requires confirm', async () => {
    expect((await adm(devEnv(), '/api/admin/branches/b_1/rotate', {})).status).toBe(422);
  });
  it('rotate returns 5 words once; only a hash is stored; audit has no phrase and is not undoable', async () => {
    const env = devEnv();
    const r = await adm(env, '/api/admin/branches/b_1/rotate', { confirm: true });
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    const { words } = await r.json();
    expect(words).toHaveLength(5);
    const b = await env.DB.prepare("SELECT * FROM branch WHERE id='b_1'").first();
    expect(b.pw_version).toBe(1); expect(b.pw_iters).toBe(100000);
    expect(JSON.stringify(b)).not.toContain(words.join(' '));
    const a = await env.DB.prepare("SELECT * FROM audit_log WHERE action='rotate_passphrase'").first();
    expect(a.undoable).toBe(0);
    for (const w of words) expect(JSON.stringify(a)).not.toContain(` ${w} `);
    expect((await adm(env, `/api/admin/audit/${a.id}/undo`, {})).status).toBe(422);
    const list = await (await call(env, LOCAL + '/api/admin/branches')).text();
    expect(list).not.toMatch(/pw_hash|pw_salt/);
  });
  it('branches page has no per-row Copy button', async () => {
    const h = await (await call(devEnv(), LOCAL + '/admin/branches')).text();
    expect(h.match(/<button[^>]*>[^<]*Copy/g) || []).toHaveLength(1); // only the one-time "Copy all" panel button
    expect(h).toMatch(/id="copyAll"/);
  });
  it('the admin client never touches localStorage/sessionStorage', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(new URL('../public/assets/admin.js', import.meta.url), 'utf8')).not.toMatch(/localStorage\.|sessionStorage\./);
  });
});

describe('undo', () => {
  it('person edit can be undone from the audit log', async () => {
    const env = devEnv();
    await adm(env, '/api/admin/people/p_c3', { nickname: 'Mocky' }, 'PATCH');
    const a = await env.DB.prepare("SELECT id FROM audit_log WHERE entity='person' AND entity_id='p_c3' ORDER BY id DESC").first();
    expect((await adm(env, `/api/admin/audit/${a.id}/undo`, {})).status).toBe(200);
    expect((await env.DB.prepare("SELECT nickname FROM person WHERE id='p_c3'").first()).nickname).toBeNull();
  });
});
