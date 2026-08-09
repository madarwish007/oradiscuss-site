---
course: automated-dba
module: "A2. Handing it to your own AI: the briefing, its schema, and prompts that do not invent"
order: 3
title: "NA is not OK, and a briefing full of it is describing an incomplete collection"
summary: The single most important thing to know about reading these documents. NA means a check could not be determined, it is counted apart from OK, it never reaches needs_attention, and a reader who misses that will report a clean bill of health over a collection that read almost nothing.
estimatedMinutes: 45
prerequisites:
  - The OraDiscuss Health Check pack and the RCA Generator pack unpacked somewhere you can read them.
  - A bash shell, and python3 on the machine you run the lab on.
oracleVersions:
  - 19c
  - 26ai
lastReviewed: 2026-08-09
draft: false
---

## What this lesson answers

My briefing says the overall status is fine and nothing needs attention. How much
of the database did it actually manage to look at?

## Applicability

**Releases.** The lab contacts no database, so nothing in it depends on your
release. It replays two collections written by hand through two shipped parsers.

**Edition.** Not applicable to the lab. In the field, the account a collector runs
as decides more of this than the edition does.

**Packs the lab uses.** The OraDiscuss Health Check pack, v1.0.0, and the
OraDiscuss RCA Generator pack, v1.0.0. Both are part of the membership, both are
read-only, and neither contacts a database in this lab.

**Oracle licensed options.** One line in the incident collection below names
`control_management_pack_access` and the `DBA_HIST` views. Those views are part
of the Oracle Diagnostics Pack, licensed separately on Enterprise Edition.
Oracle's documentation states it: "Some of the products and tools in the
preceding list, including Oracle Diagnostics Pack and Oracle Tuning Pack, require
separate licenses." (*Tools for Tuning the Database*,
`https://docs.oracle.com/en/database/oracle/oracle-database/26/tdppt/tools-tuning-database.html`,
read 9 August 2026.) A collector that finds it is not licensed to read those views
records an NA and moves on, which is precisely the case this lesson is about.
Nothing in this lab reads them.

## The mechanism

A check carries one of four statuses.

| Status | Meaning |
|---|---|
| OK | Measured, and inside the threshold you configured |
| WARN | Measured, and past your warn threshold |
| CRIT | Measured, and past your crit threshold |
| NA | **Could not be determined** |

Three of those are measurements. The fourth is the absence of one.

NA is where a check lands when the account lacked a grant, a view was not
accessible, a binary was not on the PATH, an optional feature is not installed,
or a licensed option was not available to read. In every one of those cases the
honest report is that nothing was learned, and the wrong report is a pass.

Two things follow from that in the document itself.

**NA is counted separately.** `summary.counts` carries four numbers, not three:

```json
"counts": { "OK": 0, "WARN": 0, "CRIT": 0, "NA": 6 }
```

The schema states the consequence in its own words: a briefing with a high NA
count describes an incomplete collection, and an assistant reading it should say
so rather than report a clean bill of health.

**NA never reaches `needs_attention`.** That array holds every WARN and every
CRIT, in collection order, and the schema explains the exclusion in five words:
unknown is not the same as wrong. It would be dishonest to list an unread check
beside a measured problem, because you cannot rank a thing you did not measure.

Now hold both of those in your head at once, because together they produce the
trap this whole lesson exists for:

> A collection in which nothing at all could be read has an **empty**
> `needs_attention` array.

Not a short one. Empty. A consumer that reads `needs_attention`, finds nothing,
and reports that all is well has done exactly what the field permits and exactly
the opposite of what the document means. The one field that would have told it
otherwise is `counts.NA`, and reading it is not optional.

**The two collectors treat NA differently in `overall_status`, and both are
right.** In `health_check.sh`, `overall_status` is promoted by WARN and by CRIT
only. There is no NA branch, and you can read that in the shipped source: the
`case` statement over each status has arms for CRIT and WARN and nothing else. In
`rca_generator.sh`, any NA at all forces the collection status to at least WARN,
and the shipped comment says why:

> For a state briefing an NA among thirty OK checks should not flip the summary.
> For an INCIDENT collection it must: the pack's whole thesis is that a tier
> nobody read is not a tier that was clean.

That difference is worth understanding rather than memorising. A state briefing
answers "what is true now", and one unreadable check among many does not change
what the others measured. An incident collection answers "what happened", where
an unread tier is a hole in the story rather than a missing row in a table. Same
field, same schema, different meaning, and the collector that knows which document
it is writing is the one that decides.

Note what did **not** change between them: neither collector puts NA into
`needs_attention`. The exclusion is a property of the contract, not of a
collector's mood.

