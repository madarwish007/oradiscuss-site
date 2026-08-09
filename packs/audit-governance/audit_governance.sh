#!/usr/bin/env bash
# ============================================================================
# OraDiscuss - Audit and Governance Pack v1.0.0
# audit_governance.sh - the audit posture, access and governance read.
#
# Generated locally by OraDiscuss tooling. Not produced by, affiliated with, or
# endorsed by Oracle Corporation. https://oradiscuss.com
#
# Written for Oracle 19c/21c/23ai on Linux.
# READ-ONLY: SELECT-only SQL. It issues no DDL and no DML, it writes nothing to
# your database, and there is no flag anywhere in this file that makes it.
#
# WHAT THIS PRODUCES, AND WHAT IT DELIBERATELY DOES NOT.
#
#   It reports WHAT IS. It never reports what that means.
#
#   That distinction is the whole design of this pack and it is not a style
#   preference. "Three accounts hold a password from the shipped default list"
#   is a fact: it was read out of a dictionary view and you can check it. "This
#   estate fails its audit" is a judgement, it depends on things no script on
#   this machine can see, and it is the line this whole product stands behind.
#
#   The temptation is everywhere in this subject: default passwords, system
#   privileges that apply across all schemas, grants held by PUBLIC, a profile
#   with no password verify function. Every one of those is reported here as a
#   counted, named observation and none of them is coloured as a finding.
#
#   The same rule governs the option and feature section, carried word for word
#   from this pack's registered scope: it reports usage FACTS and never a
#   licence conclusion. "Partitioning shows 14 detected usages, first seen on
#   12 March" is safe and genuinely useful. Anything past that sentence is a
#   judgement about an agreement this pack has never read.
#
# STATUS MEANS SOMETHING NARROWER HERE THAN IN THE OTHER PACKS, ON PURPOSE.
#   OK   = this was read, and here is what it says.
#   NA   = this could NOT be read, and here is what would make it readable.
#   WARN = the COLLECTION is incomplete. It is never a statement about your
#          database. CRIT is not used at all.
#
#   So needs_attention in the briefing is empty by construction, and a guard in
#   this product's test suite asserts that it stays empty.
#
# THIS PACK ADOPTS THE INCIDENT INCOMPLETENESS RULE, WHICH IS A DELIBERATE
# DEVIATION FROM THE STATE-BRIEFING DEFAULT, RECORDED HERE SO IT IS NOT
# "FIXED" BACK.
#   lib/odc_briefing.sh notes that for a state briefing an NA among thirty OK
#   checks should not move the summary. That is right for a health check and
#   wrong here. "No account holds a privilege that applies across all schemas"
#   and "DBA_SYS_PRIVS could not be read" are opposite answers, and an audit
#   read that printed OK over a tier nobody could open would be making exactly
#   the mistake this pack exists to expose in other people's reporting. So any
#   NA makes the overall status WARN, the report states how many of its checks
#   could not be read, and the exit code agrees with both.
#
# ONE COLLECTION, TWO OUTPUTS:
#   report.html   - the audit read for the human
#   briefing.json - the same collection, structured, for YOUR OWN AI
# The database is read ONCE. A second collection is how two outputs end up
# describing the same database at two different moments.
#
# TEN TIERS, EACH ITS OWN SQL FILE, EACH FAILING ALONE.
#   A tier that cannot run becomes an NA check naming what would make it run,
#   and the other nine still produce their rows. The tier list is in ONE place
#   in this file and the dry-run plan is printed FROM it, so a plan that
#   promises a tier the pack does not have cannot be written by accident.
#
# THE WINDOW IS BOUNDED BY CONFIG, NEVER OPEN.
#   AUDIT_WINDOW_DAYS bounds every time-based tier. An unbounded read of the
#   audit trail on a busy estate is millions of rows, is slow enough to be
#   noticed by the people running the database, and produces a document nobody
#   reads. The window is stated in the report and carried in the briefing.
#
# Usage:
#   ./audit_governance.sh [--dry-run] [--config /path/to/config.env]
#   ./audit_governance.sh --render-only /path/to/audit_raw_SID_ts.txt
#
#   --render-only rebuilds both outputs from a collection that already ran,
#   without contacting the database. Use it to re-read an old collection, and
#   note that it is also what lets this pack's tests drive the REAL parser
#   below rather than a copy of it that would pass forever while this rotted.
#
# Cron example (06:40 Monday, as oracle OS user):
#   40 6 * * 1 /opt/oradiscuss/audit-governance/audit_governance.sh >> /opt/oradiscuss/audit-governance/output/cron.log 2>&1
#
# Output: HTML report and briefing.json in $OUTPUT_DIR/audit/
# Exit codes: 0 = every tier was read, 1 = at least one tier could not be read,
#             2 = could not run at all, or an output failed. A briefing that
#             cannot be written is a 2: a run that produced half its outputs is
#             a failed run, not a partial success.
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

