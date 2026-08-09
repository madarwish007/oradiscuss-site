---
course: performance-recovery-mastery
module: "Performance evidence: from 'the database is slow' to a ranked set of cited facts"
order: 2
title: Which window am I actually looking at?
summary: A triage report is a subtraction between two snapshots. This lesson works out which pair you got, what bounds how far back and how fine that pair can be, and drives the collector's refusals until it says out loud what it will not guess.
estimatedMinutes: 25
prerequisites:
  - A machine with bash. No database is contacted, and no Oracle home needs to be set.
  - The OraDiscuss DBA Health Check Automation Pack v1.0.0, unpacked somewhere you can read it.
  - Lesson 1 of this module, if you want the licensing position before you read the view names.
oracleVersions:
  - 19c
  - 26ai
lastReviewed: 2026-08-09
draft: false
---

## What this lesson answers

The report says the window is 02:00 to 06:00. Were those the four hours that hurt, were they four hours of one instance's uninterrupted life, and how would I know if they were not?

## Applicability

Written against **Oracle Database 19c** and **Oracle AI Database 26ai**, Enterprise Edition. The column descriptions quoted below were read on Oracle's *Database Reference* pages for both releases on 9 August 2026 and are the same in both.

**Licence requirement.** The window facts live in the Workload Repository. `DBA_HIST_SNAPSHOT` is one of the six `DBA_HIST_` views Oracle's *Licensing Information User Manual* names as usable without an Oracle Diagnostics Pack licence. **`DBA_HIST_WR_CONTROL` is not on that list**, and neither are the event, statistic and SQL views a triage actually reads. Lesson 1 has the passage and the audit.

**This lesson's lab needs no licence and no database.** It drives the wrapper on a machine with no Oracle home, where the only thing it can do is refuse.

**What was checked, and what was not.** The four invocations below were run on 9 August 2026 against pack v1.0.0 on a machine with no Oracle home, and the exit codes and messages shown are captured from that run. The Oracle column descriptions were read on Oracle's documentation the same day. **No statement here has been run against a running Oracle instance by this project.**

## The mechanism

An AWR window is not a time range. It is a **pair of snapshot ids for one database id**, and every number in a triage report is a subtraction between those two rows. Everything that can be wrong with the window is a consequence of that one sentence.

`DBA_HIST_SNAPSHOT` "displays information about the snapshots in the Workload Repository". The columns that decide whether your window is sound are `SNAP_ID`, `DBID`, `INSTANCE_NUMBER`, `BEGIN_INTERVAL_TIME` and `END_INTERVAL_TIME`, and one that is easy to skip past: `STARTUP_TIME`, described as "Startup time of the instance".

### Two kinds of subtraction, and only one of them is Oracle's

This distinction is the reason a triage report can be internally inconsistent without anything being broken.

`DBA_HIST_SQLSTAT` carries both forms. Oracle's description of the view says it plainly: "The total value is the value of the statistics since instance startup. The delta value is the value of the statistics from the `BEGIN_INTERVAL_TIME` to the `END_INTERVAL_TIME` in the `DBA_HIST_SNAPSHOT` view." So `ELAPSED_TIME_TOTAL` counts from startup and `ELAPSED_TIME_DELTA` is already scoped to the interval. A tool reading the delta columns is reading Oracle's own arithmetic.

`DBA_HIST_SYSTEM_EVENT` and `DBA_HIST_SYSSTAT` have no delta columns at all. `DBA_HIST_SYSTEM_EVENT` holds `TOTAL_WAITS` and `TIME_WAITED_MICRO`, `DBA_HIST_SYSSTAT` holds a single `VALUE`, and the reference describes both views as containing snapshots of their `V$` originals. A window over those views is a subtraction **the tool performs itself**, between the row at the begin snapshot and the row at the end snapshot.

That is exactly what the shipped collector does. The wait event section computes its own difference with `LAG` over `snap_id`, and the top SQL section reads `elapsed_time_delta` and `executions_delta`. Same report, two different arithmetics, and only the second one is Oracle's.

Now `STARTUP_TIME` matters. A subtraction of two counters measures work done only if the counter was not reset in between. If the two snapshot rows in your pair do not carry the same `STARTUP_TIME`, the instance restarted inside your window, and the self-computed difference is not a measure of anything you asked about.

### What bounds the window before you choose it

`DBA_HIST_WR_CONTROL` "displays the control information for the Workload Repository", and three of its columns are the boundaries of the whole exercise.