## At the terminal

Two replays. The first is a state collection in which nothing could be read. The
second is an incident collection in the same condition.

**Setup.**

```bash
ODC_PACK=/opt/oradiscuss/healthcheck      # wherever you unpacked it
RCA_PACK=/opt/oradiscuss/rca              # wherever you unpacked it
LAB="$HOME/odc-lab-na"
mkdir -p "$LAB"
cd "$LAB"

cat > "$LAB/state_config.env" <<CFG
ORACLE_SID=LABDB
ORACLE_HOME=/nonexistent
ORACLE_CONNECT="/ as sysdba"
OUTPUT_DIR=$LAB/state
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

cat > "$LAB/incident_config.env" <<CFG
ORACLE_SID=LABDB
ORACLE_HOME=/nonexistent
ORACLE_CONNECT="/ as sysdba"
OUTPUT_DIR=$LAB/incident
RCA_MAX_EVENTS=500
RCA_CORRELATION_WINDOW_SEC=600
CFG
```

The blind state collection. Six checks, none of them readable. This is what a
collector writes when it runs as an account that holds none of the grants it
needs:

```bash
cat > "$LAB/blind_collection.txt" <<'RAW'
SEC|Instance and database
CHK|INSTANCE|NA|Instance status|V$INSTANCE was not readable by this account
SEC|Tablespace usage
CHK|TS_USERS|NA|Tablespace USERS|DBA_TABLESPACE_USAGE_METRICS was not readable, so no tablespace was measured
CHK|TS_UNDOTBS1|NA|Tablespace UNDOTBS1|DBA_TABLESPACE_USAGE_METRICS was not readable, so no tablespace was measured
SEC|Archivelog and FRA
CHK|FRA_USAGE|NA|FRA usage|V$RECOVERY_FILE_DEST was not readable by this account
SEC|RMAN backup recency
CHK|RMAN_FULL|NA|Last full backup|V$RMAN_BACKUP_JOB_DETAILS was not readable by this account
CHK|RMAN_ARCH|NA|Last archivelog backup|V$RMAN_BACKUP_JOB_DETAILS was not readable by this account
RAW
```

The blind incident collection. Three tiers, none readable, and one event that did
reach the timeline:

```bash
cat > "$LAB/blind_incident.txt" <<'RAW'
WIN|2026-08-08 02:00:00|2026-08-08 06:00:00|--at 2026-08-08 04:00, widened to plus and minus 2 hours
SEC|Collection status
CHK|OSTIER|NA|Operating system tier|skipped. Running as oracle, which cannot read the system logs, and no passwordless sudo is available.
CHK|AWR|NA|Workload evidence|control_management_pack_access is "NONE", so DBA_HIST views were not read.
CHK|ADRINC|NA|ADR incidents|adrci was not found on the PATH, so Oracle's own incident records were not read.
EVT|1|1754640042|2026-08-08 03:20:42|alert-log|SEVERE|ORA-01578: ORACLE data block corrupted (file # 7, block # 1234)
RAW
```

**The lab.** Replay the state collection first.

```bash
bash "$ODC_PACK/health_check.sh" --config "$LAB/state_config.env" \
  --render-only "$LAB/blind_collection.txt"

python3 -c "import json,sys; print(json.dumps(json.load(open(sys.argv[1]))['summary'], indent=2))" \
  "$LAB/state/reports/health_LABDB_latest.json"
```

Captured from a `--render-only` replay on 9 August 2026. No database was
contacted; the collection is written by hand and is synthetic.

```json
{
  "overall_status": "WARN",
  "counts": {
    "OK": 0,
    "WARN": 1,
    "CRIT": 0,
    "NA": 6
  },
  "needs_attention": [
    "LISTENER"
  ]
}
```

Read that carefully before going on. Six checks came back NA. Not one of them
appears in `needs_attention`. The single id that does appear is `LISTENER`, and
`LISTENER` is not in the collection you wrote at all: `health_check.sh` builds
that row in the shell, on the machine doing the replaying. On the capture above
`lsnrctl` was not on the PATH, so it reported WARN.

So the only thing this document nominates for your attention is the only thing
that did not come from the database, and the six checks that did come from the
database are silent because nothing could be read.

Now the incident side.

```bash
bash "$RCA_PACK/rca_generator.sh" --config "$LAB/incident_config.env" \
  --render-only "$LAB/blind_incident.txt"

python3 -c "import json,sys; print(json.dumps(json.load(open(sys.argv[1]))['summary'], indent=2))" \
  "$LAB/incident/rca/rca_LABDB_latest.json"
```

