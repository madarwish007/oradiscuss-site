#!/usr/bin/env bash
# ============================================================================
# OraDiscuss - DBA Health Check Automation Pack v1.0.0
# awr_triage.sh - AWR triage over a snapshot window, dual output.
#
# Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
# affiliated with, or endorsed by Oracle Corporation.
# READ-ONLY: this pack issues no DDL and no DML against your data. It runs
# SELECT-only SQL.
#
# *** LICENSE REQUIREMENT, STATED AS A FACT AND NOT AS ADVICE ***
# This script reads DBA_HIST_* views. Reading those views requires the Oracle
# Diagnostics Pack license. If you are not licensed for Diagnostics Pack on
# this database, do not run this script. We state the requirement; whether you
# hold the license is yours to know, and nothing here checks or asserts it.
# The requirement is also printed on the face of every report this produces,
# so a report that outlives this README still carries it.
#
# Written for Oracle 19c/21c on Linux. Review it before you run it, and run it
# somewhere that is not production first. You are the DBA.
#
# Usage, two argument shapes because a real triage arrives either way:
#   ./awr_triage.sh --snaps <begin_snap> <end_snap>
#   ./awr_triage.sh --last-hours <N>
#   ./awr_triage.sh --render-only /path/to/awr_raw_SID_ts.txt
#
#   --snaps        you already know the window, typically from an AWR report
#                  or from DBA_HIST_SNAPSHOT.
#   --last-hours   you know when it hurt, not which snapshot that was. The
#                  wrapper resolves the earliest and latest snapshot inside
#                  the window and tells you which pair it chose, because a
#                  triage that silently picked a different window than you
#                  meant is worse than one that refused.
#   --render-only  rebuilds both outputs from a collection that already ran,
#                  without contacting the database.
#
# TWO OUTPUTS FROM ONE COLLECTION, which is the point of this pack:
#   $OUTPUT_DIR/reports/awr_triage_<SID>_<ts>.html  - for you
#   $OUTPUT_DIR/reports/awr_triage_<SID>_<ts>.json  - for YOUR AI
#
# WHAT THIS DOES NOT DO, deliberately: it does not tell you what to change.
# Every efficiency ratio is reported with status NA and no threshold, because
# the only honest comparison is against this database's own baseline. Ranked
# facts, never verdicts, is the line the whole product stands behind.
#
# Exit codes: 0 = collection and both outputs written, 1 = at least one WARN,
#             2 = at least one CRIT, the window could not be resolved, or an
#             output could not be written.
#
# License: single-user license, modify allowed, no redistribution.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.env"
VERSION="1.0.0"
SCRIPT_NAME="awr_triage.sh"

# The dual-output layer. Sourced, never executed.
# shellcheck source=lib/odc_briefing.sh
. "${SCRIPT_DIR}/lib/odc_briefing.sh"

log() { printf '%s [awr_triage] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }
err() { printf '%s [awr_triage] ERROR: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >&2; }

usage() {
  sed -n '18,32p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

BSNAP=''
ESNAP=''
LAST_HOURS=''
RENDER_ONLY=''

while [ $# -gt 0 ]; do
  case "$1" in
    --snaps)
      shift; BSNAP="${1:?--snaps requires a begin snapshot id}"
      shift; ESNAP="${1:?--snaps requires an end snapshot id}"
      ;;
    --last-hours) shift; LAST_HOURS="${1:?--last-hours requires a number}" ;;
    --render-only) shift; RENDER_ONLY="${1:?--render-only requires a path}" ;;
    --config) shift; CONFIG_FILE="${1:?--config requires a path}" ;;
    -h|--help) usage 0 ;;
    *) err "unknown argument: $1"; usage 2 ;;
  esac
  shift
done

# Exactly one argument shape, and say so plainly rather than guessing. A tool
# that quietly picks a window when the operator gave two conflicting ones is
# how a triage ends up describing the wrong hour.
if [ -z "$RENDER_ONLY" ]; then
  if [ -n "$LAST_HOURS" ] && [ -n "$BSNAP" ]; then
    err "give --snaps OR --last-hours, not both"; exit 2
  fi
  if [ -z "$LAST_HOURS" ] && [ -z "$BSNAP" ]; then
    err "one of --snaps or --last-hours is required"; usage 2
  fi
  case "${LAST_HOURS:-1}" in
    ''|*[!0-9]*) err "--last-hours must be a whole number of hours"; exit 2 ;;
  esac
fi

# shellcheck source=/dev/null
[ -r "$CONFIG_FILE" ] && . "$CONFIG_FILE"

ORACLE_SID="${ORACLE_SID:-${ODC_ORACLE_SID:-UNKNOWN}}"
OUTPUT_DIR="${OUTPUT_DIR:-${SCRIPT_DIR}/output}"
SQLPLUS_CONNECT="${SQLPLUS_CONNECT:-/ as sysdba}"

