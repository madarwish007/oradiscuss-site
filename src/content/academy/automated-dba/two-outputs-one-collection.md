---
course: automated-dba
module: "A2. Handing it to your own AI: the briefing, its schema, and prompts that do not invent"
order: 1
title: "Two outputs from one collection, and what the second one is for"
summary: A collector writes an HTML report and a JSON briefing beside it. This lesson explains what the briefing is, why both come from one pass over the database, and why the file stays on your machine.
estimatedMinutes: 30
prerequisites:
  - The OraDiscuss Health Check pack unpacked somewhere you can read it.
  - A bash shell, and python3 on the machine you run the lab on. python3 is used only to print JSON readably.
oracleVersions:
  - 19c
  - 26ai
lastReviewed: 2026-08-09
draft: false
---

## What this lesson answers

You ran a collector. It wrote a report you can read, and it wrote a JSON file
beside it that you did not ask for. What is the JSON, who is it for, and why is
it not the same information twice?

## Applicability

**Releases.** The lab in this lesson contacts no database at all, so nothing in
it depends on your release. It replays a collection that is written by hand, in
the collector's own raw format, through the shipped parser.

**Edition.** Not applicable to the lab, for the same reason.

**Pack the lab uses.** The OraDiscuss Health Check pack, v1.0.0, specifically
`health_check.sh` and `lib/odc_briefing.sh`. Both are part of the membership.
The pack is read-only: it issues no DDL and no DML, and the lab below does not
contact a database in any case.

**What the collectors themselves say about releases.** `health_check.sh` states
in its own header that it is written for Oracle 19c and 21c on Linux;
`rca_generator.sh` and the Daily Operations collectors state 19c, 21c and 23ai
on Linux. Those are the packs' claims about the packs, quoted here rather than
restated, and the release name Oracle uses for the current long term support
release has since moved on again.

**Oracle licensed options.** This lesson touches none. Later lessons in this
module do, and say so where they do.

## The mechanism

A collector reads the database once and writes twice.

```text
one collection  ->  report.html    for you
                ->  briefing.json  for whichever AI assistant you already pay for
```

The single pass is the part that matters, and it is a correctness property rather
than a performance one. If the human report and the machine briefing came from
two separate collections, they would describe the database at two different
moments, and the first time they disagreed you would have no way to tell which
one was wrong. In `health_check.sh` the raw collector file is read twice by the
shell, but the database is queried once, and the comment in the shipped source
says exactly that.

The raw file in between is a plain text format you can read with your eyes:

```text
SEC|<section title>
CHK|<check id>|<status>|<title>|<detail>
MET|<check id>|<metric name>|<value>|<unit>
```

The collector SQL prints those lines. Here is a shipped example, from
`sql/health_check.sql`, which builds one `CHK` line per tablespace:

```sql
SELECT 'CHK|TS_' || m.tablespace_name || '|' ||
       CASE WHEN m.used_percent >= &ODC_TS_CRIT THEN 'CRIT'
            WHEN m.used_percent >= &ODC_TS_WARN THEN 'WARN'
            ELSE 'OK' END ||
       '|Tablespace ' || m.tablespace_name || '|' ||
       ROUND(m.used_percent, 1) || '% used (' ||
       ROUND(m.tablespace_size * tp.bytes / 1024 / 1024 / 1024, 1) || ' GB max, ' ||
       ROUND(m.used_space   * tp.bytes / 1024 / 1024 / 1024, 1) || ' GB used)'
FROM dba_tablespace_usage_metrics m
CROSS JOIN (SELECT TO_NUMBER(p.value) AS bytes
            FROM v$parameter p WHERE p.name = 'db_block_size') tp
WHERE m.tablespace_name NOT IN (
        SELECT tablespace_name FROM dba_tablespaces WHERE status = 'OFFLINE')
ORDER BY m.used_percent DESC;
```

That is worth reading closely, because it tells you what the briefing can and
cannot contain. The status is decided in the SQL, against thresholds passed in
from your own config file. Nothing downstream re-decides it.

The briefing itself is assembled by `lib/odc_briefing.sh`, which is pure bash. The
reason is stated in the file: `jq` is not installable on many database hosts, and
a pack that needs it is a pack that cannot run where it matters. The dependency
surface is bash and SQL\*Plus and nothing else.

