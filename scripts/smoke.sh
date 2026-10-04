#!/usr/bin/env bash
# Integration smoke test against real workerd/miniflare (local D1 + R2 emulation).
# Usage: bash scripts/smoke.sh   (starts two wrangler dev instances: local-bypass and production-mode)
set -uo pipefail
cd "$(dirname "$0")/.."
PASS=0; FAIL=0
check() { local want="$1" got="$2" label="$3"; if [[ "$got" == "$want" ]]; then echo "  ok   $label ($got)"; PASS=$((PASS+1)); else echo "  FAIL $label (want $want, got $got)"; FAIL=$((FAIL+1)); fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

npx wrangler d1 migrations apply teamlancaster-family --local >/dev/null 2>&1
npx wrangler d1 execute teamlancaster-family --local --file=scripts/seed-dev.sql >/dev/null 2>&1

start() { # $1 port, rest: extra args
  local port=$1; shift
  npx wrangler dev --local --port "$port" "$@" >"/tmp/smoke-$port.log" 2>&1 &
  echo $! > "/tmp/smoke-$port.pid"
  for i in $(seq 1 60); do curl -s -o /dev/null "http://localhost:$port/robots.txt" && return 0; sleep 0.5; done
  echo "server on $port did not start"; cat "/tmp/smoke-$port.log"; exit 1
}
stop() { kill "$(cat /tmp/smoke-$1.pid)" 2>/dev/null; pkill -f "wrangler dev --local --port $1" 2>/dev/null; }
trap 'stop 8801; stop 8802' EXIT

echo "== A: ENVIRONMENT=local (from .dev.vars) on localhost: dev bypass active"
start 8801
A=http://localhost:8801
check 200 "$(code $A/admin)" "GET /admin via localhost bypass"
check 200 "$(code $A/api/admin/whoami)" "GET /api/admin/whoami"
check 403 "$(code -X POST -H 'content-type: application/json' -d '{}' $A/api/admin/people)" "POST admin without Origin"
check 403 "$(code -X POST -H 'Origin: https://evil.example.com' -H 'content-type: application/json' -d '{}' $A/api/admin/people)" "POST admin with foreign Origin"
check 201 "$(code -X POST -H "Origin: $A" -H 'content-type: application/json' -d '{"first_name":"Example","last_name":"Person"}' $A/api/admin/people)" "POST admin create Example Person (Origin ok)"
check 403 "$(code -H 'Host: teamlancaster-family.chris.workers.dev' $A/admin)" "Host: *.workers.dev -> blocked even in local mode"
check 403 "$(code -H 'Host: teamlancaster-family.chris.workers.dev' $A/)" "Host: *.workers.dev public page -> blocked"
check 403 "$(code -A 'ia_archiver' $A/)" "ia_archiver UA"
check 403 "$(code -A 'Mozilla/5.0 (compatible; archive.org_bot)' $A/)" "archive.org_bot UA"
check 200 "$(code $A/)" "public front page"
check 404 "$(code $A/sitemap.xml)" "no sitemap"
check 415 "$(code -X POST -F name=x -F photo=@public/assets/favicon.png $A/api/request)" "public request with file upload refused"
H=$(curl -s -D - -o /dev/null $A/)
[[ "$H" == *"noarchive"* ]] && check yes yes "X-Robots-Tag has noarchive" || check yes no "X-Robots-Tag has noarchive"
T=$(curl -s $A/api/public/tree)
[[ "$T" != *"Founder-A"* && "$T" != *"Kid-One"* && "$T" != *"Placeholder"* ]] && check yes yes "public tree: no surnames/minors" || check yes no "public tree: no surnames/minors"
stop 8801

echo "== B: ENVIRONMENT=production on localhost (bypass must be impossible)"
start 8802 --var ENVIRONMENT:production
B=http://localhost:8802
check 403 "$(code $B/admin)" "GET /admin, no JWT"
check 403 "$(code $B/api/admin/whoami)" "GET /api/admin/whoami, no JWT"
check 403 "$(code -H 'Cf-Access-Jwt-Assertion: eyJhbGciOiJSUzI1NiIsImtpZCI6IngifQ.eyJlbWFpbCI6ImFAYi5jIn0.c2ln' $B/api/admin/whoami)" "bad JWT"
check 403 "$(code -H 'Host: teamlancaster-family.chris.workers.dev' $B/api/admin/whoami)" "workers.dev host"
check 403 "$(code $B/)" "localhost is not a canonical host in production mode -> whole site gated"

echo; echo "smoke: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