Captured from the same session:

```text
[rca_generator] window 2026-08-08 02:00:00 to 2026-08-08 06:00:00, 1 events, collection status WARN
[rca_generator] collection completeness: 3 of 3 checks could not be read, so this collection is incomplete
```

```json
{
  "overall_status": "WARN",
  "counts": {
    "OK": 0,
    "WARN": 0,
    "CRIT": 0,
    "NA": 3
  },
  "needs_attention": []
}
```

There it is with nothing else in the frame. Zero OK, zero WARN, zero CRIT, three
NA, and `needs_attention` is an empty array. The collector says the collection is
incomplete in its own log line and in its report, and the summary block on its own
would let a careless reader conclude that nothing needs doing.

Both documents still carry the truth. It is in `counts.NA`, and in the `detail`
string of each NA check, which names what would make that tier readable.

```bash
python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
for c in d['checks']:
    if c['status'] == 'NA':
        print(c['id'], '->', c['detail'])
" "$LAB/incident/rca/rca_LABDB_latest.json"
```

```text
OSTIER -> skipped. Running as oracle, which cannot read the system logs, and no passwordless sudo is available.
AWR -> control_management_pack_access is "NONE", so DBA_HIST views were not read.
ADRINC -> adrci was not found on the PATH, so Oracle's own incident records were not read.
```

Three sentences, three different reasons, three different fixes. That is the most
useful paragraph in an incomplete briefing, and it is the paragraph a summary
badge cannot carry.

**Teardown.**

```bash
rm -rf "$LAB"
```

## Read it wrong

**An absent tier is not a clean tier.** A window with no operating system errors,
because the operating system tier was never read, tells you nothing about the
operating system. The shipped incident prompt states that rule to your assistant
in those words, and it is the rule most worth carrying into work that has nothing
to do with these packs.

**NA is not a failure either.** It is genuinely neutral. A check can be NA because
an optional feature is not installed, because a view is empty on this release,
because the collector ran as an account that was deliberately given less. Treating
every NA as a defect produces a different bad habit: a report nobody reads because
it is always red. What NA obliges you to do is say what was not measured, not to
raise an alarm about it.

**The completeness ratio is yours to compute, and it is the number to lead with.**
`counts.NA` divided by the total of all four counts is how much of the collection
came back unknown. Neither document prints that ratio as a field. The incident
collector prints a sentence version of it in its own log and report, and the state
collector does not.

**A high NA count changes what the rest of the document can support.** If half the
checks are unknown, a CRIT on one of the others is still a real measurement, and
the absence of a second CRIT is not evidence of anything. Ranking is only
meaningful over what was measured, and the size of what was not measured is what
tells you how far the ranking can be trusted.

**`overall_status` will not save you.** In the state document above it read WARN,
and the WARN came from a listener probe on the replaying machine rather than from
any of the six unreadable checks. It is a promoted worst-status, not an assessment
of the collection.

## Check your work

**One.** The NA count equals the number of NA checks you wrote, and none of them
was nominated for attention:

```bash
python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
mine = [c['id'] for c in d['checks'] if c['status'] == 'NA']
print('NA count      :', d['summary']['counts']['NA'])
print('NA ids        :', mine)
print('overlap with needs_attention:', [i for i in mine if i in d['summary']['needs_attention']])
" "$LAB/incident/rca/rca_LABDB_latest.json"
```

This prints an NA count of 3, the three ids you wrote, and an empty overlap. The
overlap is the falsifiable part: if any NA id ever appears in `needs_attention`,
the document is claiming to have ranked something it never measured.

**Two.** Watch the count move. Edit `blind_incident.txt`, change the `ADRINC` line
from `NA` to `OK`, replay, and read the summary again. `counts.NA` goes to 2, the
completeness line in the collector's own output changes to say 2 of 3, and
`needs_attention` stays empty because an OK check does not need attention either.
Two of the three numbers you are watching moved and the third did not, which is
what tells you the three are independent.

## Where this goes next

Oracle documentation cited in part 2, for the licensing fact only:

- *Tools for Tuning the Database*, Oracle Database documentation, 26,
  `https://docs.oracle.com/en/database/oracle/oracle-database/26/tdppt/tools-tuning-database.html`

Everything else here is in files that ship with your packs. Read the `NA`
description in `schema/briefing.schema.json`, under `summary.counts`, and the
paragraph about NA in `prompts/README.md`, which calls it the honesty field.

The OraDiscuss Health Check pack and the OraDiscuss RCA Generator pack, both part
of the membership, are the collectors used above.
