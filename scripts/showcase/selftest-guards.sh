#!/usr/bin/env bash
# =============================================================================
# WATCH EVERY SHOWCASE GUARD FAIL.
#
# A guard nobody has seen fire is not a guard. An overflow check that silently
# matches nothing prints "fits ok" for every card; a click on a selector that
# does not exist looks exactly like a click that worked. So each guard in
# test/showcase.test.js is pointed at a copy of Showcase/ and scripts/showcase/
# with ONE thing deliberately broken, and this script fails unless the guard
# that is supposed to catch it actually does.
#
#   bash scripts/showcase/selftest-guards.sh
#
# Exit 0 means every listed guard was observed failing on the input built to
# break it, and observed passing on the untouched copy.
# =============================================================================
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/odc-showcase-selftest-XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
# The em dash is built from its bytes, never typed. A literal one in this file
# would trip the very guard this file exists to exercise, and the baseline case
# below would fail for a reason that has nothing to do with the assets.
EM="$(printf '\xe2\x80\x94')"

# fresh <name> -> prints the case directory, containing showcase/ and scripts/
fresh() {
  local d="$TMP/$1"
  rm -rf "$d"; mkdir -p "$d"
  cp -R "$REPO/Showcase" "$d/showcase"
  cp -R "$REPO/scripts/showcase" "$d/scripts"
  printf '%s\n' "$d"
}

run_case() {
  local d="$1"
  SHOWCASE_DIR="$d/showcase" SHOWCASE_SCRIPTS="$d/scripts" \
    node --test --test-reporter=tap "$REPO/test/showcase.test.js" 2>&1
}

# expect_fail <case name> <expected test name> <mutation command...>
#
# Note the string matching rather than `grep -q`. Under `set -o pipefail`,
# `producer | grep -q needle` reports FAILURE when it matches, because grep
# exits at the first hit and the producer dies on the closed pipe. That cost
# this script one confusing baseline failure before it was noticed.
expect_fail() {
  local name="$1" wanted="$2"; shift 2
  local d; d="$(fresh "$name")"
  if ! ( cd "$d" && "$@" ); then
    echo "SELFTEST BROKEN: the mutation for $name did not run"
    FAIL=$((FAIL+1)); return
  fi
  local out failed said
  out="$(run_case "$d")"
  failed="$(printf '%s\n' "$out" | grep '^not ok' || true)"
  if [[ "$failed" == *"$wanted"* ]]; then
    said="$(printf '%s\n' "$out" | awk -v w="$wanted" '
      index($0, "not ok") == 1 { on = index($0, w) > 0 }
      on && /error: / { sub(/^ *error: /, ""); print; exit }')"
    echo "PASS  $name"
    echo "      guard fired: $wanted"
    [ -n "$said" ] && echo "      said: ${said:0:150}"
    PASS=$((PASS+1)); return
  fi
  echo "FAIL  $name"
  echo "      expected this guard to fire and it did not: $wanted"
  if [ -n "$failed" ]; then
    printf '%s\n' "$failed" | sed 's/^/      other failures: /'
  else
    echo "      nothing failed at all, so this guard cannot see the break"
  fi
  FAIL=$((FAIL+1))
}

echo "=== the untouched copy must pass ==="
BASE="$(fresh baseline)"
BASE_OUT="$(run_case "$BASE")"
if [[ "$BASE_OUT" == *"# fail 0"* ]]; then
  echo "PASS  baseline: an untouched copy passes every guard"
  PASS=$((PASS+1))
else
  echo "FAIL  baseline: an untouched copy does NOT pass, so nothing below means anything"
  printf '%s\n' "$BASE_OUT" | grep '^not ok' | sed 's/^/      /'
  FAIL=$((FAIL+1))
fi

echo
echo "=== each guard, against input built to break it ==="

expect_fail unregistered-file "every file in Showcase/samples is registered in the manifest" \
  bash -c 'echo stray > showcase/samples/healthcheck/leftover.txt'

expect_fail missing-file "every manifest entry exists on disk with the recorded size" \
  bash -c 'rm showcase/samples/healthcheck/run.log'

expect_fail size-drift "every manifest entry exists on disk with the recorded size" \
  bash -c 'echo extra >> showcase/samples/healthcheck/run.log'

expect_fail provenance-standards "the provenance sentence is verbatim in STANDARDS.md" \
  bash -c "perl -pi -e 's/Not output from a real Oracle database\./Representative output./' showcase/STANDARDS.md"

expect_fail provenance-manifest "the provenance sentence is verbatim on every manifest entry" \
  bash -c "perl -0pi -e 's/\"provenance\": \"Sample rendered[^\"]*\"/\"provenance\": \"Sample output\"/' showcase/MANIFEST.json"