- `SNAP_INTERVAL`, "Snapshot interval; how often to automatically take snapshots". This is the finest window you can ask for. An event shorter than the interval cannot have a window of its own.
- `RETENTION`, "Retention setting for the snapshots; amount of time to keep the snapshots". This is how far back the evidence goes. Past it, the question is unanswerable from AWR at any price.
- `TOPNSQL`, "The number of Top SQL flushed for each SQL criteria (elapsed time, CPU time, parse calls, sharable memory, version count)". This one decides who is allowed into the top SQL section at all, and lesson 4 comes back to it.

### The two ways to name a window, and why the tool tells you which it chose

`awr_triage.sh` takes the window in two shapes, because triage arrives in two shapes. `--snaps` is for when you already know the pair. `--last-hours` is for when you know when it hurt but not which snapshot that was, and the wrapper resolves the earliest and latest snapshot inside that span before it collects anything.

The resolution is a single statement against `DBA_HIST_SNAPSHOT`, and it is worth reading rather than trusting, because it decides what the whole report is about. Below is the statement as the database receives it after the wrapper has substituted the hours you asked for, here four:

```sql
SELECT MIN(snap_id) || ' ' || MAX(snap_id)
FROM dba_hist_snapshot
WHERE dbid = (SELECT dbid FROM v$database)
  AND end_interval_time >= SYSDATE - (4/24);
```

The wrapper then logs the pair it chose, and stops if it cannot resolve one or if the span holds only a single snapshot. A triage that quietly picked a different window than you meant is worse than one that refused, and the next section is that refusal, driven until you have watched it.

## At the terminal

**Setup.** No database, no Oracle home, nothing created inside a database.

```bash
export PACK_DIR="${HOME}/oradiscuss-healthcheck/packs/healthcheck"   # wherever you unpacked it
mkdir -p "${HOME}/od-lab-b1"
cd "${PACK_DIR}"
echo "oracle home: ${ORACLE_HOME:-none}"
```

If that prints anything other than `none`, stop and move to a machine where it does. The last two rows of the matrix below depend on there being no `sqlplus` to find, and on a database host they would not refuse. They would collect.

**The lab.** Four invocations, one at a time. Read each message before running the next.

```bash
./awr_triage.sh --snaps 41201 41205 --last-hours 4
echo "exit ${?}"
```

```text
# captured 2026-08-09, GNU bash 3.2.57, pack v1.0.0, no database contacted
2026-08-09T05:02:27+0300 [awr_triage] ERROR: give --snaps OR --last-hours, not both
exit 2
```

```bash
./awr_triage.sh --last-hours 4h
echo "exit ${?}"
```

```text
# captured 2026-08-09, same run
2026-08-09T05:02:27+0300 [awr_triage] ERROR: --last-hours must be a whole number of hours
exit 2
```

```bash
./awr_triage.sh --last-hours 4
echo "exit ${?}"
```

```text
# captured 2026-08-09, same run
2026-08-09T05:02:27+0300 [awr_triage] ERROR: sqlplus not found at $ORACLE_HOME/bin/sqlplus
exit 2
```

```bash
./awr_triage.sh --snaps 41201 41205
echo "exit ${?}"
```

```text
# captured 2026-08-09, same run
2026-08-09T05:02:27+0300 [awr_triage] ERROR: sqlplus not found at $ORACLE_HOME/bin/sqlplus
exit 2
```

The first two are the wrapper refusing an ambiguous or unusable window. The last two are the same wrapper accepting a perfectly good window and then failing to find a database, which on this machine is the correct outcome and on a database host would not happen.

**The statement you would want on your own lab estate.** This is the window read, by hand, using only the view Oracle's exception list names. It answers three questions at once: which snapshots exist, what times they cover, and whether the instance restarted between them.

```sql
SELECT snap_id,
       TO_CHAR(begin_interval_time, 'YYYY-MM-DD HH24:MI') AS win_begin,
       TO_CHAR(end_interval_time,   'YYYY-MM-DD HH24:MI') AS win_end,
       TO_CHAR(startup_time,        'YYYY-MM-DD HH24:MI') AS instance_started,
       instance_number
FROM dba_hist_snapshot
WHERE dbid = (SELECT dbid FROM v$database)
  AND end_interval_time >= SYSDATE - (4/24)
ORDER BY instance_number, snap_id;
```

