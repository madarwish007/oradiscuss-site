---
course: automated-dba
module: "Incident reconstruction: evidence, timeline, and the explanations that compete"
order: 4
title: A tier nobody read is not a tier that was clean
summary: During an incident, "we found no operating system errors" and "we never read the operating system logs" are completely different answers, and a report that renders them the same way is worse than no report.
estimatedMinutes: 35
prerequisites:
  - The OraDiscuss RCA Generator Pack v1.0.0, unzipped somewhere you can read.
  - A bash shell and a text editor. This lesson contacts no database.
oracleVersions:
  - 19c
  - 26ai
lastReviewed: 2026-08-09
---

## What this lesson answers

You are three hours into an incident and somebody asks whether the storage layer
showed anything. You look at your collection and there are no operating system
errors in it. What can you honestly say? The answer depends entirely on whether
that tier was read and found nothing, or was never read at all, and most tooling
renders those two states identically. This lesson is about how a collection
records the difference and why an incomplete collection must never present
itself as a clean one.

## Applicability

Written against Oracle Database 19c and Oracle AI Database 26ai, Enterprise
Edition. The collector is written for Linux. The lab runs anywhere bash runs and
contacts no database.

Tool: OraDiscuss RCA Generator Pack v1.0.0, `rca_generator.sh`. The pack is
read-only and is part of the membership.

**Licence, before the first command.** One of the seven tiers reads
`DBA_HIST_*` views, which are licensed with the Oracle Diagnostics Pack,
separately from the database on Enterprise Edition. Oracle's documentation
states it: "Some of the products and tools in the preceding list, including
Oracle Diagnostics Pack and Oracle Tuning Pack, require separate licenses."
(*Tools for Tuning the Database*, Oracle AI Database 26ai, linked below, fetched
9 August 2026.) The collector reads the `control_management_pack_access`
parameter first and, where it does not permit those views, records an `NA` check
naming the pack rather than running the query. That check is a statement about
which views were read. It is not advice about what you should license, and this
lesson does not offer any. Without that pack you have no workload tier, and the
alert log, ADR incident, listener and operating system tiers are unaffected.

**What was checked on 9 August 2026.** Every output block below is from a real
run on that date against pack v1.0.0, on a machine with no Oracle software
installed. The parameter semantics in *The mechanism* are cited to Oracle
documentation fetched the same day against both the 19c and 26ai Reference. No
claim here has been checked against a running instance by this project.

## The mechanism

The collection carries seven tiers, and each of them emits a check on every run
whether or not it managed to read anything. A check has a status, and the four
statuses are not four grades of the same thing:

- `OK` means the tier was read.
- `WARN` and `CRIT` mean the tier was read and something in it crossed a
  threshold.
- `NA` means the tier could not be determined, and the check says what would
  make it determinable.

That last clause is the design. An `NA` check is not a shrug. The operating
system tier's `NA` names the account it ran as and says that passwordless sudo
would include it. The workload tier's `NA` names the parameter value it found
and the pack that governs it. The ADR incident tier's `NA` says whether `adrci`
was missing from the path or whether no ADR home resolved. Each one is a
sentence somebody can act on tomorrow, which is more useful during a
reconstruction than a silent gap is ever going to be.

**`control_management_pack_access` is the gate on the workload tier.** Oracle
documents it as specifying "which of the Server Manageability Packs should be
active", with values `NONE`, `DIAGNOSTIC` and `DIAGNOSTIC+TUNING`, and it notes
that a license for `DIAGNOSTIC` is required for enabling the `TUNING` pack. The
26ai Reference states the default as `DIAGNOSTIC+TUNING` for Enterprise Edition
and for Oracle AI Database Free, and `NONE` for other editions. Both Reference
pages were fetched on 9 August 2026 and agree on the values.

