#!/usr/bin/env bash
# ============================================================================
# OraDiscuss - DBA Health Check Automation Pack v1.0.0
# health_check.sh - daily Oracle database health check.
#
# Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
# affiliated with, or endorsed by Oracle Corporation.
# READ-ONLY: this pack issues no DDL and no DML against your data. It runs
# SELECT-only SQL plus `lsnrctl status`.
#
# Written for Oracle 19c/21c on Linux. Review it before you run it, and run it
# somewhere that is not production first. You are the DBA.
#
# Usage:
#   ./health_check.sh [--dry-run] [--config /path/to/config.env]
#   ./health_check.sh --render-only /path/to/health_raw_SID_ts.txt
#
#   --render-only rebuilds both outputs from a collection that already ran,
#   without contacting the database. Use it to re-read an old collection, or
#   to re-render after you have edited the report template.
#
# Cron example (06:30 daily, as oracle OS user):
#   30 6 * * * /opt/oradiscuss/healthcheck/health_check.sh >> /opt/oradiscuss/healthcheck/output/cron.log 2>&1
#
# TWO OUTPUTS FROM ONE COLLECTION, which is the point of this pack:
#   $OUTPUT_DIR/reports/health_<SID>_<ts>.html  - for you
#   $OUTPUT_DIR/reports/health_<SID>_<ts>.json  - for YOUR AI
#
#   The .json is a briefing: structured, schema-versioned, and meant to be
#   handed to whichever assistant you already pay for, together with a prompt
#   from the prompts/ directory. Your scripts collect, your AI reasons, your
#   data never leaves this machine. Neither file is transmitted anywhere.
#
# Exit codes: 0 = all OK, 1 = at least one WARN, 2 = at least one CRIT or
#             the check could not run (monitoring/cron friendly).
#             A briefing that cannot be written is also a 2. In v1.0 the JSON
#             is a first-class output rather than a bonus, so a run that
#             silently produced only half its outputs must not report success.
#
# License: single-user license, modify allowed, no redistribution.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.env"
DRY_RUN=0
VERSION="1.0.0"

# The dual-output layer. Sourced, never executed.
# shellcheck source=lib/odc_briefing.sh
. "${SCRIPT_DIR}/lib/odc_briefing.sh"

