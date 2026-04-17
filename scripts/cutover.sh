#!/usr/bin/env bash
#
# cutover.sh — move oradiscuss.com from the old Pages project (direct upload)
#              to the new Workers Builds project (git-connected).
#
# Usage:
#   export CF_API_TOKEN='...'
#   bash scripts/cutover.sh
#
# Token scopes required (create at https://dash.cloudflare.com/profile/api-tokens
# using the "Create Custom Token" button):
#   - Account · Workers Scripts · Edit
#   - Account · Cloudflare Pages · Edit
#   - Zone    · Workers Routes · Edit      (resource: oradiscuss.com)
#   - Zone    · Zone · Read                (resource: oradiscuss.com)
#
# The token is scoped to ONE account + ONE zone and is only needed for this
# one-time cutover — you can delete it from the Cloudflare dashboard when done.

set -euo pipefail

ACCOUNT_ID="4e386b5b1955731b273fa0f50e222b00"
ZONE_NAME="oradiscuss.com"
OLD_PAGES_PROJECT="oradiscuss-prod-7k2m"
NEW_WORKER_SERVICE="oradiscuss-site"
NEW_WORKER_ENV="production"
API="https://api.cloudflare.com/client/v4"

if [ -z "${CF_API_TOKEN:-}" ]; then
  echo "ERROR: CF_API_TOKEN env var is not set."
  echo "Run:   export CF_API_TOKEN='<your-token>'   then re-run this script."
  exit 1
fi

AUTH_HEADER="Authorization: Bearer ${CF_API_TOKEN}"

# --- 0. Sanity: verify token works ---
echo "==> Verifying API token…"
ok=$(curl -sS -H "$AUTH_HEADER" "$API/user/tokens/verify" | /usr/bin/python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("success"))')
if [ "$ok" != "True" ]; then
  echo "ERROR: token failed verification — check scopes and try again."
  exit 1
fi

# --- 1. Find zone ID ---
echo "==> Looking up zone id for $ZONE_NAME…"
ZONE_ID=$(curl -sS -H "$AUTH_HEADER" "$API/zones?name=$ZONE_NAME" \
  | /usr/bin/python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["result"][0]["id"] if d.get("result") else "")')
if [ -z "$ZONE_ID" ]; then
  echo "ERROR: could not resolve zone id for $ZONE_NAME."
  exit 1
fi
echo "    zone_id=$ZONE_ID"

# --- 2. Detach oradiscuss.com from the old Pages project (if attached) ---
echo "==> Checking Pages project '$OLD_PAGES_PROJECT' for $ZONE_NAME…"
pages_domains=$(curl -sS -H "$AUTH_HEADER" \
  "$API/accounts/$ACCOUNT_ID/pages/projects/$OLD_PAGES_PROJECT/domains")
has_apex=$(echo "$pages_domains" | /usr/bin/python3 -c 'import sys,json; d=json.load(sys.stdin); print(any(x.get("name")=="'$ZONE_NAME'" for x in (d.get("result") or [])))')
if [ "$has_apex" = "True" ]; then
  echo "    detaching $ZONE_NAME from $OLD_PAGES_PROJECT…"
  curl -sS -X DELETE -H "$AUTH_HEADER" \
    "$API/accounts/$ACCOUNT_ID/pages/projects/$OLD_PAGES_PROJECT/domains/$ZONE_NAME" \
    | /usr/bin/python3 -c 'import sys,json; d=json.load(sys.stdin); print("    ", "ok" if d.get("success") else "FAILED: "+json.dumps(d.get("errors", [])))'
else
  echo "    $ZONE_NAME is NOT attached to $OLD_PAGES_PROJECT (nothing to detach)."
fi

# Also detach www.oradiscuss.com if it happens to be attached (rare but possible)
has_www=$(echo "$pages_domains" | /usr/bin/python3 -c 'import sys,json; d=json.load(sys.stdin); print(any(x.get("name")=="www.'$ZONE_NAME'" for x in (d.get("result") or [])))')
if [ "$has_www" = "True" ]; then
  echo "    detaching www.$ZONE_NAME from $OLD_PAGES_PROJECT…"
  curl -sS -X DELETE -H "$AUTH_HEADER" \
    "$API/accounts/$ACCOUNT_ID/pages/projects/$OLD_PAGES_PROJECT/domains/www.$ZONE_NAME" \
    | /usr/bin/python3 -c 'import sys,json; d=json.load(sys.stdin); print("    ", "ok" if d.get("success") else "FAILED: "+json.dumps(d.get("errors", [])))'
fi

# --- 3. Attach oradiscuss.com as a custom domain of the new Worker ---
# API: POST /accounts/:id/workers/domains  body: {zone_id, hostname, service, environment}
echo "==> Attaching $ZONE_NAME to Worker '$NEW_WORKER_SERVICE'…"
attach_body=$(cat <<JSON
{"zone_id":"$ZONE_ID","hostname":"$ZONE_NAME","service":"$NEW_WORKER_SERVICE","environment":"$NEW_WORKER_ENV"}
JSON
)
resp=$(curl -sS -X PUT -H "$AUTH_HEADER" -H "Content-Type: application/json" \
  --data "$attach_body" \
  "$API/accounts/$ACCOUNT_ID/workers/domains")
echo "$resp" | /usr/bin/python3 -c 'import sys,json; d=json.load(sys.stdin); print("    ", "ok ("+(d.get("result") or {}).get("id","?")+")" if d.get("success") else "FAILED: "+json.dumps(d.get("errors", [])))'

# --- 4. Verify ---
echo "==> Waiting ~6s for edge propagation…"
sleep 6
echo "==> Probing https://$ZONE_NAME/ …"
code=$(curl -sSI -o /dev/null -w "%{http_code}" "https://$ZONE_NAME/")
echo "    HTTP $code"
title=$(curl -sS "https://$ZONE_NAME/" | /usr/bin/grep -oE '<title>[^<]+</title>' | head -1)
echo "    title: $title"
echo "==> Probing https://$ZONE_NAME/admin/ …"
code_admin=$(curl -sS -o /dev/null -w "%{http_code}" "https://$ZONE_NAME/admin/")
echo "    HTTP $code_admin"

echo
echo "Cutover finished. If the title shows 'OraDiscuss — Oracle Mastery, Distilled'"
echo "and /admin/ returns 200, you're live on the new stack."
echo
echo "Rollback if needed:"
echo "  1. In CF dash: Workers & Pages → $NEW_WORKER_SERVICE → Settings → Domains → remove $ZONE_NAME"
echo "  2. In CF dash: Workers & Pages → $OLD_PAGES_PROJECT → Custom domains → add $ZONE_NAME"
