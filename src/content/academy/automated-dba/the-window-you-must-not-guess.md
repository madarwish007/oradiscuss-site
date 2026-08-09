---
course: automated-dba
module: "Incident reconstruction: evidence, timeline, and the explanations that compete"
order: 1
title: The window you must not guess
summary: Somebody says the database was bad last night. Before you collect anything, you have to fix which hours you are collecting, and be able to prove afterwards which hours you actually looked at.
estimatedMinutes: 30
prerequisites:
  - The OraDiscuss RCA Generator Pack v1.0.0, unzipped somewhere you can read.
  - A bash shell and a text editor. This lesson contacts no database.
oracleVersions:
  - 19c
  - 26ai
lastReviewed: 2026-08-09
---

## What this lesson answers

Somebody tells you the database was bad last night. You are going to collect
evidence about it. Before you collect anything at all, you have to answer a
question nobody asks out loud: which hours are you collecting? Get that wrong and
every fact you produce afterwards is true about the wrong period, which is worse
than having no facts, because it looks like work.

## Applicability

Written against Oracle Database 19c and Oracle AI Database 26ai, Enterprise
Edition. The collector is written for Linux. The lab in this lesson runs
anywhere bash runs and never contacts a database.

Tool: OraDiscuss RCA Generator Pack v1.0.0, `rca_generator.sh`. The pack is
read-only: SELECT-only SQL, ADRCI show commands, and log file reads. It is part
of the membership.

**Licence, before the first command.** One of the seven collection tiers reads
`DBA_HIST_*` views. Those are licensed with the Oracle Diagnostics Pack, which
is separate from the database licence on Enterprise Edition. Oracle's own
documentation states it: "Some of the products and tools in the preceding list,
including Oracle Diagnostics Pack and Oracle Tuning Pack, require separate
licenses." (*Tools for Tuning the Database*, Oracle AI Database 26ai,
`https://docs.oracle.com/en/database/oracle/oracle-database/26/tdppt/tools-tuning-database.html`,
fetched 9 August 2026.) The collector checks the `control_management_pack_access`
parameter before it reads any of those views, and where the parameter does not
permit them it records that it did not read them. Nothing in this lesson runs
that tier, because nothing in this lesson contacts a database at all. What you
lose without that pack is workload evidence: wait events and heavy statements
across the window. What you keep is everything else in the list below, and the
alert log is the tier that carries most of an incident's ordering.

**What was checked on 9 August 2026.** The labs in this lesson were run end to
end on that date against RCA Generator Pack v1.0.0, on a machine with no Oracle
software installed, and the output printed below is what those runs produced.
No claim in this lesson has been checked against a running 19c or 26ai instance
by this project. Where a claim is about Oracle rather than about the pack, it is
cited or marked.

## The mechanism

A triage window is an argument, not a setting, and the collector accepts exactly
three shapes of it.

- `--since 2h`, `--since 24h`, `--since 7d`. A relative window ending at the
  moment you run the command. The unit suffix is `m`, `h` or `d`.
- `--at "YYYY-MM-DD HH:MI"`. A moment you already know about, from a ticket or a
  phone call. The collector widens it to plus and minus two hours, so this shape
  produces a four hour window, not a point.
- `--from "YYYY-MM-DD HH:MI" --to "YYYY-MM-DD HH:MI"`. Explicit boundaries. Both
  are given together or neither is.

**Giving more than one shape is a hard error, not a precedence rule.** That is
the design decision worth pausing on. A tool that accepted `--since 2h` together
with `--at "2026-08-08 04:00"` would have to pick one, and whichever it picked,
some operator somewhere would spend an hour reading facts about hours he did not
mean. Refusing to start costs one retry. Quietly examining the wrong window
costs the incident.

Once resolved, the window is logged as it is resolved, printed at the top of the
report, and carried into the machine-readable briefing together with the
argument that produced it. That last part matters more than it looks: six weeks
later, reading an archived report, the difference between "somebody asked for
the two hours around 04:00" and "somebody asked for the last day" is the
difference between a deliberate examination and a sweep.

What the collector would then do, in order, is seven tiers, each of which
records its own status whether or not it ran:

1. Instance identity and ADR paths, read from `V$DIAG_INFO` rather than from an
   assumed diagnostic destination layout on disk. Oracle documents that view as
   describing "the state of Automatic Diagnostic Repository (ADR) functionality
   using NAME=VALUE pairs".
2. The alert log inside the window.
3. ADR incidents, through `adrci`.
4. Node scope, recorded so the report states which node it describes.
5. Workload evidence, only where `control_management_pack_access` permits it.
6. Listener log errors.
7. Operating system logs, only where the account can actually read them.

> **Documented, not observed here.** The collector queries `V$DIAG_INFO` for the
> rows named `ADR Home` and `Diag Trace`. The view itself is documented in the
> Oracle Database Reference (linked below), and the row names are read from the
> pack's own shipped SQL, which you can check. The Reference page as fetched on
> 9 August 2026 did not resolve the full NAME list for this lesson, so confirm
> the exact row names on your own instance before relying on them.

## At the terminal

**Setup.** Everything this lesson creates lives under one directory it makes
itself, and teardown removes that directory. Set `PACK` to wherever you unzipped
the pack. The zip unpacks to a directory named `rca`.

