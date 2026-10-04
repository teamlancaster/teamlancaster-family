// Family-only rule: noindex/noarchive everywhere, archive + AI crawlers refused, no sitemap, no og/twitter tags.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { baseEnv, call, stubFetch } from './helpers.js';

const PROD = 'https://teamlancaster.com';
let env;
beforeEach(() => { vi.stubGlobal('fetch', stubFetch([])); env = baseEnv(); });

describe('headers', () => {
  it.each(['/', '/robots.txt', '/assets/app.css', '/api/public/tree', '/admin', '/nope', '/sitemap.xml'])('%s carries X-Robots-Tag noindex+noarchive', async (p) => {
    const r = await call(env, PROD + p);
    const x = r.headers.get('x-robots-tag');
    expect(x).toMatch(/noindex/); expect(x).toMatch(/noarchive/); expect(x).toMatch(/nofollow/);
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
  });
  it('front page HTML: meta robots noarchive, no og:/twitter: tags, no photos', async () => {
    const h = await (await call(env, PROD + '/')).text();
    expect(h).toMatch(/<meta name="robots" content="noindex,nofollow,noarchive/);
    expect(h).not.toMatch(/property="og:|name="twitter:|og:image|og:title/i);
    expect(h).not.toMatch(/<img[^>]+(photos\/|\/p\/|\.jpe?g)/i);
    expect(h).not.toMatch(/lancaster-ai@|\/admin/); // notification address + admin path never on the page
  });
  it('admin + API responses are private, no-store', async () => {
    for (const p of ['/admin', '/api/admin/people', '/api/public/tree']) expect((await call(env, PROD + p)).headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('crawlers', () => {
  it('robots.txt disallows archive + AI crawlers, no Sitemap, no blanket disallow', async () => {
    const t = await (await call(env, PROD + '/robots.txt')).text();
    for (const b of ['ia_archiver', 'archive.org_bot', 'CCBot', 'GPTBot']) expect(t).toMatch(new RegExp(`User-agent: ${b.replace('.', '\\.')}\\nDisallow: /`));
    expect(t).not.toMatch(/sitemap/i);
    expect(t).toMatch(/User-agent: \*\nDisallow: \/admin\nDisallow: \/api\/\n/); // search engines can still fetch / to see noindex
  });
  it.each(['ia_archiver (+http://www.alexa.com/site/help/webmasters)', 'Mozilla/5.0 (compatible; archive.org_bot +http://archive.org/details/archive.org_bot)', 'CCBot/2.0', 'Mozilla/5.0 GPTBot/1.1'])('blocked UA %s -> 403', async (ua) => {
    expect((await call(env, PROD + '/', { headers: { 'user-agent': ua } })).status).toBe(403);
  });
  it('Googlebot is allowed to fetch (to read noindex)', async () => {
    const r = await call(env, PROD + '/', { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } });
    expect(r.status).toBe(200); expect(r.headers.get('x-robots-tag')).toMatch(/noindex/);
  });
  it('/sitemap.xml -> 404', async () => { expect((await call(env, PROD + '/sitemap.xml')).status).toBe(404); });
});

describe('deploy config safety', () => {
  const cfg = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  it('wrangler.jsonc ships ENVIRONMENT=production and never "local"', () => {
    expect(cfg).toMatch(/"ENVIRONMENT":\s*"production"/);
    expect(cfg).not.toMatch(/"ENVIRONMENT":\s*"local"/);
  });
  it('workers.dev + preview URLs are off', () => {
    expect(cfg).toMatch(/"workers_dev":\s*false/); expect(cfg).toMatch(/"preview_urls":\s*false/);
  });
  it('.dev.vars is git-ignored', () => {
    expect(readFileSync(new URL('../.gitignore', import.meta.url), 'utf8')).toMatch(/^\.dev\.vars$/m);
  });
  it('WAF rule definition exists and is not applied by code', () => {
    const w = JSON.parse(readFileSync(new URL('../infra/waf-block-archive-ai-bots.json', import.meta.url), 'utf8'));
    expect(w.rules[0].action).toBe('block');
    expect(w.rules[0].expression).toMatch(/ia_archiver/); expect(w.rules[0].expression).toMatch(/archive\.org_bot/);
  });
});
