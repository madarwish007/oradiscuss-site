# Field-test target — run a pack against real Oracle before it ships

This is the always-available Oracle test bed. Its whole purpose is to turn a
field test from a project into an evening: a local, throwaway **Oracle Database
23ai Free** instance a pack can actually be *run* against before release.

It is **not** a customer production estate, and nothing it produces is
"field-tested on a real estate" in the sense the pack READMEs mean. That claim
belongs to a run against a real production database — a separate, human step.

## Requirements

- Docker (Docker Desktop on macOS). Nothing else — `sqlplus` lives inside the
  container, so you do not need an Oracle client on your machine.

## Use it

```bash
# one command: brings the DB up, waits for it to open, runs the pack twice
scripts/field-test/run-field-test.sh healthcheck

# tear the lab down (removes the container and its volumes)
docker compose -f scripts/field-test/docker-compose.yml down -v
```

Outputs land on the host under `scripts/field-test/out/`:

```
out/run.log                       full transcript of the run
out/sysdba/reports/health_*.html  report from the SYSDBA run  (execution proof)
out/sysdba/reports/health_*.json  the AI-briefing JSON beside it
out/reader/reports/health_*.html  report from the odc_reader run  (the one that matters)
out/reader/reports/health_*.json
```

## Why two runs

- **SYSDBA** — proves the pack *executes*: connects, runs its SELECT-only SQL,
  exits with a real code, writes both outputs.
- **odc_reader** — a customer-shaped account with only `CREATE SESSION` +
  `SELECT_CATALOG_ROLE` in `FREEPDB1`. This is the input a real monitoring user
  actually has. SYSDBA masks every "not authorised / not available" path, so the
  run that tells you how the pack behaves for a customer is this one.

## Reading the results honestly

A fresh lab database legitimately reports:

- **CRIT** on backup recency — no RMAN backups exist yet. Correct.
- **NA** on ASM and FRA — none configured. Correct.
- possibly **WARN** around archivelog mode. Correct for a default Free instance.

None of those are defects; they are the checks doing their job on an empty box.
What *is* a finding: a check that **errors** on a view or column that changed in
23ai. The packs target 19c/21c, so a 23ai difference is exactly the cheap bug
this bed exists to catch — it goes to the Academy candidate pipeline, it does not
get papered over.

## What it deliberately does not do

- It does not stage fake problems to make a report look interesting. The report's
  value is that it is real and plainly labelled.
- It does not connect to, read, or touch anything outside this container.
- It does not persist between runs unless you keep the container up.