Two fields in the header of every briefing carry the position the whole product
stands on, and they are in the data rather than only in the documentation so that
a consumer can assert them instead of trusting them:

```json
"read_only": true,
"data_residency": "This file was written on the machine that ran the collector. OraDiscuss never receives it."
```

The file is written into your output directory, on your host. Nothing in the pack
transmits it. When you hand it to an assistant, you are handing your own file to
your own account, and that is a decision you take deliberately, once per file.

## At the terminal

The whole lab replays a collection through the shipped parser. No database is
contacted, which means you can run it on the lab estate or on a laptop.

**Setup.** Create a lab directory, and point a variable at wherever you unpacked
the Health Check pack.

```bash
ODC_PACK=/opt/oradiscuss/healthcheck    # wherever you unpacked it
LAB="$HOME/odc-lab-briefing"
mkdir -p "$LAB"
cd "$LAB"
```

Write a config file for the lab, so nothing touches the config you use for real
collections:

```bash
cat > "$LAB/lab_config.env" <<CFG
ORACLE_SID=LABDB
ORACLE_HOME=/nonexistent
ORACLE_CONNECT="/ as sysdba"
OUTPUT_DIR=$LAB
TS_WARN_PCT=85
TS_CRIT_PCT=95
ASM_WARN_PCT=80
ASM_CRIT_PCT=90
FRA_WARN_PCT=80
FRA_CRIT_PCT=90
RMAN_FULL_MAX_AGE_HOURS=30
RMAN_ARCH_MAX_AGE_HOURS=8
INVALID_OBJ_WARN=1
RETENTION_DAYS=30
CFG
```

Now write a collection by hand. This is the raw format the SQL above prints, and
writing it yourself is the fastest way to understand what the parser is given.
The quoted heredoc marker matters: it stops the shell from touching the
backslashes.

```bash
cat > "$LAB/lab_collection.txt" <<'RAW'
SEC|Instance and database
CHK|INSTANCE|OK|Instance status|LABDB OPEN, ARCHIVELOG, "primary" role
SEC|Tablespace usage
CHK|TS_USERS|WARN|Tablespace USERS|87.3% used (100 GB max, 87.3 GB used)
CHK|TS_UNDOTBS1|CRIT|Tablespace UNDOTBS1|96.8% used (16 GB max, 15.5 GB used)
CHK|TS_BADLOCALE|WARN|Tablespace BADLOCALE|87,3% used, written by a session with a decimal comma
SEC|Alert log
CHK|ALERT_WINDOWS_PATH|NA|Recent ORA- sample|ORA-27037: unable to obtain file status for D:\oracle\oradata\LABDB\undotbs01.dbf
CHK|ALERT_QUOTED_NAME|NA|Recent ORA- sample|ORA-19809: limit exceeded for recovery files, "db_recovery_file_dest_size" reached
CHK|ALERT_PIPE_INSIDE|NA|Recent ORA- sample|ORA-00060: deadlock detected while waiting: session 42 held "TX" mode 6 | waiter 77 wants mode 4
MET|TS_USERS|used_pct|87.3|percent
MET|TS_USERS|used_gb|87.3|GB
MET|TS_USERS|max_gb|100.0|GB
MET|TS_UNDOTBS1|used_pct|96.8|percent
MET|TS_BADLOCALE|used_pct|87,3|percent
RAW
```

**The lab.** Replay it.

```bash
bash "$ODC_PACK/health_check.sh" \
  --config "$LAB/lab_config.env" \
  --render-only "$LAB/lab_collection.txt"
```

Captured from a `--render-only` replay of the collection above, on 9 August 2026,
with the lab directory paths shortened to fit. No database was contacted; the
collection is written by hand and is synthetic.

```text
[health_check] render-only: rebuilding outputs from .../lab_collection.txt, the database is not contacted
[health_check] report written: .../reports/health_LABDB_20260809-045542.html
[health_check] briefing written: .../reports/health_LABDB_20260809-045542.json
[health_check] overall status: CRIT (exit 2)
[health_check] hand the briefing to your own AI with a prompt from prompts/ - nothing left this machine.
```

Two files, one timestamp, one collection:

```bash
ls -1 "$LAB/reports"
```

```text
health_LABDB_20260809-045542.html
health_LABDB_20260809-045542.json
health_LABDB_latest.html
health_LABDB_latest.json
```

