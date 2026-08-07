#!/usr/bin/env bash
# ============================================================================
# OraDiscuss - Daily Operations Pack v1.0.0
# env_collector.sh - one-time environment discovery & config generator.
#
# Generated locally by OraDiscuss tooling. Not produced by, affiliated with, or
# endorsed by Oracle Corporation. https://oradiscuss.com
#
# Written for Oracle 19c/21c/23ai on Linux.
# READ-ONLY: reads /etc/oratab, OLR, process lists, crontabs, and runs
# SELECT-only version probes. It issues no DDL and no DML, and it writes ONLY
# to its own setup directory.
#
# Purpose: run once per host ("setup once, everything else just works").
#   - Detects standalone vs RAC (crsctl/OLR).
#   - On RAC: iterates all cluster nodes via SSH (continue-on-failure).
#   - Per node captures: /etc/oratab, Oracle Homes + versions, running SIDs,
#     listeners, ASM/GI presence + version, kernel/mem/limits, crontabs.
#   - Writes a version-aware config.env per node into the setup dir.
#
# ONE DISCOVERY, TWO OUTPUTS:
#   env_summary_<ts>.html   - the environment summary for the human
#   env_briefing_<ts>.json  - the same discovery, structured, for YOUR OWN AI
#
# Usage:
#   ./env_collector.sh [--setup-dir /path] [--dry-run]
#   ./env_collector.sh --primary-home /u01/app/oracle/product/19c/dbhome_1
#   ./env_collector.sh --render-only /path/to/setup-dir
#
#   --primary-home names the primary Oracle Home outright, so a host with
#   several homes never has to be asked. Without it, an interactive run asks
#   and a non-interactive one takes the pre-selected default and logs which.
#
#   --render-only rebuilds both outputs from probe files already collected in
#   a setup directory, contacting no host. It is how this pack's tests drive
#   the REAL parser rather than a copy of it.
#
# Exit codes: 0 = complete, 1 = partial (some nodes unreachable), 2 = failed.
#
# License: single-user license, modify allowed, no redistribution.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="1.0.0"
DRY_RUN=0
DEGRADED=0
RENDER_ONLY=''
PRIMARY_HOME_OPT=''

# shellcheck source=lib/odc_briefing.sh
. "${SCRIPT_DIR}/lib/odc_briefing.sh"

log()  { printf '%s [env_collector] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }
err()  { printf '%s [env_collector] ERROR: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >&2; }
esc()  { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' ; }

# ---------------------------------------------------------------------------
# Per-node status, WITHOUT an associative array.
#
# The v0.9 script used `declare -A NODE_STATUS`, which is bash 4. That is not
# a style preference: `bash -n` reports the file as perfectly fine and the
# line then dies at RUNTIME on bash 3.2, which is the default bash on macOS
# and is still present on older database hosts. Under `set -e` it aborts the
# script before a single node has been probed, so the failure lands nowhere
# near the cause.
#
# Lookup is by EXACT FIELD EQUALITY rather than a regex, because a hostname
# containing a dot would otherwise match the wrong row.
# ---------------------------------------------------------------------------
NODE_STATUS_LIST=''
node_status_set() { NODE_STATUS_LIST="${NODE_STATUS_LIST}${1}=${2}
"; }
node_status_get() { printf '%s' "$NODE_STATUS_LIST" | awk -F= -v n="$1" '$1==n{v=$2} END{print v}'; }

usage() { grep -E '^# (Usage|  \./)' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --setup-dir) shift; SETUP_DIR="${1:?--setup-dir requires a path}" ;;
    --dry-run)   DRY_RUN=1 ;;
    --render-only) shift; RENDER_ONLY="${1:?--render-only requires a setup directory}" ;;
    --primary-home) shift; PRIMARY_HOME_OPT="${1:?--primary-home requires a path}" ;;
    -h|--help)   usage ;;
    *) err "unknown argument: $1"; usage ;;
  esac
  shift
done

SETUP_DIR="${SETUP_DIR:-$HOME/oradiscuss-dailyops/setup}"
TS_NOW="$(date '+%Y%m%d-%H%M%S')"