expect_fail field-test-claim "the manifest still says the pack has not been run against a real database" \
  bash -c "perl -0pi -e 's/has not been run against a real Oracle database/was run against a production Oracle database/' showcase/MANIFEST.json"

expect_fail frame-caption-removed "the frame template still burns the provenance into the pixels" \
  bash -c "perl -pi -e 's/\{\{PROVENANCE\}\}//' scripts/templates/frame.html"

expect_fail em-dash-in-asset "no em dash in any showcase text asset" \
  bash -c "printf 'a %s b\n' \"$EM\" >> showcase/samples/healthcheck/command.txt"

expect_fail em-dash-in-standards "no em dash in STANDARDS.md, the manifest, or any caption" \
  bash -c "printf 'a %s b\n' \"$EM\" >> showcase/STANDARDS.md"

expect_fail em-dash-in-rig "no em dash in the showcase rig or its templates" \
  bash -c "printf '/* a %s b */\n' \"$EM\" >> scripts/templates/frame.html"

expect_fail capture-constant-drift "the manifest capture settings match the standard" \
  bash -c "perl -pi -e 's/\"canvas_css_width\": 1280/\"canvas_css_width\": 1440/' showcase/MANIFEST.json"

expect_fail standards-number-drift "STANDARDS.md states the same numbers the build used" \
  bash -c "perl -pi -e 's/\\*\\*1152 CSS px\\*\\*/**1100 CSS px**/' showcase/STANDARDS.md"

expect_fail image-dimension-lie "every shipped image is 2560 device px wide" \
  bash -c "perl -pi -e 's/\"width\": 2560/\"width\": 2400/ if \$. > 0' showcase/MANIFEST.json"

expect_fail video-registered-but-not-encoded "a video is only registered when it was actually encoded" \
  bash -c "perl -pi -e 's/\"video_encoded\": true/\"video_encoded\": false/' showcase/MANIFEST.json"

expect_fail stray-sid "the only Oracle SID anywhere in the samples is the declared fictional one" \
  bash -c "perl -pi -e 's/ODCDEMO1 on/ODCPROD3 on/' scripts/lab/healthcheck/collection.txt"

expect_fail stray-hostname "every host shaped token in the samples is on the declared allowlist" \
  bash -c "perl -pi -e 's/dbnode1\.odclab\.example/dbnode1.internal.corp/' scripts/lab/healthcheck/collection.txt"

expect_fail stray-ip "every IPv4 literal in the samples is in a documentation range" \
  bash -c "perl -pi -e 's/PRIMARY\) open_mode/PRIMARY at 10.20.30.40) open_mode/' scripts/lab/healthcheck/collection.txt"

expect_fail undeclared-collection "the lab collection declares itself synthetic on its own face" \
  bash -c "perl -pi -e 's/^# SYNTHETIC LAB COLLECTION.*//' scripts/lab/healthcheck/collection.txt"

expect_fail synthetic-input-hidden "every synthetic input is declared in the manifest and exists" \
  bash -c "python3 -c \"
import json,pathlib
p=pathlib.Path('showcase/MANIFEST.json'); d=json.loads(p.read_text())
d['synthetic_inputs']=[i for i in d['synthetic_inputs'] if 'lsnrctl' not in i['path']]
p.write_text(json.dumps(d,indent=2))\""

expect_fail retouched-report "the shipped report is the pack template, unedited" \
  bash -c "perl -pi -e 's/Field-test release - validate in non-production first\.//' showcase/samples/healthcheck/report.html"

# The dropped colour, put back where it used to be. The paint lands in the
# header strip of a shipped PNG, which is where the old red dot sat, and the
# mutation re-reads the pixel it just wrote: a break that did not land looks
# exactly like a guard that passed. It also changes the file size, so the size
# drift guard fires alongside. That is fine, expect_fail wants its own guard in
# the list and does not care what else is there.
expect_fail red-chrome-pixel "no Oracle red in the chrome of any shipped showcase image" \
  bash -c "python3 -c \"
from PIL import Image
p = 'showcase/samples/healthcheck/images/healthcheck-report-summary@2x.png'
im = Image.open(p).convert('RGB')
for x in range(200, 240):
    for y in range(150, 170):
        im.putpixel((x, y), (199, 70, 52))
im.save(p)
back = Image.open(p).convert('RGB').getpixel((210, 160))
assert back == (199, 70, 52), 'the paint did not land, it reads %r' % (back,)
\""

expect_fail red-in-template "no showcase template carries the dropped Oracle red" \
  bash -c "perl -pi -e 's/#8A4B12/#C74634/g' scripts/templates/frame.html && grep -q C74634 scripts/templates/frame.html"

echo
echo "=== self test summary: $PASS observed, $FAIL not observed ==="
[ "$FAIL" -eq 0 ]
