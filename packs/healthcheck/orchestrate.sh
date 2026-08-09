#!/usr/bin/env bash
# ============================================================================
# OraDiscuss - DBA Health Check Automation Pack v1.0.0
# orchestrate.sh - runs the pack in sequence, collects outputs into a dated
# run directory, prunes old runs, optionally emails the report (OFF unless
# enabled in config.env). Safe to run overlapping: uses an flock lock.
#
# Written for Oracle 19c/21c.
#
# Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
# affiliated with, or endorsed by Oracle Corporation.
# READ-ONLY: this pack issues no DDL and no DML against your data.
#
# Review it before you run it, and run it somewhere that is not production
# first. You are the DBA.
# READ-ONLY (delegates to the pack scripts; the only DB-writing step in the
# pack is the manual, opt-in sql/create_history_table.sql).
#
# Usage:
#   ./orchestrate.sh [--dry-run] [--config /path/to/config.env]
#
# Cron example (06:00 daily):
#   0 6 * * * /opt/oradiscuss/healthcheck/orchestrate.sh >> /opt/oradiscuss/healthcheck/output/cron.log 2>&1
#
# Exit codes: 0 ok, 1 warn, 2 crit (worst of the executed checks).
#
# License: single-user license, modify allowed, no redistribution.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.env"
DRY_RUN=0

log()  { printf '%s [orchestrate] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }
err()  { printf '%s [orchestrate] ERROR: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >&2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --config)  shift; CONFIG_FILE="${1:?--config requires a path}" ;;
    -h|--help) grep -E '^# (Usage|Cron|  0 6)' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
    *) err "unknown argument: $1"; exit 2 ;;
  esac
  shift
done

if [ ! -r "$CONFIG_FILE" ]; then
  err "config file not found: $CONFIG_FILE"
  exit 2
fi
# shellcheck source=/dev/null
source "$CONFIG_FILE"

for v in ORACLE_SID OUTPUT_DIR RETENTION_DAYS EMAIL_ENABLED; do
  if [ -z "${!v:-}" ]; then
    err "required config variable $v is empty - edit $CONFIG_FILE"
    exit 2
  fi
done
case "$RETENTION_DAYS" in ''|*[!0-9]*) err "RETENTION_DAYS must be an integer"; exit 2 ;; esac

# --- mutual exclusion: refuse to overlap with another run -------------------
#
# flock ships with util-linux, so it is present on the Linux hosts this pack
# targets and absent on some minimal containers and on non-Linux Unix. When it
# was missing, `! flock -n 9` was simply true and this reported "another run
# holds the lock", which is a WRONG diagnosis: it sends the reader hunting for
# a process that does not exist. A tool that is not installed and a lock that
# is genuinely held are different problems and now say so.
LOCK_FILE="$OUTPUT_DIR/orchestrate.lock"
if ! command -v flock >/dev/null 2>&1; then
  err "flock is not installed, so overlapping runs cannot be prevented safely."
  err "install util-linux, or serialise runs yourself (cron spacing, or your scheduler's own mutex)."
  exit 2
fi
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  err "another orchestrate.sh run holds the lock ($LOCK_FILE) - exiting."
  exit 2
fi

if [ "$DRY_RUN" -eq 1 ]; then
  log "dry-run: config loaded, lock acquired."
  log "dry-run: WOULD run health_check.sh --config $CONFIG_FILE"
  log "dry-run: WOULD run tablespace_monitor.sh --config $CONFIG_FILE"
  log "dry-run: WOULD collect outputs into $OUTPUT_DIR/runs/<date>/"
  log "dry-run: WOULD prune run directories older than ${RETENTION_DAYS} days"
  if [ "$EMAIL_ENABLED" = "1" ]; then
    log "dry-run: email ENABLED - WOULD send report to configured recipients via mail/sendmail"
  else
    log "dry-run: email disabled (EMAIL_ENABLED=0) - nothing would be sent"
  fi
  exit 0
fi

# Created AFTER the dry-run branch has exited, deliberately. A dry run prints a
# plan and must leave the filesystem exactly as it found it: it says what it
# WOULD collect into, and creating that directory makes the sentence false.
# A test asserts a dry run adds no files.
mkdir -p "$OUTPUT_DIR/runs"

RUN_DIR="$OUTPUT_DIR/runs/$(date '+%Y-%m-%d_%H%M%S')_${ORACLE_SID}"
mkdir -p "$RUN_DIR"
WORST=0
track() { local rc=$1; [ "$rc" -gt "$WORST" ] && WORST=$rc; return 0; }