**And then the part most tools get wrong.** For a state-of-the-database
briefing, one `NA` among thirty checks should not flip the overall status: it is
a gap in a survey. For an **incident** collection it must, and in this pack it
does. Any `NA` raises the overall status to `WARN` and the exit code to 1, even
when no check failed. The reasoning is written into the collector itself: the
pack's whole thesis is that a tier nobody read is not a tier that was clean, and
printing `OK` over two unread tiers would be the report making exactly the
mistake it exists to prevent.

The status is also derived at render time rather than during collection, so that
replaying an archived collection reaches the same verdict as the original run.
An earlier version tracked the flag while collecting and applied it after the
summary had been computed, which produced a document saying `OK` while the exit
code said 1. Two outputs of one run disagreeing about whether the run succeeded
is the defect class this pack exists to expose, and it had shipped it.

## At the terminal

**Setup.**

```bash
# SETUP
PACK=~/rca
mkdir -p ~/rca-lab/na/archive && cd ~/rca-lab/na

cat > config-labdb.env <<'CONF'
ORACLE_SID=LABDB
ORACLE_HOME=/nonexistent
ORACLE_CONNECT="/ as sysdba"
LISTENER_NAME="LISTENER"
RCA_MAX_EVENTS=500
RCA_CORRELATION_WINDOW_SEC=600
OUTPUT_DIR="$HOME/rca-lab/na/out"
CONF

# A constructed collection. Four checks, one of which could not be read.
cat > archive/rca_raw_LABDB_lesson.txt <<'RAW'
WIN|2026-08-08 03:00:00|2026-08-08 04:00:00|--at 2026-08-08 03:30, widened to plus and minus 2 hours
SEC|Collection status
CHK|IDENT|OK|Instance identity|version 19.22.0.0.0, CDB=YES, role PRIMARY
CHK|NODESCOPE|OK|Node scope|This collection describes the node it ran on: labnode1.
CHK|OSTIER|NA|Operating system tier|skipped. Running as oracle, which cannot read the system logs, and no passwordless sudo is available.
SEC|Alert log
CHK|ALERT|OK|Alert log source|read through X$DBGALERTEXT, filtered on the window in the database
EVT|3|1754620842|2026-08-08 03:20:42|alert-log|SEVERE|ORA-01578: ORACLE data block corrupted (file # 7, block # 1234)
EVT|1|1754620800|2026-08-08 03:20:00|os-messages|OS-ERROR|kernel: I/O error, dev sdc, sector 88213344
EVT|4|1754620842|2026-08-08 03:20:42|alert-log|IMPORTANT|Errors in file /u01/app/oracle/diag/rdbms/labdb/labdb1/trace/labdb1_dbw0_4711.trc
EVT|2|1754620820|2026-08-08 03:20:20|alert-log|NORMAL|Thread 1 advanced to log sequence 4412
RAW
```

**The lab, first half: an incomplete collection.**

```bash
bash "$PACK/rca_generator.sh" --config config-labdb.env \
     --render-only archive/rca_raw_LABDB_lesson.txt > /dev/null 2>&1
echo "exit code: $?"
grep -o '"overall_status": "[A-Z]*"' out/rca/rca_LABDB_latest.json
```

Captured, 9 August 2026, pack v1.0.0:

```text
exit code: 1
"overall_status": "WARN"
```

Not one check failed. Three were read and one could not be. The whole summary
block, captured verbatim from the briefing that run wrote:

```json
  "summary": {
    "overall_status": "WARN",
    "counts": {
      "OK": 3,
      "WARN": 0,
      "CRIT": 0,
      "NA": 1
    },
    "needs_attention": []
  },
```

Read that carefully. `WARN` is zero and the overall status is `WARN`. The status
is not summarising findings. It is summarising completeness, and the counts are
printed beside it so nobody has to guess which.

The report says the same thing in words. From the HTML:

```text
1 of 4 checks could not be read, so this collection is incomplete
```

**The lab, second half: make the tier readable.**

Copy the collection, and in the copy replace the whole `CHK|OSTIER|NA|` line
with a version that says the tier was read:

