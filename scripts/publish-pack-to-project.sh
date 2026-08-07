#!/usr/bin/env bash
# ============================================================================
# publish-pack-to-project.sh
#
# Publishes the COMMITTED packs into the project folder on local disk, so
# everything the founder looks for is under one directory without the project
# folder becoming a second source of truth.
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
#   GENERATED mirror plus the zips, never a hand-copy, and this script is the
#   only thing allowed to write there.
#
# IT PUBLISHES EVERY PACK IT FINDS, NOT A NAMED ONE
#   The first version hardcoded packs/healthcheck. That is the shape of defect
#   this repo has already shipped twice in orchestrate.sh: a step that names its
#   inputs silently drops every input added after it was written. Here the cost
#   would be a second pack that the founder never sees in the project folder
#   while this script reports success.
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

log() { printf '[publish-pack] %s\n' "$*"; }
err() { printf '[publish-pack] ERROR: %s\n' "$*" >&2; }

[ -d "$PROJECT" ] || { err "project folder not found: $PROJECT"; exit 2; }

cd "$REPO"

# Refuse to publish a tree that does not match what was tested.
if [ -n "$(git status --porcelain -- packs)" ]; then
  err "packs/ has uncommitted changes. Commit them first, or the project folder"
  err "would receive code that no test has run against."
  git status --short -- packs >&2
  exit 2
fi

# Every pack directory committed at HEAD. Read from git, not from the working
# tree, so an untracked scratch directory cannot become a published pack.
#
# Deliberately no `mapfile`: this Mac's /usr/bin/env bash is 3.2, where mapfile
# does not exist, and `bash -n` would still have reported the script as fine
# because the failure is at runtime rather than at parse.
PACK_LIST="$(git ls-tree --name-only HEAD packs/ | sed 's|^packs/||; s|/$||' | grep -v '^$' || true)"
[ -n "$PACK_LIST" ] || { err "no packs found at HEAD under packs/"; exit 2; }

SHA="$(git rev-parse --short HEAD)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

DEST="$PROJECT/packs"
mkdir -p "$DEST"

STAMP="$DEST/GENERATED-DO-NOT-EDIT.md"
{
  printf '# This folder is GENERATED. Do not edit anything in it.\n\n'
  printf 'Published on %s by\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')"
  printf '`scripts/publish-pack-to-project.sh` in `madarwish007/oradiscuss-site`,\n'
  printf 'from repo HEAD `%s`.\n\n' "$SHA"
  printf '**The source of truth is git, at `packs/` in that repo.** This copy exists so the\n'
  printf 'packs are findable in the project folder alongside the docs. An edit made here is\n'
  printf 'invisible to the tests, invisible to the build, and will be wiped by the next\n'
  printf 'publish.\n\n'
  printf '## What is here, and how to tell whether it is current\n\n'
  printf 'Each pack is stamped with the commit that last changed THAT PACK, not with repo\n'
  printf 'HEAD. Stamping HEAD made every unrelated commit anywhere in the repo report a\n'
  printf 'byte-identical mirror as stale, and a drift check that cries wolf is one that\n'
  printf 'eventually stops being read.\n\n'
  printf '| Pack | Version | Pack last changed at | Check it with |\n'
  printf '|---|---|---|---|\n'
} > "$STAMP"

while IFS= read -r PACK_ID; do
  PACK="packs/$PACK_ID"

  PACK_SHA="$(git log -1 --format=%h -- "$PACK")"
  [ -n "$PACK_SHA" ] || { err "could not resolve the last commit for $PACK"; exit 2; }

  rm -rf "${STAGE:?}/work"
  mkdir -p "$STAGE/work"
  git archive HEAD "$PACK" | tar -x -C "$STAGE/work"
  SRC="$STAGE/work/$PACK"

  # test-fixtures drive the repo's own tests and are not part of the product.
  rm -rf "$SRC/test-fixtures"

  # The version is DERIVED from the pack's own scripts and cross-checked, never
  # passed in. Two scripts in one pack disagreeing about their version is a real
  # drift that nothing else would catch, and it would name the customer's zip
  # after a guess.
  VERSION="$(grep -ho '^VERSION="[^"]*"' "$SRC"/*.sh 2>/dev/null | sed 's/VERSION="//; s/"//' | sort -u)"
  if [ -z "$VERSION" ]; then
    err "$PACK declares no VERSION= in any top-level script"
    exit 2
  fi
  if [ "$(printf '%s\n' "$VERSION" | wc -l | tr -d ' ')" != "1" ]; then
    err "$PACK scripts disagree about the version:"
    printf '%s\n' "$VERSION" >&2
    exit 2
  fi

  ZIP="oradiscuss-${PACK_ID}-v${VERSION}.zip"
  ( cd "$STAGE/work/packs" && zip -r -q "$STAGE/$ZIP" "$PACK_ID" )

  # Replace rather than merge: a merge leaves deleted files behind forever,
  # which is its own quiet way of drifting.
  rm -rf "${DEST:?}/$PACK_ID"
  cp -R "$SRC" "$DEST/$PACK_ID"
  cp -f "$STAGE/$ZIP" "$DEST/"

  printf '| `%s` | %s | `%s` | `git log -1 --format=%%h -- %s` |\n' \
    "$PACK_ID" "$VERSION" "$PACK_SHA" "$PACK" >> "$STAMP"

  log "published $PACK_ID v$VERSION from $PACK_SHA"
done <<< "$PACK_LIST"

{
  printf '\nIf the command in the last column does not print the sha beside it, that pack is\n'
  printf 'behind. Refresh everything with:\n\n'
  printf '    ~/Projects/oradiscuss-site/scripts/publish-pack-to-project.sh\n\n'
  printf 'Why this is generated rather than hand-copied: on 7 Aug a hand-copied pack in\n'
  printf 'this folder went stale within one hour, missing the RAC instance census and\n'
  printf 'three fixes, while looking complete.\n'
} >> "$STAMP"

log "wrote $STAMP"