# The decimal separator is set in the ENVIRONMENT, never with ALTER SESSION.
# ALTER is a DDL verb, and the read-only guarantee is the product. A German
# locale session emitting 87,3 would otherwise invalidate the whole briefing.
export NLS_NUMERIC_CHARACTERS='.,'

mkdir -p "$OUTPUT_DIR/reports"
TS_NOW="$(date '+%Y%m%d_%H%M%S')"
RAW_FILE="$OUTPUT_DIR/reports/awr_raw_${ORACLE_SID}_${TS_NOW}.txt"

if [ -n "$RENDER_ONLY" ]; then
  if [ ! -r "$RENDER_ONLY" ]; then
    err "raw collector file not readable: $RENDER_ONLY"; exit 2
  fi
  RAW_FILE="$RENDER_ONLY"
  log "render-only: rebuilding outputs from $RAW_FILE, the database is not contacted"
else
  if [ ! -x "${ORACLE_HOME:-}/bin/sqlplus" ]; then
    err "sqlplus not found at \$ORACLE_HOME/bin/sqlplus"; exit 2
  fi

  # --last-hours resolves to a real snapshot pair BEFORE the collection, and
  # the pair it chose is logged. Resolution failure is fatal rather than
  # falling back to some default window.
  if [ -n "$LAST_HOURS" ]; then
    log "resolving the snapshot pair covering the last ${LAST_HOURS}h"
    RESOLVED="$("$ORACLE_HOME/bin/sqlplus" -S -L "$SQLPLUS_CONNECT" <<SQL || true
SET PAGESIZE 0 FEEDBACK OFF VERIFY OFF HEADING OFF TERMOUT OFF
WHENEVER SQLERROR EXIT SQL.SQLCODE
SELECT MIN(snap_id) || ' ' || MAX(snap_id)
FROM dba_hist_snapshot
WHERE dbid = (SELECT dbid FROM v\$database)
  AND end_interval_time >= SYSDATE - (${LAST_HOURS}/24);
EXIT
SQL
)"
    BSNAP="$(printf '%s' "$RESOLVED" | awk 'NF{print $1; exit}')"
    ESNAP="$(printf '%s' "$RESOLVED" | awk 'NF{print $2; exit}')"
    case "${BSNAP:-x}${ESNAP:-x}" in
      *[!0-9]*) err "could not resolve a snapshot pair for the last ${LAST_HOURS}h"; exit 2 ;;
    esac
    if [ "$BSNAP" = "$ESNAP" ]; then
      err "only one snapshot in the last ${LAST_HOURS}h (snap ${BSNAP}); widen the window"
      exit 2
    fi
    log "resolved to snapshots ${BSNAP} .. ${ESNAP}"
  fi

  log "collecting AWR triage for snapshots ${BSNAP} .. ${ESNAP}"
  SQL_RC=0
  "$ORACLE_HOME/bin/sqlplus" -S -L "$SQLPLUS_CONNECT" \
    "@${SCRIPT_DIR}/sql/awr_triage_collect.sql" "$BSNAP" "$ESNAP" \
    > "$RAW_FILE" || SQL_RC=$?

  if [ "$SQL_RC" -ne 0 ] || [ ! -s "$RAW_FILE" ]; then
    err "collector failed (rc=$SQL_RC) or produced nothing: $RAW_FILE"
    exit 2
  fi
  log "collection complete: $RAW_FILE"
fi

# Outputs always land in OUTPUT_DIR/reports, and only the BASE NAME is taken
# from the collection. Deriving the whole path from the raw file meant that a
# --render-only replay wrote its outputs next to whatever file it was handed,
# which for an archived collection is somebody's backup directory and for the
# test fixtures is the pack's own source tree.
RAW_BASE="$(basename "$RAW_FILE")"
RAW_BASE="${RAW_BASE%.txt}"
case "$RAW_BASE" in
  awr_raw_*) REPORT_BASE="awr_triage_${RAW_BASE#awr_raw_}" ;;
  *)         REPORT_BASE="awr_triage_${RAW_BASE}" ;;
esac
REPORT_HTML="$OUTPUT_DIR/reports/${REPORT_BASE}.html"
REPORT_JSON="$OUTPUT_DIR/reports/${REPORT_BASE}.json"

esc() { sed -e 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g'; }

EXIT_CODE=0
CUR_SECTION=''
ROWS_HTML=''
SECTION_HTML=0

odc_br_reset

# Pass one pools every measurement by check id. Position is never used: the
# collector may emit MET lines anywhere, and a metric that attached itself to
# whichever check happened to be last would misfile the first time somebody
# reordered a statement.
while IFS= read -r line; do
  case "$line" in
    MET\|*)
      IFS='|' read -r _ mid mname mvalue munit <<<"$line"
      odc_br_metric "$mid" "$mname" "$mvalue" "$munit"
      ;;
  esac
