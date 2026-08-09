---
course: automated-dba
module: "Incident reconstruction: evidence, timeline, and the explanations that compete"
order: 5
title: The archive you can still read in six months
summary: A collection is only evidence if replaying it later returns the same answer. That means the clock is carried rather than recomputed, the replay contacts nothing, and the raw file it read is left exactly as it found it.
estimatedMinutes: 30
prerequisites:
  - The OraDiscuss RCA Generator Pack v1.0.0, unzipped somewhere you can read.
  - A bash shell and a text editor. This lesson contacts no database.
  - Two timezone names your machine recognises. The lab uses Europe/Riga and America/New_York.
oracleVersions:
  - 19c
  - 26ai
lastReviewed: 2026-08-09
---

## What this lesson answers

The incident is closed. Six months later somebody asks what actually happened,
or a similar failure turns up and you want to compare. You still have the
collection. Can you trust what it tells you now, and can you prove that reading
it again did not change it? This lesson is about the properties a collection
needs to survive being read later, by somebody else, somewhere else.

## Applicability

Written against Oracle Database 19c and Oracle AI Database 26ai, Enterprise
Edition. The collector is written for Linux. The lab runs anywhere bash runs and
contacts no database.

Tool: OraDiscuss RCA Generator Pack v1.0.0, `rca_generator.sh`. The pack is
read-only and is part of the membership. This lesson reads no `DBA_HIST_*` view
and raises no Diagnostics Pack question.

**What was checked on 9 August 2026.** Every output block below is from a real
run on that date against pack v1.0.0, on a machine with no Oracle software
installed, including both timezone runs. The one Oracle fact used, the column
type of `ORIGINATING_TIMESTAMP`, is cited to the 26ai Reference fetched the same
day. No claim here has been checked against a running instance by this project.

## The mechanism

Three properties make a collection re-readable, and each is a decision that
could have gone the other way.

**The clock is carried, not recomputed.** Every event in a collection has both a
numeric epoch and a formatted timestamp string, and the string is produced at
collection time, on the machine that saw the incident. A renderer that formatted
the epoch itself would be correct on the day and wrong forever after, because
the same archived file opened in another timezone would print a different clock
for the same incident. The events would shift by hours and nothing on the page
would say so. Carrying the string costs a few bytes per event and removes the
whole class of problem. It also means a replay needs no date library at all.

This matters more on Oracle than the general argument suggests, because the
underlying column is timezone-bearing. The 26ai Reference gives
`V$DIAG_ALERT_EXT.ORIGINATING_TIMESTAMP` the type `TIMESTAMP(9) WITH TIME ZONE`
and describes it as the "Date and time when the message was generated". A value
with a zone in it, rendered by a process that has its own zone, is precisely
where a silent shift comes from.

**A replay contacts nothing.** Rendering from an archived collection resolves no
window, opens no connection, reads no log and touches no database. That is what
makes an old collection readable at all: the estate it came from may have been
patched, rebuilt or decommissioned, and none of that changes the document. It is
also what makes this whole module practisable, because you can rehearse reading
an incident without having one.

**The replay leaves the collection as it found it.** The raw collection is
input. Nothing appends to it, nothing rewrites it, and a second reader gets the
same file the first reader got. A render that grew the file it was reading would
make every replay differ from the last, which is a slow way to destroy an
archive without anybody noticing.

**The appendix is listed, not embedded.** Raw evidence such as an alert log
excerpt is written beside the report and recorded in the briefing as a name, a
byte count and a description. An alert log excerpt is routinely larger than
everything else in the document combined, so embedding it would make the
structured document unusable for the sake of material that is better read in a
pager. The consequence for archiving is the one to remember: **the manifest lists
the files that existed at collection time**, so if you archive the report without
its appendix directory, the document will still tell you exactly what is
missing.

## At the terminal

**Setup.**

```bash
# SETUP
PACK=~/rca
mkdir -p ~/rca-lab/archive-lesson/archive && cd ~/rca-lab/archive-lesson

cat > config-labdb.env <<'CONF'
ORACLE_SID=LABDB
ORACLE_HOME=/nonexistent
ORACLE_CONNECT="/ as sysdba"
LISTENER_NAME="LISTENER"
RCA_MAX_EVENTS=500
RCA_CORRELATION_WINDOW_SEC=600
OUTPUT_DIR="$HOME/rca-lab/archive-lesson/out"
CONF

# A constructed collection, with an appendix manifest line at the end.
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
APX|alertlog_window.txt|18422|raw evidence captured during collection
RAW
```

**The lab: read one archive in two timezones.** Record a checksum of the
collection first, so that the last step can prove nothing touched it.

