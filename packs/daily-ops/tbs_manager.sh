#!/usr/bin/env bash
# ============================================================================
# OraDiscuss - Daily Operations Pack v1.0.0
# tbs_manager.sh - the tablespace deep read.
#
# Generated locally by OraDiscuss tooling. Not produced by, affiliated with, or
# endorsed by Oracle Corporation. https://oradiscuss.com
#
# Written for Oracle 19c/21c/23ai on Linux.
# READ-ONLY: SELECT-only SQL. It issues no DDL and no DML, it writes nothing to
# your database, and there is no flag anywhere in this file that makes it.
#
# THIS RELEASE IS REPORT-ONLY, AND THAT IS A DECISION RATHER THAN AN OMISSION.
# The v0.9 script also GENERATED statements to add a datafile, resize one, or
# change an autoextend policy. Those paths printed by default and only ran with
# an explicit flag, so they were careful. They were still removed, because the
# sentence this product is sold on is "read every line and you will find no way
# for this to touch your database", and a footnoted version of that sentence is
# worth less than the feature was.
#
# The generated-statement paths are HELD, NOT DELETED, per the operating plan.
# The exact v0.9 source is kept verbatim in held/ in the source repository, out
# of this customer package, awaiting review. See held/README.md.
#
# ONE COLLECTION, TWO OUTPUTS:
#   report.html   - the tablespace read for the human
#   briefing.json - the same collection, structured, for YOUR OWN AI
# The database is queried ONCE. A second collection is how two outputs end up
# describing the same database at two different moments.
#
# Covers: usage with the bigfile flag stated, autoextend policy and reachable
# headroom per tablespace, shrink candidates by free space inside the file, and
# extent-count hints. Every one of them is a fact. None of them is a verdict.
#
# Usage:
#   ./tbs_manager.sh [--dry-run] [--config /path/to/config-<node>.env]
#   ./tbs_manager.sh --render-only /path/to/tbs_raw_SID_ts.txt
#
#   --render-only rebuilds both outputs from a collection that already ran,
#   without contacting the database. Use it to re-read an old collection, and
#   note that it is also what lets this pack's tests drive the REAL parser
#   below rather than a copy of it that would pass forever while this rotted.
#
# Cron example (07:10 daily, as oracle OS user):
#   10 7 * * * /opt/oradiscuss/daily-ops/tbs_manager.sh >> /opt/oradiscuss/daily-ops/output/cron.log 2>&1
#
# Output: HTML report and briefing.json in $OUTPUT_DIR/tbs/
# Exit codes: 0 = all OK, 1 = at least one WARN, 2 = at least one CRIT/error.
#             A briefing that cannot be written is also a 2: a run that produced
#             half its outputs is a failed run, not a partial success.
#
# License: single-user license, modify allowed, no redistribution.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.env"
DRY_RUN=0
RENDER_ONLY=''
VERSION="1.0.0"

# shellcheck source=lib/odc_briefing.sh
. "${SCRIPT_DIR}/lib/odc_briefing.sh"

log()  { printf '%s [tbs_manager] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }
err()  { printf '%s [tbs_manager] ERROR: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >&2; }
esc()  { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' ; }

usage() { grep -E '^# (Usage|Cron|  \./|  10 7)' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --config)  shift; CONFIG_FILE="${1:?--config requires a path}" ;;
    --render-only) shift; RENDER_ONLY="${1:?--render-only requires a path}" ;;
    -h|--help) usage ;;
    *) err "unknown argument: $1"; usage ;;
  esac
  shift
done

# ---------------------------------------------------------------------------
# Load and validate configuration (fail closed).
# ---------------------------------------------------------------------------
if [ ! -r "$CONFIG_FILE" ]; then
  err "config file not found or not readable: $CONFIG_FILE"
  err "run env_collector.sh first, or copy config.env and edit it."
  exit 2
fi
# shellcheck source=/dev/null
source "$CONFIG_FILE"

