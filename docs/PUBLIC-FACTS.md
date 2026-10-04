# Public names: built from D1, read from a file

`src/public-facts.js` is the only thing the public guide, the public search and the public front page
read. None of them query D1. The file holds first names and a role (founder or branch parent), plus a
static how-to. It is generated; do not edit the names by hand.

## How a build gets the names

`scripts/build-public-facts.js` reads D1 and rewrites the file.

```
npm run build                                        # local dev database
node scripts/build-public-facts.js --remote         # production database, used by the deploy workflow
```

The query selects people whose public name is on (`public_ok = 1`, the "show first name on the public
page" flag) and who are founders, or the public partner of a branch's root couple. The columns in the
schema are `public_ok` and `adult_confirmed`; those are the public-name and confirmed-adult flags.

Before it writes anything, the script refuses the whole build if any selected person:

- is not a confirmed adult (`adult_confirmed` is off),
- counts as a minor (no birth year, or under 18, and not confirmed adult),
- is hidden, or
- brings any field other than the first name and the role (a surname, an id, a year).

The rendered file is checked again for those fields. A refusal leaves the existing file untouched.

`npm run build` is the build step. Deploy runs it first (see `.github/workflows/deploy.yml`), then
`wrangler deploy` bundles the new file into the Worker. Until that deploy finishes, the live site keeps
serving the previous names.

## The admin button

The dashboard button **Update public page** says what it does: "Rebuilds the public names from the
database and publishes the front page." It calls `POST /api/admin/rebuild-public`, which is behind the
same Access check and the same origin rule as every other admin action.

That endpoint does not read D1 and does not deploy by itself. It writes an audit log entry and then:

- returns **501 "Deploy hook not configured"** when `DEPLOY_HOOK_URL` is not set (this is the state today), or
- POSTs to that URL when it is set. The response never contains the URL or the token.

See `docs/DEPLOY-CHECKLIST.md` for the hook.