log()  { printf '%s [health_check] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }
err()  { printf '%s [health_check] ERROR: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >&2; }

usage() {
  grep -E '^# (Usage|Cron|  \./|  30)' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 2
}

RENDER_ONLY=''

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
  err "copy config.env from the pack and edit it for your environment."
  exit 2
fi
# shellcheck source=/dev/null
source "$CONFIG_FILE"

for v in ORACLE_SID ORACLE_HOME ORACLE_CONNECT OUTPUT_DIR \
         TS_WARN_PCT TS_CRIT_PCT ASM_WARN_PCT ASM_CRIT_PCT \
         FRA_WARN_PCT FRA_CRIT_PCT RMAN_FULL_MAX_AGE_HOURS \
         RMAN_ARCH_MAX_AGE_HOURS INVALID_OBJ_WARN RETENTION_DAYS; do
  if [ -z "${!v:-}" ]; then
    err "required config variable $v is empty - edit $CONFIG_FILE"
    exit 2
  fi
done

if [ -z "$RENDER_ONLY" ] && [ ! -x "$ORACLE_HOME/bin/sqlplus" ]; then
  err "sqlplus not found at \$ORACLE_HOME/bin/sqlplus ($ORACLE_HOME) - check ORACLE_HOME in config.env"
  exit 2
fi

export ORACLE_SID ORACLE_HOME
export PATH="$ORACLE_HOME/bin:$PATH"
export NLS_LANG="${NLS_LANG:-AMERICAN_AMERICA.AL32UTF8}"

mkdir -p "$OUTPUT_DIR/reports"

# ---------------------------------------------------------------------------
# Connectivity check (also the core of --dry-run).
# ---------------------------------------------------------------------------
check_connectivity() {
  local rc
  rc="$(sqlplus -s -L "$ORACLE_CONNECT" <<'SQL' 2>/dev/null
SET PAGES 0 FEEDBACK OFF HEADING OFF VERIFY OFF
SELECT 'ODC_OK' FROM dual;
EXIT
SQL
)" || true
  [ "$rc" = "ODC_OK" ]
}

if [ -z "$RENDER_ONLY" ]; then
  if ! check_connectivity; then
    err "cannot connect to ORACLE_SID=$ORACLE_SID with the configured connect method."
    err "run as the oracle OS user (OS authentication) and verify config.env."
    exit 2
  fi
  log "connectivity OK (SELECT 1 FROM DUAL)"
else
  log "render-only: rebuilding outputs from $RENDER_ONLY, the database is not contacted"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  log "dry-run: config valid, database reachable."
  log "dry-run: WOULD run sql/health_check.sql with thresholds" \
      "TS=${TS_WARN_PCT}/${TS_CRIT_PCT} ASM=${ASM_WARN_PCT}/${ASM_CRIT_PCT}" \
      "FRA=${FRA_WARN_PCT}/${FRA_CRIT_PCT} RMAN=${RMAN_FULL_MAX_AGE_HOURS}h/${RMAN_ARCH_MAX_AGE_HOURS}h"
  log "dry-run: WOULD check listener via: lsnrctl status ${LISTENER_NAME:-LISTENER}"
  log "dry-run: WOULD write HTML report under $OUTPUT_DIR/reports/"
  log "dry-run: WOULD write AI briefing JSON beside it in the same directory"
  exit 0
fi

# ---------------------------------------------------------------------------
# Listener check (best effort; failure is reported, not fatal).
# ---------------------------------------------------------------------------
LISTENER_STATUS="CHK|LISTENER|WARN|Listener|lsnrctl not available - listener state unknown"
if command -v lsnrctl >/dev/null 2>&1; then
  if lsnrctl status "${LISTENER_NAME:-LISTENER}" >/dev/null 2>&1; then
    LISTENER_STATUS="CHK|LISTENER|OK|Listener|listener ${LISTENER_NAME:-LISTENER} is up"
  else
    LISTENER_STATUS="CHK|LISTENER|CRIT|Listener|listener ${LISTENER_NAME:-LISTENER} is DOWN or not responding"
  fi
fi

# ---------------------------------------------------------------------------
# Run the SQL collector.
# ---------------------------------------------------------------------------
TS_NOW="$(date '+%Y%m%d-%H%M%S')"
RAW_FILE="$OUTPUT_DIR/reports/health_raw_${ORACLE_SID}_${TS_NOW}.txt"

# --render-only rebuilds both outputs from a collection that already happened.
# It is how the pack's own tests exercise this exact parser without needing a
# database, and it is why those tests are worth trusting: a test that replayed
# a COPY of the loop below would pass forever while the shipped loop rotted.
if [ -n "$RENDER_ONLY" ]; then
  if [ ! -r "$RENDER_ONLY" ]; then
    err "raw collector file not readable: $RENDER_ONLY"
    exit 2
  fi
  RAW_FILE="$RENDER_ONLY"
else
SQL_RC=0
sqlplus -s -L "$ORACLE_CONNECT" \
  @"$SCRIPT_DIR/sql/health_check.sql" \
  "$TS_WARN_PCT" "$TS_CRIT_PCT" "$ASM_WARN_PCT" "$ASM_CRIT_PCT" \
  "$FRA_WARN_PCT" "$FRA_CRIT_PCT" \
  "$RMAN_FULL_MAX_AGE_HOURS" "$RMAN_ARCH_MAX_AGE_HOURS" \
  "$INVALID_OBJ_WARN" "$RAW_FILE" >/dev/null || SQL_RC=$?

if [ "$SQL_RC" -ne 0 ] || [ ! -s "$RAW_FILE" ]; then
  err "SQL collector failed (sqlplus rc=$SQL_RC). Check DB access and grants (SELECT_CATALOG_ROLE or equivalent)."
  exit 2
fi
fi
log "collector complete: $RAW_FILE"

# ---------------------------------------------------------------------------
# Parse results, build HTML report, compute exit code.
# ---------------------------------------------------------------------------
esc() {  # minimal HTML escaping
  sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

EXIT_CODE=0
ROWS_HTML=""
SECTION_HTML=""
CUR_SECTION="General"

# ONE COLLECTION feeds BOTH outputs. The raw file is read twice, but the
# database is queried once: that is the guarantee that matters, because a
# second collection is how the human report and the AI briefing end up
# disagreeing about the same database at the same moment.
odc_br_reset

# Pass one: pool every measurement, keyed by the check id it belongs to.
while IFS= read -r line; do
  case "$line" in
    MET\|*)
      # MET|<check id>|<name>|<value>|<unit>
      # The same numbers the HTML prints in prose, given to the AI directly so
      # it never has to parse "87.3% used (100 GB max, 87.3 GB used)".
      # Older parsers matched only SEC| and CHK|, so this line type is
      # invisible to them and the collector stays backwards compatible.
      IFS='|' read -r _ mid mname mvalue munit <<<"$line"
      odc_br_metric "$mid" "$mname" "$mvalue" "$munit"
      ;;
  esac
done < "$RAW_FILE"

# Pass two: build the HTML rows and the briefing checks together.
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
      ROWS_HTML="${ROWS_HTML}<tr class=\"st-${badge_class}\"><td><span class=\"badge ${badge_class}\">${status}</span></td><td>$(printf '%s' "$title" | esc)</td><td>$(printf '%s' "$detail" | esc)</td></tr>"
      odc_br_check "$cid" "$CUR_SECTION" "$status" "$title" "$detail"
      case "$status" in
        CRIT) [ "$EXIT_CODE" -lt 2 ] && EXIT_CODE=2 ;;
        WARN) [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1 ;;
      esac
      ;;
  esac
done < "$RAW_FILE"

# Append listener result as its own section.
IFS='|' read -r _ lst_id lst_status lst_title lst_detail <<<"$LISTENER_STATUS"
odc_br_check "$lst_id" "Listener" "$lst_status" "$lst_title" "$lst_detail"
ROWS_HTML="${ROWS_HTML}</tbody></table><h2>Listener</h2><table><tbody><tr class=\"st-$(printf '%s' "$lst_status" | tr 'A-Z' 'a-z')\"><td><span class=\"badge $(printf '%s' "$lst_status" | tr 'A-Z' 'a-z')\">$lst_status</span></td><td>$(printf '%s' "$lst_title" | esc)</td><td>$(printf '%s' "$lst_detail" | esc)</td></tr></tbody></table>"
case "$lst_status" in
  CRIT) [ "$EXIT_CODE" -lt 2 ] && EXIT_CODE=2 ;;
  WARN) [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1 ;;
esac

case "$EXIT_CODE" in
  0) OVERALL="OK";   OVERALL_CLASS="ok" ;;
  1) OVERALL="WARN"; OVERALL_CLASS="warn" ;;
  2) OVERALL="CRIT"; OVERALL_CLASS="crit" ;;
