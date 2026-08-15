#!/usr/bin/env bash
# ============================================================================
# run-field-test.sh - run a pack against the local Oracle 23ai Free lab target.
#
#   scripts/field-test/run-field-test.sh [pack]     # default pack: healthcheck
#
# WHAT THIS PROVES
#   The pack RUNS against a real Oracle database: it connects, executes its
#   SELECT-only SQL, exits with a real code, and writes a real HTML report plus
#   the AI-briefing JSON. It runs twice:
#     - as SYSDBA               -> execution proof
#     - as odc_reader           -> a customer-shaped account (CREATE SESSION +
#                                   SELECT_CATALOG_ROLE only), the input a real
#                                   monitoring user actually has
#
# WHAT THIS DOES NOT PROVE
#   Correctness on a real production estate. A fresh lab DB legitimately shows
#   CRIT on backup recency (no backups exist) and NA on ASM/FRA (none present).
#   Those are correct behaviours, not defects. A check that ERRORS on a 23ai
#   view change is a finding (the pack targets 19c/21c) - capture it, do not
#   hide it. The "field-tested on a real estate" claim is a separate human step.
#
# REQUIREMENTS: Docker. Nothing else - sqlplus lives inside the container.
# TEARDOWN:     docker compose -f scripts/field-test/docker-compose.yml down -v
# ============================================================================

# Not -e: we WANT to capture a pack's non-zero exit, not abort on it.
set -uo pipefail

PACK="${1:-healthcheck}"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

COMPOSE="docker compose"
CONTAINER="odc-fieldtest-db"

mkdir -p out/sysdba out/reader
: > out/run.log
log() { printf '%s | %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a out/run.log; }

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found on PATH - install Docker Desktop and retry." ; exit 127
fi

log "==> pack under test: $PACK"
log "==> bringing up Oracle 23ai Free (gvenzl) lab target"
$COMPOSE up -d 2>&1 | tee -a out/run.log

log "==> waiting for the database to open (container health)"
ready=0
for i in $(seq 1 60); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo missing)"
  log "   [$i/60] health=$status"
  [ "$status" = "healthy" ] && { ready=1; break; }
  [ "$status" = "missing" ] && { log "   container not found; aborting"; break; }
  sleep 10
done
if [ "$ready" != "1" ]; then
  log "!! database did not reach a healthy state - last 40 log lines:"
  $COMPOSE logs --tail 40 2>&1 | tee -a out/run.log
  exit 3
fi

# Discover the container's ORACLE_HOME so nothing is hard-coded to an image tag.
OH="$($COMPOSE exec -T db bash -lc 'printf %s "$ORACLE_HOME"')"
log "==> ORACLE_HOME=$OH  ORACLE_SID=FREE  PDB=FREEPDB1"

log "==> creating customer-shaped read-only user in FREEPDB1"
$COMPOSE exec -T db bash -lc 'sqlplus -s "/ as sysdba" @/field-test-sql/create-reader.sql' 2>&1 | tee -a out/run.log

# The pack reads all connection + threshold settings from a config.env. We write
# one per identity into the host-mounted output dir (= /field-test-out inside).
write_config() {  # <host-file> <connect-string> <container-output-dir>
  cat > "$1" <<EOF
ORACLE_SID="FREE"
ORACLE_HOME="$OH"
ORACLE_CONNECT="$2"
OUTPUT_DIR="$3"
TS_WARN_PCT=80
TS_CRIT_PCT=90
FRA_WARN_PCT=80
FRA_CRIT_PCT=90
ASM_WARN_PCT=80
ASM_CRIT_PCT=90
RMAN_FULL_MAX_AGE_HOURS=30
RMAN_ARCH_MAX_AGE_HOURS=8
INVALID_OBJ_WARN=1
RETENTION_DAYS=30
EMAIL_ENABLED=0
TS_HISTORY_TABLE="ORADISCUSS_TS_HISTORY"
EOF
}
write_config out/hc-sysdba.config.env "/ as sysdba" "/field-test-out/sysdba"
write_config out/hc-reader.config.env "odc_reader/Odc_Reader#2026@localhost:1521/FREEPDB1" "/field-test-out/reader"

run_pack() {  # <label> <container-config-path>
  log "==> [$1] --dry-run"
  $COMPOSE exec -T db bash -lc "bash /packs/$PACK/health_check.sh --dry-run --config $2" 2>&1 | tee -a out/run.log
  log "   [$1] dry-run exit=${PIPESTATUS[0]}"
  log "==> [$1] real run"
  $COMPOSE exec -T db bash -lc "bash /packs/$PACK/health_check.sh --config $2" 2>&1 | tee -a out/run.log
  log "   [$1] real-run exit=${PIPESTATUS[0]}  (0=all OK, 1=WARN, 2=CRIT or could-not-run)"
}
run_pack sysdba /field-test-out/hc-sysdba.config.env
run_pack reader /field-test-out/hc-reader.config.env

log "==> outputs written to the host under scripts/field-test/out/:"
find out/sysdba out/reader -type f 2>/dev/null | sed 's/^/     /' | tee -a out/run.log
log "==> DONE. These are LAB outputs from Oracle Database 23ai Free."
log "    They contain no customer data and are not a real production estate."
