---
course: automated-dba
module: "Incident reconstruction: evidence, timeline, and the explanations that compete"
order: 3
title: What you measured, what you are reading into it, and what would tell them apart
summary: An ordering correlation is a measurement. What it means is an interpretation. Carrying those as two separate sentences, plus a third naming what would separate competing explanations, is the whole discipline.
estimatedMinutes: 40
prerequisites:
  - The OraDiscuss RCA Generator Pack v1.0.0, unzipped somewhere you can read.
  - A bash shell and a text editor. This lesson contacts no database.
  - Lesson two of this module is useful background but is not required. This lab builds its own collection.
oracleVersions:
  - 19c
  - 26ai
lastReviewed: 2026-08-09
---

## What this lesson answers

You have a timeline. One thing happened before another thing. Now what? This is
the lesson where a reconstruction either becomes useful or becomes the confident
story that sends four people down the wrong corridor. The question it answers is
narrow and it is the most valuable one in the module: how do you write down what
you found so that the next reader can disagree with your interpretation without
throwing away your measurement?

## Applicability

Written against Oracle Database 19c and Oracle AI Database 26ai, Enterprise
Edition. The collector is written for Linux. The lab runs anywhere bash runs and
contacts no database.

Tool: OraDiscuss RCA Generator Pack v1.0.0, `rca_generator.sh`. The pack is
read-only and is part of the membership. No `DBA_HIST_*` view is read in this
lesson, so no Diagnostics Pack question arises here. Lesson four covers the tier
where it does.

**What was checked on 9 August 2026.** Every output block below was produced by
a real run on that date against pack v1.0.0, on a machine with no Oracle
software installed. Nothing in this lesson makes a claim about Oracle server
behaviour, so nothing in it needed a running instance. The one Oracle fact it
uses, the alert log message levels, is cited in lesson two.

## The mechanism

Every ordering correlation the pack derives is carried as three separate fields,
and they are separate because they have different truth conditions.

**`statement` is measured.** It is checkable against the timeline printed beside
it. If the report says one error preceded another by 42 seconds, you can count
the seconds yourself. A statement can be wrong, but it is wrong in a way that
somebody can find.

**`reading` is an interpretation, labelled as one.** It is what a
knowledgeable person might conclude from the statement. It is not derived from
the data by any process the tool can defend, and the tool says so on the page.
The report prints it prefixed with the words "Reading, which is an
interpretation and not a measurement", which is deliberately clumsy and
deliberately unmissable.

**`would_distinguish` names what would separate that reading from a competing
explanation.** This is the field that replaces a recommended-next-steps section.
It is not an instruction. It names something to know. The difference is not
politeness: an instruction assumes the reading is right and moves on, while a
distinguishing question assumes it might not be and says how to find out.

Held together, the three parts do one job: they let a second reader keep your
measurement and discard your interpretation. That transaction is what makes an
incident write-up worth forwarding, and its absence is why most of them are not.

The pack derives correlations only inside a bounded window, set by
`RCA_CORRELATION_WINDOW_SEC` and defaulting to 600 seconds. Two events further
apart than that are not offered as a correlation at all. That knob deserves your
suspicion in one direction only: widening it manufactures correlations, because
over a long enough span everything precedes something.

The skill generalises past this tool, and that is the reason the module spends a
whole lesson on it. Any sentence you are about to write in an incident summary
belongs to one of the three categories. If you cannot say which, it is a
reading, and it needs a label.

## At the terminal

**Setup.**

```bash
# SETUP
PACK=~/rca
mkdir -p ~/rca-lab/facts/archive && cd ~/rca-lab/facts

cat > config-labdb.env <<'CONF'
ORACLE_SID=LABDB
ORACLE_HOME=/nonexistent
ORACLE_CONNECT="/ as sysdba"
LISTENER_NAME="LISTENER"
RCA_MAX_EVENTS=500
RCA_CORRELATION_WINDOW_SEC=600
OUTPUT_DIR="$HOME/rca-lab/facts/out"
CONF

# A constructed collection. No database produced these lines and the numbers
# are illustrative.
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

**The lab, first half: read a three part fact.**

```bash
bash "$PACK/rca_generator.sh" --config config-labdb.env \
     --render-only archive/rca_raw_LABDB_lesson.txt
grep -o '"id":"[a-z_]*"' out/rca/rca_LABDB_latest.json
```

Captured, 9 August 2026, pack v1.0.0:

```text
"id":"first_event"
"id":"os_precedes_ora"
"id":"top_ora_codes"
```

Open `out/rca/rca_LABDB_latest.html` in a browser and find the ordering facts.
These are the three parts of the middle one, captured from the same run:

```text
STATEMENT: The first operating system error precedes the first ORA- error by 42 seconds.
READING: An ordering consistent with an incident originating below the database, where
  the ORA- errors are downstream symptoms. Ordering is not causation: a database-driven
  load spike can produce operating system errors first.
WOULD_DISTINGUISH: Whether the operating system errors continue after the database
  errors stop, and whether they appear on hosts that run no database.