done < "$RAW_FILE"

# Pass two builds the human report and the briefing together, from the same
# single collection. That is the guarantee: the two outputs cannot disagree
# about the same database at the same moment, because there is only one read.
while IFS= read -r line; do
  case "$line" in
    SEC\|*)
      title="${line#SEC|}"
      CUR_SECTION="$title"
      [ "$SECTION_HTML" -eq 1 ] && ROWS_HTML="${ROWS_HTML}</tbody></table>"
      SECTION_HTML=1
      ROWS_HTML="${ROWS_HTML}<h2>$(printf '%s' "$title" | esc)</h2><table><thead><tr><th>Status</th><th>Item</th><th>Detail</th></tr></thead><tbody>"
      ;;
    CHK\|*)
      IFS='|' read -r _ cid status title detail <<<"$line"
      badge_class="$(printf '%s' "$status" | tr 'A-Z' 'a-z')"
      ROWS_HTML="${ROWS_HTML}<tr class=\"st-${badge_class}\"><td><span class=\"badge ${badge_class}\">${status}</span></td><td>$(printf '%s' "$title" | esc)</td><td>$(printf '%s' "$detail" | esc)</td></tr>"
      odc_br_check "$cid" "$CUR_SECTION" "$status" "$title" "$detail"
      case "$status" in
        CRIT) [ "$EXIT_CODE" -lt 2 ] && EXIT_CODE=2 ;;
        WARN) [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1 ;;
      esac
      ;;
  esac
done < "$RAW_FILE"

[ "$SECTION_HTML" -eq 1 ] && ROWS_HTML="${ROWS_HTML}</tbody></table>"

OVERALL=OK
[ "$EXIT_CODE" -eq 1 ] && OVERALL=WARN
[ "$EXIT_CODE" -ge 2 ] && OVERALL=CRIT

GENERATED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

cat > "$REPORT_HTML" <<HTML
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AWR triage ${ORACLE_SID} ${TS_NOW}</title>
<style>
body{font:15px/1.6 ui-sans-serif,system-ui,sans-serif;margin:0;padding:32px;color:#1c1917;background:#f7f5f1}
h1{font-size:1.6rem;margin:0 0 6px}h2{font-size:1.1rem;margin:32px 0 8px}
table{border-collapse:collapse;width:100%;font-size:14px}
th{text-align:left;padding:8px 10px 8px 0;border-bottom:2px solid #1c1917;font-size:11px;letter-spacing:.08em;text-transform:uppercase}
td{padding:9px 10px 9px 0;border-bottom:1px solid #e0d9cd;vertical-align:top}
.badge{font:600 10px ui-monospace,monospace;letter-spacing:.06em;padding:3px 7px;border-radius:4px}
.badge.ok{background:#e4efe8;color:#1f6b45}.badge.warn{background:#f6eeda;color:#8a6a12}
.badge.crit{background:#f7e7e2;color:#a3341f}.badge.na{background:#ede8e0;color:#787065}
.note{background:#efeae2;border-left:3px solid #e0a020;padding:12px 15px;margin:18px 0;font-size:14px}
.meta{color:#4a443d;font-size:13px}
</style></head><body>
<h1>AWR triage</h1>
<p class="meta">${ORACLE_SID} &middot; generated ${GENERATED_AT} &middot; overall ${OVERALL}</p>
<div class="note"><strong>Diagnostics Pack license required.</strong> This report was
produced by reading DBA_HIST_* views, which requires the Oracle Diagnostics Pack
license. The requirement is stated as a fact; whether you hold the license is
yours to know.</div>
<div class="note">No thresholds are applied to the efficiency ratios. Compare
them against this database's own baseline. This report states what the database
recorded and does not tell you what to change.</div>
${ROWS_HTML}
<p class="meta">OraDiscuss (oradiscuss.com). Not produced by, affiliated with,
or endorsed by Oracle Corporation. Read-only: this pack issues no DDL and no DML
against your data.</p>
</body></html>
HTML

if [ ! -s "$REPORT_HTML" ]; then
  err "report could not be written: $REPORT_HTML"; exit 2
fi

odc_br_document "healthcheck" "$VERSION" "$SCRIPT_NAME" "$ORACLE_SID" \
  "$GENERATED_AT" "$OVERALL" "$EXIT_CODE" > "$REPORT_JSON"

if [ ! -s "$REPORT_JSON" ]; then
  err "briefing could not be written: $REPORT_JSON"; exit 2
fi

log "report:   $REPORT_HTML"
log "briefing: $REPORT_JSON"
exit "$EXIT_CODE"
