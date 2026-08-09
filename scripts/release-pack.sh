#!/usr/bin/env bash
# ============================================================================
# release-pack.sh
#
# THE RELEASE STEP. It turns a committed pack into something a paying member can
# actually download, which until now nothing in this repository did.
#
# WHAT WAS MISSING, measured on 9 Aug 2026 rather than assumed. The delivery
# layer built in Phase 6 is real and tested, and no pack had ever been put
# anywhere a customer could reach it: the preview R2 bucket held no pack object,
# `pack_release` was empty, and nothing in the repo uploaded a pack or wrote a
# release row. worker/delivery.js reads r2_key out of that empty table, so a
# perfectly valid signed link had nothing to serve. This script is the missing
# link, and worker/release.js is the other half.
#
# WHAT IT DOES, in order:
#   1. Refuses a dirty tree and exports from HEAD, so a release cannot contain
#      code no test has run against.
#   2. Builds the customer zip, DETERMINISTICALLY, and prints its sha256.
#   3. Puts it in R2 under a stable versioned key, in ONE named environment.
#   4. Emits the SQL that records it in pack_release and changelog. It PRINTS
#      the statements and writes them to a file. It does not execute them.
#
# IT IS SHAPED AFTER scripts/publish-pack-to-project.sh ON PURPOSE and shares
# its two hard rules: publish EVERY pack it finds rather than a named one, and
# publish from HEAD rather than from the working tree. The VERSION is derived
# from the pack's own scripts and cross-checked exactly as it is there, because
# two scripts in one pack disagreeing about their version would name a
# customer's zip after a guess.
#
# THE ENVIRONMENT IS AN ARGUMENT AND PREVIEW IS THE DEFAULT. Production needs
# --production, spelled out, because a production release is a founder gate.
#
# IT IS IDEMPOTENT. Re-running it for a version already released uploads
# nothing (the bytes are compared, not assumed) and the emitted SQL inserts
# neither a second release row nor a second changelog entry. Re-running it after
# the pack CHANGED but the version did not is refused loudly, because that is
# the one case where "idempotent" would quietly mean "customers who downloaded
# yesterday have different bytes to customers who download today".
#
# Usage:
#   ./scripts/release-pack.sh                          every pack, to preview
#   ./scripts/release-pack.sh --pack healthcheck       one pack, to preview
#   ./scripts/release-pack.sh --production             every pack, to production
#   ./scripts/release-pack.sh --dry-run                build and emit, touch nothing remote
#
#   --pack NAME         release one pack instead of all of them
#   --production        release to production instead of preview
#   --dry-run           build, hash and emit SQL; make no network call at all
#   --notes-file FILE   release notes for the changelog entry (needs --pack)
#   --min-tier N        override the membership from scripts/pack-tiers.tsv (needs --pack)
#   --out DIR           where the zip and the SQL land (default .release-out)
#   --host URL          origin for the printed announce call
#
# RELEASE_WRANGLER exists so the tests can point the remote calls at a stub and
# watch the refusals fire without touching anybody's account. It defaults to the
# real thing.
# ============================================================================

set -euo pipefail

# UTC everywhere, for two different reasons at once: released_at is a timestamp
# other people read, and the zip stores modification times, so a build in Muscat
# and a build in London must produce the same bytes.
export TZ=UTC

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '[release-pack] %s\n' "$*"; }
err() { printf '[release-pack] ERROR: %s\n' "$*" >&2; }

ENVIRONMENT="preview"
ONE_PACK=""
NOTES_FILE=""
MIN_TIER_OVERRIDE=""
DRY_RUN="no"
OUT="$REPO/.release-out"
HOST=""

while [ $# -gt 0 ]; do
  case "$1" in
    --production) ENVIRONMENT="production"; shift ;;
    --preview) ENVIRONMENT="preview"; shift ;;
    --dry-run) DRY_RUN="yes"; shift ;;
    --pack) ONE_PACK="${2:-}"; shift 2 ;;
    --notes-file) NOTES_FILE="${2:-}"; shift 2 ;;
    --min-tier) MIN_TIER_OVERRIDE="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --host) HOST="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,60p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) err "unknown argument: $1"; exit 2 ;;
  esac