# ---------------------------------------------------------------------------
# The per-node probe. Runs locally OR over ssh - keep it self-contained.
# Emits KEY=VALUE lines + named file sections between <<<NAME>>> markers.
# ---------------------------------------------------------------------------
read -r -d '' PROBE <<'PROBE_EOF' || true
echo "KERNEL=$(uname -r)"
echo "OS_RELEASE=$(cat /etc/redhat-release /etc/oracle-release /etc/os-release 2>/dev/null | head -1)"
echo "MEM_TOTAL_KB=$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null)"
echo "SHMMAX=$(cat /proc/sys/kernel/shmmax 2>/dev/null || echo n/a)"
echo "SHMALL=$(cat /proc/sys/kernel/shmall 2>/dev/null || echo n/a)"
echo "SEM=$(cat /proc/sys/kernel/sem 2>/dev/null || echo n/a)"
echo "HUGEPAGES=$(awk '/HugePages_Total/{print $2}' /proc/meminfo 2>/dev/null)"
echo "LIMITS_NOFILE=$(ulimit -n 2>/dev/null)"
echo "LIMITS_NPROC=$(ulimit -u 2>/dev/null)"
# Clusterware?
CRS_HOME=""
if [ -r /etc/oracle/olr.loc ]; then
  CRS_HOME="$(awk -F= '/crs_home/{print $2}' /etc/oracle/olr.loc)"
fi
echo "CRS_HOME=${CRS_HOME:-none}"
if [ -n "$CRS_HOME" ] && [ -x "$CRS_HOME/bin/crsctl" ]; then
  echo "GI_VERSION=$("$CRS_HOME/bin/crsctl" query crs releaseversion 2>/dev/null | head -1 || echo unknown)"
  echo "GI_ACTIVE=$("$CRS_HOME/bin/crsctl" check crs >/dev/null 2>&1 && echo yes || echo no)"
else
  echo "GI_VERSION=none"
  echo "GI_ACTIVE=no"
fi
# ASM instance running?
ASM_SID="$(ps -eo comm 2>/dev/null | awk '/^pmon_\+ASM/{sub("pmon_","");print;exit}')"
echo "ASM_SID=${ASM_SID:-none}"
echo '<<<ORATAB>>>'
grep -vE '^\s*#|^\s*$' /etc/oratab 2>/dev/null || echo "(no /etc/oratab entries)"
echo '<<<PMON_SIDS>>>'
ps -eo comm 2>/dev/null | awk '/^pmon_/{sub("pmon_","");print}' || true
echo '<<<OHOMES>>>'
# unique homes from oratab + running pmon processes (comm only - never args,
# or this probe matches itself when passed via bash -c/ssh)
{ grep -vE '^\s*#|^\s*$' /etc/oratab 2>/dev/null | cut -d: -f2
  for p in /proc/[0-9]*/comm; do
    c="$(cat "$p" 2>/dev/null)"
    case "$c" in ora_pmon_*|asm_pmon_*) readlink "${p%/comm}/exe" 2>/dev/null | sed 's#/bin/oracle$##' ;; esac
  done
} | grep -E '^/' | sort -u
echo '<<<OHOME_VERSIONS>>>'
for h in $( { grep -vE '^\s*#|^\s*$' /etc/oratab 2>/dev/null | cut -d: -f2 ; } | sort -u ); do
  v="unknown"
  [ -x "$h/bin/sqlplus" ] && v="$("$h/bin/sqlplus" -V 2>/dev/null | awk '/SQL\*Plus/{print $3}')"
  echo "$h=$v"
done
echo '<<<LISTENERS>>>'
ps -eo comm,args 2>/dev/null | awk '$1=="tnslsnr"{print $2}' | sort -u || true
echo '<<<CRONTABS>>>'
for u in oracle grid "$(whoami)"; do
  crontab -u "$u" -l 2>/dev/null | sed "s/^/[$u] /" || true
done | grep -vE 'no crontab' || echo "(no crontabs found)"
PROBE_EOF

# ---------------------------------------------------------------------------
# Standalone vs RAC detection (local node).
# ---------------------------------------------------------------------------
IS_RAC=0 ; NODES="$(hostname -s)"
CRS_HOME=""
[ -r /etc/oracle/olr.loc ] && CRS_HOME="$(awk -F= '/crs_home/{print $2}' /etc/oracle/olr.loc || true)"
if [ -n "$CRS_HOME" ] && [ -x "$CRS_HOME/bin/crsctl" ]; then
  if "$CRS_HOME/bin/crsctl" check crs >/dev/null 2>&1; then
    IS_RAC=1
    if [ -x "$CRS_HOME/bin/olsnodes" ]; then
      NODES="$("$CRS_HOME/bin/olsnodes" 2>/dev/null | tr '\n' ' ' | sed 's/ $//')"
    fi
  fi