The timestamp is the same in both names because both were built from the same
pass. The `latest` entries are symlinks, which is what makes a cron job and a
human able to name the same file.

Now read the header of the briefing:

```bash
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(json.dumps({k:d[k] for k in ('schema_version','kind','generator','collection')}, indent=2))" \
  "$LAB/reports/health_LABDB_latest.json"
```

Captured from the same replay:

```json
{
  "schema_version": "1.1",
  "kind": "state",
  "generator": {
    "vendor": "OraDiscuss",
    "source": "https://oradiscuss.com",
    "pack": "healthcheck",
    "pack_version": "1.0.0",
    "script": "health_check.sh",
    "notice": "Generated locally by OraDiscuss tooling. Not produced by, affiliated with, or endorsed by Oracle Corporation."
  },
  "collection": {
    "generated_at": "2026-08-09T04:55:42+0300",
    "oracle_sid": "LABDB",
    "read_only": true,
    "collector_exit_code": 2,
    "data_residency": "This file was written on the machine that ran the collector. OraDiscuss never receives it."
  }
}
```

Every field there answers a question an assistant would otherwise guess at: which
contract this document follows, which question it answers, which script wrote it,
when, against which SID, and whether anything was written to the database.

**Teardown.**

```bash
rm -rf "$LAB"
```

That removes only the directory the setup created. Nothing else was touched, and
the pack directory was read and never written.

## Read it wrong

**A replay is not always purely a replay, and this collector is an example.**
`health_check.sh` builds its listener row in the shell rather than in the SQL, and
that code runs under `--render-only` as well. If `lsnrctl` is on your PATH, the
replay runs `lsnrctl status` on the machine you are replaying on. On the capture
above it was not on the PATH, so the row came back WARN with the detail
`lsnrctl not available - listener state unknown`. Read that row as a statement
about the machine doing the replaying, never as part of the collection you
handed it. It is also the reason to run these labs on the lab estate rather than
on a production database host.

**`overall_status` is a summary, not a diagnosis.** It is the worst status in the
document, promoted upward. It tells you that something in here is CRIT. It does
not tell you which thing, how long it has been true, or whether it matters on
your estate. That last judgement is yours, and the pack does not make it.

**The exit code and the document agree on purpose.** `collector_exit_code` in the
briefing is the same number the shell returned. If you ever see them disagree, the
run produced two outputs from two different states and neither can be trusted.
The shipped code treats a briefing that could not be written as a failed run for
the same reason: half a run that reports success is worse than a run that fails.

**"Read only" is a claim about the pack, not about your account.** The pack issues
no DDL and no DML. It says nothing about what else on your host could. If you want
to hold the pack to it, the assertion is in the data, at `collection.read_only`.

## Check your work

Two observables, and both are falsifiable.

**One.** Both files exist, and their names share a timestamp:

```bash
ls "$LAB"/reports/health_LABDB_*.html "$LAB"/reports/health_LABDB_*.json
```

If a timestamp appears on one and not the other, they did not come from one
collection.

**Two.** The exit code recorded inside the briefing equals the exit code the shell
returned:

```bash
bash "$ODC_PACK/health_check.sh" --config "$LAB/lab_config.env" \
  --render-only "$LAB/lab_collection.txt" >/dev/null 2>&1
echo "shell said: ${?}"
python3 -c "import json,sys; print('document says:', json.load(open(sys.argv[1]))['collection']['collector_exit_code'])" \
  "$LAB/reports/health_LABDB_latest.json"
```

Both print 2 for the collection above, because it carries a CRIT check. Now change
the `TS_UNDOTBS1` line from CRIT to OK and rerun. On the machine this was captured
on, both printed 1, the WARN rows remaining. Your listener row can hold that
number higher, for the reason the first item of "Read it wrong" gives, so the
value is not the thing to check.

The invariant is the equality. Whatever the number is, the shell and the document
must agree on it. If they ever differ, the two outputs of that run are describing
different states, and neither can be trusted.

## Where this goes next

This lesson makes no claim about Oracle behaviour, so it cites no Oracle
documentation. What it does depend on ships with your pack and is worth reading
in full: `schema/briefing.schema.json`, which is the contract, and
`lib/odc_briefing.sh`, which is the assembler and is roughly two hundred and
sixty lines of heavily commented bash.

The OraDiscuss Health Check pack, part of the membership, is the collector used
above.
