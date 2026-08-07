#!/usr/bin/env bash
# ============================================================================
# publish-pack-to-drive.sh
#
# Publishes the COMMITTED pack into the Drive project folder, so everything the
# founder looks for is under one directory without Drive becoming a second
# source of truth.
#
# WHY THIS EXISTS
#   RUNBOOK.md:57 says the Drive folder is the docs home and code lives in git,
#   never in Drive. The reason is not tidiness. On 7 Aug a hand-copied pack in
#   Drive went stale inside ONE HOUR: it was missing the RAC census, both
#   orchestrate fixes and the tablespace dual output, while looking complete.
#   A stale copy that looks current is worse than no copy, because somebody
#   eventually field-tests it and reports bugs that were fixed hours earlier.
#
#   So the rule is kept and the inconvenience is automated away: Drive gets a
#   GENERATED mirror plus the zip, never a hand-copy, and this script is the
#   only thing allowed to write there.
#
# IT PUBLISHES FROM HEAD, NOT FROM THE WORKING TREE
#   Uncommitted edits are deliberately not published. What reaches Drive is
#   what is committed, which is what the tests ran against.
#
# Usage:
#   ./scripts/publish-pack-to-drive.sh
# ============================================================================

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRIVE="/Users/mahmouddarwish/Library/CloudStorage/GoogleDrive-mahmood.darweesh@gmail.com/My Drive/OraDiscuss_Website"
PACK="packs/healthcheck"
VERSION="1.0.0"

log() { printf '[publish-pack] %s\n' "$*"; }
err() { printf '[publish-pack] ERROR: %s\n' "$*" >&2; }

[ -d "$DRIVE" ] || { err "Drive project folder not found: $DRIVE"; exit 2; }

cd "$REPO"

# Refuse to publish a tree that does not match what was tested.
if [ -n "$(git status --porcelain -- "$PACK")" ]; then
  err "the pack has uncommitted changes. Commit them first, or Drive would"
  err "receive code that no test has run against."
  git status --short -- "$PACK" >&2
  exit 2
fi

SHA="$(git rev-parse --short HEAD)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Export from HEAD rather than copying the working tree.
git archive HEAD "$PACK" | tar -x -C "$STAGE"
SRC="$STAGE/$PACK"

# test-fixtures drive the repo's own tests and are not part of the product.
rm -rf "$SRC/test-fixtures"

# The customer-facing artifact.
( cd "$STAGE/packs" && zip -r -q "$STAGE/oradiscuss-healthcheck-v${VERSION}.zip" healthcheck )

DEST="$DRIVE/packs"
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

Published from git \`$SHA\` on $(date '+%Y-%m-%d %H:%M:%S %Z')
by \`scripts/publish-pack-to-drive.sh\` in \`madarwish007/oradiscuss-site\`.

**The source of truth is git, at \`packs/healthcheck/\` in that repo.** This copy
exists so the pack is findable in the project folder alongside the docs. An edit
made here is invisible to the tests, invisible to the build, and will be wiped
by the next publish.

To check whether this copy is current:

    cd ~/Projects/oradiscuss-site && git rev-parse --short HEAD

If that does not print \`$SHA\`, this folder is behind. Refresh it with:

    ~/Projects/oradiscuss-site/scripts/publish-pack-to-drive.sh

Why this is generated rather than hand-copied: on 7 Aug a hand-copied pack in
this folder went stale within one hour, missing the RAC instance census and
three fixes, while looking complete.
STAMP

log "published pack from $SHA"
log "  $DEST/healthcheck/"
log "  $DEST/oradiscuss-healthcheck-v${VERSION}.zip"
log "  $DEST/GENERATED-DO-NOT-EDIT.md"
