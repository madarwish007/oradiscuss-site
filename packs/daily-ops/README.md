# OraDiscuss Daily Operations Pack v1.0.0

Published by OraDiscuss (oradiscuss.com). Not produced by, affiliated with, or
endorsed by Oracle Corporation.

**Everything here is read-only.** It issues no DDL and no DML. Read the scripts
before you run them, and run them somewhere that is not production first. You
are the DBA.

## What it does

`env_collector.sh` runs **once per host**, before anything else. It discovers
the environment (standalone or RAC, Oracle Homes and their versions, running
SIDs, listeners, Grid Infrastructure and ASM, kernel limits, crontabs) and
writes a `config-<node>.env` that every other script then reads. On a cluster
it reaches the other nodes over passwordless SSH and **continues when a node is
unreachable**, reporting that node as a WARN with the remedy rather than
failing the run or, worse, quietly describing a cluster it only half saw. It
also writes two outputs:

- `env_summary_<timestamp>.html` for you
- `env_briefing_<timestamp>.json` for your own AI

    ./env_collector.sh
    ./env_collector.sh --primary-home /u01/app/oracle/product/19c/dbhome_1
    ./env_collector.sh --render-only /path/to/setup-dir

A host with several Oracle Homes is genuinely ambiguous. An interactive run
asks; a cron run takes the pre-selected default and logs which one it took;
`--primary-home` settles it outright so nothing has to guess.

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

`tbs_manager.sh` is the tablespace deep read. The morning briefing answers "is
anything full". This one answers the three questions you ask once something is:
can the file grow by itself, how much room is actually reachable before a human
has to act, and is any of this space recoverable rather than purchasable.

- `tbs_report_<SID>_<timestamp>.html` for you
- `tbs_report_<SID>_<timestamp>.json` for **your own** AI assistant

Covered: usage with the bigfile flag stated rather than implied, autoextend
policy and reachable headroom per tablespace, datafiles carrying free space
inside them, and segments with high extent counts.

**The last two are observations, not recommendations, and the document is built
that way.** They carry status OK because they describe where space is sitting,
not a threshold anybody breached. Free space inside a datafile is not
automatically reclaimable: the high-water mark decides that and is not in the
view, which the report says on its face rather than leaving to be assumed.

**It reports on ONE container**, the one your session is connected to, and names
that container in its first row. To cover a whole CDB, run it once per
container.

## Running it

    cp config.env config-mydb.env      # edit ORACLE_SID, ORACLE_HOME, thresholds
    ./daily_analysis.sh --config config-mydb.env
    ./tbs_manager.sh --config config-mydb.env

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

`prompts/morning-triage.md` and `prompts/tablespace-capacity.md` contain prompts
to paste alongside the JSON. Each teaches your assistant the SHAPE of the
document it goes with, and deliberately does not
recite Oracle version behaviour, because a prompt reciting half-remembered
facts is how a confident wrong answer gets made. It also does not ask your
assistant for commands to paste at a production database.

Your assistant, your subscription, your data. Nothing in this pack transmits
anything anywhere, and OraDiscuss never receives your output.

## What is not here, and why

`redef_assistant` from the earlier field-test set is not in this pack. It
creates a table, and everything sold here is read-only.

`tbs_manager` IS here, but only its report. The earlier version also generated
statements to add a datafile, resize one, or change an autoextend policy. Those
paths printed by default and ran only with an explicit flag, so they were
careful, and they were removed anyway. The sentence this pack is sold on is
"read every line and you will find no way for this to touch your database", and
that sentence with a footnote attached is worth less than the feature was.
