---
course: automated-dba
module: "Incident reconstruction: evidence, timeline, and the explanations that compete"
order: 2
title: The timeline, and the tiebreaker it cannot do without
summary: Alert log entries routinely share a second. A timeline sorted on the second alone tells one story on your machine and a different story on your colleague's, and neither of you finds out.
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

You have a list of things that happened and you want them in order. That sounds
like sorting by time, and it is not, because the events you care about most
during an incident are the ones that happened in the same second. This lesson is
about what a reconstructed timeline has to carry so that it means the same thing
on two machines, and about how to practise reading one without waiting for an
incident.

## Applicability

Written against Oracle Database 19c and Oracle AI Database 26ai, Enterprise
Edition. The collector is written for Linux. The lab runs anywhere bash runs and
contacts no database.

Tool: OraDiscuss RCA Generator Pack v1.0.0, `rca_generator.sh` and
`sql/rca_alertlog.sql`. The pack is read-only and is part of the membership.

This lesson reads the alert log tier only. It does not touch `DBA_HIST_*` views
and therefore raises no Diagnostics Pack question. Lesson four covers the tier
that does.

**What was checked on 9 August 2026.** Every command and every output block
below is from a real run on that date against RCA Generator Pack v1.0.0, on a
machine with no Oracle software installed. The Oracle column semantics in *The
mechanism* are cited to Oracle documentation fetched the same day, against both
the 19c and the 26ai Reference. No claim here has been checked against a running
instance by this project.

## The mechanism

A collection is a flat text stream, one record per line, fields separated by a
vertical bar. Events are the `EVT` records and their fields are, in order:

```text
EVT | seq | epoch | timestamp | source | severity | message
```

`seq` is assigned once, at collection time, in the order the source returned the
rows. `epoch` is seconds. `timestamp` is a formatted string. The renderer sorts
on `(epoch, seq)`.

**Why the tiebreaker exists.** An ORA- error and the trace file it wrote are
frequently recorded in the same second. So are a wave of errors from the same
event. Sort a set of same-second rows on the second alone and their relative
order is whatever the sort implementation on that machine happened to do with
equal keys. Two colleagues reading the same archived collection then read two
different stories, and nothing on either page tells them they disagree. The
sequence number removes the ambiguity by carrying the collection order forward
into the sort, so the timeline is a property of the collection rather than of the
machine that rendered it.

**Where the fields come from.** In the alert log tier the collector reads the
fixed table `X$DBGALERTEXT`. Oracle documents the view `V$DIAG_ALERT_EXT` over
the same alert log content, and that documentation is where the column meanings
in this lesson come from. `ORIGINATING_TIMESTAMP` is documented as the "Date and
time when the message was generated". On the 26ai Reference its type is given as
`TIMESTAMP(9) WITH TIME ZONE`, which is worth carrying into lesson five.

`MESSAGE_LEVEL` is documented as the "Level the message belongs to. Lower level
values imply higher severity for errors", with these values:

| Value | Name | Documented meaning |
|---|---|---|
| 1 | CRITICAL | critical errors |
| 2 | SEVERE | severe errors |
| 8 | IMPORTANT | important message |
| 16 | NORMAL | normal message |

Checked against both the 19c and the 26ai Oracle Database Reference on 9 August
2026, and the mapping is identical on both. The collector's filter of
`message_level <= 8` therefore keeps the first three rows of that table and
drops the fourth.

> **Undocumented, and treated as such.** `X$DBGALERTEXT` is a fixed table Oracle
> does not document. This lesson makes no claim about its columns or its
> behaviour across releases. What can be said is a fact about shipped code: the
> collector probes it once, and where it is not readable it records that and
> falls back to reading the text alert log, whose timestamps are parsed rather
> than queried.

## At the terminal

**Setup.** One directory, made by the lab and removed by teardown. Set `PACK` to
wherever you unzipped the pack.

```bash
# SETUP
PACK=~/rca
mkdir -p ~/rca-lab/timeline/archive && cd ~/rca-lab/timeline

cat > config-labdb.env <<'CONF'
ORACLE_SID=LABDB
ORACLE_HOME=/nonexistent
ORACLE_CONNECT="/ as sysdba"
LISTENER_NAME="LISTENER"
RCA_MAX_EVENTS=500
RCA_CORRELATION_WINDOW_SEC=600
OUTPUT_DIR="$HOME/rca-lab/timeline/out"
CONF
```

Now write the collection you are going to read. This is a constructed incident,
not a captured one: the numbers are plainly illustrative and no database
produced them. Writing it by hand is the point, because a format you have typed
once is a format you can read under pressure.