fi
[ -n "$NODES" ] || NODES="$(hostname -s)"
# Not logged under --render-only: the topology is about to be replaced by what
# the saved probes actually say, and announcing the local machine's shape first
# reads as a finding about the replayed estate.
[ -n "$RENDER_ONLY" ] || \
  log "topology: $([ $IS_RAC -eq 1 ] && echo "RAC, nodes: $NODES" || echo "standalone")"

if [ "$DRY_RUN" -eq 1 ]; then
  cat <<PLAN
DRY-RUN - env_collector plan
  topology        : $([ $IS_RAC -eq 1 ] && echo "RAC ($NODES)" || echo standalone)
  setup dir       : $SETUP_DIR
  WOULD per node  : run read-only probe (oratab, homes+versions, pmon SIDs,
                    listeners, kernel/shm/limits, crontabs, GI/ASM version)
  WOULD write     : config-<node>.env per node + env_summary_<ts>.html
  WOULD interview : only if multiple Oracle Homes on a node (primary-home pick,
                    default pre-selected). Nothing touches the database or OS.
PLAN
  exit 0
fi

mkdir -p "$SETUP_DIR"

# ---------------------------------------------------------------------------
# Run the probe on every node (local directly, remote via SSH loop,
# continue-on-failure).
# ---------------------------------------------------------------------------
if [ -n "$RENDER_ONLY" ]; then
  # Replay: the probes already happened. Rebuild the node list and each node's
  # status FROM THE FILES, so no host is contacted and nothing is invented.
  # A probe file whose body is the unreachable marker is still an unreachable
  # node on replay, exactly as it was on the day it was collected.
  SETUP_DIR="$RENDER_ONLY"
  [ -d "$SETUP_DIR" ] || { err "render-only setup directory not found: $SETUP_DIR"; exit 2; }
  NODES=''
  for f in "$SETUP_DIR"/probe_*.txt; do
    [ -r "$f" ] || continue
    n="$(basename "$f")"; n="${n#probe_}"; n="${n%.txt}"
    NODES="${NODES}${n} "
    if head -1 "$f" | grep -q '^NODE UNREACHABLE'; then
      node_status_set "$n" unreachable
      DEGRADED=1
    else
      node_status_set "$n" replayed
    fi
  done
  NODES="${NODES% }"
  [ -n "$NODES" ] || { err "no probe_*.txt files in $SETUP_DIR"; exit 2; }
  IS_RAC=0
  case "$NODES" in *' '*) IS_RAC=1 ;; esac
  log "render-only: replaying $NODES from $SETUP_DIR, no host is contacted"
else
for node in $NODES; do
  RAW="$SETUP_DIR/probe_${node}.txt"
  if [ "$node" = "$(hostname -s)" ] || [ "$node" = "$(hostname)" ]; then
    bash -c "$PROBE" > "$RAW" 2>/dev/null || true
    node_status_set "$node" local
    log "probed local node $node"
  else
    if ssh -o BatchMode=yes -o ConnectTimeout=8 "$node" "bash -s" <<<"$PROBE" > "$RAW" 2>/dev/null; then
      node_status_set "$node" ssh
      log "probed node $node via SSH"
    else
      node_status_set "$node" unreachable
      DEGRADED=1
      printf 'NODE UNREACHABLE via passwordless SSH (BatchMode, 8s timeout).\nSet up ssh keys for the oracle/grid user, or run env_collector.sh locally on %s and merge the setup dirs.\n' "$node" > "$RAW"
      log "node $node unreachable - continuing"
    fi
  fi
done
fi

# ---------------------------------------------------------------------------
# Parse each probe file, interview when multiple homes, write config-<node>.env
# ---------------------------------------------------------------------------
section() { # file marker -> lines between <<<marker>>> and next <<<
  awk -v m="<<<$2>>>" '$0==m{f=1;next} /^<<</{f=0} f' "$1"
}

CONFIGS_HTML=""

