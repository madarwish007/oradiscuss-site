---
course: performance-recovery-mastery
module: "Performance evidence: from 'the database is slow' to a ranked set of cited facts"
order: 1
title: "Before the first command: which of these tools needs a licence"
summary: AWR, ADDM and ASH are part of a separately licensed pack, and the database will not stop you. This lesson audits a collection script for its licensed surface before it is ever run.
estimatedMinutes: 25
prerequisites:
  - A machine with bash, grep, sort and comm. No database is contacted.
  - The OraDiscuss DBA Health Check Automation Pack v1.0.0, unpacked somewhere you can read it.
oracleVersions:
  - 19c
  - 26ai
lastReviewed: 2026-08-09
draft: false
---

## What this lesson answers

Somebody hands you a script that reads AWR. Before you run it anywhere, which parts of it are covered by a licence your employer may not hold, and how do you find that out from the script itself rather than from whoever sent it?

## Applicability

Written against **Oracle Database 19c** and **Oracle AI Database 26ai**, Enterprise Edition. Every claim below about licensing was checked against Oracle's own documentation for **both** releases on 9 August 2026, and the sentences quoted are identical in the two documents.

**Licence requirement, stated before the first command.** Automatic Workload Repository (AWR), Automatic Database Diagnostic Monitor (ADDM) and Active Session History (ASH) are part of the **Oracle Diagnostics Pack**. SQL Tuning Advisor and SQL Access Advisor are part of the **Oracle Tuning Pack**. Both are separately licensed on Enterprise Edition. Oracle's *Get Started with Performance Tuning* guide for 26ai states it in one sentence: "Some of the products and tools in the preceding list, including Oracle Diagnostics Pack and Oracle Tuning Pack, require separate licenses." The Tuning Pack is not independent of the Diagnostics Pack: the `CONTROL_MANAGEMENT_PACK_ACCESS` reference page states that "A license for DIAGNOSTIC is required for enabling the TUNING pack."

**This lesson's lab needs neither pack and no database.** It reads files on your own machine.

**What was checked, and what was not.** The lab below was run end to end on 9 August 2026 against the shipped pack, on a machine with no Oracle home. The Oracle statements were read on Oracle's documentation pages for 19c and 26ai on the same date. **No statement in this lesson has been run against a running Oracle instance by this project.** Where a statement is addressed to a database it is addressed to your lab estate, and it is yours to check.

## The mechanism

The thing most often got wrong here is where the licence attaches. It does not attach to a tool you install or a button in a console. It attaches to **the data**, which means it also attaches to a plain `SELECT` typed by hand at SQL\*Plus.

Oracle's *Licensing Information User Manual* says so twice. Once about the views:

> All data dictionary views beginning with the prefix DBA_HIST_ are part of this pack, along with their underlying tables. The only exception are the views: DBA_HIST_SNAPSHOT, DBA_HIST_DATABASE_INSTANCE, DBA_HIST_SNAP_ERROR, DBA_HIST_SEG_STAT, DBA_HIST_SEG_STAT_OBJ, and DBA_HIST_UNDOSTAT. They can be used without the Oracle Diagnostics Pack license.

And once about the routes to them:

> Any and all methods of accessing Oracle Diagnostics Pack functionality, whether through Enterprise Manager Console, Desktop Widgets, command-line APIs, or direct access to the underlying data, requires an Oracle Diagnostics Pack license.

The same document also places `V$ACTIVE_SESSION_HISTORY` and its underlying table `X$ASH` inside the pack, which is worth knowing because it is the one `V$` view a DBA reaches for when he is trying to avoid AWR.

Both passages appear, word for word, in the 19c manual and in the 26ai manual. That matters: it means an audit finding on a 19c estate does not stop being a finding after an upgrade.

### The parameter that is not an entitlement check

`CONTROL_MANAGEMENT_PACK_ACCESS` "specifies which of the Server Manageability Packs should be active". It takes three values. `NONE` makes neither pack available. `DIAGNOSTIC` makes only the Diagnostics Pack available, and the reference page notes that the pack "includes AWR, ADDM, and so on". `DIAGNOSTIC+TUNING` makes both available.