# --- 1. daily health check ---------------------------------------------------
log "running health_check.sh ..."
set +e
"$SCRIPT_DIR/health_check.sh" --config "$CONFIG_FILE" > "$RUN_DIR/health_check.log" 2>&1
rc=$?
set -e
track "$rc"
log "health_check.sh finished rc=$rc"

# --- 2. tablespace monitor ---------------------------------------------------
log "running tablespace_monitor.sh ..."
set +e
"$SCRIPT_DIR/tablespace_monitor.sh" --config "$CONFIG_FILE" > "$RUN_DIR/tablespace_monitor.log" 2>&1
rc=$?
set -e
track "$rc"
log "tablespace_monitor.sh finished rc=$rc"

# --- collect outputs ---------------------------------------------------------
# BOTH outputs go into the run directory, not just the HTML.
#
# Until v1.0 this line matched *.html only, which was correct when the HTML was
# the only thing a run produced. With the briefing added it would have quietly
# left every cron user, which is the documented primary usage, with a dated run
# directory containing half of what the run made: "one collection, two outputs"
# would have been true in reports/ and false in the artifact the customer keeps.
#
# awr_triage IS DELIBERATELY ABSENT FROM THIS LIST AND FROM THE RUN STEPS ABOVE.
# This comment exists because the alternative is somebody finding the omission
# later and being unable to tell whether it was a decision or the same fan-out
# bug a third time. It is a decision. awr_triage is on-demand triage, not a
# daily job: it needs a snapshot window chosen by a human, and it reads
# DBA_HIST_* views, which require the Diagnostics Pack licence that not every
# customer holds. Run unattended it would either guess a window or fail nightly
# on an unlicensed database. Its outputs still land in reports/ like everything
# else; they simply do not belong to an orchestrated run.
#
# IF awr_triage IS EVER ADDED TO THE RUN ABOVE, ADD ITS PREFIX HERE IN THE SAME
# COMMIT. That is the whole lesson this file has already taught twice.
for prefix in health tablespace; do
  for ext in html json; do
    find "$OUTPUT_DIR/reports" -maxdepth 1 -name "${prefix}_${ORACLE_SID}_*.${ext}" -newermt '-10 minutes' \
      -exec cp {} "$RUN_DIR/" \; 2>/dev/null || true
  done
done
[ -f "$OUTPUT_DIR/logs/tablespace_usage_${ORACLE_SID}.csv" ] && \
  cp "$OUTPUT_DIR/logs/tablespace_usage_${ORACLE_SID}.csv" "$RUN_DIR/" || true
ln -sfn "$RUN_DIR" "$OUTPUT_DIR/runs/latest"
log "run collected in $RUN_DIR"

# --- prune old runs -----------------------------------------------------------
pruned="$(find "$OUTPUT_DIR/runs" -mindepth 1 -maxdepth 1 -type d \
  -mtime +"$RETENTION_DAYS" -print -exec rm -rf {} + | wc -l)"
[ "$pruned" -gt 0 ] && log "pruned $pruned run director(ies) older than ${RETENTION_DAYS} days"

# --- optional email (OFF by default) ------------------------------------------
if [ "$EMAIL_ENABLED" = "1" ]; then
  if [ -z "${EMAIL_TO:-}" ]; then
    err "EMAIL_ENABLED=1 but EMAIL_TO is empty - skipping email."
  else
    REPORT="$(ls -t "$RUN_DIR"/health_*.html 2>/dev/null | head -1 || true)"
    if [ -z "$REPORT" ]; then
      err "no health report found to email - skipping."
    elif command -v mail >/dev/null 2>&1; then
      mail -s "${EMAIL_SUBJECT_PREFIX:-[HealthCheck]} ${ORACLE_SID} $(date '+%Y-%m-%d') status=${WORST}" \
        "$EMAIL_TO" < "$REPORT" && log "emailed report to recipients via mail"
    elif command -v sendmail >/dev/null 2>&1; then
      {
        printf 'To: %s\n' "$EMAIL_TO"
        printf 'Subject: %s %s %s status=%s\n' "${EMAIL_SUBJECT_PREFIX:-[HealthCheck]}" "$ORACLE_SID" "$(date '+%Y-%m-%d')" "$WORST"
        printf 'Content-Type: text/html; charset=utf-8\n\n'
        cat "$REPORT"
      } | sendmail -t && log "emailed report via sendmail"
    else
      err "EMAIL_ENABLED=1 but neither 'mail' nor 'sendmail' exists - skipping email."
    fi
  fi
fi

log "done. worst status=$WORST (0 ok / 1 warn / 2 crit)"
exit "$WORST"
