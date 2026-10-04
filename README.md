# teamlancaster-family (Phase 1 + 2)

Private family tree for teamlancaster.com. Cloudflare Worker (static assets + API), D1, private R2, Workers AI.
Family-only: noindex/noarchive on everything, archive + AI crawlers refused, no sitemap, no og/twitter tags.
**Not deployed.** See `docs/DEPLOY-CHECKLIST.md`.

## Run locally
Requires Node 22+ (wrangler 4). On the box: `export PATH=~/.local/node22/bin:$PATH`.
```
npm install
cp .dev.vars.example .dev.vars          # ENVIRONMENT=local + Turnstile test keys (local only, git-ignored)
npm run db:migrate:local && npm run db:seed:local   # fake placeholder people only
npm run build                            # regenerate src/public-facts.js from local D1
npm run dev                              # http://localhost:8787  (admin at /admin via the localhost-only dev bypass)
npm test                                 # vitest: 113 tests
npm run smoke                            # real workerd/miniflare: local-bypass + production-mode instances
python3 scripts/shoot.py                 # screenshots -> screenshots/
python3 scripts/ui_flow.py               # browser flow check (run after re-seeding)
```

## Layout
- `src/index.js` router: bot block, host gate, admin gate, headers, cron retention
- `src/lib/access.js` Cloudflare Access JWT verification (fails closed) + dev bypass + Origin check
- `src/lib/http.js` headers, robots.txt, blocked crawler list
- `src/lib/privacy.js` minor rule, public eligibility, validation
- `src/public-facts.js` generated public names (see docs/PUBLIC-FACTS.md); `src/lib/guide.js` public AI guide
- `scripts/build-public-facts.js` rebuilds that file from D1 at build time; `POST /api/admin/rebuild-public` triggers the deploy hook
- `src/lib/upload.js` magic bytes, EXIF check, quarantine pipeline, R2 keys
- `src/lib/notify.js` pointer-only Resend email; `src/lib/turnstile.js`; `src/lib/audit.js` audit + undo; `src/lib/crypto.js`
- `src/routes/public.js`, `src/routes/admin-api.js`, `src/views/*`
- `migrations/0001_init.sql` D1 schema; `scripts/seed-dev.sql` FAKE data for local only
- `infra/waf-block-archive-ai-bots.{json,tf}` WAF rule definition (NOT applied)