# ONE discovery feeds BOTH outputs. Every fact below is written into the HTML
# summary and into the briefing from the same variables, so the two cannot
# disagree about a host.
odc_br_reset
NODE_COUNT="$(printf '%s\n' "$NODES" | tr ' ' '\n' | grep -c .)"
odc_br_metric TOPOLOGY node_count "$NODE_COUNT" nodes
odc_br_check TOPOLOGY "Topology" OK "Cluster topology" \
  "$([ "$IS_RAC" -eq 1 ] && echo "RAC, $NODE_COUNT nodes: $NODES" || echo "standalone, single node: $NODES")"

for node in $NODES; do
  RAW="$SETUP_DIR/probe_${node}.txt"
  if [ "$(node_status_get "$node")" = "unreachable" ]; then
    # WARN, not NA. NA means a check could not be evaluated; this one was
    # evaluated and the answer is that a cluster node was never described, so
    # no config was generated for it and there is a named remedy.
    odc_br_check "NODE_${node}" "Nodes" WARN "Node ${node}" \
      "unreachable over passwordless SSH, so no config-${node}.env was generated. Set up ssh keys for the oracle or grid user, or run env_collector.sh on ${node} itself."
    continue
  fi

  HOMES="$(section "$RAW" OHOMES | grep -E '^/' || true)"
  SID_LINES="$(section "$RAW" PMON_SIDS || true)"
  FIRST_DB_SID="$(printf '%s\n' "$SID_LINES" | grep -v '^+ASM' | head -1)"
  PRIMARY_HOME=""

  HOME_COUNT="$(printf '%s\n' "$HOMES" | grep -c '^/' || true)"
  if [ -n "$PRIMARY_HOME_OPT" ]; then
    # Named outright by the caller, which is the only shape that is both
    # unattended AND deliberate. The default below is unattended but is still
    # a guess, and a guess that nobody was asked to confirm is worth logging
    # rather than worth trusting.
    PRIMARY_HOME="$PRIMARY_HOME_OPT"
    log "node $node: primary home given as $PRIMARY_HOME (--primary-home)"
  elif [ "$HOME_COUNT" -gt 1 ]; then
    # Genuinely ambiguous: which home is primary? Default = home of the first
    # running DB SID per oratab; else first alphabetically.
    DEFAULT_HOME="$(grep "^${FIRST_DB_SID:-~none~}:" /etc/oratab 2>/dev/null | cut -d: -f2 || true)"
    [ -n "$DEFAULT_HOME" ] || DEFAULT_HOME="$(printf '%s\n' "$HOMES" | head -1)"
    if [ -t 0 ] && [ -z "$RENDER_ONLY" ] && [ "$node" = "$(hostname -s)" ]; then
      echo "Multiple Oracle Homes on $node:" >&2
      printf '%s\n' "$HOMES" | nl >&2
      printf 'Which is the PRIMARY home? [default: %s]: ' "$DEFAULT_HOME" >&2
      read -r pick
      if [ -n "$pick" ] && printf '%s\n' "$HOMES" | grep -qx "$pick"; then
        PRIMARY_HOME="$pick"
      elif [ -n "$pick" ] && [[ "$pick" =~ ^[0-9]+$ ]]; then
        PRIMARY_HOME="$(printf '%s\n' "$HOMES" | sed -n "${pick}p")"
      else
        PRIMARY_HOME="$DEFAULT_HOME"
      fi
    else
      PRIMARY_HOME="$DEFAULT_HOME"
      log "node $node: $HOME_COUNT homes - defaulting primary to $PRIMARY_HOME"
    fi
  else
    PRIMARY_HOME="$(printf '%s\n' "$HOMES" | head -1)"
  fi

  SID="$FIRST_DB_SID"
  if [ -z "$SID" ]; then
    SID="$(grep -vE '^\s*#|^\s*$' /etc/oratab 2>/dev/null | grep -v '^+ASM' | cut -d: -f1 | head -1 || true)"
  fi
  [ -n "$SID" ] || SID=""

  GI_VER="$(grep '^GI_VERSION=' "$RAW" | cut -d= -f2-)"
  ASM="$(grep '^ASM_SID=' "$RAW" | cut -d= -f2-)"
  OH_VER="$(section "$RAW" OHOME_VERSIONS | grep "^${PRIMARY_HOME}=" | cut -d= -f2 || true)"

  CFG="$SETUP_DIR/config-${node}.env"
  cat > "$CFG" <<CFG
