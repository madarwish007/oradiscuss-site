#!/usr/bin/env bash
# ============================================================================
# OraDiscuss - Daily Operations Pack v1.0.0
# daily_analysis.sh - the "morning briefing": complete daily analysis.
#
# Generated locally by OraDiscuss tooling. Not produced by, affiliated with, or
# endorsed by Oracle Corporation. https://oradiscuss.com
#
# Written for Oracle 19c/21c/23ai on Linux.
# READ-ONLY: SELECT-only SQL plus `opatch lsinventory` (read-only inventory).
# It issues no DDL and no DML, and it writes nothing to your database.
#
# ONE COLLECTION, TWO OUTPUTS:
#   report.html   - the morning briefing for the human
#   briefing.json - the same collection, structured, for YOUR OWN AI
# The database is queried ONCE. A second collection is how the two outputs end
# up describing the same database at two different moments.
#
# Covers: instance/database, tablespace usage + 7-day growth trend (opt-in
# history table), top-10 segments, RMAN backup recency, standby apply lag,
# stale optimizer statistics, failed logins (unified audit), invalid objects
# (with delta vs yesterday), patch inventory summary.
#
# Usage:
#   ./daily_analysis.sh [--dry-run] [--config /path/to/config-<node>.env]
#   ./daily_analysis.sh --render-only /path/to/daily_raw_SID_ts.txt
#
#   --render-only rebuilds both outputs from a collection that already ran,
#   without contacting the database. Use it to re-read an old collection, and
#   note that it is also what lets this pack's tests drive the REAL parser
#   below rather than a copy of it that would pass forever while this rotted.
#
# Cron example (07:00 daily, as oracle OS user):
#   0 7 * * * /opt/oradiscuss/daily-ops/daily_analysis.sh >> /opt/oradiscuss/daily-ops/output/cron.log 2>&1
#
# Output: HTML morning briefing and briefing.json in $OUTPUT_DIR/briefings/
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