done

# Both of these apply to ONE pack's changelog entry or ONE pack's membership.
# Accepting them for a whole-catalogue run would silently give four packs the
# same release notes and the same tier.
if [ -n "$NOTES_FILE" ] && [ -z "$ONE_PACK" ]; then
  err "--notes-file names the notes for one pack, so it needs --pack too."
  exit 2
fi
if [ -n "$MIN_TIER_OVERRIDE" ] && [ -z "$ONE_PACK" ]; then
  err "--min-tier sets the membership for one pack, so it needs --pack too."
  exit 2
fi

case "$ENVIRONMENT" in
  preview)
    BUCKET="oradiscuss-assets-preview"
    D1_NAME="oradiscuss-preview"
    # The workers.dev host for the preview Worker: its name comes from
    # wrangler.toml [env.preview] and the account subdomain is the one every
    # other Worker in this project is deployed on. Override with --host.
    DEFAULT_HOST="https://oradiscuss-site-preview.mahmood-darweesh.workers.dev"
    ;;
  production)
    BUCKET="oradiscuss-assets"
    D1_NAME="oradiscuss"
    DEFAULT_HOST="https://oradiscuss.com"
    ;;
esac
[ -n "$HOST" ] || HOST="$DEFAULT_HOST"

WRANGLER="${RELEASE_WRANGLER:-npx wrangler}"

cd "$REPO"

# ------------------------------------------------------------ what is HEAD

# Refuse to release a tree that does not match what was tested. The manifest is
# in scope beside the packs because it decides a number that reaches a customer
# facing page, so an uncommitted edit to it must not reach a release either.
if [ -n "$(git status --porcelain -- packs scripts/pack-tiers.tsv)" ]; then
  err "packs/ or scripts/pack-tiers.tsv has uncommitted changes. Commit them first,"
  err "or this release would carry code and claims that no test has run against."
  git status --short -- packs scripts/pack-tiers.tsv >&2
  exit 2
fi

# Every pack directory committed at HEAD. Read from git, not from the working
# tree, so an untracked scratch directory cannot become a released pack.
#
# `-d` restricts this to TREES, which is the one place this deliberately differs
# from publish-pack-to-project.sh: that script would read a loose file under
# packs/ as though it were a pack. Deliberately no `mapfile`: this Mac's
# /usr/bin/env bash is 3.2, where it does not exist, and `bash -n` would still
# have called the script fine because the failure is at runtime.
PACK_LIST="$(git ls-tree -d --name-only HEAD packs/ | sed 's|^packs/||; s|/$||' | grep -v '^$' || true)"
[ -n "$PACK_LIST" ] || { err "no packs found at HEAD under packs/"; exit 2; }

if [ -n "$ONE_PACK" ]; then
  if ! printf '%s\n' "$PACK_LIST" | grep -qx "$ONE_PACK"; then
    err "no pack named '$ONE_PACK' at HEAD. Packs found:"
    printf '%s\n' "$PACK_LIST" >&2
    exit 2
  fi
  PACK_LIST="$ONE_PACK"
fi

# The membership manifest, read from HEAD for the same reason the packs are.
MANIFEST="$(git show "HEAD:scripts/pack-tiers.tsv" 2>/dev/null || true)"
[ -n "$MANIFEST" ] || { err "scripts/pack-tiers.tsv is not committed at HEAD"; exit 2; }

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

# Doubling a single quote is the whole of SQLite string escaping, and every
# value below goes through here before it is pasted into a statement.
sql_quote() { printf '%s' "$1" | sed "s/'/''/g"; }

mkdir -p "$OUT"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

STAMP="$(date '+%Y-%m-%dT%H:%M:%SZ')"
RELEASED=0

