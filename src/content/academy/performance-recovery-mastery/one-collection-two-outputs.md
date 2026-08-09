---
course: performance-recovery-mastery
module: "Performance evidence: from 'the database is slow' to a ranked set of cited facts"
order: 3
title: What the collector reads, and what it writes
summary: One read of the database becomes a report for you and a briefing for your assistant. This lesson takes a captured collection apart, changes one status by hand, and watches the exit code and the overall status move with it.
estimatedMinutes: 35
prerequisites:
  - A machine with bash. No database is contacted, and no Oracle home needs to be set.
  - The OraDiscuss DBA Health Check Automation Pack v1.0.0, unpacked somewhere you can read and copy files.
  - Nothing from lessons 1 or 2 needs to still exist. This lab starts from its own setup.
oracleVersions:
  - 19c
  - 26ai
lastReviewed: 2026-08-09
draft: false
---

## What this lesson answers

The tool produced an HTML report and a JSON file. Where did each of them come from, can they disagree with each other, and what exactly is the exit code telling me?

## Applicability

Written against **Oracle Database 19c** and **Oracle AI Database 26ai**, Enterprise Edition, and against the OraDiscuss DBA Health Check Automation Pack **v1.0.0**.

**Licence requirement.** The collection this lesson takes apart is produced by reading `DBA_HIST_SYSTEM_EVENT`, `DBA_HIST_SQLSTAT`, `DBA_HIST_SQLTEXT` and `DBA_HIST_SYSSTAT`, all of which are part of the **Oracle Diagnostics Pack**, plus `DBA_HIST_SNAPSHOT`, which is not. Lesson 1 has Oracle's wording and the audit that produces that list.

**This lesson's lab replays a collection that already happened and needs neither the pack nor a database.** It uses `--render-only`, which rebuilds both outputs from a captured file without contacting anything.

**What was checked, and what was not.** Every command and every output block below was run on 9 August 2026, GNU bash 3.2.57, pack v1.0.0, on a machine with no Oracle home. The input is the synthetic fixture the pack ships for its own tests, so **the numbers in it are not a measurement of any database** and are shown here to exercise the machinery, not to be read as a workload. The Oracle view descriptions were read on Oracle's documentation the same day. **No statement here has been run against a running Oracle instance by this project.**

## The mechanism

The collector and the wrapper meet at a line-oriented contract, and the whole design follows from it. The SQL writes plain text lines in three shapes:

```text
SEC|<section title>
CHK|<id>|<OK|WARN|CRIT|NA>|<title>|<detail>
MET|<check id>|<name>|<value>|<unit>
```

`SEC` opens a section. `CHK` is one finding with a status. `MET` is a machine-readable measurement, attached to a check by that check's id.

The wrapper then reads that file **twice**. The first pass pools every `MET` line by check id. The second pass builds the HTML report and the JSON briefing together, in one loop, so each check carries whatever metrics were recorded for it.

Two design decisions in there are worth taking with you, because they are the kind of thing that goes wrong quietly in scripts you write yourself.

**Metrics are keyed by id, not by position.** An earlier design attached each metric to whichever check was last seen, which forced every SQL author to interleave statements in exactly one order and would have misfiled a measurement the first time somebody did not. The id is already on the line, so using it removes the whole class of error.

**Both outputs come from one read.** The guarantee is not that the report is right. It is that the report and the briefing cannot describe the same database at two different moments, because there is only one collection behind them.

### Status, overall, exit code

Four statuses exist. `OK`, `WARN` and `CRIT` are findings. `NA` means the check **could not be determined**, which is not the same as fine, and the briefing counts NA separately for exactly that reason.

The exit code follows the worst status seen: `0` for none, `1` if any check returned `WARN`, `2` if any returned `CRIT` or the window could not be resolved or an output could not be written. The `overall_status` in the briefing follows the same ladder.

### The ratios have no threshold, and that is a decision

The instance efficiency ratios come back with status `NA` and no threshold at all. The collector's own header says why:

> The prose version of this script has always told the reader to "compare against YOUR baseline, not textbook numbers". Emitting WARN at some fixed percentage would contradict that in the same breath, and would be exactly the verdict this product does not give.

So the ratios are carried as measurements. You get the number and the visible absence of a judgement about it, which is a more honest artifact than a green tick derived from a percentage somebody read in a book in 1998.