Two facts about it decide how you should read it.

The first is the default. On **Enterprise Edition the default is `DIAGNOSTIC+TUNING`**, on other editions the default is `NONE`. So on a stock Enterprise Edition instance both packs are switched on, and the database will hand you an AWR report without a word about money.

The second is what the parameter is for. It controls **availability**, not entitlement. Nothing in the database knows what your organisation bought. A `DIAGNOSTIC+TUNING` setting tells you the feature is switched on and tells you nothing at all about whether you are allowed to use it. The reference page also records that the parameter is modifiable by `ALTER SYSTEM` but **not modifiable in a PDB**, which is a detail worth carrying into any multitenant estate.

### What is left if you do not have the pack

Wait time and system statistics have a live, cumulative form that AWR takes its snapshots from. Oracle's reference describes `DBA_HIST_SYSTEM_EVENT` as containing "snapshots of `V$SYSTEM_EVENT`", and `DBA_HIST_SYSSTAT` as containing "snapshots of `V$SYSSTAT`". The `V$` originals are the same counters before the repository stored them.

> **Documented, not observed here.** Oracle's *Licensing Information User Manual* for 19c and for 26ai names `V$ACTIVE_SESSION_HISTORY` and `X$ASH` as part of the Diagnostics Pack, and does not name `V$SYSTEM_EVENT` or `V$SYSSTAT` anywhere in the document. That is an absence in a list, which is weaker evidence than a sentence granting permission, and this lesson has not reproduced it against a running instance. Read the manual for your own release and edition, and take your licensing position from your contract rather than from a course. Source: *Oracle Database Licensing Information User Manual*, linked below.

The practical difference between the two families is arithmetic, and lesson 3 of this module returns to it. AWR keeps a row per snapshot, so a window is a subtraction between two stored rows. The `V$` views hold one running total, so a window is a subtraction between two readings **you** took, which means you have to take the first one before the trouble starts.

## At the terminal

The lab is an audit. You are going to take a script that reads AWR and produce, from the script itself, the list of views it touches and which of them Oracle places inside the Diagnostics Pack. It is the check to run on any script anybody hands you, including this one.

**Setup.** Nothing here contacts a database, and nothing is created inside a database.

```bash
export PACK_DIR="${HOME}/oradiscuss-healthcheck/packs/healthcheck"   # wherever you unpacked it
mkdir -p "${HOME}/od-lab-b1"
cd "${PACK_DIR}"
echo "oracle home: ${ORACLE_HOME:-none}"
```

That last line is part of the setup, not decoration. These labs are meant to run where there is no Oracle home, so a mistyped command cannot reach an instance.

```text
# captured 2026-08-09, GNU bash 3.2.57, pack v1.0.0, no database contacted
oracle home: none
```

**The lab.** First, the list of views the collector names.

```bash
grep -oiE 'dba_hist_[a-z_]+' sql/awr_triage_collect.sql \
  | tr 'A-Z' 'a-z' | LC_ALL=C sort -u > "${HOME}/od-lab-b1/views_read.txt"
cat "${HOME}/od-lab-b1/views_read.txt"
```

```text
# captured 2026-08-09 from packs/healthcheck/sql/awr_triage_collect.sql v1.0.0
dba_hist_snapshot
dba_hist_sqlstat
dba_hist_sqltext
dba_hist_sysstat
dba_hist_system_event
```

Now Oracle's exception list, typed out from the *Licensing Information User Manual* passage quoted above, and sorted the same way.

```bash
LC_ALL=C sort > "${HOME}/od-lab-b1/views_exempt.txt" <<'LIST'
dba_hist_database_instance
dba_hist_seg_stat
dba_hist_seg_stat_obj
dba_hist_snap_error
dba_hist_snapshot
dba_hist_undostat
LIST

LC_ALL=C comm -23 "${HOME}/od-lab-b1/views_read.txt" "${HOME}/od-lab-b1/views_exempt.txt"
```

`comm -23` prints the lines in the first file that are not in the second, which here is exactly the set of views that carry the licence.

