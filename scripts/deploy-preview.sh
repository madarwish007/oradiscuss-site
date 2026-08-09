#!/usr/bin/env bash
# ============================================================================
# deploy-preview.sh - ONE command that puts the current integration branch on
# preview and then PROVES it worked.
#
# WHY THIS EXISTS. The founder was handed a seven line paste sequence twice.
# The first time it had no build step, so the new Worker shipped over the old
# pages. The second time the queue line printed a red ERROR because the queue
# already existed, which is harmless and reads exactly like a failure. Both
# times the real problem was the same: a list of commands has no idea whether
# it succeeded, so the person pasting it has to judge, and judging is the thing
# a founder should never have to do for a deploy.
#
# So this is one command, it stops at the first REAL failure, it treats an
# already-existing queue as success, and it finishes by fetching the deployed
# site and asserting a page that only exists on the new build.
#
# Usage:  ./scripts/deploy-preview.sh
# ============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

PREVIEW_HOST="${PREVIEW_HOST:-https://oradiscuss-site-preview.mahmood-darweesh.workers.dev}"
BRANCH="${BRANCH:-integration}"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32mok\033[0m  %s\n' "$*"; }
die()  { printf '\n\033[31mSTOPPED: %s\033[0m\n' "$*" >&2; exit 1; }

say "1/6  Checking the tree is clean"
[ -z "$(git status --porcelain | grep -v '^?? node_modules')" ] \
  || die "you have uncommitted changes. Commit or stash them, then run this again."
ok "nothing uncommitted"

say "2/6  Fetching and switching to $BRANCH"
git fetch origin --quiet
git checkout --quiet "$BRANCH"
git pull --quiet --ff-only origin "$BRANCH" || die "could not fast forward $BRANCH. Someone pushed something that needs a merge."
ok "on $BRANCH at $(git rev-parse --short HEAD)"

say "3/6  Making sure the retry queue exists"
# An existing queue is SUCCESS, not failure. This is the line that printed a red
# ERROR last time and made a healthy run look broken.
QOUT="$(npx wrangler queues create webhook-retry-preview 2>&1 || true)"
if printf '%s' "$QOUT" | grep -qi "already taken\|already exists"; then
  ok "queue already exists, which is what we want"
elif printf '%s' "$QOUT" | grep -qi "Created queue\|✨"; then
  ok "queue created"
else
  printf '%s\n' "$QOUT" >&2
  die "could not confirm the queue. Read the output above."
fi

say "4/6  Building the site from scratch"
# The stale content cache is real: it has emitted pages for content that was
# already deleted. A cold build costs seconds and removes the whole question.
rm -rf node_modules/.astro dist
npm run build >/tmp/odc-build.log 2>&1 || { tail -20 /tmp/odc-build.log >&2; die "the build failed. Output above."; }
PAGES="$(find dist -name '*.html' | wc -l | tr -d ' ')"
[ "$PAGES" -ge 90 ] || die "the build produced only $PAGES pages, which is the OLD site. The branch switch did not take."
ok "$PAGES pages built"

say "5/6  Deploying to preview"
npx wrangler deploy --env preview 2>&1 | tail -6

say "6/6  Proving it actually landed, from the deployed site"
FAILED=0
for path in / /academy/ /watch/ /changelog/ /reissue/ /pricing/; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "${PREVIEW_HOST}${path}" || echo 000)"
  if [ "$CODE" = "200" ]; then ok "$path  $CODE"
  else printf '    \033[31mFAIL\033[0m %s  %s\n' "$path" "$CODE"; FAILED=1; fi
done
[ "$FAILED" -eq 0 ] || die "the deploy ran but the new pages are not being served. Tell Claude, and paste everything above."

printf '\n\033[32mDONE. Preview is serving the new build.\033[0m\n'
printf 'Open: %s\n\n' "$PREVIEW_HOST"