```bash
# SETUP, continued: a constructed collection, written by hand.
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

Read the four event lines before you render them. They are deliberately not in
order in the file, and two of them carry the same epoch and the same formatted
timestamp.

**The lab.** Replay the collection. Nothing is contacted.

```bash
bash "$PACK/rca_generator.sh" --config config-labdb.env \
     --render-only archive/rca_raw_LABDB_lesson.txt
```

Captured output, 9 August 2026, pack v1.0.0, machine with no Oracle software:

```text
[rca_generator] render-only: rebuilding outputs from archive/rca_raw_LABDB_lesson.txt, nothing is contacted
[rca_generator] report written: .../out/rca/rca_LABDB_20260809-044352.html
[rca_generator] briefing written: .../out/rca/rca_LABDB_20260809-044352.json
[rca_generator] window 2026-08-08 03:00:00 to 2026-08-08 04:00:00, 4 events, collection status WARN
```

Read the timeline out of the briefing. The pack maintains a symlink with a
stable name, so this works without knowing the timestamp in the filename.

```bash
grep -o '"seq":[0-9]*' out/rca/rca_LABDB_latest.json | tee first.txt
```

Captured:

```text
"seq":1
"seq":2
"seq":3
"seq":4
```

The file gave them as 3, 1, 4, 2. The timeline gives them as 1, 2, 3, 4.

**Now break the file order on purpose.** Open
`archive/rca_raw_LABDB_lesson.txt` in your editor and move the four `EVT` lines
into a different order among themselves. Change nothing else, and change no
field inside any line. Save it as a second file so the first survives:

```bash
cp archive/rca_raw_LABDB_lesson.txt archive/rca_raw_LABDB_shuffled.txt
# now edit archive/rca_raw_LABDB_shuffled.txt and reorder its four EVT lines
bash "$PACK/rca_generator.sh" --config config-labdb.env \
     --render-only archive/rca_raw_LABDB_shuffled.txt
grep -o '"seq":[0-9]*' out/rca/rca_LABDB_latest.json | tee second.txt
```

**Teardown.**

```bash
cd ~ && rm -rf ~/rca-lab/timeline
```

## Read it wrong

**The timeline is complete only about the tiers that ran.** This collection
carries an `NA` on the operating system tier. Every event in the timeline is
real, and the timeline is still not the incident: it is the part of the incident
that a readable tier happened to record. Lesson four is about that gap, and it
is the single most common way a reconstructed timeline misleads a careful
reader.

**`seq` orders within one collection, and only within one collection.** It is
assigned by the collection that produced it. Two collections from two nodes each
have their own sequence starting from one, so concatenating them and sorting on
`(epoch, seq)` produces an order that is arbitrary wherever their epochs tie.
The pack does not merge collections, and this is one of the reasons.

**Same second does not mean same cause.** The tiebreaker fixes the ordering so
that everyone reads the same sequence. It does not promote that sequence into a
relationship. Two entries in the same second, ordered by collection order, are
two entries in the same second.

**A dropped level is not an absent event.** The collector keeps
`message_level <= 8`, so normal messages are filtered out at the database. The
event you are looking for might be recorded at level 16 and therefore absent
from a timeline that is otherwise complete. That is a filter you chose by using
this tool, and it is a fair thing to go back and widen once you know what you
are hunting.

**Formatted time and epoch can disagree, and the collection will not tell you.**
Both are written at collection time, from the same row. If you hand-edit a
collection, as you did in this lab, you can produce a file where the string says
one thing and the epoch says another. The renderer sorts on the epoch and prints
the string. Lesson five is about why the string is carried rather than computed.

## Check your work

1. The first render printed `"seq":1` through `"seq":4` in that order, from a
   file that listed them 3, 1, 4, 2.
2. The second render, from your reordered file, printed exactly the same four
   lines in exactly the same order. The two `tee` commands above kept them, so
   make it mechanical: `diff first.txt second.txt` prints nothing when they
   match, and prints the disagreement when they do not.
3. The two events sharing epoch `1754620842` came out as `seq` 3 then 4, which
   is their collection order, not their file order. If your reordered file put 4
   above 3 and the output still reads 3 then 4, the tiebreaker did the work.

If the two renders disagree, check that you changed only the order of whole
lines. Editing a field inside a line changes the collection, and then you are
comparing two different collections rather than two orderings of one.

## Where this goes next

- Oracle Database Reference 19c, *V$DIAG_ALERT_EXT*:
  `https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/V-DIAG_ALERT_EXT.html`
- Oracle AI Database 26ai Reference, *V$DIAG_ALERT_EXT*:
  `https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/V-DIAG_ALERT_EXT.html`

The OraDiscuss RCA Generator Pack automates this same collection and is included
in the membership.
