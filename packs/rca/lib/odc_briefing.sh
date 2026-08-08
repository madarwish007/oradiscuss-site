#!/usr/bin/env bash
# ============================================================================
# OraDiscuss - DBA Health Check Automation Pack v1.0.0
# lib/odc_briefing.sh - the dual-output layer: briefing.json assembly.
#
# Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
# affiliated with, or endorsed by Oracle Corporation.
# READ-ONLY: this pack issues no DDL and no DML against your data.
# License: single-user license, modify allowed, no redistribution.
#
# WHAT THIS IS
#   Every OraDiscuss collector emits two outputs from ONE collection:
#     report.html   - for the human
#     briefing.json - for the customer's own AI, on the customer's own machine
#   This library is the second half. It is sourced, never executed.
#
# WHY PURE BASH
#   `jq` is not installable on many production database hosts, and a pack that
#   needs it is a pack that cannot run where it matters. The dependency surface
#   of this pack is deliberately bash + sqlplus and nothing else.
#
# THE ESCAPING IS THE LOAD-BEARING PART
#   Check details carry raw ORA- text from the alert log: double quotes,
#   Windows-style backslash paths, tabs, and stray control bytes. An emitter
#   that does not escape those produces INVALID JSON exactly when the database
#   is most interesting, which is the one moment the customer needs to hand it
#   to an AI. odc_json_esc is tested against all of those in the pack tests.
# ============================================================================

# ---------------------------------------------------------------------------
# odc_json_esc <string>
# Escapes a string for use inside a JSON double-quoted value. Prints the
# escaped form WITHOUT surrounding quotes.
#
# Backslash MUST be replaced first, or the backslashes introduced when
# escaping the quotes get escaped a second time and the output is corrupt.
# ---------------------------------------------------------------------------
odc_json_esc() {
  local s="${1-}"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\n'/\\n}"
  # Anything still in the C0 control range is not representable raw in JSON.
  # These are drivers of invalid documents, never information, so they go.
  printf '%s' "$s" | LC_ALL=C tr -d '\000-\010\013\014\016-\037'
}

# ---------------------------------------------------------------------------
# odc_json_num <string>
# Prints the argument if it is a valid JSON number, otherwise prints null.
#
# This is not paranoia. The collector formats its numbers with an explicit
# NLS_NUMERIC_CHARACTERS mask, but a customer who edits the SQL, or a future
# check that forgets the mask, would emit "87,3" under a German locale. That
# is not a JSON number, and one of them invalidates the whole document.
# ---------------------------------------------------------------------------
odc_json_num() {
  local v="${1-}"
  case "$v" in
    ''|*[!0-9.eE+-]*) printf 'null'; return 0 ;;
  esac
  if printf '%s' "$v" | LC_ALL=C grep -Eq '^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?$'; then
    printf '%s' "$v"
  else
    printf 'null'
  fi
}

# ---------------------------------------------------------------------------
# Accumulator state. Reset by odc_br_reset, appended to by the parse loop in
# the calling collector, and rendered by odc_br_document.
# ---------------------------------------------------------------------------
ODC_BR_CHECKS=''       # accumulated check objects, comma separated
ODC_BR_POOL=''         # every metric seen, one per line: id<TAB>name<TAB>value<TAB>unit
ODC_BR_COUNT_OK=0
ODC_BR_COUNT_WARN=0
ODC_BR_COUNT_CRIT=0
ODC_BR_COUNT_NA=0
ODC_BR_ATTENTION=''    # ids that are not OK, comma separated
ODC_BR_KIND='state'    # see odc_br_incident below
ODC_BR_INCIDENT=''     # complete JSON object, or empty

odc_br_reset() {
  ODC_BR_CHECKS=''
  ODC_BR_POOL=''
  ODC_BR_COUNT_OK=0
  ODC_BR_COUNT_WARN=0
  ODC_BR_COUNT_CRIT=0
  ODC_BR_COUNT_NA=0
  ODC_BR_ATTENTION=''
  ODC_BR_KIND='state'
  ODC_BR_INCIDENT=''
}