# ============================================================================
# OraDiscuss - Daily Operations Pack v0.9.0 (field-test release)
# config-${node}.env - GENERATED by env_collector.sh on $(date '+%Y-%m-%d %H:%M:%S %Z')
# Node: ${node}  ($([ "$IS_RAC" -eq 1 ] && echo RAC || echo standalone))
# Review before use. NEVER add passwords here.
# ============================================================================

# --- Oracle environment ------------------------------------------------------
ORACLE_SID="${SID}"
ORACLE_HOME="${PRIMARY_HOME}"
ORACLE_CONNECT="/ as sysdba"
LISTENER_NAME="LISTENER"

# --- Detected environment (informational; used for version-aware branching) --
DB_HOME_VERSION="${OH_VER:-unknown}"
GI_VERSION="${GI_VER}"
ASM_SID="${ASM}"
TOPOLOGY="$([ "$IS_RAC" -eq 1 ] && echo rac || echo standalone)"
CLUSTER_NODES="${NODES}"

# --- Site naming standard (used by tbs_manager.sh for new datafiles) --------
# %TS% is replaced with the tablespace name, %NN% with a sequence number.
DATAFILE_NAME_STANDARD="\${ORACLE_BASE:-/u01/app/oracle}/oradata/\${ORACLE_SID}/%TS%_%NN%.dbf"

# --- Thresholds ---------------------------------------------------------------
TS_WARN_PCT=80
TS_CRIT_PCT=90
# Backup verification: WARN if no successful level-0/full backup older than
# this many hours; archivelog backup max age; standby apply lag (minutes).
RMAN_FULL_MAX_AGE_HOURS=30
RMAN_ARCH_MAX_AGE_HOURS=8
STANDBY_LAG_WARN_MIN=30
STALE_STATS_WARN=50

# --- Output / notifications ----------------------------------------------------
OUTPUT_DIR="\$HOME/oradiscuss-dailyops/output"
NOTIFY_ENABLED=0
NOTIFY_EMAIL=""
CFG
  log "wrote $CFG (SID=${SID:-UNSET}, home=$PRIMARY_HOME)"

  # Metrics BEFORE the check: the briefing pools measurements by check id and
  # attaches them when the check is recorded, so a metric emitted afterwards
  # would land on nothing.
  MEM_KB="$(grep '^MEM_TOTAL_KB=' "$RAW" | cut -d= -f2- || true)"
  HUGE="$(grep '^HUGEPAGES=' "$RAW" | cut -d= -f2- || true)"
  NOFILE="$(grep '^LIMITS_NOFILE=' "$RAW" | cut -d= -f2- || true)"
  [ -n "$MEM_KB" ] && odc_br_metric "NODE_${node}" mem_total_kb "$MEM_KB" kB
  [ -n "$HUGE" ]   && odc_br_metric "NODE_${node}" hugepages_total "$HUGE" pages
  [ -n "$NOFILE" ] && odc_br_metric "NODE_${node}" limits_nofile "$NOFILE" files
  odc_br_metric "NODE_${node}" oracle_home_count "$HOME_COUNT" homes

  # Versions stay in the DETAIL as text. They are not numbers, and the schema
  # validator rejects a stringified number in a metric, correctly.
  odc_br_check "NODE_${node}" "Nodes" OK "Node ${node}" \
    "probed $(node_status_get "$node"); SID ${SID:-none}, primary home ${PRIMARY_HOME:-none} (version ${OH_VER:-unknown}), GI ${GI_VER:-none}, ASM ${ASM:-none}, ${HOME_COUNT} Oracle home(s)"

  CONFIGS_HTML="${CONFIGS_HTML}<tr><td>$(printf '%s' "$node" | esc)</td><td>$(node_status_get "$node")</td><td>$(printf '%s' "${SID:--}" | esc)</td><td class=\"mono\">$(printf '%s' "${PRIMARY_HOME:--}" | esc)</td><td>$(printf '%s' "${OH_VER:-unknown}" | esc)</td><td>$(printf '%s' "$GI_VER" | esc)</td><td><a href=\"config-${node}.env\">config-${node}.env</a></td></tr>"
done

