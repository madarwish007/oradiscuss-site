#!/usr/bin/env bash
# =============================================================================
# Showcase step 1: produce the Health Check sample pair from a collection.
#
# It runs the REAL packs/healthcheck/health_check.sh through its REAL
# --render-only path. Nothing here re-implements the renderer, so the sample
# on the sales page cannot drift away from what a customer's run produces:
# if the pack's report template changes, this output changes with it.
#
# THE COLLECTION IS SYNTHETIC. See scripts/showcase/lab/healthcheck/
# collection.txt. The pack has never been run against a real Oracle database;
# the founder's field test is the designed gate for that. To rebuild the
# showcase from a real field-test collection instead:
#
#   ODC_SHOWCASE_COLLECTION=/path/to/health_raw_SID_ts.txt npm run showcase
#
# and then correct the provenance strings in Showcase/STANDARDS.md and
# scripts/showcase/build.mjs by hand, deliberately. No code change is needed
# to swap the data; the honesty strings are meant to resist being swapped by
# accident.
#
# Run from the REPO ROOT, and it asserts that. Every path it hands to
# health_check.sh is therefore repo relative, which is the only reason the log
# lines are short enough and portable enough to put in a video: they name
# paths that exist in this repository rather than one machine's scratch
# directory.
#
# Usage: scripts/showcase/render-sample.sh <output-directory>
# Writes: <out>/report.html, <out>/briefing.json, <out>/run.log,
#         <out>/command.txt, <out>/exit-code.txt
# =============================================================================
set -euo pipefail

LAB=scripts/showcase/lab/healthcheck
PACK=packs/healthcheck

[ -r "$PACK/health_check.sh" ] || {
  echo "run this from the repository root: $PACK/health_check.sh not found" >&2
  exit 2
}

DEST="${1:?usage: scripts/showcase/render-sample.sh <output-directory>}"
COLLECTION="${ODC_SHOWCASE_COLLECTION:-$LAB/collection.txt}"

[ -r "$COLLECTION" ] || { echo "collection not readable: $COLLECTION" >&2; exit 2; }
chmod +x "$LAB/bin/lsnrctl"

mkdir -p "$DEST"
RUN_DIR=.showcase-run
rm -rf "$RUN_DIR"
mkdir -p "$RUN_DIR/reports"

# The lab listener stub, declared in STANDARDS.md and in the manifest.
export PATH="$PWD/$LAB/bin:$PATH"
export ODC_SHOWCASE_OUT="$RUN_DIR"

# The command the video shows, written down once so the terminal frames cannot
# claim a command that was not the one that ran.
cat > "$DEST/command.txt" <<CMD
bash $PACK/health_check.sh \\
  --config $LAB/config.env \\
  --render-only $COLLECTION
CMD

set +e
bash "$PACK/health_check.sh" \
  --config "$LAB/config.env" \
  --render-only "$COLLECTION" \
  > "$DEST/run.log" 2>&1
RC=$?
set -e

# 0 = all OK, 1 = at least one WARN, 2 = at least one CRIT. The sample
# collection carries a CRIT on purpose, so 2 is the expected code here and
# anything above 2 is a real failure.
if [ "$RC" -gt 2 ]; then
  echo "health_check.sh failed with rc=$RC" >&2
  cat "$DEST/run.log" >&2
  rm -rf "$RUN_DIR"
  exit "$RC"
fi

HTML="$(find "$RUN_DIR/reports" -maxdepth 1 -name '*.html' -type f | head -1)"
JSON="$(find "$RUN_DIR/reports" -maxdepth 1 -name '*.json' -type f | head -1)"

[ -n "$HTML" ] || { echo "no HTML report produced" >&2; exit 2; }
[ -n "$JSON" ] || { echo "no JSON briefing produced" >&2; exit 2; }

# Normalised names. The pack stamps a timestamp into its filenames, which is
# right for a customer keeping a history and wrong for a manifest that has to
# name the same file across regenerations.
cp "$HTML" "$DEST/report.html"
cp "$JSON" "$DEST/briefing.json"
printf '%s\n' "$RC" > "$DEST/exit-code.txt"
rm -rf "$RUN_DIR"

echo "render-sample: report.html and briefing.json written to $DEST (health_check.sh exit $RC)"