# ---------------------------------------------------------------------------
# odc_br_incident <complete JSON object>
#
# TWO DOCUMENT KINDS, ONE SCHEMA, AND WHY IT IS NOT TWO SCHEMAS.
#
# Every collector until now answered "what is the state of this database", and
# a checks array says that perfectly. RCA answers a different question, "what
# happened", whose answer is evidence, a reconstructed timeline and ranked
# ordering facts. That is genuinely a second document shape.
#
# It is carried as an OPTIONAL block on the SAME schema, discriminated by
# `kind`, rather than as a second schema. A consumer that already reads a
# briefing keeps working unchanged: the header, the collection block, the
# summary and the checks all still mean exactly what they meant, and RCA's
# collection-status facts (which tiers ran, which were skipped and why) are
# ordinary checks carrying ordinary NA statuses. Only the incident-specific part
# is new, and a reader that does not care about it can ignore one key.
#
# Two schemas would have duplicated all of that, and the duplicate would drift.
#
# THE UNEXERCISED PATH IS THE TRAP. This library has already shipped one default
# nobody reached, the inline ${8:-...} for thresholds, which expanded to three
# literal characters and emitted invalid JSON for the first caller that omitted
# the argument. So both paths here are deliberately exercised: every
# state-shaped collector omits the incident block on every run, and RCA's tests
# drive the injection path AND assert that omitting it still validates.
# ---------------------------------------------------------------------------
odc_br_incident() {
  ODC_BR_KIND='incident'
  ODC_BR_INCIDENT="${1-}"
}

# ---------------------------------------------------------------------------
# odc_br_metric <check id> <name> <value> <unit>
# Records a machine-readable measurement against a check id.
#
# Metrics are keyed by id rather than by position, so a collector may emit its
# MET| lines anywhere in the raw file: interleaved, or in one block at the end.
# The earlier design attached each metric to whichever check was last seen,
# which quietly forced every SQL author to interleave their statements and
# would have misfiled the metric the first time somebody did not. The id is
# already in the line; using it costs one grep and removes the whole class.
# ---------------------------------------------------------------------------
odc_br_metric() {
  local id="${1-}" name="${2-}" value="${3-}" unit="${4-}"
  [ -n "$id" ] && [ -n "$name" ] || return 0
  ODC_BR_POOL="${ODC_BR_POOL}${id}	${name}	${value}	${unit}
"
}

# ---------------------------------------------------------------------------
# odc_br_metrics_for <check id>
# Prints the JSON object of every metric recorded against that id.
# ---------------------------------------------------------------------------
odc_br_metrics_for() {
  local want="$1" out='' mid mname mvalue munit
  while IFS='	' read -r mid mname mvalue munit; do
    [ "$mid" = "$want" ] || continue
    [ -n "$out" ] && out="${out},"
    out="${out}\"$(odc_json_esc "$mname")\":{\"value\":$(odc_json_num "$mvalue"),\"unit\":\"$(odc_json_esc "$munit")\"}"
  done <<POOL
${ODC_BR_POOL}
POOL
  printf '{%s}' "$out"
}