```

Check the statement against the timeline before you read on. The operating
system error is at 03:20:00 and the first ORA- error is at 03:20:42. That is 42
seconds, and you did not have to trust anybody to know it.

Now read the third part again. It does not tell you to look at the storage. It
names two observations that would pull the two explanations apart, and one of
them ("hosts that run no database") is the kind of thing a person who knows the
estate can answer in a minute and a tool can never answer at all.

**The lab, second half: change the ordering and watch the fact change.**

Copy the collection, then open the copy in your editor and edit the single line
beginning `EVT|1|`. Move that operating system event to 03:21:30, which is after
both alert log errors. Change **both** the epoch and the formatted timestamp,
because they are two fields and the file will not stop you changing one:

- epoch `1754620800` becomes `1754620890`
- timestamp `2026-08-08 03:20:00` becomes `2026-08-08 03:21:30`

```bash
cp archive/rca_raw_LABDB_lesson.txt archive/rca_raw_LABDB_later-os.txt
# edit archive/rca_raw_LABDB_later-os.txt as described, then:
bash "$PACK/rca_generator.sh" --config config-labdb.env \
     --render-only archive/rca_raw_LABDB_later-os.txt
grep -o '"id":"[a-z_]*"' out/rca/rca_LABDB_latest.json
```

Captured from that run:

```text
"id":"first_event"
"id":"ora_precedes_os"
"id":"top_ora_codes"
```

And the fact itself:

```text
STATEMENT: The first ORA- error precedes the first operating system error by 48 seconds.
READING: An ordering consistent with a database-side origin, where the operating system
  errors are downstream. The same caution applies in reverse.
WOULD_DISTINGUISH: Whether the database errors reference resources the operating system
  later complains about.
```

One event moved by ninety seconds and the whole reading inverted, from an
incident that started below the database to one that started inside it. Nothing
else in the collection changed. Sit with that for a moment, because it is the
argument for labelling readings rather than reporting them: the interpretation
is that sensitive to a single field, and the measurement is not.

**Write the third part yourself.** The first fact in both runs is
`first_event`, and after your edit its statement reads:

```text
STATEMENT: The earliest event collected in this window is at 2026-08-08 03:20:20,
  from alert-log: Thread 1 advanced to log sequence 4412
```

Before reading the pack's own reading of it, write down two things on paper: one
interpretation somebody could reasonably draw from that statement, and one
observation that would separate your interpretation from a competing one. Then
compare with what the report says. There is no marking scheme here. The exercise
is to notice which of your two sentences was easy and which was hard, because
the hard one is the one that carries the value.

**Teardown.**

```bash
cd ~ && rm -rf ~/rca-lab/facts
```

## Read it wrong

**Ordering is not causation, and knowing the slogan is not the same as
obeying it.** The failure mode is not that somebody writes "A caused B". It is
that somebody writes "A preceded B" in the summary, and then plans the next four
hours as though A caused B. Watch what you do next, not what you wrote.

**A correlation window is a knob that manufactures agreement.** At 600 seconds
the pack offered one ordering fact. Widen it far enough and any two events in
any collection fall inside it. If you ever find yourself widening a correlation
window to make a correlation appear, you have started writing the conclusion
first.

**Frequency ranks recurrence, not importance.** The third fact in both runs
ranks the most frequent error codes. One occurrence of a serious error outranks
a hundred of a benign one, and the report says so in its own reading. A count is
a fact about repetition.

**A reading you agree with is still a reading.** The dangerous ones are not the
implausible interpretations. They are the ones that match what you already
suspected, because those are the ones you stop labelling.

**The absence of a correlation is not the absence of a cause.** Where nothing
correlates, the pack emits a fact saying so, and its reading points at the tiers
that were not read rather than at the estate. That is lesson four.

## Check your work

1. The first run printed `"id":"os_precedes_ora"` and the second printed
   `"id":"ora_precedes_os"`. Those are two different identifiers from two
   different collections, and if you see the same identifier twice, your edit did
   not take. Re-open the copy and check you edited the line beginning `EVT|1|`.
2. The measured intervals are 42 seconds and 48 seconds. Both are checkable by
   hand against the timestamps in your two files. Do the subtraction and confirm
   the tool is not being taken on trust.
3. Your edited file changed the `first_event` statement as well, from the
   operating system error to the log switch at 03:20:20. If `first_event` still
   names the operating system error, you changed the timestamp but not the epoch,
   which is exactly the failure lesson two warned about.

## Where this goes next

- Oracle Database Reference 19c, *V$DIAG_ALERT_EXT*, for what the alert log
  columns behind these events mean:
  `https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/V-DIAG_ALERT_EXT.html`
- The pack ships `prompts/incident-review.md`, a prompt that teaches an assistant
  to treat `statement` as fact and `reading` as a hypothesis it may disagree
  with. Reading it is a compact statement of this lesson from the other side.

The OraDiscuss RCA Generator Pack derives these ordering facts from the
collection it gathers and is included in the membership.
