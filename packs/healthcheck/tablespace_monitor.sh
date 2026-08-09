#!/usr/bin/env bash
# ============================================================================
# OraDiscuss - DBA Health Check Automation Pack v1.0.0
# tablespace_monitor.sh - focused tablespace/autoextend monitor with growth
# projection. Appends one line per tablespace to a CSV log each run.
#
# Written for Oracle 19c/21c.
#
# Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
# affiliated with, or endorsed by Oracle Corporation.
# READ-ONLY: this pack issues no DDL and no DML against your data.
#
# Review it before you run it, and run it somewhere that is not production
# first. You are the DBA.
# READ-ONLY by default: runs SELECT-only SQL. Growth projection uses the
# opt-in history table (see sql/create_history_table.sql - the ONLY script
# in this pack that writes to the database, run manually and reviewed first).
#
# Usage:
#   ./tablespace_monitor.sh [--dry-run] [--config /path/to/config.env]
#
# Cron example (hourly, as oracle OS user):
#   7 * * * * /opt/oradiscuss/healthcheck/tablespace_monitor.sh >> /opt/oradiscuss/healthcheck/output/cron.log 2>&1
#
# Output: appends to $OUTPUT_DIR/logs/tablespace_usage_<SID>.csv
#   timestamp,tablespace,used_pct,status,used_gb,max_gb,autoextend,gb_per_day,days_to_90pct
# Exit codes: 0 = all OK (or dry-run), 1 = any WARN, 2 = any CRIT or failure.
#
# License: single-user license, modify allowed, no redistribution.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.env"
DRY_RUN=0
VERSION="1.0.0"
RENDER_ONLY=''

# The dual-output layer, shared with health_check.sh. Sourced, never executed.
# shellcheck source=lib/odc_briefing.sh
. "${SCRIPT_DIR}/lib/odc_briefing.sh"

log()  { printf '%s [ts_monitor] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }
err()  { printf '%s [ts_monitor] ERROR: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >&2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --render-only) shift; RENDER_ONLY="${1:?--render-only requires a path}" ;;
    --config)  shift; CONFIG_FILE="${1:?--config requires a path}" ;;
    -h|--help) grep -E '^# (Usage|Cron|  [0-9])' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
    *) err "unknown argument: $1"; exit 2 ;;
  esac
  shift
done

if [ ! -r "$CONFIG_FILE" ]; then
  err "config file not found or not readable: $CONFIG_FILE"
  exit 2
fi
# shellcheck source=/dev/null
source "$CONFIG_FILE"

for v in ORACLE_SID ORACLE_HOME ORACLE_CONNECT OUTPUT_DIR \
         TS_WARN_PCT TS_CRIT_PCT TS_HISTORY_TABLE; do
  if [ -z "${!v:-}" ]; then
    err "required config variable $v is empty - edit $CONFIG_FILE"
    exit 2
  fi
done
if [ -z "$RENDER_ONLY" ] && [ ! -x "$ORACLE_HOME/bin/sqlplus" ]; then
  err "sqlplus not found at \$ORACLE_HOME/bin/sqlplus - check ORACLE_HOME"
  exit 2
fi

export ORACLE_SID ORACLE_HOME
export PATH="$ORACLE_HOME/bin:$PATH"
export NLS_LANG="${NLS_LANG:-AMERICAN_AMERICA.AL32UTF8}"

CSV="$OUTPUT_DIR/logs/tablespace_usage_${ORACLE_SID}.csv"

if [ -z "$RENDER_ONLY" ]; then
rc="$(sqlplus -s -L "$ORACLE_CONNECT" <<'SQL' 2>/dev/null
SET PAGES 0 FEEDBACK OFF HEADING OFF VERIFY OFF
SELECT 'ODC_OK' FROM dual;
EXIT
SQL
)" || true
if [ "$rc" != "ODC_OK" ]; then
  err "cannot connect to ORACLE_SID=$ORACLE_SID - check config.env and OS auth."
  exit 2
fi
log "connectivity OK"
else
  log "render-only: rebuilding outputs from $RENDER_ONLY, the database is not contacted"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  log "dry-run: config valid, database reachable."
  log "dry-run: WOULD snapshot usage via sql/tablespace_usage.sql (warn=${TS_WARN_PCT} crit=${TS_CRIT_PCT})"
  log "dry-run: WOULD attempt growth projection from history table '${TS_HISTORY_TABLE}' (falls back to current-only if absent)"
  log "dry-run: WOULD append CSV rows to $CSV"
  exit 0
fi

# Created AFTER the dry-run branch has exited, deliberately. A dry run
# prints a plan and must leave the filesystem exactly as it found it: it
# says it writes nothing, and creating an output directory would make that
# sentence false. A test asserts a dry run adds no files.
mkdir -p "$OUTPUT_DIR/logs"

# --- current usage snapshot ------------------------------------------------
PROJ="$(mktemp)"
if [ -n "$RENDER_ONLY" ]; then
  if [ ! -r "$RENDER_ONLY" ]; then
    err "raw usage file not readable: $RENDER_ONLY"
    exit 2
  fi
  RAW="$RENDER_ONLY"
  trap 'rm -f "${PROJ:-}"' EXIT