Here is what one of those ratios is actually made of. `DBA_HIST_SYSSTAT` is described by Oracle's reference as containing "snapshots of `V$SYSSTAT`", and the `STAT_NAME` values below are ordinary system statistic names, the same ones the `V$SYSSTAT` page tells you to look up in `V$STATNAME`. The subtraction is the collector's own, using `LAG` across the two snapshots, for the reason lesson 2 gives.

```sql
SELECT 'Soft Parse' AS metric,
       ROUND(100 * (1 - SUM(CASE WHEN stat_name = 'parse count (hard)'  THEN delta END)
                      / NULLIF(SUM(CASE WHEN stat_name = 'parse count (total)' THEN delta END), 0)), 2) AS pct
FROM (SELECT stat_name,
             value - LAG(value) OVER (PARTITION BY stat_name ORDER BY snap_id) AS delta
      FROM dba_hist_sysstat
      WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP));
```

Note `NULLIF(..., 0)`. A denominator of zero produces a null ratio rather than an error, and a null ratio is reported as "not available". A check that could not be computed says so instead of printing something.

### One more detail that is easy to miss

The decimal separator is set in the **environment**, with `NLS_NUMERIC_CHARACTERS`, and never with `ALTER SESSION`. `ALTER` is a DDL verb, and a collection pack whose entire promise is that it issues no DDL and no DML cannot make an exception for its own convenience. A session under a locale that writes `87,3` instead of `87.3` would otherwise produce a briefing that is not valid JSON. Lesson 4 shows what the briefing does when a number arrives in that shape anyway.

## At the terminal

**Setup.** A lab directory, a lab copy of `config.env` with the output path changed, and a copy of the shipped fixture to work on.

```bash
export PACK_DIR="${HOME}/oradiscuss-healthcheck/packs/healthcheck"   # wherever you unpacked it
export LAB="${HOME}/od-lab-b1"
mkdir -p "${LAB}/out"
sed 's|^OUTPUT_DIR=.*|OUTPUT_DIR="'"${LAB}"'/out"|' "${PACK_DIR}/config.env" > "${LAB}/config.env"
grep '^OUTPUT_DIR' "${LAB}/config.env"
cp "${PACK_DIR}/test-fixtures/awr_raw_hostile.txt" "${LAB}/awr_raw_LAB_001.txt"
cd "${PACK_DIR}"
```

Editing a copy of `config.env` rather than exporting `OUTPUT_DIR` is deliberate. `config.env` is sourced by the wrapper after your environment is already in place and sets the variable again, so an exported value loses. Pass the copy with `--config` and the output lands where you asked.

**The lab, step one.** Replay the captured collection.

```bash
./awr_triage.sh --config "${LAB}/config.env" --render-only "${LAB}/awr_raw_LAB_001.txt"
echo "exit ${?}"
```

```text
# captured 2026-08-09, GNU bash 3.2.57, pack v1.0.0, no database contacted.
# Absolute paths shortened to their last components, no lines omitted.
2026-08-09T05:07:54+0300 [awr_triage] render-only: rebuilding outputs from .../od-lab-b1/awr_raw_LAB_001.txt, the database is not contacted
2026-08-09T05:07:55+0300 [awr_triage] report:   .../od-lab-b1/out/reports/awr_triage_LAB_001.html
2026-08-09T05:07:55+0300 [awr_triage] briefing: .../od-lab-b1/out/reports/awr_triage_LAB_001.json
exit 0
```

Both output names came from the **base name of the collection**, not from where you were standing. That matters when you replay an archived collection: an earlier version of this script derived the whole output path from the input path, which meant replaying a file out of somebody's backup directory wrote the new reports into that backup directory.

**Step two.** Change exactly one thing. The window check is the only check in this collection that carries a real status, so it is the one to move.

```bash
sed 's/^CHK|awr_window|OK|/CHK|awr_window|CRIT|/' \
  "${LAB}/awr_raw_LAB_001.txt" > "${LAB}/awr_raw_LAB_002.txt"
grep '^CHK|awr_window|' "${LAB}/awr_raw_LAB_002.txt"
./awr_triage.sh --config "${LAB}/config.env" --render-only "${LAB}/awr_raw_LAB_002.txt"
echo "exit ${?}"
```

```text
# captured 2026-08-09, same run, absolute paths shortened, no lines omitted
CHK|awr_window|CRIT|Snapshot pair resolves|Snapshots 41201 and 41205 both exist for dbid 1234567890.
2026-08-09T05:07:55+0300 [awr_triage] render-only: rebuilding outputs from .../od-lab-b1/awr_raw_LAB_002.txt, the database is not contacted
2026-08-09T05:07:55+0300 [awr_triage] report:   .../od-lab-b1/out/reports/awr_triage_LAB_002.html
2026-08-09T05:07:55+0300 [awr_triage] briefing: .../od-lab-b1/out/reports/awr_triage_LAB_002.json
exit 2
```

