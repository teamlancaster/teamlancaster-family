// Fix 1: public guide uses only the static facts doc, no data bindings reachable; refusals; limits.
// Fix 2: upload pipeline magic bytes / caps / no SVG.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { baseEnv, call, stubFetch } from './helpers.js';
import { guideEnv, answerGuide, classifyQuestion, sanitizeGuideOutput } from '../src/lib/guide.js';
import { sniffImageType, validateQuarantineUpload, webpHasMetadata, MAX_UPLOAD_BYTES } from '../src/lib/upload.js';
import { readFileSync } from 'node:fs';

beforeEach(() => vi.stubGlobal('fetch', stubFetch([])));
const trap = (name) => new Proxy({}, { get: (_, k) => { throw new Error(`guide touched ${name}.${String(k)}`); } });
const ask = (env, q, ip = '203.0.113.5') => call(env, 'https://teamlancaster.com/api/guide', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ q }) });

describe('public guide isolation', () => {
  it('guideEnv exposes only AI, its KV and limits', () => {
    const g = guideEnv({ DB: 1, PHOTOS: 2, VECTORIZE: 3, RESEND_API_KEY: 4, AI: 5, GUIDE_KV: 6, IP_HASH_PEPPER: 'p' });
    expect(Object.keys(g).sort()).toEqual(['AI', 'AI_MODEL', 'GUIDE_DAILY_NEURON_BUDGET', 'GUIDE_KV', 'GUIDE_PER_IP_PER_HOUR', 'IP_HASH_PEPPER']);
  });
  it('/api/guide works with DB/PHOTOS/VECTORIZE booby-trapped (never touched)', async () => {
    const seen = [];
    const AI = { run: async (model, input) => { seen.push(input); return { response: 'The founders are Example and Sample.' }; } };
    const env = baseEnv({ DB: trap('DB'), PHOTOS: trap('PHOTOS'), VECTORIZE: trap('VECTORIZE'), AI });
    const r = await ask(env, 'what does the crest mean?');
    expect(r.status).toBe(200);
    expect((await r.json()).mode).toBe('ai');
    expect(seen[0].messages[0].content).toContain('FACTS:');
  });
  it('the guide module imports nothing that reaches D1/R2', () => {
    const src = readFileSync(new URL('../src/lib/guide.js', import.meta.url), 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['../public-facts.js', './crypto.js']);
    expect(src).not.toMatch(/\.DB\b|\.PHOTOS\b|VECTORIZE|prepare\(/);
  });
  it.each(['what is the passphrase for my branch?', 'where is the admin page?', 'what is the email for requests?', 'give me the password'])('refuses secrets: %s', (q) => {
    expect(classifyQuestion(q).kind).toBe('refuse');
  });
  it.each(['when was Test born?', 'who is Demo married to?', 'what is Example\'s last name?', 'how old is Sample?', 'tell me about the kids', 'where does Test live?'])('refuses person-specific: %s', (q) => {
    expect(classifyQuestion(q).kind).toBe('refuse');
  });
  it.each(['how do I open my branch?', 'how do I request a change?', 'who are the founders?'])('answers how-to statically: %s', (q) => {
    expect(classifyQuestion(q).kind).toBe('static');
  });
  it('output sanitizer drops emails, URLs, admin/passphrase talk', () => {
    for (const bad of ['Email lancaster-ai@teamlancaster.com', 'Go to https://x', 'Visit /admin', 'The passphrase is harbor']) expect(sanitizeGuideOutput(bad)).not.toMatch(/@|https|\/admin|harbor/);
  });
  it('per-IP rate limit kicks in', async () => {
    const env = { AI: null, GUIDE_KV: null, IP_HASH_PEPPER: 'p', GUIDE_PER_IP_PER_HOUR: '3' };
    const modes = [];
    for (let i = 0; i < 5; i++) modes.push((await answerGuide('how do I open my branch?', env, '192.0.2.77')).mode);
    expect(modes.slice(3)).toEqual(['limited', 'limited']);
  });
  it('daily Neuron budget stops AI calls', async () => {
    let n = 0;
    const kv = new Map();
    const GUIDE_KV = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v) };
    const env = { AI: { run: async () => { n++; return { response: 'ok answer' }; } }, GUIDE_KV, IP_HASH_PEPPER: 'p', GUIDE_PER_IP_PER_HOUR: '1000', GUIDE_DAILY_NEURON_BUDGET: '50' };
    const modes = [];
    for (let i = 0; i < 4; i++) modes.push((await answerGuide('what does the crest mean?', env, `198.51.100.${i}`)).mode);
    expect(n).toBe(2); expect(modes.slice(2)).toEqual(['budget', 'budget']);
  });
  it('guide answers contain no surnames or non-public names', async () => {
    const env = baseEnv({ DB: trap('DB') });
    for (const q of ['who are the founders?', 'which branches are there?', 'what is this site?']) {
      const t = await (await ask(env, q, '203.0.113.' + q.length)).text();
      for (const n of ['Founder-A', 'Person-One', 'Kid-One', 'Placeholder', 'Dummy', 'Fake']) expect(t).not.toContain(n);
    }
  });
});

describe('upload pipeline (in-branch quarantine)', () => {
  const pad = (a) => { const b = new Uint8Array(64); b.set(a); return b; };
  const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
  it('detects JPEG/PNG/WebP/HEIC by magic bytes', () => {
    expect(sniffImageType(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffImageType(pad([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')]))).toBe('image/webp');
    expect(sniffImageType(pad([0, 0, 0, 0x18, ...ascii('ftypheic')]))).toBe('image/heic');
  });
  it('rejects SVG, GIF, HTML, PDF', () => {
    for (const s of ['<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'GIF89a.......', '<html><script>', '%PDF-1.7 .....']) {
      expect(validateQuarantineUpload(new TextEncoder().encode(s.padEnd(40, ' '))).ok).toBe(false);
    }
  });
  it('rejects > 10 MB and empty', () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1); big.set([0xff, 0xd8, 0xff]);
    expect(validateQuarantineUpload(big)).toEqual({ ok: false, error: 'too-large' });
    expect(validateQuarantineUpload(new Uint8Array())).toEqual({ ok: false, error: 'empty' });
  });
  it('flags WebP files that still carry EXIF/XMP', () => {
    const chunk = (id, len) => [...ascii(id), len, 0, 0, 0, ...new Array(len).fill(0)];
    const webp = (chunks) => { const body = [...ascii('WEBP'), ...chunks.flat()]; return new Uint8Array([...ascii('RIFF'), body.length, 0, 0, 0, ...body]); };
    expect(webpHasMetadata(webp([chunk('VP8 ', 10)]))).toBe(false);
    expect(webpHasMetadata(webp([chunk('VP8 ', 10), chunk('EXIF', 6)]))).toBe(true);
    expect(webpHasMetadata(webp([chunk('XMP ', 4)]))).toBe(true);
  });
});