else
RAW="$(mktemp)"
trap 'rm -f "${RAW:-}" "${PROJ:-}"' EXIT
SQL_RC=0
sqlplus -s -L "$ORACLE_CONNECT" @"$SCRIPT_DIR/sql/tablespace_usage.sql" \
  "$TS_WARN_PCT" "$TS_CRIT_PCT" "$RAW" >/dev/null || SQL_RC=$?
if [ "$SQL_RC" -ne 0 ] || [ ! -s "$RAW" ]; then
  err "usage query failed (sqlplus rc=$SQL_RC)."
  exit 2
fi
fi

# --- optional growth projection (graceful fallback) -------------------------
if [ -z "$RENDER_ONLY" ]; then
sqlplus -s -L "$ORACLE_CONNECT" @"$SCRIPT_DIR/sql/tablespace_projection.sql" \
  "$TS_HISTORY_TABLE" "$PROJ" >/dev/null 2>&1 || true
fi
if grep -q '^#HISTORY_MISSING' "$PROJ" 2>/dev/null; then
  log "history table '${TS_HISTORY_TABLE}' not present - current-only mode (no projection)."
  : > "$PROJ"
elif grep -q '^#PROJECTION_ERROR' "$PROJ" 2>/dev/null; then
  err "projection query failed: $(grep '^#PROJECTION_ERROR' "$PROJ" | head -1) - continuing current-only."
  : > "$PROJ"
fi

# --- emit CSV rows ----------------------------------------------------------
NOW_ISO="$(date '+%Y-%m-%dT%H:%M:%S%z')"
EXIT_CODE=0
if [ ! -s "$CSV" ]; then
  echo "timestamp,tablespace,used_pct,status,used_gb,max_gb,autoextend,gb_per_day,days_to_90pct" > "$CSV"
fi

odc_br_reset

while IFS=',' read -r ts pct status used_gb max_gb autoext; do
  [ -z "${ts:-}" ] && continue
  gpd="-"; d90="-"
  if [ -s "$PROJ" ]; then
    pline="$(grep -i "^${ts}," "$PROJ" | head -1 || true)"
    if [ -n "$pline" ]; then
      gpd="$(cut -d',' -f2 <<<"$pline")"
      d90="$(cut -d',' -f3 <<<"$pline")"
    fi
  fi
  echo "${NOW_ISO},${ts},${pct},${status},${used_gb},${max_gb},${autoext},${gpd},${d90}" >> "$CSV"

  # The same row, for the AI. The growth numbers are the interesting part
  # here: a percentage is a snapshot, gb_per_day and days_to_90pct are the
  # only things in this pack that describe a TREND, and they are exactly what
  # an assistant needs to answer a capacity question rather than a status one.
  # They are absent, not zero, when no history table exists.
  odc_br_metric "TS_${ts}" "used_pct" "$pct" "percent"
  odc_br_metric "TS_${ts}" "used_gb" "$used_gb" "GB"
  odc_br_metric "TS_${ts}" "max_gb" "$max_gb" "GB"
  [ "$gpd" != "-" ] && odc_br_metric "TS_${ts}" "gb_per_day" "$gpd" "GB/day"
  [ "$d90" != "-" ] && odc_br_metric "TS_${ts}" "days_to_90pct" "$d90" "days"
  odc_br_check "TS_${ts}" "Tablespace Usage" "$status" "Tablespace ${ts}" \
    "${pct}% used (${used_gb} GB of ${max_gb} GB max, autoextend ${autoext})"

  case "$status" in
    CRIT) [ "$EXIT_CODE" -lt 2 ] && EXIT_CODE=2 ;;
    WARN) [ "$EXIT_CODE" -lt 1 ] && EXIT_CODE=1 ;;
  esac
done < "$RAW"

log "snapshot appended to $CSV (exit $EXIT_CODE)"

# --- the second output: the briefing ---------------------------------------
case "$EXIT_CODE" in
  0) OVERALL="OK" ;;
  1) OVERALL="WARN" ;;
  *) OVERALL="CRIT" ;;
esac

mkdir -p "$OUTPUT_DIR/reports"
TS_NOW="$(date '+%Y%m%d-%H%M%S')"
BRIEFING="$OUTPUT_DIR/reports/tablespace_${ORACLE_SID}_${TS_NOW}.json"
THRESHOLDS_JSON="{\"tablespace_warn_pct\":$(odc_json_num "$TS_WARN_PCT"),\"tablespace_crit_pct\":$(odc_json_num "$TS_CRIT_PCT")}"

BRIEFING_TMP="${BRIEFING}.partial"
if ! odc_br_document \
      "healthcheck" "$VERSION" "tablespace_monitor.sh" "$ORACLE_SID" \
      "$NOW_ISO" "$OVERALL" "$EXIT_CODE" "$THRESHOLDS_JSON" > "$BRIEFING_TMP"; then
  rm -f "$BRIEFING_TMP"
  err "the CSV was appended but the AI briefing was not: $BRIEFING"
  err "this run produced only half of its outputs, so it is being reported as a failure."
  exit 2
fi
mv -f "$BRIEFING_TMP" "$BRIEFING"
ln -sf "$BRIEFING" "$OUTPUT_DIR/reports/tablespace_${ORACLE_SID}_latest.json"
log "briefing written: $BRIEFING"

exit "$EXIT_CODE"