# ---------------------------------------------------------------------------
# odc_br_check <id> <section> <status> <title> <detail>
# Appends one check to the document, with any metrics already recorded for it.
# Collectors therefore read the raw file twice: once to pool the metrics, once
# to build the checks. The file is local and small; correctness is worth it.
# ---------------------------------------------------------------------------
odc_br_check() {
  local id="$1" section="$2" status="$3" title="$4" detail="$5"

  case "$status" in
    OK)   ODC_BR_COUNT_OK=$((ODC_BR_COUNT_OK + 1)) ;;
    WARN) ODC_BR_COUNT_WARN=$((ODC_BR_COUNT_WARN + 1)) ;;
    CRIT) ODC_BR_COUNT_CRIT=$((ODC_BR_COUNT_CRIT + 1)) ;;
    *)    ODC_BR_COUNT_NA=$((ODC_BR_COUNT_NA + 1)) ;;
  esac

  # NA means "could not be determined", which is not the same as "fine".
  # It stays out of needs_attention but is counted, so an AI reading the
  # briefing can tell a clean bill of health from an incomplete collection.
  case "$status" in
    WARN|CRIT)
      [ -n "$ODC_BR_ATTENTION" ] && ODC_BR_ATTENTION="${ODC_BR_ATTENTION},"
      ODC_BR_ATTENTION="${ODC_BR_ATTENTION}\"$(odc_json_esc "$id")\""
      ;;
  esac

  local obj
  obj="{\"id\":\"$(odc_json_esc "$id")\""
  obj="${obj},\"section\":\"$(odc_json_esc "$section")\""
  obj="${obj},\"status\":\"$(odc_json_esc "$status")\""
  obj="${obj},\"title\":\"$(odc_json_esc "$title")\""
  obj="${obj},\"detail\":\"$(odc_json_esc "$detail")\""
  obj="${obj},\"metrics\":$(odc_br_metrics_for "$id")}"

  [ -n "$ODC_BR_CHECKS" ] && ODC_BR_CHECKS="${ODC_BR_CHECKS},"
  ODC_BR_CHECKS="${ODC_BR_CHECKS}${obj}"
}

# ---------------------------------------------------------------------------
# odc_br_document <pack> <pack_version> <script> <sid> <generated_at>
#                 <overall_status> <exit_code> <thresholds_json>
# Prints the complete briefing document to stdout.
# ---------------------------------------------------------------------------
odc_br_document() {
  local pack="$1" pack_version="$2" script="$3" sid="$4" generated_at="$5"
  local overall="$6" exit_code="$7" thresholds="${8-}"

  # DEFAULTED HERE, NOT INLINE, AND THIS IS A FIXED BUG RATHER THAN A STYLE
  # CHOICE. It used to read ${8:-{\}}, which expands to the literal three
  # characters {\} and emits INVALID JSON. Every collector shipped so far
  # happens to pass this argument, so the broken default was never reached and
  # never noticed. The first script that omitted it (awr_triage.sh) produced a
  # briefing that would not parse at all. A default nobody exercises is not a
  # default, it is a trap waiting for the next caller.
  [ -n "$thresholds" ] || thresholds='{}'

  # Built before the heredoc rather than branched inside it, so the document has
  # exactly one shape in the source and cannot end up with a stray comma in one
  # of two branches nobody renders side by side.
  local incident_block=''
  if [ -n "$ODC_BR_INCIDENT" ]; then
    incident_block="
  \"incident\": ${ODC_BR_INCIDENT},"
  fi

  cat <<JSON
{
  "schema_version": "1.1",
  "kind": "$(odc_json_esc "$ODC_BR_KIND")",
  "generator": {
    "vendor": "OraDiscuss",
    "source": "https://oradiscuss.com",
    "pack": "$(odc_json_esc "$pack")",
    "pack_version": "$(odc_json_esc "$pack_version")",
    "script": "$(odc_json_esc "$script")",
    "notice": "Generated locally by OraDiscuss tooling. Not produced by, affiliated with, or endorsed by Oracle Corporation."
  },
  "collection": {
    "generated_at": "$(odc_json_esc "$generated_at")",
    "oracle_sid": "$(odc_json_esc "$sid")",
    "read_only": true,
    "collector_exit_code": $(odc_json_num "$exit_code"),
    "data_residency": "This file was written on the machine that ran the collector. OraDiscuss never receives it."
  },
  "summary": {
    "overall_status": "$(odc_json_esc "$overall")",
    "counts": {
      "OK": ${ODC_BR_COUNT_OK},
      "WARN": ${ODC_BR_COUNT_WARN},
      "CRIT": ${ODC_BR_COUNT_CRIT},
      "NA": ${ODC_BR_COUNT_NA}
    },
    "needs_attention": [${ODC_BR_ATTENTION}]
  },
  "thresholds": ${thresholds},${incident_block}
  "checks": [${ODC_BR_CHECKS}]
}
JSON
}