```text
CHK|OSTIER|OK|Operating system tier|system logs captured to the appendix
```

```bash
cp archive/rca_raw_LABDB_lesson.txt archive/rca_raw_LABDB_osread.txt
# edit archive/rca_raw_LABDB_osread.txt as described, then:
bash "$PACK/rca_generator.sh" --config config-labdb.env \
     --render-only archive/rca_raw_LABDB_osread.txt > /dev/null 2>&1
echo "exit code: $?"
grep -o '"overall_status": "[A-Z]*"' out/rca/rca_LABDB_latest.json
```

Captured:

```text
exit code: 0
"overall_status": "OK"
```

and in the report:

```text
all 4 checks were read
```

The timeline did not change. The events did not change. The only thing that
changed is whether the document is entitled to describe itself as complete.

**Teardown.**

```bash
cd ~ && rm -rf ~/rca-lab/na
```

## Read it wrong

**`OK` does not mean the database is healthy.** It means every tier in this
collection was read. A collection can be `OK` and describe a catastrophe, and
the timeline sitting underneath it is where you would find that out. Reading the
overall status as a verdict on the estate is the single easiest mistake to make
with this document, and it is made by people who are in a hurry, which during an
incident is everybody.

**The `NA` count is a completeness measure, not a severity.** Four `NA` checks
are not worse than one in any clinical sense. They mean four tiers of evidence
are missing, and which four matters far more than how many. An unread alert log
and an unread listener log are not comparable losses.

**An unread tier is a hole in every ordering fact above it.** This is the part
worth carrying out of the module. When the earliest event in a collection is at
03:20:00, that is the earliest event the readable tiers recorded. If the
operating system tier was `NA`, the true first event may be earlier and you have
no way to know. The pack says exactly this in the reading attached to its
`first_event` fact, and it is the reason that fact exists at all.

**A licence gate is not a finding.** An `NA` on the workload tier says the
parameter did not permit reading `DBA_HIST_*` views. That is a fact about the
collection. It is not a statement that the estate is unlicensed, it is not a
recommendation to buy anything, and nothing in this lesson is either.

**Do not clear an `NA` by deleting the check.** You did the opposite of that in
the lab: you changed a check that said "not read" into one that said "read",
which is a claim about the collection and would be a lie if the tier really had
not run. In the lab it is a controlled experiment on a constructed file. Against
a real collection it would be falsifying evidence, and the reason it is so easy
to do here is worth remembering when somebody asks you to tidy up a report.

## Check your work

1. `echo "exit code: $?"` printed `1` after the first render and `0` after the
   second. If both printed `0`, your first collection did not contain the `NA`
   line. If both printed `1`, your edit did not take.
2. The first briefing carried `"overall_status": "WARN"` with `"WARN": 0` in its
   counts, and the second carried `"overall_status": "OK"`. Run
   `grep -o '"NA": [0-9]*' out/rca/rca_LABDB_latest.json` against each and
   confirm it reads `1` then `0`.
3. The HTML changed its completeness sentence from "1 of 4 checks could not be
   read, so this collection is incomplete" to "all 4 checks were read". Search
   the file for the word `checks` and read the sentence rather than trusting the
   badge colour.

## Where this goes next

- Oracle Database Reference 19c, *CONTROL_MANAGEMENT_PACK_ACCESS*:
  `https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/CONTROL_MANAGEMENT_PACK_ACCESS.html`
- Oracle AI Database 26ai Reference, *CONTROL_MANAGEMENT_PACK_ACCESS*:
  `https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/CONTROL_MANAGEMENT_PACK_ACCESS.html`
- Oracle AI Database 26ai, *Tools for Tuning the Database*:
  `https://docs.oracle.com/en/database/oracle/oracle-database/26/tdppt/tools-tuning-database.html`

The OraDiscuss RCA Generator Pack records every tier it could not read as a
named `NA` check and is included in the membership.
