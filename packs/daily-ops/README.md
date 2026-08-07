# OraDiscuss Daily Operations Pack v1.0.0

Published by OraDiscuss (oradiscuss.com). Not produced by, affiliated with, or
endorsed by Oracle Corporation.

**Everything here is read-only.** It issues no DDL and no DML. Read the scripts
before you run them, and run them somewhere that is not production first. You
are the DBA.

## What it does

`daily_analysis.sh` is the morning briefing. It collects once and writes two
files side by side:

- `morning_<SID>_<timestamp>.html` for you
- `morning_<SID>_<timestamp>.json` for **your own** AI assistant

The database is queried once. A second collection is how a human report and a
machine briefing end up describing the same database at two different moments.

Covered: instance and database identity, tablespace usage, tablespace growth
over seven days where history exists, top segments by size, RMAN full and
archivelog backup recency, standby apply lag, stale optimizer statistics,
failed logons from the unified audit trail, invalid objects with a delta
against yesterday, and a patch inventory summary.

## Running it

    cp config.env config-mydb.env      # edit ORACLE_SID, ORACLE_HOME, thresholds
    ./daily_analysis.sh --config config-mydb.env

    ./daily_analysis.sh --dry-run      # prints the plan, contacts nothing
    ./daily_analysis.sh --render-only /path/to/daily_raw_SID_ts.txt

`--render-only` rebuilds both outputs from a collection that already happened,
without touching the database. It leaves the collection exactly as it found it,
so an archived run can be re-read as many times as you like.

Cron, as the oracle OS user:

    0 7 * * * /opt/oradiscuss/daily-ops/daily_analysis.sh >> /opt/oradiscuss/daily-ops/output/cron.log 2>&1

Exit codes: `0` all OK, `1` at least one WARN, `2` at least one CRIT or an
error. A run that writes the HTML but fails to write the briefing also exits
`2`, because half a run is a failed run.

## Grants

`SELECT_CATALOG_ROLE` or the equivalent SELECT grants on the dictionary views.
The failed-logon check additionally needs `AUDIT_VIEWER` or a direct SELECT on
`UNIFIED_AUDIT_TRAIL`; without it that one check reports `NA` and the rest of
the collection is unaffected.

## Handing the briefing to your AI

`prompts/morning-triage.md` contains a prompt to paste alongside the JSON. It
teaches your assistant the SHAPE of the document and deliberately does not
recite Oracle version behaviour, because a prompt reciting half-remembered
facts is how a confident wrong answer gets made. It also does not ask your
assistant for commands to paste at a production database.

Your assistant, your subscription, your data. Nothing in this pack transmits
anything anywhere, and OraDiscuss never receives your output.

## What is not here, and why

`tbs_manager` and `redef_assistant` from the earlier field-test set are not in
this pack. Both generate statements that change a database, and everything sold
here is read-only.
