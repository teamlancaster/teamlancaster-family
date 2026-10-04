# What Chris provides / does to deploy Phases 1-2

All accounts are Chris's personal ones. Nothing here touches GoDaddy, the apex/www records, or the Inkbox
email records (MX @, MX mail, SPF TXT @, `_amazonses`, `_dmarc`, `ibk1._domainkey`, `inkbox-ownership`).

## 1. GitHub
- Create an EMPTY PRIVATE repo: `teamlancaster/teamlancaster-family` (no README, no license, no .gitignore).
- Give the Cursor GitHub app access to that one repo (GitHub > Settings > Applications > Cursor > Configure > Only select repositories).

## 2. Cloudflare account (the one that holds the teamlancaster.com zone 712c61fe6e7e08f8123082b3fa54a2fb)
- Send the **Account ID** (dashboard > Workers & Pages > right sidebar, or the zone Overview page).
- **Turn on R2 once** in the dashboard (R2 > Purchase/Enable; free tier, may ask for a card). A token can't do this step.
- **Zero Trust**: one.dash.cloudflare.com > sign up for the **Free** plan (up to 50 users, $0; may ask for a card). Choose a
  **team name** (gives `<team>.cloudflareaccess.com`) and send it. Settings > Authentication > add **One-time PIN**.
- **Admin email list** for the Access Allow policy: Chris's email (plus one backup admin email if wanted).

## 3. Cloudflare API token (new custom token; do NOT reuse CLOUDFLARE_API_TOKEN_TEAMLANCASTER)
My Profile > API Tokens > Create Custom Token. Account resources: only Chris's account. Zone resources: only teamlancaster.com.

| Scope | Permission | Why |
|---|---|---|
| Account | Workers Scripts: Edit | deploy the Worker, set secrets |
| Account | D1: Edit | create the DB, run migrations |
| Account | Workers R2 Storage: Edit | create the private photo bucket |
| Account | Workers KV Storage: Edit | the AI guide's budget/rate-limit namespace |
| Account | Account Settings: Read | wrangler account lookups |
| Account | Access: Apps and Policies: Edit | create the Access app + Allow policy for /admin* and /api/admin* |
| Account | Turnstile Sites: Edit | create the Turnstile widget for the request form |
| Zone (teamlancaster.com) | Workers Routes: Edit | attach the Worker Custom Domain (staging now, apex/www at cutover) |

Optional (only if Chris wants me to apply them instead of clicking): Account > Access: Organizations, Identity Providers, and Groups: Edit
(to add One-time PIN for him); Zone > Zone WAF: Edit and Zone > Bot Management: Edit (to apply `infra/waf-block-archive-ai-bots.json`
and the "Block AI bots" toggle). Not needed now: Vectorize (Phase 5), User Details/Memberships (account ID is set explicitly).
Workers AI needs no extra permission or account.

## 4. Where Phases 1-2 run before cutover (needs Chris's OK)
`workers_dev` and preview URLs stay OFF. Recommended: Worker Custom Domain **`staging.teamlancaster.com`** (one new proxied
record created by Cloudflare; no existing record changes), with an Access app covering `staging.teamlancaster.com/*`.
The Worker treats any non-canonical host as private (valid Access JWT required on every route) and the admin check is
fail-closed on every host. The apex/www switch from GitHub Pages is Phase 4.

## 5. Resend (pointer-only notification emails to lancaster-ai@teamlancaster.com)
- Create a Resend account; add the domain **`notify.teamlancaster.com`** (sending only; receiving off).
- Create an API key with **Sending access** restricted to that domain; send it to me as a secret (I set it with `wrangler secret put RESEND_API_KEY`; never committed or printed).
- DNS records Resend will show (add exactly what its Records tab says, DNS-only / grey cloud). Typically:
  - `TXT resend._domainkey.notify` = `p=...` (DKIM)
  - `MX send.notify` = `feedback-smtp.us-east-1.amazonses.com`, priority 10 (bounce return-path)
  - `TXT send.notify` = `"v=spf1 include:amazonses.com ~all"` (SPF)
  - Domains created after Aug 2026 may get CNAME records instead of the MX/TXT pair; a CNAME can't share a name with other records, which is fine here because these names are new.
  - Optional: `TXT _dmarc.notify` = `v=DMARC1; p=none;` (separate from the apex `_dmarc`, which stays untouched).
- **No collisions with Inkbox**: all Resend names sit under `notify.` (`resend._domainkey.notify`, `send.notify`, `_dmarc.notify`). Inkbox uses `@`, `mail`, `_amazonses`, `_dmarc`, `ibk1._domainkey`, `inkbox-ownership`. Do not pick `mail` as the Resend subdomain (Inkbox has an MX there).
- After the records verify: send one Inkbox test email out and one in, to confirm nothing changed.
- I can add these 3 records with the existing DNS token only if Chris says so explicitly; otherwise he adds them.

## 6. AI provider
- Cloudflare Workers AI (binding `AI`, model `@cf/meta/llama-3.1-8b-instruct-fast`). No extra account. Free 10,000 Neurons/day;
  the public guide is capped at 2,000/day (20%) plus 20 questions/hour per hashed IP.

## 7. Deploy hook (so "Update public page" can publish)
The admin button asks the Worker to start a rebuild. The Worker only knows how to POST to a URL; it
never deploys on its own. Set one of these once the private repo exists, with `wrangler secret put`.
Both are secrets. They are never printed and never appear in an API response.

- `DEPLOY_HOOK_URL`, one of:
  - a Cloudflare Workers Builds deploy hook (Workers & Pages > the Worker > Settings > Builds > Deploy hooks;
    the hook URL itself is the secret and a plain POST triggers `npm run build` then deploy), or
  - the GitHub workflow_dispatch URL
    `https://api.github.com/repos/teamlancaster/teamlancaster-family/actions/workflows/deploy.yml/dispatches`
- `DEPLOY_HOOK_TOKEN`, only for the GitHub option: a fine-grained personal access token with Actions: Write
  on that one repo. Sent as a bearer token. Not needed for a Cloudflare deploy hook.

The workflow file `.github/workflows/deploy.yml` runs only when dispatched. It runs
`node scripts/build-public-facts.js --remote` and then `wrangler deploy`. It needs the repo secrets
`CLOUDFLARE_API_TOKEN` (the deploy token from step 3) and `CLOUDFLARE_ACCOUNT_ID`. Until the hook is
set, the button returns "Deploy hook not configured" and changes nothing.

## 8. Secrets I generate and set (nothing for Chris to provide)
`IP_HASH_PEPPER`, `COOKIE_HMAC_KEY` (random), `TURNSTILE_SECRET` (from the widget), `RESEND_API_KEY` (from step 5).
Vars filled in `wrangler.jsonc`: `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` (from the Access app), `ADMIN_EMAILS`, `TURNSTILE_SITE_KEY`, D1/KV ids.

## Deploy steps (once the above exists; for reference)
1. `wrangler d1 create teamlancaster-family`, `wrangler r2 bucket create teamlancaster-photos`, `wrangler kv namespace create GUIDE_KV`; paste ids.
2. `wrangler d1 migrations apply teamlancaster-family --remote` (schema only; no seed in production).
3. Create Access app(s) + Allow policy (admin emails, One-time PIN); copy AUD into `ACCESS_AUD`.
4. Create Turnstile widget (hostnames teamlancaster.com, staging.teamlancaster.com).
5. `wrangler secret put ...` for each secret; `wrangler deploy`.
6. Re-run the fail-closed checks against the deployed host: no JWT, forged JWT, wrong AUD, workers.dev, bad Origin => 403.
