#!/usr/bin/env bash
# ============================================================================
# OraDiscuss - RCA Generator Pack v1.0.0
# rca_generator.sh - incident evidence collector and reconstructor.
#
# Generated locally by OraDiscuss tooling. Not produced by, affiliated with, or
# endorsed by Oracle Corporation. https://oradiscuss.com
#
# Written for Oracle 19c/21c/23ai on Linux.
# READ-ONLY: SELECT-only SQL, ADRCI show commands, and log file READS. The only
# commands that want root are reads of OS logs. It issues no DDL and no DML, and
# it writes nothing to your database.
#
# WHAT THIS PRODUCES, AND WHAT IT DELIBERATELY DOES NOT.
#   It produces EVIDENCE, a reconstructed TIMELINE, and RANKED ORDERING FACTS.
#   It does not produce a verdict, and it does not produce commands to run.
#
#   That is the product's line and it is not a style preference. An ordering
#   correlation is a real measurement: this error was recorded 42 seconds before
#   that one. What it MEANS is an inference, and the inference belongs to the
#   DBA who knows the estate. So every correlation is carried as two separate
#   fields, the measured `statement` and the labelled `reading`, and where a
#   reading has a competing explanation the document says what would DISTINGUISH
#   them rather than what to go and do.
#
#   The v0.9 release had a "recommended next steps" section and cause entries
#   that said things like "investigate the storage layer first". Those are
#   instructions, they are gone, and this header is the record of why.
#
# ONE COLLECTION, TWO OUTPUTS:
#   report.html   - the incident report for the human
#   briefing.json - the same collection, structured, for YOUR OWN AI
# The briefing carries "kind": "incident", which is how a consumer tells this
# document apart from a state-of-the-database briefing without guessing.
#
# Collects, for one incident window:
#   - alert log entries (X$DBGALERTEXT when readable, text alert log when not)
#   - ADR incident list via adrci
#   - workload evidence from AWR, ONLY when the Diagnostics Pack is available
#   - listener log errors
#   - clusterware alert log on RAC, local node
#   - OS tier (messages, dmesg), ONLY as root or with passwordless sudo
# Every tier that cannot run becomes an NA check naming what would make it run.
# A tier that is silently absent is indistinguishable from a tier that found
# nothing, and those are very different answers during an incident.
#
# Usage:
#   ./rca_generator.sh --since 2h|24h|7d
#   ./rca_generator.sh --at "YYYY-MM-DD HH:MI"          # window = at +/- 2h
#   ./rca_generator.sh --from "YYYY-MM-DD HH:MI" --to "YYYY-MM-DD HH:MI"
#   ./rca_generator.sh --dry-run --since 24h            # prints the plan only
#   ./rca_generator.sh --config /path/to/config.env
#   ./rca_generator.sh --render-only /path/to/rca_raw_SID_ts.txt
#
#   Giving more than one window shape is a HARD ERROR rather than a
#   precedence rule. A triage that quietly examined a different window than the
#   operator meant is worse than one that refused to start.
#
#   --render-only rebuilds both outputs from a collection that already ran,
#   without contacting anything. It is also what lets this pack's tests drive
#   the REAL parser and the REAL correlation logic rather than a copy that would
#   pass forever while the shipped one rotted.
#
# Output: HTML report and briefing.json in $OUTPUT_DIR/rca/
# Exit codes: 0 = complete collection, 1 = report produced but at least one
#             tier was skipped, 2 = could not run at all, or an output failed.
#
# License: single-user license, modify allowed, no redistribution.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.env"
DRY_RUN=0
RENDER_ONLY=''
VERSION="1.0.0"
SINCE='' ; AT='' ; FROM='' ; TO=''

# shellcheck source=lib/odc_briefing.sh
. "${SCRIPT_DIR}/lib/odc_briefing.sh"