log()  { printf '%s [audit_governance] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }
err()  { printf '%s [audit_governance] ERROR: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >&2; }
esc()  { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' ; }

usage() { grep -E '^# (Usage|Cron|  \./|  40 6)' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }

# ---------------------------------------------------------------------------
# THE TIER TABLE. ONE PLACE, READ THREE TIMES.
#
# Fields: id | sql file | section title | what would make it readable
#
# The dry-run plan, the collection loop and the NA text all come from here, so
# a plan that promises a tier the collector does not have cannot be written by
# accident. This repo has shipped a fan-out step that named its inputs three
# times, and the RCA pack shipped a --dry-run describing two tiers it did not
# own. Both are the same defect and this is the shape that prevents it.
#
# The "needs" text is what the reader is owed when a tier does not run. A tier
# that is silently absent looks exactly like a tier that found nothing, and in
# an access review those are opposite answers.
# ---------------------------------------------------------------------------
tier_table() {
  cat <<'TIERS'
AUDIT_MODE|audit_mode_check.sql|Audit posture|SELECT on V$OPTION, V$PARAMETER, AUDIT_UNIFIED_POLICIES and AUDIT_UNIFIED_ENABLED_POLICIES. SELECT_CATALOG_ROLE normally carries all four.
TRAIL_ACTIVITY|audit_trail_activity.sql|Audit trail activity|SELECT on UNIFIED_AUDIT_TRAIL, which the AUDIT_VIEWER role carries, or on DBA_AUDIT_TRAIL where traditional auditing is still in use.
TRAIL_HYGIENE|audit_trail_hygiene.sql|Audit trail hygiene|SELECT on UNIFIED_AUDIT_TRAIL and on DBA_SEGMENTS. AUDIT_VIEWER plus SELECT_CATALOG_ROLE normally carry both.
PRIV_REVIEW|privilege_review.sql|Privilege and access|SELECT on DBA_ROLE_PRIVS, DBA_SYS_PRIVS, DBA_TAB_PRIVS, DBA_USERS, DBA_USERS_WITH_DEFPWD and V$PWFILE_USERS. SELECT_CATALOG_ROLE normally carries all six.
PKG_GRANTS|sensitive_grants_check.sql|Package grants held by PUBLIC|SELECT on DBA_TAB_PRIVS, which SELECT_CATALOG_ROLE normally carries.
PROFILE_POLICY|profile_policy_check.sql|Profile and password policy|SELECT on DBA_PROFILES and DBA_USERS, which SELECT_CATALOG_ROLE normally carries.
CHANGE_INV|change_inventory.sql|Change inventory|SELECT on DBA_OBJECTS for the object half, and on UNIFIED_AUDIT_TRAIL for the audited-statement half.
DBLINKS|db_links_inventory.sql|Database links|SELECT on DBA_DB_LINKS, which SELECT_CATALOG_ROLE normally carries.
TDE|tde_encryption_check.sql|Encryption at rest|SELECT on V$ENCRYPTION_WALLET, V$ENCRYPTED_TABLESPACES, V$TABLESPACE and DBA_ENCRYPTED_COLUMNS. On a database with no keystore configured these views are readable and simply empty.
FEATURE_USAGE|feature_usage_check.sql|Option and feature usage|SELECT on DBA_FEATURE_USAGE_STATISTICS and V$OPTION, which SELECT_CATALOG_ROLE normally carries.
TIERS
}

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
  err "copy config.env and edit it before the first run."
  exit 2
fi
# shellcheck source=/dev/null
source "$CONFIG_FILE"

for v in ORACLE_SID ORACLE_HOME ORACLE_CONNECT OUTPUT_DIR AUDIT_WINDOW_DAYS AUDIT_TOP_N; do
  if [ -z "${!v:-}" ]; then
    err "required config variable $v is empty - edit $CONFIG_FILE"
    exit 2
  fi
done

case "$AUDIT_WINDOW_DAYS" in
  ''|*[!0-9]*) err "AUDIT_WINDOW_DAYS must be a whole number of days. Got: $AUDIT_WINDOW_DAYS"; exit 2 ;;
esac
case "$AUDIT_TOP_N" in
  ''|*[!0-9]*) err "AUDIT_TOP_N must be a whole number of rows. Got: $AUDIT_TOP_N"; exit 2 ;;
esac

# The client is required by the modes that CONTACT the database, and only by
# those. --render-only rebuilds outputs from a collection that already ran, and
# --dry-run only prints the plan; neither opens a connection, so neither has any
# use for sqlplus. Demanding it anyway would refuse to show a customer the plan
# for the exact reason they are usually reading it: to see what this would do
# before pointing it at anything. --render-only was already exempt here and
# --dry-run was not, which is the whole of the defect.
if [ -z "$RENDER_ONLY" ] && [ "$DRY_RUN" -eq 0 ] && [ ! -x "$ORACLE_HOME/bin/sqlplus" ]; then
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

if [ "$DRY_RUN" -eq 1 ]; then
  printf 'DRY-RUN - audit and governance collection plan\n'
  printf '  config           : %s\n' "$CONFIG_FILE"
  printf '  ORACLE_SID       : %s\n' "$ORACLE_SID"
  printf '  window           : the last %s days, for every time-bounded tier\n' "$AUDIT_WINDOW_DAYS"
  printf '  ranked tiers keep: %s rows\n' "$AUDIT_TOP_N"
  printf '  output           : %s/audit/\n' "$OUTPUT_DIR"
  printf '\n  WOULD read, in order, each recording its own status as a check.\n'
  printf '  A tier that cannot be read becomes an NA check naming what would\n'
  printf '  make it readable, and the remaining tiers still produce their rows.\n\n'
  N=0
  while IFS='|' read -r t_id t_sql t_section t_needs; do
    [ -n "$t_id" ] || continue
    N=$((N + 1))
    printf '  %2d. %-15s %-28s %s\n' "$N" "$t_id" "sql/$t_sql" "$t_section"
  done <<TIERLIST
$(tier_table)
TIERLIST
  cat <<'PLAN'

  WOULD then write one HTML report and one briefing.json from that ONE read.

  WOULD NOT: issue any statement that changes anything, judge what any of it
  means, score the database, or draw a conclusion about any licence agreement.
  Every row is an observation with its own numbers beside it. Exit 0.
PLAN
  exit 0
fi

# Created AFTER the dry-run branch has exited, deliberately. A dry run
# prints a plan and must leave the filesystem exactly as it found it: it
# says it writes nothing, and creating an output directory would make that
# sentence false. A test asserts a dry run adds no files.
mkdir -p "$OUTPUT_DIR/audit"

TS_NOW="$(date '+%Y%m%d-%H%M%S')"

# ---------------------------------------------------------------------------
# COLLECT. Every tier lands in ONE raw stream file, which is the only thing
# --render-only ever reads.
# ---------------------------------------------------------------------------
if [ -n "$RENDER_ONLY" ]; then
  [ -r "$RENDER_ONLY" ] || { err "raw collection not readable: $RENDER_ONLY"; exit 2; }
  RAW_FILE="$RENDER_ONLY"
  log "render-only: rebuilding outputs from $RAW_FILE, the database is not contacted"
else
  RAW_FILE="$OUTPUT_DIR/audit/audit_raw_${ORACLE_SID}_${TS_NOW}.txt"
  : > "$RAW_FILE"

  emit() { printf '%s\n' "$*" >> "$RAW_FILE"; }

  if ! sq "SELECT 'ODC_OK' FROM dual;" | grep -q ODC_OK; then
    err "cannot connect to ORACLE_SID=$ORACLE_SID. Run as the oracle OS user and verify the config."
    exit 2
  fi
  log "connectivity OK"

  # The window is formatted HERE, at collection time, and carried. Re-reading an
  # archived collection in another timezone must not silently rewrite the period
  # the report describes.
  WIN_FROM="$(sq "SELECT TO_CHAR(SYSDATE - ${AUDIT_WINDOW_DAYS}, 'YYYY-MM-DD HH24:MI:SS') FROM dual;" | tail -1 | tr -d ' \r' | sed 's/\(....-..-..\)\(..:..:..\)/\1 \2/')"
  WIN_TO="$(sq "SELECT TO_CHAR(SYSDATE, 'YYYY-MM-DD HH24:MI:SS') FROM dual;" | tail -1 | tr -d ' \r' | sed 's/\(....-..-..\)\(..:..:..\)/\1 \2/')"
  emit "WIN|${AUDIT_WINDOW_DAYS}|${WIN_FROM:-unknown}|${WIN_TO:-unknown}"

  # ---------------------------------------------------------------------------
  # SCOPE, stated in the data before anything else.
  #
  # Same pattern and same reason as the tablespace pack's SCOPE and the RCA
  # pack's NODESCOPE. Nearly every view read below is container scoped: DBA_USERS
  # in a CDB root describes the root's common users, not the accounts inside a
  # pluggable database. A clean access review from the wrong container is
  # indistinguishable from a clean estate, and nothing in the report would warn
  # the reader. So the report says which container it describes, on its face.
  # ---------------------------------------------------------------------------
  emit "SEC|Report scope"
  SCOPE_LINE="$(sq "SELECT 'CHK|SCOPE|OK|Report scope|' || CASE WHEN d.cdb = 'YES' THEN 'container ' || SYS_CONTEXT('USERENV','CON_NAME') || ' only. These views describe the container this session is connected to, so accounts, grants, profiles and objects belonging to other pluggable databases are NOT in this report. Run it once per container you are responsible for.' ELSE 'the whole database. This is not a CDB, so there is one container and this report covers all of it.' END FROM v\$database d;" | grep '^CHK|SCOPE|' | tail -1 || true)"
  if [ -n "$SCOPE_LINE" ]; then
    emit "$SCOPE_LINE"
  else
    emit "CHK|SCOPE|NA|Report scope|the container this session is connected to could not be read from V\$DATABASE, so this report does not state which container it describes. Needs SELECT on V\$DATABASE."
  fi
  emit "CHK|WINDOW|OK|Reporting window|The time-bounded tiers below cover the last ${AUDIT_WINDOW_DAYS} days, from ${WIN_FROM:-unknown} to ${WIN_TO:-unknown} as the database clock recorded them. Rows outside that period were not read, so this report says nothing about them. The window comes from AUDIT_WINDOW_DAYS in the configuration file."
  emit "MET|WINDOW|window_days|${AUDIT_WINDOW_DAYS}|days"

  TIER_DIR="$(mktemp -d)"
  trap 'rm -rf "$TIER_DIR"' EXIT

  while IFS='|' read -r t_id t_sql t_section t_needs; do
    [ -n "$t_id" ] || continue
    TIER_OUT="$TIER_DIR/${t_id}.txt"
    : > "$TIER_OUT"
    TIER_RC=0
    sqlplus -s -L "$ORACLE_CONNECT" \
      @"$SCRIPT_DIR/sql/$t_sql" \
      "$AUDIT_WINDOW_DAYS" "$AUDIT_TOP_N" "$TIER_OUT" >/dev/null 2>&1 || TIER_RC=$?

    # Whatever the tier DID produce is kept, even when it stopped early. A tier
    # that emitted four rows and then hit a view it could not open is more
    # useful than a tier reported as an empty NA, as long as the report also
    # says it stopped. Both halves are recorded below.
    LINES_ADDED=0
    if [ -s "$TIER_OUT" ]; then
      grep -E '^(SEC|CHK|MET)\|' "$TIER_OUT" >> "$RAW_FILE" || true
      LINES_ADDED="$(grep -cE '^(SEC|CHK|MET)\|' "$TIER_OUT" 2>/dev/null || true)"
      LINES_ADDED="${LINES_ADDED:-0}"
    fi

    # An Oracle error at the START of a spooled line is the tier reporting that
    # it stopped. The exit status alone is not enough: SQL*Plus returns the
    # Oracle error code modulo 256, and a small number of codes reduce to zero.
    TIER_ERR=0
    [ "$TIER_RC" -ne 0 ] && TIER_ERR=1
    grep -qE '^ORA-[0-9]+' "$TIER_OUT" 2>/dev/null && TIER_ERR=1
    [ "$LINES_ADDED" -eq 0 ] && TIER_ERR=1

    if [ "$TIER_ERR" -eq 1 ]; then
      emit "SEC|${t_section}"
      if [ "$LINES_ADDED" -eq 0 ]; then
        emit "CHK|${t_id}|NA|${t_section} tier|this tier produced nothing and was not read. What would make it readable: ${t_needs}"
      else
        emit "CHK|${t_id}|NA|${t_section} tier|this tier stopped part way through, so the ${LINES_ADDED} rows above it are all that was read and the rest of this tier is missing rather than empty. What would make the whole tier readable: ${t_needs}"
      fi
    fi
    log "tier ${t_id}: ${LINES_ADDED} rows, status $( [ "$TIER_ERR" -eq 1 ] && printf 'NA' || printf 'read' )"
  done <<TIERLIST
$(tier_table)
TIERLIST

  log "collection complete: $RAW_FILE"
fi

# ---------------------------------------------------------------------------
# RENDER. Everything below runs identically on a fresh collection and on an
# archived one, and it appends nothing to the raw file. A re-render that grew
# the file it was reading would make every replay differ from the last.
# ---------------------------------------------------------------------------
EXIT_CODE=0
ROWS_HTML='' ; SECTION_HTML='' ; CUR_SECTION='Report scope'

odc_br_reset

WINDOW_DAYS="$(awk -F'|' '$1=="WIN"{print $2; exit}' "$RAW_FILE")"
WINDOW_FROM="$(awk -F'|' '$1=="WIN"{print $3; exit}' "$RAW_FILE")"
WINDOW_TO="$(awk -F'|' '$1=="WIN"{print $4; exit}' "$RAW_FILE")"
: "${WINDOW_DAYS:=$AUDIT_WINDOW_DAYS}" ; : "${WINDOW_FROM:=unknown}" ; : "${WINDOW_TO:=unknown}"

# Pass one pools every measurement, keyed by the check id it belongs to. Keyed
# by ID and not by position on purpose: the ranked tiers below emit their CHK
# rows and their MET rows as SEPARATE executions of the same query, so a metric
# attached to whichever check was last seen would be misfiled the moment two
# rows tied in the ranking column.
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
      ROWS_HTML="${ROWS_HTML}<h2>$(printf '%s' "$title" | esc)</h2><table><thead><tr><th>Status</th><th>Observation</th><th>What was read</th></tr></thead><tbody>"
      ;;
    CHK\|*)
      IFS='|' read -r _ cid status title detail <<<"$line"
      badge_class="$(printf '%s' "$status" | tr 'A-Z' 'a-z')"
      case "$badge_class" in ok|warn|crit|na) ;; *) badge_class="na" ;; esac
      ROWS_HTML="${ROWS_HTML}<tr class=\"st-${badge_class}\"><td><span class=\"badge ${badge_class}\">${status}</span></td><td>$(printf '%s' "$title" | esc)</td><td>$(printf '%s' "$detail" | esc)</td></tr>"
      odc_br_check "$cid" "$CUR_SECTION" "$status" "$title" "$detail"
      ;;
  esac