# ---------------------------------------------------------------------------
# HTML environment summary.
# ---------------------------------------------------------------------------
DETAIL_HTML=""
for node in $NODES; do
  RAW="$SETUP_DIR/probe_${node}.txt"
  DETAIL_HTML="${DETAIL_HTML}<details><summary>$(printf '%s' "$node" | esc) - raw probe ($(node_status_get "$node"))</summary><pre>$(head -c 40000 "$RAW" | esc)</pre></details>"
done

SUMMARY="$SETUP_DIR/env_summary_${TS_NOW}.html"
cat > "$SUMMARY" <<HTML
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Environment Summary - ${TS_NOW}</title>
<style>
  :root{color-scheme:dark}
  body{background:#0A0B0D;color:#E8E9EB;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:32px;line-height:1.5}
  .wrap{max-width:1100px;margin:0 auto}
  h1{font-size:22px;margin:0 0 4px}
  h2{font-size:15px;margin:28px 0 8px;color:#9BA1A9;text-transform:uppercase;letter-spacing:.06em}
  .meta{color:#9BA1A9;font-size:13px;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;background:#121316;border:1px solid #262A31;border-radius:10px;overflow:hidden;font-size:13px}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #262A31}
  th{color:#9BA1A9;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
  .mono{font-family:ui-monospace,"JetBrains Mono",monospace;font-size:12px}
  a{color:#FF6B4A;text-decoration:none}
  details{border:1px solid #262A31;border-radius:10px;background:#121316;padding:10px 16px;margin:8px 0}
  summary{cursor:pointer;font-weight:600;font-size:13px}
  pre{background:#0d0e10;border:1px solid #262A31;border-radius:8px;padding:12px;overflow-x:auto;font-size:12px;color:#cdd2d8;margin-top:10px}
  .foot{color:#9BA1A9;font-size:12px;margin-top:24px}
</style>
</head>
<body>
<div class="wrap">
  <h1>Environment Summary</h1>
  <div class="meta">OraDiscuss Daily Operations Pack v${VERSION} - field-test release &middot; generated $(date '+%Y-%m-%d %H:%M:%S %Z') &middot; topology: $([ "$IS_RAC" -eq 1 ] && echo "RAC" || echo "standalone") &middot; nodes: $(printf '%s' "$NODES" | esc)</div>
  <h2>Nodes &amp; generated configs</h2>
  <table><thead><tr><th>Node</th><th>Probe</th><th>SID</th><th>Primary home</th><th>DB home ver</th><th>GI ver</th><th>Config</th></tr></thead>
  <tbody>${CONFIGS_HTML}</tbody></table>
  <h2>Raw probe detail</h2>
  ${DETAIL_HTML}
  <div class="foot">Next step: review each config-&lt;node&gt;.env, then run daily_analysis.sh --config config-&lt;node&gt;.env. env_collector is read-only against the OS and never connects to a database.</div>
</div>
</body>
</html>
HTML

ln -sf "$SUMMARY" "$SETUP_DIR/env_summary_latest.html"
log "environment summary: $SUMMARY"

# ---------------------------------------------------------------------------
# Output two: the same discovery, structured, for the customer's own AI.
#
# Written to a temporary file and moved into place. If it cannot be written the
# whole run fails, because a run that produced only its HTML is a failed run
# rather than a partial success, and "one discovery, two outputs" would then be
# false in exactly the silent way that is hardest to notice.
# ---------------------------------------------------------------------------
[ "$DEGRADED" -eq 1 ] && OVERALL="WARN" || OVERALL="OK"
EXIT_CODE=0
[ "$DEGRADED" -eq 1 ] && EXIT_CODE=1

BRIEFING="$SETUP_DIR/env_briefing_${TS_NOW}.json"
BRIEFING_TMP="${BRIEFING}.partial"
if ! odc_br_document \
      "daily-ops" "$VERSION" "env_collector.sh" "${SID:-none}" \
      "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$OVERALL" "$EXIT_CODE" \
      '{}' > "$BRIEFING_TMP"; then
  rm -f "$BRIEFING_TMP"
  err "the HTML summary was written but the AI briefing was not: $BRIEFING"
  err "this run produced only half of its outputs, so it is being reported as a failure."
  exit 2
fi
mv -f "$BRIEFING_TMP" "$BRIEFING"
ln -sf "$BRIEFING" "$SETUP_DIR/env_briefing_latest.json"
log "briefing written: $BRIEFING"
log "hand the briefing to your own AI with a prompt from prompts/ - nothing left this machine."

exit "$EXIT_CODE"