log()  { printf '%s [rca_generator] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }
err()  { printf '%s [rca_generator] ERROR: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >&2; }
esc()  { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' ; }

usage() { grep -E '^# (Usage|  \./)' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }

# ---------------------------------------------------------------------------
# Portable date helpers.
#
# GNU date and BSD date disagree about everything, and this pack is written for
# Linux but is TESTED on a Mac. A helper that only worked on one of them would
# mean the window logic could never be exercised by a test, which is precisely
# the code where a silent mistake costs the most: it decides which hours of an
# incident anybody ever looks at.
# ---------------------------------------------------------------------------
epoch_to_str() {
  date -d "@$1" '+%Y-%m-%d %H:%M:%S' 2>/dev/null \
    || date -r "$1" '+%Y-%m-%d %H:%M:%S' 2>/dev/null \
    || printf 'epoch %s' "$1"
}

str_to_epoch() {
  local s="${1-}"
  case "$s" in *:*:*) ;; *:*) s="$s:00" ;; *) printf ''; return 1 ;; esac
  date -d "$s" '+%s' 2>/dev/null \
    || date -j -f '%Y-%m-%d %H:%M:%S' "$s" '+%s' 2>/dev/null \
    || { printf ''; return 1; }
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --config)  shift; CONFIG_FILE="${1:?--config requires a path}" ;;
    --render-only) shift; RENDER_ONLY="${1:?--render-only requires a path}" ;;
    --since)   shift; SINCE="${1:?--since requires e.g. 2h, 24h, 7d}" ;;
    --at)      shift; AT="${1:?--at requires 'YYYY-MM-DD HH:MI'}" ;;
    --from)    shift; FROM="${1:?--from requires 'YYYY-MM-DD HH:MI'}" ;;
    --to)      shift; TO="${1:?--to requires 'YYYY-MM-DD HH:MI'}" ;;
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

for v in ORACLE_SID ORACLE_HOME ORACLE_CONNECT OUTPUT_DIR RCA_MAX_EVENTS RCA_CORRELATION_WINDOW_SEC; do
  if [ -z "${!v:-}" ]; then
    err "required config variable $v is empty - edit $CONFIG_FILE"
    exit 2
  fi
done

export ORACLE_SID ORACLE_HOME
export PATH="$ORACLE_HOME/bin:$PATH"
export NLS_LANG="${NLS_LANG:-AMERICAN_AMERICA.AL32UTF8}"

mkdir -p "$OUTPUT_DIR/rca"

# ---------------------------------------------------------------------------
# Resolve the window, and REFUSE rather than guess.
# ---------------------------------------------------------------------------
WINDOW_FROM='' ; WINDOW_TO='' ; WINDOW_RESOLVED_FROM=''

if [ -z "$RENDER_ONLY" ]; then
  SHAPES=0
  [ -n "$SINCE" ] && SHAPES=$((SHAPES + 1))
  [ -n "$AT" ] && SHAPES=$((SHAPES + 1))
  { [ -n "$FROM" ] || [ -n "$TO" ]; } && SHAPES=$((SHAPES + 1))

  if [ "$SHAPES" -gt 1 ]; then
    err "give ONE window shape, not several. Got: ${SINCE:+--since }${AT:+--at }${FROM:+--from }${TO:+--to }"
    err "a triage that silently picked one of two windows is worse than one that refused."
    exit 2
  fi

  if [ "$SHAPES" -eq 0 ]; then
    # Interview only when somebody is actually there. Under cron there is no
    # terminal, and a prompt would hang the run forever with no output at all.
    if [ -t 0 ]; then
      printf 'Incident window. Enter a relative window such as 2h, 24h or 7d: '
      read -r SINCE
      [ -n "$SINCE" ] || { err "no window given"; exit 2; }
    else
      err "no window given and no terminal to ask at. Pass --since, --at, or --from with --to."
      exit 2
    fi
  fi

  NOW_EP="$(date '+%s')"
  if [ -n "$SINCE" ]; then
    case "$SINCE" in
      *h) SECS=$(( ${SINCE%h} * 3600 )) ;;
      *d) SECS=$(( ${SINCE%d} * 86400 )) ;;
      *m) SECS=$(( ${SINCE%m} * 60 )) ;;
      *)  err "--since takes a number followed by m, h or d, for example 90m, 2h, 7d. Got: $SINCE"; exit 2 ;;
    esac
    WINDOW_FROM="$(epoch_to_str $((NOW_EP - SECS)))"
    WINDOW_TO="$(epoch_to_str "$NOW_EP")"
    WINDOW_RESOLVED_FROM="--since $SINCE"
  elif [ -n "$AT" ]; then
    AT_EP="$(str_to_epoch "$AT")" || { err "could not read --at '$AT'. Use 'YYYY-MM-DD HH:MI'."; exit 2; }
    WINDOW_FROM="$(epoch_to_str $((AT_EP - 7200)))"
    WINDOW_TO="$(epoch_to_str $((AT_EP + 7200)))"
    WINDOW_RESOLVED_FROM="--at $AT, widened to plus and minus 2 hours"
  else
    [ -n "$FROM" ] && [ -n "$TO" ] || { err "--from and --to are given together, or neither."; exit 2; }
    F_EP="$(str_to_epoch "$FROM")" || { err "could not read --from '$FROM'"; exit 2; }
    T_EP="$(str_to_epoch "$TO")"   || { err "could not read --to '$TO'"; exit 2; }
    [ "$T_EP" -gt "$F_EP" ] || { err "--to must be later than --from"; exit 2; }
    WINDOW_FROM="$(epoch_to_str "$F_EP")"
    WINDOW_TO="$(epoch_to_str "$T_EP")"
    WINDOW_RESOLVED_FROM="--from and --to"
  fi

  # Logged, always. Which window was examined is the single most important fact
  # about a triage, and the operator must be able to see that it matched what
  # they meant without reading the report first.
  log "window resolved from ${WINDOW_RESOLVED_FROM}: ${WINDOW_FROM} to ${WINDOW_TO}"