Read `instance_started` down the column before you read anything else. If it changes, your window contains a restart.

**Teardown.** Two directories, because the third and fourth invocations got far enough to create one.

```bash
rm -rf "${HOME}/od-lab-b1"
rmdir "${HOME}/oradiscuss-healthcheck/output/reports" "${HOME}/oradiscuss-healthcheck/output" 2>/dev/null
```

`rmdir` rather than `rm -rf` on purpose. It removes those two directories only if they are empty, so if a real collection of yours is sitting in there, the teardown refuses instead of taking it with it.

## Read it wrong

**The widest pair inside the span is not the event.** `--last-hours 4` resolves to the minimum and maximum snapshot ids in those four hours. If the trouble lasted eight minutes, those eight minutes are now averaged across four hours, and the average will look unremarkable. The window did not lie. It answered the question you asked, which was about four hours.

**The span selects on the end of an interval.** The resolution statement takes snapshots whose `END_INTERVAL_TIME` falls inside the span. The earliest snapshot it returns therefore has a `BEGIN_INTERVAL_TIME` before your span starts. That is usually what you want and it is never what you said.

**A pair that straddles a restart still produces numbers.** Nothing errors. The self-computed differences over `DBA_HIST_SYSTEM_EVENT` and `DBA_HIST_SYSSTAT` are the ones affected, because those are subtractions of running totals. The collector's window check confirms that both snapshot ids exist for the database id. It does not compare `STARTUP_TIME`, so that comparison is yours to make.

**On RAC, the rows are per instance and this collector does not say so.** `DBA_HIST_SNAPSHOT`, `DBA_HIST_SYSTEM_EVENT`, `DBA_HIST_SYSSTAT` and `DBA_HIST_SQLSTAT` all carry `INSTANCE_NUMBER`. The shipped collector filters on `dbid` and `snap_id` and does not filter or group by instance, so on a clustered database every instance's rows are in scope for one figure. On a single-instance database, which is what these labs assume, that makes no difference. On a cluster, the figure you get is not a per-instance figure and the per-instance skew is the thing you were probably looking for.

**A quiet window is evidence about the window, not about the database.** If the four hours you picked were the four hours after the problem stopped, the report is accurate and useless. The window is a claim you made, and it is the first claim to check.

## Check your work

1. All four invocations print `exit 2`. Not one of them writes a report.
2. The first message names the conflict, `give --snaps OR --last-hours, not both`. The second names the value it would not guess at, `--last-hours must be a whole number of hours`.
3. The third and fourth messages are identical to each other and mention `sqlplus`, not the window. That is the proof that your window arguments were accepted and the machine has no database to ask. If you get a different message here, your `ORACLE_HOME` is set and you are not on the lab machine this lesson assumes.
4. The four runs did not all leave the same trace, and the difference is the point. Run this after the fourth:

```bash
find "${HOME}/oradiscuss-healthcheck/output" 2>/dev/null || echo "nothing created"
```

An empty `output/reports` directory exists. Nothing is in it. That directory did not exist after the first two runs and did exist after the third, because the wrapper refuses an ambiguous window **before** it reads its configuration, and creates its output directory **before** it looks for `sqlplus`. An empty output directory is therefore evidence that a run got past argument checking and no further, which is a useful thing to be able to read off a filesystem at 3am.

It also tells you where output goes, and the answer is not where you might assume. The directory that appeared is the one named in `config.env`, not one derived from where you ran the command. Setting `OUTPUT_DIR` in your shell before the run does not move it, because `config.env` is sourced afterwards and sets the variable again. Lesson 3 uses `--config` for exactly this reason.

## Where this goes next

- *Database Reference, 26ai: DBA_HIST_SNAPSHOT*, `https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/DBA_HIST_SNAPSHOT.html`, and the 19c page at `https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/DBA_HIST_SNAPSHOT.html`
- *Database Reference, 26ai: DBA_HIST_WR_CONTROL*, `https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/DBA_HIST_WR_CONTROL.html`
- *Database Reference, 26ai: DBA_HIST_SQLSTAT*, `https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/DBA_HIST_SQLSTAT.html`
- *Database Reference, 26ai: DBA_HIST_SYSTEM_EVENT*, `https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/DBA_HIST_SYSTEM_EVENT.html`

The OraDiscuss DBA Health Check Automation Pack ships `awr_triage.sh`, which resolves the window from either argument shape and logs the pair it chose, and it is part of the membership.