esac

REPORT="$OUTPUT_DIR/reports/health_${ORACLE_SID}_${TS_NOW}.html"
cat > "$REPORT" <<HTML
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Health Check - ${ORACLE_SID} - ${TS_NOW}</title>
<style>
  :root{color-scheme:dark}
  body{background:#0A0B0D;color:#E8E9EB;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:32px;line-height:1.5}
  .wrap{max-width:1000px;margin:0 auto}
  h1{font-size:22px;margin:0 0 4px}
  h2{font-size:15px;margin:28px 0 8px;color:#9BA1A9;text-transform:uppercase;letter-spacing:.06em}
  .meta{color:#9BA1A9;font-size:13px;margin-bottom:20px}
  .summary{display:flex;align-items:center;gap:12px;background:#121316;border:1px solid #262A31;border-radius:10px;padding:16px 20px;margin-bottom:8px}
  .summary .big{font-size:18px;font-weight:700}
  table{width:100%;border-collapse:collapse;background:#121316;border:1px solid #262A31;border-radius:10px;overflow:hidden;font-size:14px}
  th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #262A31}
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
  <h1>Database Health Check</h1>
  <div class="meta">SID <strong>${ORACLE_SID}</strong> &middot; generated $(date '+%Y-%m-%d %H:%M:%S %Z') &middot; OraDiscuss Health Check Pack v${VERSION}</div>
  <div class="summary"><span class="badge ${OVERALL_CLASS}">${OVERALL}</span><span class="big">Overall status: ${OVERALL}</span></div>
  ${ROWS_HTML}
  <div class="foot">Thresholds - tablespaces ${TS_WARN_PCT}/${TS_CRIT_PCT}%, ASM ${ASM_WARN_PCT}/${ASM_CRIT_PCT}%, FRA ${FRA_WARN_PCT}/${FRA_CRIT_PCT}%, RMAN full ${RMAN_FULL_MAX_AGE_HOURS}h / arch ${RMAN_ARCH_MAX_AGE_HOURS}h. Field-test release - validate in non-production first.</div>
</div>
</body>
</html>
HTML

ln -sf "$REPORT" "$OUTPUT_DIR/reports/health_${ORACLE_SID}_latest.html"
log "report written: $REPORT"

# ---------------------------------------------------------------------------
# The second output: the briefing for the customer's own AI.
#
# Written to a temp file and moved into place only once it is complete, so a
# consumer polling the reports directory can never read half a document, and
# a crash mid-write leaves the previous briefing intact rather than a corrupt
# one that an AI would happily reason over.
# ---------------------------------------------------------------------------
BRIEFING="$OUTPUT_DIR/reports/health_${ORACLE_SID}_${TS_NOW}.json"
THRESHOLDS_JSON="{\"tablespace_warn_pct\":$(odc_json_num "$TS_WARN_PCT"),\"tablespace_crit_pct\":$(odc_json_num "$TS_CRIT_PCT"),\"asm_warn_pct\":$(odc_json_num "$ASM_WARN_PCT"),\"asm_crit_pct\":$(odc_json_num "$ASM_CRIT_PCT"),\"fra_warn_pct\":$(odc_json_num "$FRA_WARN_PCT"),\"fra_crit_pct\":$(odc_json_num "$FRA_CRIT_PCT"),\"rman_full_max_age_hours\":$(odc_json_num "$RMAN_FULL_MAX_AGE_HOURS"),\"rman_arch_max_age_hours\":$(odc_json_num "$RMAN_ARCH_MAX_AGE_HOURS"),\"invalid_object_warn\":$(odc_json_num "$INVALID_OBJ_WARN")}"

BRIEFING_TMP="${BRIEFING}.partial"
if ! odc_br_document \
      "healthcheck" "$VERSION" "health_check.sh" "$ORACLE_SID" \
      "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$OVERALL" "$EXIT_CODE" \
      "$THRESHOLDS_JSON" > "$BRIEFING_TMP"; then
  rm -f "$BRIEFING_TMP"
  err "the HTML report was written but the AI briefing was not: $BRIEFING"
  err "this run produced only half of its outputs, so it is being reported as a failure."
  exit 2
fi
mv -f "$BRIEFING_TMP" "$BRIEFING"
ln -sf "$BRIEFING" "$OUTPUT_DIR/reports/health_${ORACLE_SID}_latest.json"
log "briefing written: $BRIEFING"

log "overall status: $OVERALL (exit $EXIT_CODE)"
log "hand the briefing to your own AI with a prompt from prompts/ - nothing left this machine."
exit "$EXIT_CODE"