for v in ORACLE_SID ORACLE_HOME ORACLE_CONNECT OUTPUT_DIR \
         TS_WARN_PCT TS_CRIT_PCT TS_SHRINK_FREE_PCT TS_FRAG_EXTENTS; do
  if [ -z "${!v:-}" ]; then
    err "required config variable $v is empty - edit $CONFIG_FILE"
    exit 2
  fi
done

if [ -z "$RENDER_ONLY" ] && [ ! -x "$ORACLE_HOME/bin/sqlplus" ]; then
  err "sqlplus not found at \$ORACLE_HOME/bin/sqlplus ($ORACLE_HOME) - check ORACLE_HOME in config"
  exit 2
fi

export ORACLE_SID ORACLE_HOME
export PATH="$ORACLE_HOME/bin:$PATH"
export NLS_LANG="${NLS_LANG:-AMERICAN_AMERICA.AL32UTF8}"


sq() {
  sqlplus -s -L "$ORACLE_CONNECT" 2>/dev/null <<SQL
SET PAGES 0 FEEDBACK OFF HEADING OFF VERIFY OFF LINES 4000 TRIMSPOOL ON
WHENEVER SQLERROR EXIT SQL.SQLCODE
$1
EXIT
SQL
}

if [ -z "$RENDER_ONLY" ]; then
  if ! sq "SELECT 'ODC_OK' FROM dual;" | grep -q ODC_OK; then
    err "cannot connect to ORACLE_SID=$ORACLE_SID. Run as the oracle OS user and verify config."
    exit 2
  fi
  log "connectivity OK"
  IDENT="$(sq "SELECT version_full || '|' || (SELECT cdb FROM v\$database) FROM v\$instance;" | tail -1)"
  DB_VERSION="${IDENT%%|*}" ; IS_CDB="${IDENT#*|}"
else
  # Nothing is contacted, so the identity that was true at COLLECTION time is
  # not knowable here. Saying "unknown" is the honest answer; inventing a
  # version would put a fact in the report that nobody measured.
  log "render-only: rebuilding outputs from $RENDER_ONLY, the database is not contacted"
  DB_VERSION="unknown (rendered from a saved collection)"
  IS_CDB="unknown"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  cat <<PLAN
DRY-RUN - tbs_manager plan
  config           : $CONFIG_FILE
  ORACLE_SID       : $ORACLE_SID  (version $DB_VERSION, CDB=$IS_CDB)
  WOULD run        : sql/tbs_report.sql (SELECT-only)
    thresholds     : usage ${TS_WARN_PCT}/${TS_CRIT_PCT}%
                     shrink candidate above ${TS_SHRINK_FREE_PCT}% free inside a datafile
                     extent-count hint above ${TS_FRAG_EXTENTS} extents
  WOULD write      : HTML report and briefing.json under $OUTPUT_DIR/tbs/
  WOULD NOT        : issue any statement that changes anything. This release is
                     report-only and holds no path that writes to the database.
PLAN
  exit 0
fi

# Created AFTER the dry-run branch has exited, deliberately. A dry run
# prints a plan and must leave the filesystem exactly as it found it: it
# says it writes nothing, and creating an output directory would make that
# sentence false. A test asserts a dry run adds no files.
mkdir -p "$OUTPUT_DIR/tbs"

# ---------------------------------------------------------------------------
# Run the SQL collector.
# ---------------------------------------------------------------------------
TS_NOW="$(date '+%Y%m%d-%H%M%S')"

if [ -n "$RENDER_ONLY" ]; then
  if [ ! -r "$RENDER_ONLY" ]; then
    err "raw collector file not readable: $RENDER_ONLY"
    exit 2
  fi
  RAW_FILE="$RENDER_ONLY"
else
  RAW_FILE="$OUTPUT_DIR/tbs/tbs_raw_${ORACLE_SID}_${TS_NOW}.txt"
  SQL_RC=0
  sqlplus -s -L "$ORACLE_CONNECT" \
    @"$SCRIPT_DIR/sql/tbs_report.sql" \
    "$TS_WARN_PCT" "$TS_CRIT_PCT" \
    "$TS_SHRINK_FREE_PCT" "$TS_FRAG_EXTENTS" \
    "$RAW_FILE" >/dev/null || SQL_RC=$?

  if [ "$SQL_RC" -ne 0 ] || [ ! -s "$RAW_FILE" ]; then
    err "SQL collector failed (sqlplus rc=$SQL_RC). Check DB access and dictionary grants."
    exit 2
  fi