```text
# captured 2026-08-09, same run
dba_hist_sqlstat
dba_hist_sqltext
dba_hist_sysstat
dba_hist_system_event
```

**The underlying SQL, since you should never take a wrapper's word for what it reads.** This is the collector's first statement, and it is the one that uses the exempt view. The `&1` and `&2` are the snapshot ids the wrapper passes in.

```sql
SELECT 'CHK|awr_window|'
       || CASE WHEN COUNT(*) = 2 THEN 'OK' ELSE 'CRIT' END
       || '|Snapshot pair resolves|'
       || CASE WHEN COUNT(*) = 2
               THEN 'Snapshots &BSNAP and &ESNAP both exist for dbid &DBID_V.'
               ELSE 'Expected 2 snapshots for dbid &DBID_V, found '
                    || COUNT(*) || '. The window below cannot be trusted.'
          END
FROM dba_hist_snapshot
WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP);
```

**Teardown.**

```bash
rm -rf "${HOME}/od-lab-b1"
```

Nothing was created anywhere else, and no database was contacted, so that is the whole teardown.

## Read it wrong

**The database answering is not the database licensing.** On Enterprise Edition the packs are available by default. A query that returns rows has told you the feature is switched on. It has told you nothing about your contract, and the audit does not care which of you typed the statement.

**The lab reads names, not reachability.** `grep` finds the views the SQL text mentions. It cannot find a view reached indirectly, through another view or through a procedure, and it will happily match a view name that appears only in a comment. Treat the output as the floor of the licensed surface, not the ceiling. Reading the whole file remains the only complete answer, and it is 279 lines.

**One exempt view does not make a script exempt.** `DBA_HIST_SNAPSHOT` being on Oracle's exception list is the reason the window check is not the licensed part. Four of the five views in this collector are inside the pack, and one is enough.

**The exception list belongs to a release.** The six names above were read in the 19c and 26ai manuals. They agree with each other today. If you are on another release, the manual for that release is the only list that counts, and it is one page to check.

**A wrapper's header is a claim, not a control.** This pack prints the licence requirement in the script header, in the collector's header, and on the face of every report it produces. That is disclosure, and disclosure is worth having. It is still not a check: nothing in the script asks the database whether you are entitled, because nothing in the database knows.

## Check your work

Three observations, all of them falsifiable, and the first two are exact counts.

1. `wc -l < "${HOME}/od-lab-b1/views_read.txt"` prints **5**. The collector names five `DBA_HIST_` views.
2. The `comm -23` output has **4** lines. Four of the five carry the Diagnostics Pack.
3. The one name that disappeared between the two lists is `dba_hist_snapshot`, and it is one of the six Oracle names in the exception passage quoted above.

If the first number is not 5, you are pointing at a different file or a different pack version. If the third name is anything else, re-read your exception list against the manual rather than against this page.

One more, on the disclosure rather than the licence:

```bash
grep -c 'Diagnostics Pack' "${PACK_DIR}/awr_triage.sh" "${PACK_DIR}/sql/awr_triage_collect.sql"
```

Both files return a non-zero count. A collection script that reads these views and says nothing about the pack is a script to read more carefully before running.

## Where this goes next

- *Get Started with Performance Tuning, 26ai: Tools for Tuning the Database*, `https://docs.oracle.com/en/database/oracle/oracle-database/26/tdppt/tools-tuning-database.html`
- *Oracle Database Licensing Information User Manual, 26ai*, `https://docs.oracle.com/en/database/oracle/oracle-database/26/dblic/Licensing-Information.html`, and the 19c edition at `https://docs.oracle.com/en/database/oracle/oracle-database/19/dblic/Licensing-Information.html`
- *Database Reference, 26ai: CONTROL_MANAGEMENT_PACK_ACCESS*, `https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/CONTROL_MANAGEMENT_PACK_ACCESS.html`, and the 19c page at `https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/CONTROL_MANAGEMENT_PACK_ACCESS.html`

The OraDiscuss DBA Health Check Automation Pack ships `awr_triage.sh` and `sql/awr_triage_collect.sql`, which are the files audited above, and it is part of the membership.