done < "$RAW_FILE"
[ -n "$SECTION_HTML" ] && ROWS_HTML="${ROWS_HTML}</tbody></table>"

# ---------------------------------------------------------------------------
# THE ONLY STATUS THIS PACK EVER RAISES DESCRIBES THE COLLECTION.
#
# Derived here rather than during collection so that a replay of an archived
# raw file agrees with the fresh run that produced it. The RCA pack shipped the
# opposite arrangement in its first draft: a flag set while collecting and
# applied after the summary was already computed, so the document said OK while
# the exit code said 1, and under --render-only the flag was never set at all.
# ---------------------------------------------------------------------------
CHECK_TOTAL=$((ODC_BR_COUNT_OK + ODC_BR_COUNT_WARN + ODC_BR_COUNT_CRIT + ODC_BR_COUNT_NA))
if [ "$ODC_BR_COUNT_NA" -gt 0 ]; then
  EXIT_CODE=1
  OVERALL="WARN" ; OVERALL_CLASS="warn"
  COMPLETENESS="${ODC_BR_COUNT_NA} of ${CHECK_TOTAL} checks could not be read, so this collection is incomplete"
else
  OVERALL="OK" ; OVERALL_CLASS="ok"
  COMPLETENESS="all ${CHECK_TOTAL} checks were read"