fi
log "collector complete: $RAW_FILE"

# ---------------------------------------------------------------------------
# Parse, roll up, build BOTH outputs from the ONE collection above.
#
# Nothing is appended to the raw file at any point, so a re-render leaves the
# collection it read exactly as it found it. That is asserted by a test rather
# than left as an intention, because the failure mode is quiet: every replay
# would differ from the last, and a read-only archive copy would fail outright.
# ---------------------------------------------------------------------------
EXIT_CODE=0
ROWS_HTML=""
SECTION_HTML=""
CUR_SECTION="General"

odc_br_reset

# Pass one pools every measurement, keyed by the check id it belongs to.
# Keyed by ID and not by position on purpose: attaching each metric to whichever
# check was last seen would silently misfile it the first time somebody wrote
# their SQL in a different order, and would quietly force every future author to
# interleave their statements to stay correct.
while IFS= read -r line; do
  case "$line" in
    MET\|*)
      IFS='|' read -r _ mid mname mvalue munit <<<"$line"
      odc_br_metric "$mid" "$mname" "$mvalue" "$munit"
      ;;
  esac
done < "$RAW_FILE"

# Pass two builds the HTML rows and the briefing checks together, from the same
# lines, so the two outputs cannot disagree about a single check.
while IFS= read -r line; do
  case "$line" in
    SEC\|*)
      title="${line#SEC|}"
      CUR_SECTION="$title"
      [ -n "$SECTION_HTML" ] && ROWS_HTML="${ROWS_HTML}</tbody></table>"
      SECTION_HTML=1
      ROWS_HTML="${ROWS_HTML}<h2>$(printf '%s' "$title" | esc)</h2><table><thead><tr><th>Status</th><th>Check</th><th>Detail</th></tr></thead><tbody>"
      ;;
    CHK\|*)
      IFS='|' read -r _ cid status title detail <<<"$line"
      badge_class="$(printf '%s' "$status" | tr 'A-Z' 'a-z')"
      case "$badge_class" in ok|warn|crit|na) ;; *) badge_class="na" ;; esac
      ROWS_HTML="${ROWS_HTML}<tr class=\"st-${badge_class}\"><td><span class=\"badge ${badge_class}\">${status}</span></td><td>$(printf '%s' "$title" | esc)</td><td>$(printf '%s' "$detail" | esc)</td></tr>"
      odc_br_check "$cid" "$CUR_SECTION" "$status" "$title" "$detail"
      case "$status" in
        CRIT) [ "$EXIT_CODE" -lt 2 ] && EXIT_CODE=2 ;;
        WARN) [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1 ;;
      esac
      ;;
  esac
done < "$RAW_FILE"
[ -n "$SECTION_HTML" ] && ROWS_HTML="${ROWS_HTML}</tbody></table>"

case "$EXIT_CODE" in
  0) OVERALL="OK";   OVERALL_CLASS="ok" ;;
  1) OVERALL="WARN"; OVERALL_CLASS="warn" ;;
  2) OVERALL="CRIT"; OVERALL_CLASS="crit" ;;
esac

