---
course: performance-recovery-mastery
module: "Performance evidence: from 'the database is slow' to a ranked set of cited facts"
order: 4
title: The overall status said OK. Eight checks said nothing.
summary: A briefing separates what was measured from what could not be determined, and the second list is usually longer. This lesson reads a captured briefing for its silences, and finds a number that did not survive the file format.
estimatedMinutes: 30
prerequisites:
  - A machine with bash and grep. No database is contacted.
  - The OraDiscuss DBA Health Check Automation Pack v1.0.0, unpacked somewhere you can read and copy files.
  - Nothing from earlier lessons needs to still exist. This lab starts from its own setup.
oracleVersions:
  - 19c
  - 26ai
lastReviewed: 2026-08-09
draft: false
---

## What this lesson answers

The briefing says the overall status is OK and there is nothing needing attention. How much of that is a measurement, and what did the collection try to determine and fail?

## Applicability

Written against **Oracle Database 19c** and **Oracle AI Database 26ai**, Enterprise Edition, and against the OraDiscuss DBA Health Check Automation Pack **v1.0.0**.

**Licence requirement.** The collection being read here would, on a live database, come from `DBA_HIST_` views inside the **Oracle Diagnostics Pack**. Lesson 1 has the wording and the audit. **This lab replays a captured collection and needs neither the pack nor a database.**

**What was checked, and what was not.** Every command and output below was run on 9 August 2026, GNU bash 3.2.57, pack v1.0.0, on a machine with no Oracle home. The input is the pack's own synthetic test fixture, so **its numbers are not a measurement of any database**. The Oracle view descriptions were read on Oracle's documentation the same day. **No statement here has been run against a running Oracle instance by this project.**

## The mechanism

The briefing is one JSON document with a fixed spine: a `generator` block naming the pack and script, a `collection` block carrying `read_only` and where the file was written, a `summary`, a `thresholds` object, and a `checks` array. Each check has an `id`, a `section`, a `status`, a `title`, a human `detail`, and a `metrics` object.

The summary is the part people read and the part most easily misread. It carries three things:

- `overall_status`, the worst status any check returned.
- `counts`, with a separate tally for `OK`, `WARN`, `CRIT` and **`NA`**.
- `needs_attention`, the ids of checks that returned `WARN` or `CRIT`.

**`NA` is counted and is deliberately kept out of `needs_attention`.** It means the check could not be determined. It is not a pass, and it is not an alarm, and the briefing refuses to file it as either. That single design decision is what lets a reader tell a clean bill of health from an incomplete collection, and the difference between those two is most of the value in the document.

### A number can be lost without the file breaking

The briefing is assembled in shell, without `jq`, because `jq` is not installable on many database hosts and a pack that needs it cannot run where it matters. Every value that goes into a numeric field is validated first: if it is not a JSON number, the emitter writes `null`.

That is not fussiness. A collection run under a locale that writes decimals with a comma emits `87,3`, which is not a JSON number, and one of those would make the entire document unparseable at exactly the moment somebody wanted to hand it to an assistant. The pack sets `NLS_NUMERIC_CHARACTERS` in the environment to prevent it, and validates on the way out in case something got through anyway.

The consequence to carry: **`null` in a metric is not zero, and it is not "the database reported nothing".** It is "a value arrived and this document could not represent it". You have to go back to the collection to see what it was.

### An empty metrics object is a third thing

`"metrics": {}` means no `MET` line was recorded against that check id. The check ran, produced a human-readable detail, and carried no machine-readable measurement. That is different from a metric present with a `null` value, and different again from a metric present with a number.

Three states, three meanings, and any tool or assistant reading the file has to keep them apart.

### What the top SQL section is, and is not

Two documented facts bound it. Oracle's reference says `DBA_HIST_SQLSTAT` "captures the top SQL statements based on a set of criteria". And `DBA_HIST_WR_CONTROL.TOPNSQL` is "The number of Top SQL flushed for each SQL criteria (elapsed time, CPU time, parse calls, sharable memory, version count)".

So the section is a top list of a top list. A statement can be absent because it did not run, or because it ran and did not make the cut, and the section itself cannot tell you which. The collector then takes its own top ten from what the repository kept.

One more difference inside the same report, visible in the collector's SQL and worth knowing before you compare two sections. The wait event and instance efficiency sections read `snap_id IN (begin, end)`, which is a difference between the two endpoints. The top SQL and plan change sections read `snap_id BETWEEN begin AND end`, which aggregates every snapshot in the range. For cumulative counters the endpoint difference is the whole window's change, so both are defensible, and they are not the same query.

## At the terminal

**Setup.** Produce a briefing to read. This is the same replay as lesson 3, repeated here so this lab does not depend on that one still being on disk.

```bash
export PACK_DIR="${HOME}/oradiscuss-healthcheck/packs/healthcheck"   # wherever you unpacked it
export LAB="${HOME}/od-lab-b1"
mkdir -p "${LAB}/out"
sed 's|^OUTPUT_DIR=.*|OUTPUT_DIR="'"${LAB}"'/out"|' "${PACK_DIR}/config.env" > "${LAB}/config.env"
cp "${PACK_DIR}/test-fixtures/awr_raw_hostile.txt" "${LAB}/awr_raw_LAB_001.txt"
cd "${PACK_DIR}"
./awr_triage.sh --config "${LAB}/config.env" --render-only "${LAB}/awr_raw_LAB_001.txt"
export BRIEF="${LAB}/out/reports/awr_triage_LAB_001.json"
```