Look at that `CHK` line before moving on. The status now says `CRIT` and the detail still says both snapshots exist, because `sed` changed one field and not the sentence beside it. The machinery follows the status. Prose in a report is for you, and a status is for the machine, and this is what it looks like when the two stop agreeing.

**Step three.** Read the two summary blocks side by side.

```bash
grep -A 9 '"summary"' "${LAB}/out/reports/awr_triage_LAB_001.json"
grep -A 9 '"summary"' "${LAB}/out/reports/awr_triage_LAB_002.json"
```

```text
# captured 2026-08-09, same run. The input is the pack's synthetic test fixture,
# not a measurement of any database.
  "summary": {
    "overall_status": "OK",
    "counts": {
      "OK": 1,
      "WARN": 0,
      "CRIT": 0,
      "NA": 8
    },
    "needs_attention": []
  },
--
  "summary": {
    "overall_status": "CRIT",
    "counts": {
      "OK": 0,
      "WARN": 0,
      "CRIT": 1,
      "NA": 8
    },
    "needs_attention": ["awr_window"]
  },
```

One field changed in the collection. The overall status moved, the exit code moved from 0 to 2, and the check id appeared in `needs_attention`. Eight of the nine checks did not move, because they never had a status to move.

**Teardown.**

```bash
rm -rf "${HOME}/od-lab-b1"
```

Nothing outside that directory was written, because `--config` pointed the output at it and `--render-only` never opened a connection.

## Read it wrong

**The fixture is not a database.** `awr_raw_hostile.txt` is the file the pack's own tests use to prove the parser survives awkward input: a Windows path with backslashes inside a SQL text, a quoted string, a missing metric, a number written with a comma. Reading its wait times as a workload would be reading a crash test dummy as an injury report.

**Exit 0 is not a clean bill of health.** In this collection the exit code was decided by one check out of nine. The other eight are `NA`, which means the collection carried a number and no judgement, and one of them carried no number at all. An exit code summarises the statuses that exist. It cannot summarise the ones that do not.

**Consistency is not correctness.** One read means the report and the briefing agree with each other. If the window was wrong, they agree with each other about the wrong window.

**A valid briefing can still have lost a value.** The JSON emitter checks that a number is a JSON number and writes `null` when it is not, so a locale-mangled figure does not invalidate the whole document. The file stays parseable and the measurement is gone. Lesson 4 is that specific case.

**`--render-only` does not police the window arguments.** Pass `--snaps` or `--last-hours` alongside it and the wrapper accepts them and ignores them, because in replay there is no database to select a window from. The window that the replay describes is the one that was captured, whatever you typed today.

## Check your work

1. The first replay prints `exit 0`. The second prints `exit 2`.
2. `ls "${LAB}/out/reports"` shows four files: an HTML and a JSON for `LAB_001`, and the same pair for `LAB_002`. The names come from the collection's base name, with `awr_raw_` replaced by `awr_triage_`.
3. In `awr_triage_LAB_001.json`, `"overall_status"` is `"OK"` and `"needs_attention"` is `[]`. In `awr_triage_LAB_002.json`, `"overall_status"` is `"CRIT"` and `"needs_attention"` contains `"awr_window"`.
4. `"NA": 8` in both. The change you made did not touch a single one of the eight, which is the observable form of the sentence "the ratios have no threshold".
5. Both JSON files parse. If you have a JSON tool to hand, use it; if not, `grep -c '"schema_version"' ` returning 1 on each is a weaker check that still catches a truncated document.

## Where this goes next

- *Database Reference, 26ai: DBA_HIST_SYSSTAT*, `https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/DBA_HIST_SYSSTAT.html`
- *Database Reference, 26ai: V$SYSSTAT*, `https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/V-SYSSTAT.html`, which is where the statistic names in the ratio come from
- *Database Reference, 26ai: V$SYSTEM_EVENT*, `https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/V-SYSTEM_EVENT.html`. Note that the 26ai page lists `CPU` and `CPU_FG` columns that the 19c page does not, so a script written against one release should be read again on the other

The OraDiscuss DBA Health Check Automation Pack ships `awr_triage.sh`, `sql/awr_triage_collect.sql` and `lib/odc_briefing.sh`, which are the three files this lesson takes apart, and it is part of the membership.