REPORT="$OUTPUT_DIR/tbs/tbs_report_${ORACLE_SID}_${TS_NOW}.html"
cat > "$REPORT" <<HTML
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tablespace Report - ${ORACLE_SID} - ${TS_NOW}</title>
<style>
  :root{color-scheme:dark}
  body{background:#0A0B0D;color:#E8E9EB;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:32px;line-height:1.5}
  .wrap{max-width:1100px;margin:0 auto}
  h1{font-size:22px;margin:0 0 4px}
  h2{font-size:15px;margin:28px 0 8px;color:#9BA1A9;text-transform:uppercase;letter-spacing:.06em}
  .meta{color:#9BA1A9;font-size:13px;margin-bottom:20px}
  .summary{display:flex;align-items:center;gap:12px;background:#121316;border:1px solid #262A31;border-radius:10px;padding:16px 20px;margin-bottom:8px}
  .summary .big{font-size:18px;font-weight:700}
  table{width:100%;border-collapse:collapse;background:#121316;border:1px solid #262A31;border-radius:10px;overflow:hidden;font-size:13px}
  th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #262A31;vertical-align:top}
  th{color:#9BA1A9;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
  tr:last-child td{border-bottom:0}
  .badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600}
  .badge.ok{background:#12351f;color:#4ade80}
  .badge.warn{background:#3d2f10;color:#fbbf24}
  .badge.crit{background:#3d1512;color:#FF6B4A}
  .badge.na{background:#1c1f24;color:#9BA1A9}
  .foot{color:#9BA1A9;font-size:12px;margin-top:24px}
</style>
</head>
<body>
<div class="wrap">
  <h1>Tablespace Report</h1>
  <div class="meta">SID <strong>${ORACLE_SID}</strong> (version ${DB_VERSION}, CDB=${IS_CDB}) &middot; generated $(date '+%Y-%m-%d %H:%M:%S %Z') &middot; OraDiscuss Daily Operations Pack v${VERSION} &middot; read-only</div>
  <div class="summary"><span class="badge ${OVERALL_CLASS}">${OVERALL}</span><span class="big">Overall status: ${OVERALL}</span></div>
  ${ROWS_HTML}
  <div class="foot">Thresholds - usage ${TS_WARN_PCT}/${TS_CRIT_PCT}%, shrink candidate above ${TS_SHRINK_FREE_PCT}% free inside a datafile, extent-count hint above ${TS_FRAG_EXTENTS} extents. Shrink and extent rows are OBSERVATIONS, not recommendations: verify high-water marks and object dependencies yourself before acting on any of them. This report covers one container, named in the Report scope row above.</div>
</div>
</body>
</html>
HTML

ln -sf "$REPORT" "$OUTPUT_DIR/tbs/tbs_report_${ORACLE_SID}_latest.html"

# ---------------------------------------------------------------------------
# Output two: the machine-readable briefing, from the SAME collection.
#
# Written to a temporary file and moved into place, so a half-written briefing
# never exists at the real path for another process to read. If it cannot be
# written the whole run fails: a run that produced only its HTML is a failed
# run, not a partial success, because "one collection, two outputs" would then
# be false in exactly the silent way that is hardest to notice.
# ---------------------------------------------------------------------------
THRESHOLDS_JSON="$(printf '{"tablespace_warn_pct":%s,"tablespace_crit_pct":%s,"shrink_free_pct":%s,"frag_extents":%s}' \
  "$(odc_json_num "$TS_WARN_PCT")" "$(odc_json_num "$TS_CRIT_PCT")" \
  "$(odc_json_num "$TS_SHRINK_FREE_PCT")" "$(odc_json_num "$TS_FRAG_EXTENTS")")"

BRIEFING="$OUTPUT_DIR/tbs/tbs_report_${ORACLE_SID}_${TS_NOW}.json"
BRIEFING_TMP="${BRIEFING}.partial"
if ! odc_br_document \
      "daily-ops" "$VERSION" "tbs_manager.sh" "$ORACLE_SID" \
      "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$OVERALL" "$EXIT_CODE" \
      "$THRESHOLDS_JSON" > "$BRIEFING_TMP"; then
  rm -f "$BRIEFING_TMP"
  err "the HTML report was written but the AI briefing was not: $BRIEFING"
  err "this run produced only half of its outputs, so it is being reported as a failure."
  exit 2
fi
mv -f "$BRIEFING_TMP" "$BRIEFING"
ln -sf "$BRIEFING" "$OUTPUT_DIR/tbs/tbs_report_${ORACLE_SID}_latest.json"
log "briefing written: $BRIEFING"

log "report written: $REPORT"
log "overall status: $OVERALL (exit $EXIT_CODE)"
log "hand the briefing to your own AI with prompts/tablespace-capacity.md - nothing left this machine."
exit "$EXIT_CODE"