**The lab.** Five readings, in this order, because each one changes how you read the next.

First, the status tally, taken from the checks themselves rather than from the summary that claims to describe them.

```bash
grep -o '"status":"[A-Z]*"' "${BRIEF}" | sort | uniq -c
```

```text
# captured 2026-08-09, GNU bash 3.2.57, pack v1.0.0, synthetic fixture input
   8 "status":"NA"
   1 "status":"OK"
```

Nine checks. One of them was determined.

Second, what the summary says about that.

```bash
grep -o '"overall_status": "[A-Z]*"' "${BRIEF}"
grep -o '"needs_attention": \[[^]]*\]' "${BRIEF}"
```

```text
# captured 2026-08-09, same run
"overall_status": "OK"
"needs_attention": []
```

Both statements are true. Neither says the database is fine.

Third, every measurement in the document, with its value.

```bash
grep -o '"[A-Za-z_ ]*":{"value":[^,]*' "${BRIEF}"
```

```text
# captured 2026-08-09, same run, synthetic fixture input
"begin_snap":{"value":41201
"end_snap":{"value":41205
"window_minutes":{"value":240.0
"time_waited":{"value":18422.7
"time_waited":{"value":4110.2
"elapsed":{"value":9911.4
"Buffer Hit":{"value":98.71
"Soft Parse":{"value":null
```

Fourth, chase that `null` back into the collection it came from.

```bash
grep 'Soft Parse' "${LAB}/awr_raw_LAB_001.txt"
```

```text
# captured 2026-08-09, same run
CHK|awr_eff_soft_parse|NA|Soft Parse|not available. No threshold is applied: compare against this database's own baseline.
MET|awr_eff_soft_parse|Soft Parse|87,3|percent
```

The collection carried the characters `87,3`. That is not a JSON number, so the briefing carries `null`. The human-facing line in the same collection says "not available" for its own separate reason. Two routes, one missing number, and only the raw collection tells you the difference.

Fifth, the checks that carried no measurement at all.

```bash
grep -o '"metrics":{}' "${BRIEF}" | wc -l
```

```text
# captured 2026-08-09, same run
       3
```

Three of the nine checks have an empty metrics object. Their detail strings are the only thing they contribute, which is fine for a boundary description and thin for anything you want to rank.

**Teardown.**

```bash
rm -rf "${HOME}/od-lab-b1"
```

## Read it wrong

**`overall_status: OK` is a statement about statuses, not about the database.** Here it means no check returned `WARN` or `CRIT`, and eight of the nine were never in a position to. Read `counts.NA` before you read `overall_status`, every time, and treat a briefing where NA dominates as an incomplete collection rather than a quiet estate.

**`needs_attention: []` is the most misread line in the file.** It is the line a skim turns into "nothing to do". It means no check reached a threshold, and in this collection only one check has a threshold at all.

**`null` is not zero and it is not absence.** The measurement existed in the collection. It did not survive the contract between the collection and the file. If you are ranking metrics and you treat `null` as zero, you have ranked a missing value as the best one.

**An empty `metrics` object is not a measurement of nothing.** It means no `MET` line was recorded for that id. In this fixture, one of the two top SQL entries has a detail line with figures in the prose and no metric object behind it, so a tool that ranks by `metrics` will not see it at all.

**Absence from the top SQL section proves nothing about the statement.** `TOPNSQL` decides how many statements per criterion the repository kept, and the collector then takes its own top ten of those. A statement you were looking for and did not find may have been cheap, may have missed the cut, or may not have run. The evidence does not distinguish those, and saying so is a better answer than picking one.

**One plan hash value is not one plan for the window.** The plan change check reports how many statements used more than one plan hash value inside the range, and it says in its own words that a plan change is a fact and not a fault. It does not say which plan was better, and neither should you until you have looked.

## Check your work

1. The status tally is exactly `8 NA` and `1 OK`, nine checks in total.
2. `overall_status` is `OK` while `counts.NA` is `8`. If those two facts sitting together look wrong to you, this lesson worked.
3. The metric list has **8** lines, and exactly one of them ends in `null`.
4. The `grep` against the raw collection shows `87,3` on the `MET` line. That is the value the `null` replaced.
5. `"metrics":{}` appears **3** times.
6. `grep -o '"read_only": [a-z]*' "${BRIEF}"` returns `true`. The document asserts the collection was read-only in the data, not only in the file header, so a consumer can check it rather than trust it.

## Where this goes next

- *Database Reference, 26ai: DBA_HIST_SQLSTAT*, `https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/DBA_HIST_SQLSTAT.html`, for the "top SQL statements based on a set of criteria" wording
- *Database Reference, 26ai: DBA_HIST_WR_CONTROL*, `https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/DBA_HIST_WR_CONTROL.html`, for `TOPNSQL`, `SNAP_INTERVAL` and `RETENTION`
- The briefing's own contract is in `schema/briefing.schema.json` inside the pack, and it is worth reading beside the file this lab produced

The OraDiscuss DBA Health Check Automation Pack ships `lib/odc_briefing.sh` and `schema/briefing.schema.json`, which are the emitter and the contract read in this lesson, and it is part of the membership.