log()  { printf '%s [daily_analysis] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }
err()  { printf '%s [daily_analysis] ERROR: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >&2; }
esc()  { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' ; }

usage() { grep -E '^# (Usage|Cron|  \./|  0 7)' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }

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
         TS_WARN_PCT TS_CRIT_PCT RMAN_FULL_MAX_AGE_HOURS RMAN_ARCH_MAX_AGE_HOURS \
         STANDBY_LAG_WARN_MIN STALE_STATS_WARN; do
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

mkdir -p "$OUTPUT_DIR/briefings" "$OUTPUT_DIR/state"

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

  # Version-detect first, CDB-detect second (version matrix checklist 1-2).
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
VIEW_PREFIX="DBA" ; [ "$IS_CDB" = "YES" ] && VIEW_PREFIX="CDB"
TS_HISTORY_TABLE="${TS_HISTORY_TABLE:-ORADISCUSS_TS_HISTORY}"

if [ "$DRY_RUN" -eq 1 ]; then
  cat <<PLAN
DRY-RUN - daily_analysis plan
  config          : $CONFIG_FILE
  ORACLE_SID      : $ORACLE_SID  (version $DB_VERSION, CDB=$IS_CDB -> ${VIEW_PREFIX}_* views)
  WOULD run       : sql/daily_analysis.sql (SELECT-only)
    thresholds    : TS ${TS_WARN_PCT}/${TS_CRIT_PCT}%  RMAN full ${RMAN_FULL_MAX_AGE_HOURS}h / arch ${RMAN_ARCH_MAX_AGE_HOURS}h
                    standby lag ${STANDBY_LAG_WARN_MIN}min  stale stats ${STALE_STATS_WARN}
    history table : $TS_HISTORY_TABLE (growth trends; NA if not created)
  WOULD also      : read \$ORACLE_HOME/OPatch/opatch lsinventory (patch summary)
                    compute invalid-objects delta vs $OUTPUT_DIR/state/invalid_count.prev
  WOULD write     : HTML morning briefing under $OUTPUT_DIR/briefings/
PLAN
  exit 0
fi

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
RAW_FILE="$OUTPUT_DIR/briefings/daily_raw_${ORACLE_SID}_${TS_NOW}.txt"
SQL_RC=0
sqlplus -s -L "$ORACLE_CONNECT" \
  @"$SCRIPT_DIR/sql/daily_analysis.sql" \
  "$TS_WARN_PCT" "$TS_CRIT_PCT" \
  "$RMAN_FULL_MAX_AGE_HOURS" "$RMAN_ARCH_MAX_AGE_HOURS" \
  "$STANDBY_LAG_WARN_MIN" "$STALE_STATS_WARN" \
  "$VIEW_PREFIX" "$TS_HISTORY_TABLE" "$RAW_FILE" >/dev/null || SQL_RC=$?

if [ "$SQL_RC" -ne 0 ] || [ ! -s "$RAW_FILE" ]; then
  err "SQL collector failed (sqlplus rc=$SQL_RC). Check DB access and dictionary grants."
  exit 2
fi
fi
log "collector complete: $RAW_FILE"

# ---------------------------------------------------------------------------
# Patch inventory and the invalid-objects delta APPEND to the raw collection,
# so both are skipped under --render-only. Re-rendering a saved collection must
# leave it exactly as it was: a re-render that grows the file it is reading
# would make every replay differ from the last, and would fail outright on the
# read-only archive copy somebody eventually keeps.
# ---------------------------------------------------------------------------
if [ -z "$RENDER_ONLY" ]; then

# ---------------------------------------------------------------------------
# Patch inventory (read-only opatch lsinventory; best effort).
# ---------------------------------------------------------------------------
PATCH_LINE="CHK|PATCH|NA|Patch inventory|opatch not found at \$ORACLE_HOME/OPatch - patch level unknown"
if [ -x "$ORACLE_HOME/OPatch/opatch" ]; then
  LSINV="$("$ORACLE_HOME/OPatch/opatch" lsinventory 2>/dev/null || true)"
  RU_LINE="$(printf '%s' "$LSINV" | grep -iE '^(Patch description|.*Release Update|RU )' | head -1)"
  RU_ID="$(printf '%s' "$LSINV" | grep -oE '^Patch[[:space:]]+[0-9]+' | head -1 | grep -oE '[0-9]+')"
  if [ -n "$RU_ID" ]; then
    PATCH_LINE="CHK|PATCH|OK|Patch inventory|top patch $RU_ID - $(printf '%s' "$RU_LINE" | head -c 150). Verify currency against quarterly RU announcements."
  else
    PATCH_LINE="CHK|PATCH|WARN|Patch inventory|opatch ran but no patches parsed - home may be unpatched (base release). Check 'opatch lsinventory' manually."
  fi
fi
printf '%s\n' "$PATCH_LINE" >> "$RAW_FILE"

# ---------------------------------------------------------------------------
# Invalid-objects delta vs yesterday (state file; read-only against DB).
# ---------------------------------------------------------------------------
STATE_FILE="$OUTPUT_DIR/state/invalid_count.prev"
CUR_INVALID="$(awk -F'|' '$1=="CHK" && $2=="INVALID"{ gsub(/[^0-9].*/,"",$5); print $5 }' "$RAW_FILE" | head -1)"
CUR_INVALID="${CUR_INVALID:-0}"
PREV_INVALID="-"
if [ -f "$STATE_FILE" ]; then
  PREV_INVALID="$(cat "$STATE_FILE")"
  DELTA=$(( CUR_INVALID - PREV_INVALID ))
  if [ "$DELTA" -gt 0 ]; then
    printf 'CHK|INVALID_DELTA|WARN|Invalid objects delta|%s new invalid objects since yesterday (%s -> %s)\n' "$DELTA" "$PREV_INVALID" "$CUR_INVALID" >> "$RAW_FILE"
  else
    printf 'CHK|INVALID_DELTA|OK|Invalid objects delta|no new invalid objects (%s -> %s)\n' "$PREV_INVALID" "$CUR_INVALID" >> "$RAW_FILE"
  fi
else
  printf 'CHK|INVALID_DELTA|OK|Invalid objects delta|first run - baseline stored (%s invalid). Delta reported from tomorrow.\n' "$CUR_INVALID" >> "$RAW_FILE"
fi
printf '%s' "$CUR_INVALID" > "$STATE_FILE"

fi  # end of the collect-time-only appends

# ---------------------------------------------------------------------------
# Parse, roll up, build BOTH outputs from the ONE collection above.
# ---------------------------------------------------------------------------
EXIT_CODE=0
ROWS_HTML=""
SECTION_HTML=""
CUR_SECTION="General"

odc_br_reset

# Pass one pools every measurement, keyed by the check id it belongs to.
# Keyed by ID and not by position on purpose: attaching each metric to
# whichever check was last seen would silently misfile it the first time
# somebody wrote their SQL in a different order, and would quietly force every
# future author to interleave their statements to stay correct.
while IFS= read -r line; do
  case "$line" in
    MET\|*)
      # MET|<check id>|<name>|<value>|<unit>
      # The numbers the HTML prints inside prose, handed to the AI directly so
      # it never has to parse "87.3% used (100 GB max, 87.3 GB used)".
      # Older parsers matched only SEC| and CHK|, so this line type is
      # invisible to them and the collector stays backwards compatible.
      IFS='|' read -r _ mid mname mvalue munit <<<"$line"
      odc_br_metric "$mid" "$mname" "$mvalue" "$munit"
      ;;
  esac
done < "$RAW_FILE"

# Pass two builds the HTML rows and the briefing checks together, from the
# same lines, so the two outputs cannot disagree about a single check.
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

REPORT="$OUTPUT_DIR/briefings/morning_${ORACLE_SID}_${TS_NOW}.html"
cat > "$REPORT" <<HTML
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Morning Briefing - ${ORACLE_SID} - ${TS_NOW}</title>
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
  <h1>Morning Briefing</h1>
  <div class="meta">SID <strong>${ORACLE_SID}</strong> (version ${DB_VERSION}, CDB=${IS_CDB}) &middot; generated $(date '+%Y-%m-%d %H:%M:%S %Z') &middot; OraDiscuss Daily Operations Pack v${VERSION}</div>
  <div class="summary"><span class="badge ${OVERALL_CLASS}">${OVERALL}</span><span class="big">Overall status: ${OVERALL}</span></div>
  ${ROWS_HTML}
  <div class="foot">Thresholds - tablespaces ${TS_WARN_PCT}/${TS_CRIT_PCT}%, RMAN full ${RMAN_FULL_MAX_AGE_HOURS}h / arch ${RMAN_ARCH_MAX_AGE_HOURS}h, standby lag ${STANDBY_LAG_WARN_MIN}min, stale stats warn at ${STALE_STATS_WARN}. Growth trends require the opt-in history table (${TS_HISTORY_TABLE}). Field-test release - validate in non-production first.</div>
</div>
</body>
</html>
HTML

ln -sf "$REPORT" "$OUTPUT_DIR/briefings/morning_${ORACLE_SID}_latest.html"

# ---------------------------------------------------------------------------
# Output two: the machine-readable briefing, from the SAME collection.
#
# Written to a temporary file and moved into place, so a half-written briefing
# never exists at the real path for another process to read. If it cannot be
# written the whole run fails: a run that produced only its HTML is a failed
# run, not a partial success, because "one collection, two outputs" would then
# be false in exactly the silent way that is hardest to notice.
# ---------------------------------------------------------------------------
THRESHOLDS_JSON="$(printf '{"tablespace_warn_pct":%s,"tablespace_crit_pct":%s,"rman_full_max_age_hours":%s,"rman_arch_max_age_hours":%s,"standby_lag_warn_min":%s,"stale_stats_warn":%s}' \
  "$(odc_json_num "$TS_WARN_PCT")" "$(odc_json_num "$TS_CRIT_PCT")" \
  "$(odc_json_num "$RMAN_FULL_MAX_AGE_HOURS")" "$(odc_json_num "$RMAN_ARCH_MAX_AGE_HOURS")" \
  "$(odc_json_num "$STANDBY_LAG_WARN_MIN")" "$(odc_json_num "$STALE_STATS_WARN")")"

BRIEFING="$OUTPUT_DIR/briefings/morning_${ORACLE_SID}_${TS_NOW}.json"
BRIEFING_TMP="${BRIEFING}.partial"
if ! odc_br_document \
      "daily-ops" "$VERSION" "daily_analysis.sh" "$ORACLE_SID" \
      "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$OVERALL" "$EXIT_CODE" \
      "$THRESHOLDS_JSON" > "$BRIEFING_TMP"; then
  rm -f "$BRIEFING_TMP"
  err "the HTML report was written but the AI briefing was not: $BRIEFING"
  err "this run produced only half of its outputs, so it is being reported as a failure."
  exit 2
fi
mv -f "$BRIEFING_TMP" "$BRIEFING"
ln -sf "$BRIEFING" "$OUTPUT_DIR/briefings/morning_${ORACLE_SID}_latest.json"
log "briefing written: $BRIEFING"

# Optional notification (off unless NOTIFY_ENABLED=1 in config).
if [ "${NOTIFY_ENABLED:-0}" = "1" ] && [ -n "${NOTIFY_EMAIL:-}" ]; then
  if command -v mail >/dev/null 2>&1; then
    mail -s "[OraDiscuss DailyOps] ${ORACLE_SID} morning briefing: ${OVERALL}" "$NOTIFY_EMAIL" < "$REPORT" || \
      log "notification: mail command failed (report still written)"
  else
    log "notification: NOTIFY_ENABLED=1 but no 'mail' binary - skipping"
  fi
fi

log "report written: $REPORT"
log "overall status: $OVERALL (exit $EXIT_CODE)"
log "hand the briefing to your own AI with a prompt from prompts/ - nothing left this machine."
exit "$EXIT_CODE"