log "environment: $ENVIRONMENT   bucket: $BUCKET   database: $D1_NAME"
[ "$DRY_RUN" = "yes" ] && log "DRY RUN: nothing will be uploaded and no remote call will be made"

while IFS= read -r PACK_ID; do
  PACK="packs/$PACK_ID"

  rm -rf "${STAGE:?}/work"
  mkdir -p "$STAGE/work"
  git archive HEAD "$PACK" | tar -x -C "$STAGE/work"
  SRC="$STAGE/work/$PACK"

  # test-fixtures drive the repo's own tests and are not part of the product.
  rm -rf "$SRC/test-fixtures"

  # held/ is code the founder ruled DISABLED, NOT DELETED. It stays in git so it
  # can be reviewed and revived; it must never reach a customer.
  rm -rf "$SRC/held"

  # The version is DERIVED from the pack's own scripts and cross-checked, never
  # passed in, exactly as publish-pack-to-project.sh derives it.
  #
  # The `|| true` is load bearing and was found by watching the guard below fail
  # to fire. grep exits 1 when it matches nothing, `set -o pipefail` promotes
  # that to the pipeline's status, and a plain assignment carries it, so under
  # `set -e` a pack with no VERSION= killed the script at exit 1 with NO MESSAGE
  # and the two refusals underneath were unreachable code. The same defect is in
  # publish-pack-to-project.sh, where it has never been noticed because every
  # pack committed so far happens to declare a version.
  VERSION="$(grep -ho '^VERSION="[^"]*"' "$SRC"/*.sh 2>/dev/null | sed 's/VERSION="//; s/"//' | sort -u || true)"
  if [ -z "$VERSION" ]; then
    err "$PACK declares no VERSION= in any top-level script"
    exit 2
  fi
  if [ "$(printf '%s\n' "$VERSION" | wc -l | tr -d ' ')" != "1" ]; then
    err "$PACK scripts disagree about the version:"
    printf '%s\n' "$VERSION" >&2
    exit 2
  fi

  # The membership. REFUSED rather than defaulted: min_tier decides the words
  # "Free tier" or "Toolkit and above" on the live /changelog/ page, and a
  # default would put one of them there without anybody deciding it.
  if [ -n "$MIN_TIER_OVERRIDE" ]; then
    MIN_TIER="$MIN_TIER_OVERRIDE"
    TIER_SOURCE="--min-tier on the command line"
  else
    MIN_TIER="$(printf '%s\n' "$MANIFEST" | awk -v p="$PACK_ID" '/^[^#]/ && $1==p {print $2; exit}')"
    TIER_SOURCE="scripts/pack-tiers.tsv"
  fi
  if [ -z "$MIN_TIER" ]; then
    err "$PACK_ID has no row in scripts/pack-tiers.tsv, so which membership it is"
    err "released to is undecided. That number becomes a claim on the live"
    err "/changelog/ page, so this script will not guess it."
    err "Add a row to scripts/pack-tiers.tsv, or pass --min-tier N for a one off."
    exit 2
  fi
  case "$MIN_TIER" in
    0|1|2) ;;
    *) err "$PACK_ID has min_tier '$MIN_TIER', which is not one of the catalogue tiers 0, 1 or 2"; exit 2 ;;
  esac

  # ------------------------------------------------------ the customer zip
  #
  # DETERMINISTIC, and it has to be, or nothing else in this script is true. A
  # plain `zip -r` stores each file's modification time and walks the directory
  # in readdir order, so two runs over identical content produce different
  # bytes and a different sha256. Then "this version is already released with
  # these exact bytes" could never be answered, the idempotent re-run would
  # upload a second artifact over the first, and the sha256 published beside
  # the download (worker/delivery.js sends it as X-Artifact-SHA256) would stop
  # matching what the last member downloaded.
  #
  # Three things make it deterministic: every mtime forced to one fixed
  # instant, the entry list sorted with a fixed collation, and -X to drop the
  # platform extras (uid, gid, extended attributes) that differ per machine.
  find "$SRC" -exec touch -t 202601010000 {} +
  ZIP="oradiscuss-${PACK_ID}-v${VERSION}.zip"
  rm -f "$STAGE/$ZIP"
  ( cd "$STAGE/work/packs" && find "$PACK_ID" -print | LC_ALL=C sort | zip -X -q -@ "$STAGE/$ZIP" )

  SHA="$(sha256_of "$STAGE/$ZIP")"
  BYTES="$(wc -c < "$STAGE/$ZIP" | tr -d ' ')"
  KEY="packs/${PACK_ID}/${PACK_ID}-v${VERSION}.zip"

  cp -f "$STAGE/$ZIP" "$OUT/$ZIP"

  log ""
  log "pack     $PACK_ID"
  log "version  $VERSION"
  log "min_tier $MIN_TIER  (from $TIER_SOURCE)"
  log "bytes    $BYTES"
  log "sha256   $SHA"
  log "r2 key   $KEY"

  # ------------------------------------------------------------- the upload
  if [ "$DRY_RUN" = "yes" ]; then
    log "upload   SKIPPED, this is a dry run"
  else
    EXISTING="$STAGE/existing.zip"
    rm -f "$EXISTING"
    if $WRANGLER r2 object get "$BUCKET/$KEY" --file="$EXISTING" --remote >/dev/null 2>&1 && [ -s "$EXISTING" ]; then
      EXISTING_SHA="$(sha256_of "$EXISTING")"
      if [ "$EXISTING_SHA" = "$SHA" ]; then
        log "upload   SKIPPED, $KEY is already in $BUCKET with these exact bytes"
      else
        err "$PACK_ID v$VERSION is ALREADY RELEASED to $BUCKET with DIFFERENT bytes."
        err "  in the bucket: $EXISTING_SHA"
        err "  built here:    $SHA"
        err ""
        err "Overwriting it would mean two different artifacts shipped under one"
        err "version number, and the sha256 published beside the download would"
        err "stop matching what earlier members already have. Bump VERSION= in"
        err "$PACK's scripts and release that instead."
        exit 3
      fi
    else
      $WRANGLER r2 object put "$BUCKET/$KEY" \
        --file="$STAGE/$ZIP" \
        --content-type=application/zip \
        --remote
      log "upload   done, $KEY -> $BUCKET"
    fi
  fi

  # -------------------------------------------------------- the release notes
  #
  # Taken from a file the founder wrote, or from notes committed inside the
  # pack, and NEVER generated from git log. Commit messages are internal
  # planning prose; this text lands on a public page and in an email.
  NOTES=""
  NOTES_SOURCE=""
  if [ -n "$NOTES_FILE" ]; then
    [ -f "$NOTES_FILE" ] || { err "--notes-file $NOTES_FILE does not exist"; exit 2; }
    NOTES="$(cat "$NOTES_FILE")"
    NOTES_SOURCE="$NOTES_FILE"
  elif git cat-file -e "HEAD:$PACK/RELEASE_NOTES.md" 2>/dev/null; then
    NOTES="$(git show "HEAD:$PACK/RELEASE_NOTES.md")"
    NOTES_SOURCE="$PACK/RELEASE_NOTES.md at HEAD"
  else
    NOTES="$PACK_ID $VERSION is released."
    NOTES_SOURCE="the default line, because no notes were given"
  fi
  log "notes    from $NOTES_SOURCE"

  # ---------------------------------------------------------------- the SQL
  #
  # IDEMPOTENT WITHOUT DEPENDING ON A MIGRATION. pack_release has a primary key
  # on (pack, version) from migration 0001, so INSERT OR IGNORE is enough there.
  # changelog does NOT have one, so its insert carries its own WHERE NOT EXISTS
  # rather than relying on an index that would have to be applied first. Applied
  # twice, this file changes nothing the second time, on a database with only
  # 0001 and 0002 on it, which is what both environments have today.
  Q_PACK="$(sql_quote "$PACK_ID")"
  Q_VERSION="$(sql_quote "$VERSION")"
  Q_KEY="$(sql_quote "$KEY")"
  Q_SHA="$(sql_quote "$SHA")"
  Q_NOTES="$(sql_quote "$NOTES")"
  Q_STAMP="$(sql_quote "$STAMP")"

  SQL_FILE="$OUT/${ENVIRONMENT}-${PACK_ID}-v${VERSION}.sql"
  {
    printf -- '-- OraDiscuss release, generated by scripts/release-pack.sh. Do not hand edit.\n'
    printf -- '--\n'
    printf -- '-- ENVIRONMENT: %s   DATABASE: %s   BUCKET: %s\n' "$ENVIRONMENT" "$D1_NAME" "$BUCKET"
    printf -- '-- Generated at %s from repo HEAD %s.\n' "$STAMP" "$(git rev-parse --short HEAD)"
    printf -- '-- Release notes came from %s.\n' "$NOTES_SOURCE"
    printf -- '--\n'
    printf -- '-- Safe to apply twice: neither statement inserts a second time.\n\n'
    printf -- "INSERT OR IGNORE INTO pack_release (pack, version, r2_key, sha256, min_tier, released_at)\n"
    printf -- "VALUES ('%s', '%s', '%s', '%s', %s, '%s');\n\n" \
      "$Q_PACK" "$Q_VERSION" "$Q_KEY" "$Q_SHA" "$MIN_TIER" "$Q_STAMP"
    printf -- "INSERT INTO changelog (pack, version, body_md, released_at)\n"
    printf -- "SELECT '%s', '%s', '%s', '%s'\n" "$Q_PACK" "$Q_VERSION" "$Q_NOTES" "$Q_STAMP"
    printf -- " WHERE NOT EXISTS (SELECT 1 FROM changelog WHERE pack = '%s' AND version = '%s');\n" \
      "$Q_PACK" "$Q_VERSION"
  } > "$SQL_FILE"

  log "sql      $SQL_FILE"
  RELEASED=$((RELEASED + 1))

  printf '\n----- SQL for %s, %s v%s -----\n' "$ENVIRONMENT" "$PACK_ID" "$VERSION"
  cat "$SQL_FILE"
  printf -- '----- end SQL -----\n\n'

  printf 'ONCE PER ENVIRONMENT, BEFORE THE FIRST RELEASE EVER. The two release\n'
  printf 'endpoints read columns that this migration adds, and until it is applied\n'
  printf 'they answer 503 and name it. It is not re-runnable: applied twice it fails\n'
  printf 'loudly on the first ALTER, which is the behaviour we want.\n\n'
  printf '  npx wrangler d1 execute %s --remote --file=migrations/0005_release_notify.sql\n\n' "$D1_NAME"
  printf 'Then apply this release, and announce it. ONE COMMAND PER LINE, run them\n'
  printf 'one at a time:\n\n'
  printf '  npx wrangler d1 execute %s --remote --file=%s\n' "$D1_NAME" "$SQL_FILE"
  printf '  curl -sS -X POST %s/api/release/announce -H "Authorization: Bearer $WATCH_ADMIN_TOKEN" -H "Content-Type: application/json" -d '"'"'{"pack":"%s","version":"%s"}'"'"'\n' \
    "$HOST" "$PACK_ID" "$VERSION"
  printf '\nTo see what a customer receives before announcing anything:\n\n'
  printf '  curl -sS -X POST %s/api/release/link -H "Authorization: Bearer $WATCH_ADMIN_TOKEN" -H "Content-Type: application/json" -d '"'"'{"pack":"%s","version":"%s"}'"'"'\n\n' \
    "$HOST" "$PACK_ID" "$VERSION"
done <<< "$PACK_LIST"

log "released $RELEASED pack(s) to $ENVIRONMENT"
if [ "$ENVIRONMENT" = "production" ]; then
  log ""
  log "THIS WAS PRODUCTION. Applying the SQL above is a founder action, and so is"
  log "the announce call: it mails subscribers and it can only be done once."
fi