fi

sq() {
  sqlplus -s -L "$ORACLE_CONNECT" 2>/dev/null <<SQL
SET PAGES 0 FEEDBACK OFF HEADING OFF VERIFY OFF LINES 4000 TRIMSPOOL ON
WHENEVER SQLERROR EXIT SQL.SQLCODE
$1
EXIT
SQL
}

if [ "$DRY_RUN" -eq 1 ]; then
  cat <<PLAN
DRY-RUN - RCA collection plan
  config          : $CONFIG_FILE
  ORACLE_SID      : $ORACLE_SID
  window          : $WINDOW_FROM to $WINDOW_TO
  resolved from   : $WINDOW_RESOLVED_FROM
  output          : $OUTPUT_DIR/rca/

  WOULD collect, in order, each recording its own status as a check:
   1. Instance identity and ADR paths, read from V\$DIAG_INFO rather than from
      any assumed diagnostic_dest layout.
   2. Alert log in the window. Probes X\$DBGALERTEXT once; falls back to
      reading the text alert log when that is not readable.
   3. ADR incidents, via adrci show incident.
   4. Workload evidence from AWR, ONLY if control_management_pack_access
      allows it. Otherwise an NA check naming the Diagnostics Pack.
   5. Listener log errors in the window.
   6. Clusterware alert log, local node, when this is RAC.
   7. OS tier, ONLY as root or with passwordless sudo. Otherwise an NA check.

  WOULD then reconstruct a timeline, derive ordering FACTS from it, and write
  one HTML report and one briefing.json.

  WOULD NOT: draw a conclusion, issue a verdict, or print a command to run.
  Nothing here writes to the database or to the OS. Exit 0.
PLAN
  exit 0
fi

TS_NOW="$(date '+%Y%m%d-%H%M%S')"
SEQ=0

# ---------------------------------------------------------------------------
# COLLECT. Everything lands in ONE raw stream file, which is the only thing
# --render-only ever reads. Appendix files are sidecars written once, at
# collection time, and listed in a manifest inside the stream.
# ---------------------------------------------------------------------------
if [ -n "$RENDER_ONLY" ]; then
  [ -r "$RENDER_ONLY" ] || { err "raw collection not readable: $RENDER_ONLY"; exit 2; }
  RAW_FILE="$RENDER_ONLY"
  APPENDIX_DIR="$(dirname "$RENDER_ONLY")/appendix"
  log "render-only: rebuilding outputs from $RAW_FILE, nothing is contacted"
else
  RAW_FILE="$OUTPUT_DIR/rca/rca_raw_${ORACLE_SID}_${TS_NOW}.txt"
  APPENDIX_DIR="$OUTPUT_DIR/rca/appendix_${ORACLE_SID}_${TS_NOW}"
  mkdir -p "$APPENDIX_DIR"
  : > "$RAW_FILE"

  emit()     { printf '%s\n' "$*" >> "$RAW_FILE"; }
  emit_evt() {  # source severity timestamp epoch message
    SEQ=$((SEQ + 1))
    printf 'EVT|%s|%s|%s|%s|%s|%s\n' "$SEQ" "$4" "$3" "$1" "$2" \
      "$(printf '%s' "$5" | tr '\t\n|' '   ')" >> "$RAW_FILE"
  }

  emit "WIN|${WINDOW_FROM}|${WINDOW_TO}|${WINDOW_RESOLVED_FROM}"
  emit "SEC|Collection status"

  if ! sq "SELECT 'ODC_OK' FROM dual;" | grep -q ODC_OK; then
    err "cannot connect to ORACLE_SID=$ORACLE_SID. Run as the oracle OS user and verify the config."
    exit 2
  fi
  log "connectivity OK"

  IDENT="$(sq "SELECT version_full || '|' || (SELECT cdb FROM v\$database) || '|' || (SELECT database_role FROM v\$database) FROM v\$instance;" | tail -1)"
  DB_VERSION="${IDENT%%|*}" ; REST="${IDENT#*|}" ; IS_CDB="${REST%%|*}" ; DB_ROLE="${REST#*|}"
  emit "CHK|IDENT|OK|Instance identity|version ${DB_VERSION:-unknown}, CDB=${IS_CDB:-unknown}, role ${DB_ROLE:-unknown}"

  UPH="$(sq "SELECT TO_CHAR(ROUND((SYSDATE - startup_time) * 24, 1), 'FM9999999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') FROM v\$instance;" | tail -1)"
  emit "MET|IDENT|uptime_hours|${UPH:-}|hours"

  # ADR paths come from the database, never from an assumed layout on disk.
  ADR_HOME='' ; DIAG_TRACE=''
  while IFS='|' read -r nm val; do
    case "$nm" in
      "ADR Home")   ADR_HOME="$val" ;;
      "Diag Trace") DIAG_TRACE="$val" ;;
    esac
  done <<EOF