```bash
cksum archive/rca_raw_LABDB_lesson.txt

TZ=Europe/Riga bash "$PACK/rca_generator.sh" --config config-labdb.env \
     --render-only archive/rca_raw_LABDB_lesson.txt > /dev/null 2>&1
grep -o '"timestamp":"[^"]*"' out/rca/rca_LABDB_latest.json > riga.txt

TZ=America/New_York bash "$PACK/rca_generator.sh" --config config-labdb.env \
     --render-only archive/rca_raw_LABDB_lesson.txt > /dev/null 2>&1
grep -o '"timestamp":"[^"]*"' out/rca/rca_LABDB_latest.json > newyork.txt

grep -c . riga.txt newyork.txt
diff riga.txt newyork.txt && echo "identical"
cksum archive/rca_raw_LABDB_lesson.txt
```

Captured, 9 August 2026, pack v1.0.0. Both extractions:

```text
"timestamp":"2026-08-08 03:20:00"
"timestamp":"2026-08-08 03:20:20"
"timestamp":"2026-08-08 03:20:42"
"timestamp":"2026-08-08 03:20:42"
```

`diff` printed nothing and the checksum was `2045272500 1052` before the first
render and `2045272500 1052` after the second.

**Now look at what did move.** The document also records when it was generated,
and that is a fact about the render, not about the incident. From the same two
runs:

```text
Riga     : "generated_at": "2026-08-09T05:01:26+0300"
New York : "generated_at": "2026-08-08T22:01:28-0400"
```

Two clocks in one document, and they are supposed to disagree. The incident
happened when it happened. The reading of it happened when you opened it.

**Confirm the appendix is a listing.** The raw evidence file was never present
in this lab, and the briefing still knows about it:

```bash
grep -o '"name":"[^"]*","bytes":[0-9]*' out/rca/rca_LABDB_latest.json
```

Captured:

```text
"name":"alertlog_window.txt","bytes":18422
```

The spacing in that pattern is not decoration. The outer document is written
with indentation, and the incident block inside it is assembled compactly, so a
pattern with a space after the colon matches nothing here. That is the same trap
as the empty comparison in *Check your work*, one step earlier.

That is a manifest entry describing a file that existed when the collection was
taken. It is how an archive tells you that something is missing rather than
letting you assume you have everything.

**Teardown.**

```bash
cd ~ && rm -rf ~/rca-lab/archive-lesson
```

## Read it wrong

**A carried timestamp is right, and it is still not enough on its own.** The
report prints the clock of the machine that saw the incident, which is the
correct choice, and it means you have to know what zone that machine was in
before you compare its timeline to anything else. Carrying the string prevents a
silent shift. It does not tell you the offset, and correlating this collection
with an application log from another host is where that bites.

**A checksum proves the file, not the story.** It proves the bytes you rendered
today are the bytes collected then. It says nothing about whether the collection
was complete, which is lesson four, or whether the readings drawn from it were
sound, which is lesson three.

**One node.** This is the constraint most easily forgotten in an archive, months
later, with the incident half remembered. The collection describes the node it
ran on, and the alert log, listener and operating system evidence in it are
local to that node. On a cluster, an incident that evicted a different node left
its evidence on that node. The report states this on its face, and it states it
because a single-node picture read as a cluster-wide one is a mistake that
survives archiving very well.

**An appendix entry is a claim about a file, not the file.** If the directory
was not archived beside the report, the entry still lists the name and the byte
count. That is useful and it is not evidence. Where a question turns on what was
in that file, the honest answer is that the file would settle it and you do not
have it.

**Nothing here concludes anything, and that is the finished product.** At the
end of this module you can produce a document containing evidence, a
reconstructed timeline, ranked ordering facts with their readings labelled, and
a completeness statement naming what was not read. It contains no diagnosis and
no commands. If that feels like stopping one step early, notice what the missing
step would have required: a claim about your estate that the evidence did not
support, written by something that has never seen it.

## Check your work

1. `grep -c . riga.txt newyork.txt` reported four lines in each file. Check this
   before you trust the `diff`. Two empty files also compare equal, and an
   extraction that silently matched nothing looks exactly like a successful one.
2. `diff riga.txt newyork.txt` printed nothing. Prove the check is awake by
   breaking it on purpose: `sed 's/03:20:00/03:20:01/' riga.txt > broken.txt`
   then `diff riga.txt broken.txt`, which must print a difference. A comparison
   you have never seen fail is not a comparison.
3. `cksum` returned the same two numbers before the first render and after the
   second. If they differ, something wrote to the collection, and every replay
   after that point is reading a different document from the one that was
   collected.

## Where this goes next

- Oracle AI Database 26ai Reference, *V$DIAG_ALERT_EXT*, for the column type and
  meaning behind the carried timestamp:
  `https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/V-DIAG_ALERT_EXT.html`
- Oracle Database Reference 19c, *V$DIAG_INFO*, for where the ADR paths behind
  an archived collection came from:
  `https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/V-DIAG_INFO.html`
- The pack ships `prompts/incident-review.md`, which asks an assistant for
  competing explanations and for what is missing, rather than for an answer.

The OraDiscuss RCA Generator Pack writes both the report and the structured
briefing from one collection and is included in the membership.