fi

REPORT="$OUTPUT_DIR/audit/audit_${ORACLE_SID}_${TS_NOW}.html"
cat > "$REPORT" <<HTML
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Audit and Governance Report - ${ORACLE_SID} - ${TS_NOW}</title>
<style>
  :root{color-scheme:dark}
  body{background:#0A0B0D;color:#E8E9EB;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:32px;line-height:1.5}
  .wrap{max-width:1100px;margin:0 auto}
  h1{font-size:22px;margin:0 0 4px}
  h2{font-size:15px;margin:28px 0 8px;color:#9BA1A9;text-transform:uppercase;letter-spacing:.06em}
  .meta{color:#9BA1A9;font-size:13px;margin-bottom:20px}
  .summary{display:flex;align-items:center;gap:12px;background:#121316;border:1px solid #262A31;border-radius:10px;padding:16px 20px;margin-bottom:8px}
  .summary .big{font-size:18px;font-weight:700}
  .note{background:#121316;border:1px solid #262A31;border-radius:10px;padding:14px 18px;margin:12px 0 8px;font-size:13px;color:#9BA1A9}
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
  <h1>Audit and Governance Report</h1>
  <div class="meta">SID <strong>${ORACLE_SID}</strong> &middot; window <strong>last ${WINDOW_DAYS} days</strong>, ${WINDOW_FROM} to ${WINDOW_TO} &middot; generated $(date '+%Y-%m-%d %H:%M:%S %Z') &middot; OraDiscuss Audit and Governance Pack v${VERSION} &middot; read-only</div>
  <div class="summary"><span class="badge ${OVERALL_CLASS}">${OVERALL}</span><span class="big">Collection status: ${OVERALL}</span><span>${COMPLETENESS}</span></div>
  <div class="note">Every row below is an observation read out of a dictionary view, with its numbers beside it. This report does not grade your database and it does not tell you what any of this means for your estate, because that depends on things no script on this machine can see. A status of OK means the row was read. A status of NA means it could not be, and the row says what would make it readable. The status on the line above describes THIS COLLECTION and nothing else.</div>
  ${ROWS_HTML}
  <div class="foot">Window: the last ${WINDOW_DAYS} days, ${WINDOW_FROM} to ${WINDOW_TO}, set by AUDIT_WINDOW_DAYS. Ranked sections keep the top ${AUDIT_TOP_N} rows and say so beside their counts. The option and feature section reports usage FACTS only: detected usage counts and the dates the database recorded them. It draws no conclusion about any agreement you hold, because this pack has never read one. Scope: this report covers one container, named in the Report scope row above.</div>
</div>
</body>
</html>
HTML

ln -sf "$REPORT" "$OUTPUT_DIR/audit/audit_${ORACLE_SID}_latest.html"

# ---------------------------------------------------------------------------
# Output two: the machine-readable briefing, from the SAME collection.
#
# Written to a temporary file and moved into place, so a half-written briefing
# never exists at the real path for another process to read. If it cannot be
# written the whole run fails, because "one collection, two outputs" would
# otherwise be false in exactly the silent way that is hardest to notice.
# ---------------------------------------------------------------------------
THRESHOLDS_JSON="$(printf '{"audit_window_days":%s,"top_n":%s}' \
  "$(odc_json_num "$WINDOW_DAYS")" "$(odc_json_num "$AUDIT_TOP_N")")"

BRIEFING="$OUTPUT_DIR/audit/audit_${ORACLE_SID}_${TS_NOW}.json"
BRIEFING_TMP="${BRIEFING}.partial"
if ! odc_br_document \
      "audit-governance" "$VERSION" "audit_governance.sh" "$ORACLE_SID" \
      "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$OVERALL" "$EXIT_CODE" \
      "$THRESHOLDS_JSON" > "$BRIEFING_TMP"; then
  rm -f "$BRIEFING_TMP"
  err "the HTML report was written but the AI briefing was not: $BRIEFING"
  err "this run produced only half of its outputs, so it is being reported as a failure."
  exit 2
fi
mv -f "$BRIEFING_TMP" "$BRIEFING"
ln -sf "$BRIEFING" "$OUTPUT_DIR/audit/audit_${ORACLE_SID}_latest.json"

log "report written: $REPORT"
log "briefing written: $BRIEFING"
log "window: last ${WINDOW_DAYS} days, ${WINDOW_FROM} to ${WINDOW_TO}"
log "collection completeness: ${COMPLETENESS}"
log "hand the briefing to your own AI with prompts/audit-review.md - nothing left this machine."
exit "$EXIT_CODE"