$(sq "SELECT name || '|' || value FROM v\$diag_info WHERE name IN ('ADR Home','Diag Trace');" || true)
EOF
  if [ -n "$ADR_HOME" ]; then
    emit "CHK|ADR|OK|ADR paths|ADR home ${ADR_HOME}"
  else
    emit "CHK|ADR|NA|ADR paths|V\$DIAG_INFO returned no ADR home, so ADR-based collection is degraded. Needs SELECT on V\$DIAG_INFO."
  fi

  # Alert log. Probe once, then take whichever route is actually available.
  emit "SEC|Alert log"
  PROBE="$(sq "SELECT COUNT(*) FROM x\$dbgalertext WHERE rownum = 1;" 2>/dev/null || true)"
  if printf '%s' "$PROBE" | grep -qE '^[0-9]+$'; then
    emit "CHK|ALERT|OK|Alert log source|read through X\$DBGALERTEXT, filtered on the window in the database"
    TMP_ALERT="$APPENDIX_DIR/alertlog_window.txt"
    if sqlplus -s -L "$ORACLE_CONNECT" @"$SCRIPT_DIR/sql/rca_alertlog.sql" \
         "$WINDOW_FROM" "$WINDOW_TO" "$RCA_MAX_EVENTS" "$SEQ" "$TMP_ALERT" >/dev/null 2>&1 && [ -s "$TMP_ALERT" ]; then
      grep '^EVT|' "$TMP_ALERT" >> "$RAW_FILE" || true
      # grep -c PRINTS a count and EXITS 1 when the count is zero, so the
      # obvious `$(grep -c ... || echo 0)` yields the two lines "0" and "0" and
      # breaks the arithmetic. `|| true` keeps grep's own zero.
      EVT_ADDED="$(grep -c '^EVT|' "$TMP_ALERT" 2>/dev/null || true)"
      SEQ=$((SEQ + ${EVT_ADDED:-0}))
    else
      emit "CHK|ALERT_ROWS|NA|Alert log rows|the alert log query returned nothing readable for this window"
    fi
  else
    emit "CHK|ALERT|NA|Alert log source|X\$DBGALERTEXT is not readable, which needs SYS or an explicit X\$ grant. Falling back to the text alert log, whose timestamps are parsed rather than queried."
    ALERT_TXT="${DIAG_TRACE:-}/alert_${ORACLE_SID}.log"
    if [ -r "$ALERT_TXT" ]; then
      cp "$ALERT_TXT" "$APPENDIX_DIR/alert_text.log" 2>/dev/null || true
      emit "CHK|ALERT_TEXT|OK|Text alert log|copied to the appendix for reading, unfiltered by window"
    else
      emit "CHK|ALERT_TEXT|NA|Text alert log|not readable at ${ALERT_TXT}"
    fi
  fi

  # Workload evidence, licence gated.
  emit "SEC|Workload evidence"
  CMPA="$(sq "SELECT value FROM v\$parameter WHERE name = 'control_management_pack_access';" | tail -1)"
  case "$CMPA" in
    *DIAGNOSTIC*)
      TMP_AWR="$APPENDIX_DIR/awr_evidence.txt"
      if sqlplus -s -L "$ORACLE_CONNECT" @"$SCRIPT_DIR/sql/rca_awr_evidence.sql" \
           "$WINDOW_FROM" "$WINDOW_TO" "$TMP_AWR" >/dev/null 2>&1 && [ -s "$TMP_AWR" ]; then
        grep -E '^(SEC|CHK|MET)\|' "$TMP_AWR" >> "$RAW_FILE" || true
      else
        emit "CHK|AWR|NA|Workload evidence|the AWR query returned nothing for this window. AWR retention may not reach back this far."
      fi
      ;;
    *)
      emit "CHK|AWR|NA|Workload evidence|control_management_pack_access is '${CMPA:-unset}', so DBA_HIST views were not read. Those views are licensed with the Oracle Diagnostics Pack. Stated as a fact about what was not read, not as advice about your licensing."
      ;;
  esac

  # Listener log.
  emit "SEC|Listener"
  LSNR_LOG="${DIAG_TRACE%/trace}/../../tnslsnr/$(hostname -s 2>/dev/null || hostname)/${LISTENER_NAME:-listener}/trace/${LISTENER_NAME:-listener}.log"
  if [ -r "$LSNR_LOG" ]; then
    grep -E 'TNS-[0-9]+' "$LSNR_LOG" 2>/dev/null | tail -n "$RCA_MAX_EVENTS" > "$APPENDIX_DIR/listener_errors.txt" || true
    LC="$(grep -c . "$APPENDIX_DIR/listener_errors.txt" 2>/dev/null || true)"
    LC="${LC:-0}"
    emit "CHK|LSNR|OK|Listener log|${LC} TNS- lines captured to the appendix"
    emit "MET|LSNR|tns_errors|${LC}|lines"
  else
    emit "CHK|LSNR|NA|Listener log|not readable at the resolved ADR path, so listener evidence is absent rather than empty"
  fi

  # OS tier. Reads only, and only when the account can actually read them.
  emit "SEC|Operating system"
  if [ "$(id -u)" = "0" ] || sudo -n true 2>/dev/null; then
    for f in /var/log/messages /var/log/syslog; do
      [ -r "$f" ] && tail -n "$RCA_MAX_EVENTS" "$f" > "$APPENDIX_DIR/$(basename "$f").txt" 2>/dev/null || true
    done
    emit "CHK|OSTIER|OK|Operating system tier|system logs captured to the appendix"
  else
    emit "CHK|OSTIER|NA|Operating system tier|skipped. Running as $(id -un), which cannot read the system logs, and no passwordless sudo is available. Run as root, or grant passwordless sudo, to include this tier."
  fi

  # The appendix manifest is written at collect time, so a replay describes the
  # files that EXISTED then rather than whatever happens to be in the directory
  # when somebody re-renders it months later.
  if [ -d "$APPENDIX_DIR" ]; then
    for f in "$APPENDIX_DIR"/*; do
      [ -f "$f" ] || continue
      printf 'APX|%s|%s|%s\n' "$(basename "$f")" "$(wc -c < "$f" | tr -d ' ')" "raw evidence captured during collection" >> "$RAW_FILE"
    done
  fi

  log "collection complete: $RAW_FILE"
fi

# ---------------------------------------------------------------------------
# RENDER. Everything below runs identically on a fresh collection and on an
# archived one, and it appends nothing to the raw file. A re-render that grew
# the file it was reading would make every replay differ from the last.
# ---------------------------------------------------------------------------
EXIT_CODE=0
ROWS_HTML='' ; SECTION_HTML='' ; CUR_SECTION='Collection status'

odc_br_reset

WINDOW_FROM="$(awk -F'|' '$1=="WIN"{print $2; exit}' "$RAW_FILE")"
WINDOW_TO="$(awk -F'|' '$1=="WIN"{print $3; exit}' "$RAW_FILE")"
WINDOW_RESOLVED_FROM="$(awk -F'|' '$1=="WIN"{print $4; exit}' "$RAW_FILE")"
: "${WINDOW_FROM:=unknown}" ; : "${WINDOW_TO:=unknown}" ; : "${WINDOW_RESOLVED_FROM:=unknown}"

while IFS= read -r line; do
  case "$line" in
    MET\|*)
      IFS='|' read -r _ mid mname mvalue munit <<<"$line"
      odc_br_metric "$mid" "$mname" "$mvalue" "$munit"
      ;;
  esac
done < "$RAW_FILE"

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

# ---------------------------------------------------------------------------
# The timeline, sorted by (epoch, seq).
#
# The tiebreaker is the whole point. Alert log entries routinely share a second,
# and an ORA- error and the trace file it wrote are usually the same second.
# Sorting on the epoch alone leaves their order to whichever sort is installed,
# which is how one collection tells two different stories on two machines.
# ---------------------------------------------------------------------------
SORTED="$(mktemp)"
trap 'rm -f "$SORTED"' EXIT
grep '^EVT|' "$RAW_FILE" 2>/dev/null | sort -t'|' -k3,3n -k2,2n > "$SORTED" || true
EVENT_COUNT="$(grep -c . "$SORTED" 2>/dev/null || true)"
EVENT_COUNT="${EVENT_COUNT:-0}"

EVENTS_JSON=''
while IFS='|' read -r _ eseq eepoch etime esource esev emsg; do
  [ -n "$eseq" ] || continue
  [ -n "$EVENTS_JSON" ] && EVENTS_JSON="${EVENTS_JSON},"
  EVENTS_JSON="${EVENTS_JSON}{\"seq\":$(odc_json_num "$eseq"),\"epoch\":$(odc_json_num "$eepoch"),\"timestamp\":\"$(odc_json_esc "$etime")\",\"source\":\"$(odc_json_esc "$esource")\",\"severity\":\"$(odc_json_esc "$esev")\",\"message\":\"$(odc_json_esc "$emsg")\"}"
done < "$SORTED"

# ---------------------------------------------------------------------------
# ORDERING FACTS.
#
# Each one is a MEASUREMENT plus a labelled READING plus, where a competing
# explanation exists, what would DISTINGUISH them. Never an instruction.
# ---------------------------------------------------------------------------
FACTS_JSON=''
FACTS_HTML=''
add_fact() {  # id statement reading would_distinguish
  [ -n "$FACTS_JSON" ] && FACTS_JSON="${FACTS_JSON},"
  FACTS_JSON="${FACTS_JSON}{\"id\":\"$(odc_json_esc "$1")\",\"statement\":\"$(odc_json_esc "$2")\""
  [ -n "${3:-}" ] && FACTS_JSON="${FACTS_JSON},\"reading\":\"$(odc_json_esc "$3")\""
  [ -n "${4:-}" ] && FACTS_JSON="${FACTS_JSON},\"would_distinguish\":\"$(odc_json_esc "$4")\""
  FACTS_JSON="${FACTS_JSON}}"

  # The HTML is built from the SAME call, so the two outputs cannot come to
  # describe different facts. The labels are printed, not implied: a reader has
  # to be able to see which sentence was measured and which was interpreted
  # without knowing anything about how this file works.
  FACTS_HTML="${FACTS_HTML}<div class=\"fact\"><div class=\"stmt\">Measured: $(printf '%s' "$2" | esc)</div>"
  [ -n "${3:-}" ] && FACTS_HTML="${FACTS_HTML}<div class=\"read\">Reading, which is an interpretation and not a measurement: $(printf '%s' "$3" | esc)</div>"
  [ -n "${4:-}" ] && FACTS_HTML="${FACTS_HTML}<div class=\"dist\">What would distinguish this from a competing explanation: $(printf '%s' "$4" | esc)</div>"
  FACTS_HTML="${FACTS_HTML}</div>"
}

FIRST_LINE="$(head -1 "$SORTED" 2>/dev/null || true)"
if [ -n "$FIRST_LINE" ]; then
  f_time="$(printf '%s' "$FIRST_LINE" | cut -d'|' -f4)"
  f_src="$(printf '%s' "$FIRST_LINE" | cut -d'|' -f5)"
  f_msg="$(printf '%s' "$FIRST_LINE" | cut -d'|' -f7 | cut -c1-200)"
  add_fact "first_event" \
    "The earliest event collected in this window is at ${f_time}, from ${f_src}: ${f_msg}" \
    "This is the earliest event THIS COLLECTION saw, which is not the same as the earliest event that happened. Tiers reported NA above were not read at all." \
    "Whether any tier that returned NA covers a time before this one."
fi

FIRST_OS="$(awk -F'|' '$5 ~ /^os-/ || $6 == "OS-ERROR" {print $3; exit}' "$SORTED" 2>/dev/null || true)"
FIRST_ORA="$(awk -F'|' '$7 ~ /ORA-[0-9]+/ {print $3; exit}' "$SORTED" 2>/dev/null || true)"
if [ -n "$FIRST_OS" ] && [ -n "$FIRST_ORA" ]; then
  DELTA=$(( FIRST_ORA - FIRST_OS ))
  if [ "$DELTA" -ge 0 ] && [ "$DELTA" -le "$RCA_CORRELATION_WINDOW_SEC" ]; then
    add_fact "os_precedes_ora" \
      "The first operating system error precedes the first ORA- error by ${DELTA} seconds." \
      "An ordering consistent with an incident originating below the database, where the ORA- errors are downstream symptoms. Ordering is not causation: a database-driven load spike can produce operating system errors first." \
      "Whether the operating system errors continue after the database errors stop, and whether they appear on hosts that run no database."
  elif [ "$DELTA" -lt 0 ] && [ "$DELTA" -ge -"$RCA_CORRELATION_WINDOW_SEC" ]; then
    add_fact "ora_precedes_os" \
      "The first ORA- error precedes the first operating system error by $(( -DELTA )) seconds." \
      "An ordering consistent with a database-side origin, where the operating system errors are downstream. The same caution applies in reverse." \
      "Whether the database errors reference resources the operating system later complains about."
  fi
fi

# "x3" rather than "(3 times)", because the obvious phrasing emits "(1 times)"
# for every code that appeared once, and a customer-facing paid report should
# not need a reader to forgive its grammar.
TOP_ORA="$(awk -F'|' '{ if (match($7, /ORA-[0-9]+/)) print substr($7, RSTART, RLENGTH) }' "$SORTED" 2>/dev/null | sort | uniq -c | sort -rn | head -3 | awk '{printf "%s x%s, ", $2, $1}' | sed 's/, $//' || true)"
if [ -n "$TOP_ORA" ]; then
  add_fact "top_ora_codes" \
    "Most frequent database error codes in the window: ${TOP_ORA}" \
    "Frequency ranks what recurred, not what mattered. A single occurrence of a serious error outranks a hundred of a benign one." \
    "Which of these codes appears OUTSIDE the incident window as well, since one that is always present is background rather than signal."
fi

if [ -z "$FACTS_JSON" ]; then
  add_fact "no_correlations" \
    "No ordering correlation could be drawn. The collection holds ${EVENT_COUNT} events in this window." \
    "Absence of a correlation is not evidence that the incident had no cause. It usually means the tier that held the evidence was not read." \
    "Which of the checks above returned NA, and what each of them says would make it runnable."
fi

# ---------------------------------------------------------------------------
# AN INCOMPLETE COLLECTION IS NOT AN OK COLLECTION, AND THIS IS DERIVED HERE
# RATHER THAN DURING COLLECTION SO THAT A REPLAY AGREES WITH A FRESH RUN.
#
# The first version tracked a DEGRADED flag while collecting and applied it
# after the summary had already been computed, so the document said
# "overall_status: OK" while the exit code said 1, and under --render-only the
# flag was never set at all. Two outputs of one run disagreeing about whether
# the run succeeded is exactly the class of defect this pack exists to expose.
#
# For a state briefing an NA among thirty OK checks should not flip the summary.
# For an INCIDENT collection it must: the pack's whole thesis is that a tier
# nobody read is not a tier that was clean, and printing OK over two unread
# tiers would be the report making that mistake itself.
# ---------------------------------------------------------------------------
CHECK_TOTAL=$((ODC_BR_COUNT_OK + ODC_BR_COUNT_WARN + ODC_BR_COUNT_CRIT + ODC_BR_COUNT_NA))
if [ "$ODC_BR_COUNT_NA" -gt 0 ] && [ "$EXIT_CODE" -lt 1 ]; then
  EXIT_CODE=1
fi

case "$EXIT_CODE" in
  0) OVERALL="OK";   OVERALL_CLASS="ok" ;;
  1) OVERALL="WARN"; OVERALL_CLASS="warn" ;;
  2) OVERALL="CRIT"; OVERALL_CLASS="crit" ;;
esac

if [ "$ODC_BR_COUNT_NA" -gt 0 ]; then
  COMPLETENESS="${ODC_BR_COUNT_NA} of ${CHECK_TOTAL} checks could not be read, so this collection is incomplete"
else
  COMPLETENESS="all ${CHECK_TOTAL} checks were read"
fi

APPENDIX_JSON=''
while IFS='|' read -r tag aname abytes adesc; do
  [ "$tag" = "APX" ] || continue
  [ -n "$APPENDIX_JSON" ] && APPENDIX_JSON="${APPENDIX_JSON},"
  APPENDIX_JSON="${APPENDIX_JSON}{\"name\":\"$(odc_json_esc "$aname")\",\"bytes\":$(odc_json_num "$abytes"),\"description\":\"$(odc_json_esc "$adesc")\"}"
done < "$RAW_FILE"

TIMELINE_HTML=''
while IFS='|' read -r _ eseq eepoch etime esource esev emsg; do
  [ -n "$eseq" ] || continue
  TIMELINE_HTML="${TIMELINE_HTML}<tr><td><code>$(printf '%s' "$etime" | esc)</code></td><td>$(printf '%s' "$esource" | esc)</td><td>$(printf '%s' "$esev" | esc)</td><td>$(printf '%s' "$emsg" | esc)</td></tr>"
done < "$SORTED"
[ -n "$TIMELINE_HTML" ] || TIMELINE_HTML='<tr><td colspan="4">No events were collected in this window. See the collection status above for which tiers were not read.</td></tr>'

REPORT="$OUTPUT_DIR/rca/rca_${ORACLE_SID}_${TS_NOW}.html"
cat > "$REPORT" <<HTML
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Incident Report - ${ORACLE_SID} - ${TS_NOW}</title>
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
  .fact{background:#121316;border:1px solid #262A31;border-radius:10px;padding:14px 18px;margin-bottom:10px;font-size:14px}
  .fact .stmt{font-weight:600}
  .fact .read{color:#9BA1A9;margin-top:6px}
  .fact .dist{color:#9BA1A9;margin-top:6px;font-style:italic}
  .foot{color:#9BA1A9;font-size:12px;margin-top:24px}
</style>
</head>
<body>
<div class="wrap">
  <h1>Incident Report</h1>
  <div class="meta">SID <strong>${ORACLE_SID}</strong> &middot; window <strong>${WINDOW_FROM}</strong> to <strong>${WINDOW_TO}</strong> (${WINDOW_RESOLVED_FROM}) &middot; generated $(date '+%Y-%m-%d %H:%M:%S %Z') &middot; OraDiscuss RCA Generator Pack v${VERSION} &middot; read-only</div>
  <div class="summary"><span class="badge ${OVERALL_CLASS}">${OVERALL}</span><span class="big">Collection status: ${OVERALL}</span><span>${COMPLETENESS}</span></div>
  ${ROWS_HTML}
  <h2>Reconstructed timeline (${EVENT_COUNT} events)</h2>
  <table><thead><tr><th>When</th><th>Source</th><th>Severity</th><th>Message</th></tr></thead><tbody>${TIMELINE_HTML}</tbody></table>
  <h2>Ordering facts</h2>
  ${FACTS_HTML}
  <div class="foot">This report contains evidence, a timeline and ordering facts. It does not contain a diagnosis and it does not contain commands. Every reading above is labelled as an interpretation of a measurement that is printed beside it, so you can disagree with the reading while keeping the measurement. Times are as recorded on the machine that collected them. A check reading NA means that tier was not read, which is not the same as that tier being clean.</div>
</div>
</body>
</html>
HTML

ln -sf "$REPORT" "$OUTPUT_DIR/rca/rca_${ORACLE_SID}_latest.html"

INCIDENT_JSON="$(printf '{"window":{"from":"%s","to":"%s","resolved_from":"%s"},"events":[%s],"ordering_facts":[%s],"appendix":[%s]}' \
  "$(odc_json_esc "$WINDOW_FROM")" "$(odc_json_esc "$WINDOW_TO")" "$(odc_json_esc "$WINDOW_RESOLVED_FROM")" \
  "$EVENTS_JSON" "$FACTS_JSON" "$APPENDIX_JSON")"
odc_br_incident "$INCIDENT_JSON"

BRIEFING="$OUTPUT_DIR/rca/rca_${ORACLE_SID}_${TS_NOW}.json"
BRIEFING_TMP="${BRIEFING}.partial"
if ! odc_br_document \
      "rca" "$VERSION" "rca_generator.sh" "$ORACLE_SID" \
      "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$OVERALL" "$EXIT_CODE" \
      "$(printf '{"correlation_window_sec":%s,"max_events":%s}' "$(odc_json_num "$RCA_CORRELATION_WINDOW_SEC")" "$(odc_json_num "$RCA_MAX_EVENTS")")" \
      > "$BRIEFING_TMP"; then
  rm -f "$BRIEFING_TMP"
  err "the HTML report was written but the AI briefing was not: $BRIEFING"
  err "this run produced only half of its outputs, so it is being reported as a failure."
  exit 2
fi
mv -f "$BRIEFING_TMP" "$BRIEFING"
ln -sf "$BRIEFING" "$OUTPUT_DIR/rca/rca_${ORACLE_SID}_latest.json"

log "report written: $REPORT"
log "briefing written: $BRIEFING"
log "window ${WINDOW_FROM} to ${WINDOW_TO}, ${EVENT_COUNT} events, collection status ${OVERALL}"
log "collection completeness: ${COMPLETENESS}"
log "hand the briefing to your own AI with prompts/incident-review.md - nothing left this machine."
exit "$EXIT_CODE"