```bash
# SETUP
PACK=~/rca                       # wherever you unzipped oradiscuss-rca-v1.0.0.zip
mkdir -p ~/rca-lab/window && cd ~/rca-lab/window

cat > config-labdb.env <<'CONF'
ORACLE_SID=LABDB
ORACLE_HOME=/nonexistent
ORACLE_CONNECT="/ as sysdba"
LISTENER_NAME="LISTENER"
RCA_MAX_EVENTS=500
RCA_CORRELATION_WINDOW_SEC=600
OUTPUT_DIR="$HOME/rca-lab/window/out"
CONF
```

`ORACLE_HOME` points at a path that does not exist, deliberately. This lab has
no business reaching a database, and a home that cannot resolve means that if
any step ever tried to, it would fail loudly instead of quietly finding your
real instance. Treat that as part of the lab, not as a placeholder to fix.

**The lab, first half: ask for the plan rather than the collection.**

```bash
bash "$PACK/rca_generator.sh" --config config-labdb.env --dry-run --since 24h
echo "exit code: $?"
```

Captured output, from a real run on 9 August 2026, RCA Generator Pack v1.0.0,
macOS with no Oracle software installed. Only the first lines and the closing
lines are shown; the middle of the plan is the seven tiers listed above.

```text
2026-08-09T04:43:21+0300 [rca_generator] window resolved from --since 24h: 2026-08-08 04:43:21 to 2026-08-09 04:43:21
DRY-RUN - RCA collection plan
  config          : config-labdb.env
  ORACLE_SID      : LABDB
  window          : 2026-08-08 04:43:21 to 2026-08-09 04:43:21
  resolved from   : --since 24h
...
  WOULD NOT: draw a conclusion, issue a verdict, or print a command to run.
  Nothing here writes to the database or to the OS. Exit 0.
exit code: 0
```

Two things to notice. The window was resolved and logged before any tier was
considered, and the plan states what it would not do as plainly as what it
would.

**The lab, second half: watch it refuse.**

```bash
bash "$PACK/rca_generator.sh" --config config-labdb.env --since 2h --at "2026-08-08 04:00"
echo "exit code: $?"
```

Captured from the same session:

```text
2026-08-09T04:43:21+0300 [rca_generator] ERROR: give ONE window shape, not several. Got: --since --at
2026-08-09T04:43:21+0300 [rca_generator] ERROR: a triage that silently picked one of two windows is worse than one that refused.
exit code: 2
```

**The underlying SQL.** The window is not a display setting. It is a predicate
that reaches the database. This is the filter from the pack's
`sql/rca_alertlog.sql`, which the collector calls with the resolved boundaries:

```sql
 WHERE originating_timestamp >= TO_TIMESTAMP('&win_from', 'YYYY-MM-DD HH24:MI:SS')
   AND originating_timestamp <= TO_TIMESTAMP('&win_to',   'YYYY-MM-DD HH24:MI:SS')
   AND message_level <= 8
 ORDER BY originating_timestamp, message_text
 FETCH FIRST &max_rows ROWS ONLY;
```

The window you argued about at the command line becomes those two bind values.
`message_level <= 8` is a second filter you did not set and should know about:
it keeps critical, severe and important messages and drops normal ones. Lesson
two returns to what those levels mean.

**Teardown.**

```bash
cd ~ && rm -rf ~/rca-lab/window
```

## Read it wrong

**A plan is not evidence.** The dry run printed seven tiers. It did not
establish that any of them can run in your estate. Reading a plan and believing
the estate has been examined is the same error as reading a runbook and
believing the drill was done.

**`--since` resolves against the clock at the moment you press return.** Two
collections taken with the identical argument, an hour apart, cover two
different periods. If you are going to compare collections, or hand one to a
colleague, the explicit shape is the one that means the same thing tomorrow.

**`--at` is a four hour window.** It is a moment widened, and the widening is
deliberate, because the reported time of an incident is somebody's memory of
when they noticed. If you narrow the window to the minute you were told, you
have filtered on the accuracy of a phone call.

**A wide window is not a safer window.** Widening pulls in more background: the
same errors that are present every night, the routine log switches, the
housekeeping. Nothing in the collection is wrong, but the ordering facts derived
from it get weaker, because a fact about which of two events came first means
less when both events happen every hour anyway.

**The exit code is not a health verdict.** Exit 0 here meant the plan printed.
Exit 2 meant the collector refused to start. Neither says anything about the
database, and lesson four covers what the exit code does mean after a real
collection.

## Check your work

Run both halves and check three specific observables rather than the general
impression that something happened.

1. The first command printed a line beginning `window resolved from` that names
   the argument you gave, and the two boundaries are exactly 24 hours apart. Read
   the two timestamps and subtract them.
2. `echo "exit code: $?"` printed `0` after the dry run and `2` after the double
   shape. If the second one printed `0`, you are not running what you think you
   are running.
3. `ls -A ~/rca-lab/window/out/rca` lists nothing. The directory itself exists,
   because the collector prepares its output location before it decides whether
   this is a real run, and that is worth knowing so you do not read the
   directory's presence as evidence that something was collected. What proves the
   dry run collected nothing is that the directory is **empty**: no report, no
   briefing, no appendix.

## Where this goes next

- Oracle Database Reference, *V$DIAG_INFO*:
  `https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/V-DIAG_INFO.html`
- Oracle Database Reference, *CONTROL_MANAGEMENT_PACK_ACCESS*:
  `https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/CONTROL_MANAGEMENT_PACK_ACCESS.html`
- Oracle AI Database 26ai, *Tools for Tuning the Database*:
  `https://docs.oracle.com/en/database/oracle/oracle-database/26/tdppt/tools-tuning-database.html`

The OraDiscuss RCA Generator Pack automates this same collection and is included
in the membership.
