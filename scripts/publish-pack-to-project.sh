#!/usr/bin/env bash
# ============================================================================
# publish-pack-to-project.sh
#
# Publishes the COMMITTED pack into the project folder on local disk, so everything the
# founder looks for is under one directory without the project folder becoming a second
# source of truth.
#
# WHY THIS EXISTS
#   RUNBOOK.md:57 says the project folder is the docs home and code lives in git,
#   never in the project folder. The reason is not tidiness. On 7 Aug a hand-copied pack in
#   the project folder went stale inside ONE HOUR: it was missing the RAC census, both
#   orchestrate fixes and the tablespace dual output, while looking complete.
#   A stale copy that looks current is worse than no copy, because somebody
#   eventually field-tests it and reports bugs that were fixed hours earlier.
#
#   So the rule is kept and the inconvenience is automated away: the project folder gets a
#   GENERATED mirror plus the zip, never a hand-copy, and this script is the
#   only thing allowed to write there.
#
# IT PUBLISHES FROM HEAD, NOT FROM THE WORKING TREE
#   Uncommitted edits are deliberately not published. What reaches the project folder is
#   what is committed, which is what the tests ran against.
#
# Usage:
#   ./scripts/publish-pack-to-project.sh
# ============================================================================

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="/Users/mahmouddarwish/Working_Area/OraDiscuss_Website"
PACK="packs/healthcheck"
VERSION="1.0.0"

log() { printf '[publish-pack] %s\n' "$*"; }
err() { printf '[publish-pack] ERROR: %s\n' "$*" >&2; }

[ -d "$PROJECT" ] || { err "project folder not found: $PROJECT"; exit 2; }

cd "$REPO"

# Refuse to publish a tree that does not match what was tested.
if [ -n "$(git status --porcelain -- "$PACK")" ]; then
  err "the pack has uncommitted changes. Commit them first, or Drive would"
  err "receive code that no test has run against."
  git status --short -- "$PACK" >&2
  exit 2
fi

SHA="$(git rev-parse --short HEAD)"

# The drift check anchors on the PACK's own last-touching commit, not on HEAD.
# The first version of this script stamped HEAD, which meant a commit anywhere
# else in the repo made a byte-identical mirror announce itself as stale. That
# happened on 7 Aug, on the very commit that renamed this script. A drift check
# that cries wolf is one somebody eventually stops reading, which costs more
# than the drift it was watching for.
PACK_SHA="$(git log -1 --format=%h -- "$PACK")"
[ -n "$PACK_SHA" ] || { err "could not resolve the pack's last commit for $PACK"; exit 2; }

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Export from HEAD rather than copying the working tree.
git archive HEAD "$PACK" | tar -x -C "$STAGE"
SRC="$STAGE/$PACK"

# test-fixtures drive the repo's own tests and are not part of the product.
rm -rf "$SRC/test-fixtures"

# The customer-facing artifact.
( cd "$STAGE/packs" && zip -r -q "$STAGE/oradiscuss-healthcheck-v${VERSION}.zip" healthcheck )

DEST="$PROJECT/packs"
mkdir -p "$DEST"

# Replace rather than merge: a merge leaves deleted files behind forever, which
# is its own quiet way of drifting.
rm -rf "$DEST/healthcheck"
cp -R "$SRC" "$DEST/healthcheck"
cp -f "$STAGE/oradiscuss-healthcheck-v${VERSION}.zip" "$DEST/"

# Stamp it, so anyone reading the Drive copy can tell what it is and whether it
# is current, instead of assuming.
cat > "$DEST/GENERATED-DO-NOT-EDIT.md" <<STAMP
# This folder is GENERATED. Do not edit anything in it.

Published on $(date '+%Y-%m-%d %H:%M:%S %Z') by
\`scripts/publish-pack-to-project.sh\` in \`madarwish007/oradiscuss-site\`,
from repo HEAD \`$SHA\`. **The pack itself last changed at \`$PACK_SHA\`.**

**The source of truth is git, at \`packs/healthcheck/\` in that repo.** This copy
exists so the pack is findable in the project folder alongside the docs. An edit
made here is invisible to the tests, invisible to the build, and will be wiped
by the next publish.

To check whether this copy is current:

    cd ~/Projects/oradiscuss-site && git log -1 --format=%h -- packs/healthcheck

If that does not print \`$PACK_SHA\`, this folder is behind. Refresh it with:

    ~/Projects/oradiscuss-site/scripts/publish-pack-to-project.sh

That command asks for the PACK's last commit, not the repo's HEAD, on purpose.
Stamping HEAD made every unrelated commit anywhere in the repo report a current
mirror as stale, and a drift check that cries wolf gets ignored.

Why this is generated rather than hand-copied: on 7 Aug a hand-copied pack in
this folder went stale within one hour, missing the RAC instance census and
three fixes, while looking complete.
STAMP

log "published pack from $SHA"
log "  $DEST/healthcheck/"
log "  $DEST/oradiscuss-healthcheck-v${VERSION}.zip"
log "  $DEST/GENERATED-DO-NOT-EDIT.md"
