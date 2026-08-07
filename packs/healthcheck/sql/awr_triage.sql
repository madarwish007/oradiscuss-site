-- ============================================================================
-- OraDiscuss - DBA Health Check Automation Pack v1.0.0
-- awr_triage.sql - compact AWR triage between two snapshot ids.
--
-- *** LICENSE REQUIREMENT ***
-- This script reads DBA_HIST_* views. Using these views requires the
-- Oracle Diagnostics Pack license. Do NOT run on databases where you are
-- not licensed for Diagnostics Pack.
--
-- Written for Oracle 19c/21c.
--
-- Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
-- affiliated with, or endorsed by Oracle Corporation.
-- READ-ONLY: this pack issues no DDL and no DML against your data.
--
-- Review it before you run it, and run it somewhere that is not production
-- first. You are the DBA.
-- READ-ONLY: SELECTs only.
--
-- Usage (accepts substitution vars):
--   sqlplus / as sysdba @awr_triage.sql <begin_snap> <end_snap>
-- or run interactively and answer the prompts.
--
-- Output: spools a plain-text triage report to awr_triage_<begin>_<end>.txt
-- with three sections: top timed events, top SQL by elapsed time, and
-- instance efficiency percentages. Each section below is commented with
-- what it means and what to do next.
--
-- License: single-user license, modify allowed, no redistribution.
-- ============================================================================

SET PAGESIZE 200
SET LINESIZE 220
SET TRIMSPOOL ON
SET FEEDBACK OFF
SET VERIFY OFF
WHENEVER SQLERROR EXIT SQL.SQLCODE

DEFINE BSNAP = '&1'
DEFINE ESNAP = '&2'
DEFINE DBID_V = ''

-- Resolve DBID of the current database (AWR data is keyed by DBID).
COLUMN odc_dbid NEW_VALUE DBID_V NOPRINT
SELECT dbid AS odc_dbid FROM v$database;

-- Sanity check: both snapshots must exist for this DBID.
COLUMN odc_ok NEW_VALUE ODC_OK NOPRINT
SELECT CASE WHEN COUNT(*) = 2 THEN 'YES' ELSE 'NO' END AS odc_ok
FROM dba_hist_snapshot
WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP);

PROMPT
PROMPT =====================================================================
PROMPT AWR TRIAGE - snaps &BSNAP .. &ESNAP (requires Diagnostics Pack license)
PROMPT =====================================================================

SPOOL awr_triage_&BSNAP._&ESNAP..txt

PROMPT
PROMPT ==== Snapshot window ===================================================
SELECT snap_id, TO_CHAR(begin_interval_time, 'YYYY-MM-DD HH24:MI') AS begin_time,
       TO_CHAR(end_interval_time, 'YYYY-MM-DD HH24:MI') AS end_time
FROM dba_hist_snapshot
WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP)
ORDER BY snap_id;

-- ---------------------------------------------------------------------------
-- SECTION 1 - TOP TIMED EVENTS
-- WHAT THIS MEANS: where foreground (user) sessions spent their time.
--   High 'DB CPU' with a healthy workload is fine; high waits dominate when
--   something is wrong. 'db file sequential read' = single-block reads
--   (usually index access, often buffer-cache / storage latency).
--   'log file sync' = commit latency. 'enq: TX - row lock contention' =
--   application blocking. 'cursor: pin S wait on X' / library cache = parsing
--   storms.
-- WHAT TO DO NEXT: investigate the top 1-2 events only. Correlate with the
--   Top SQL below (section 2), then drill into that SQL's plan (DBMS_XPLAN
--   with AWR source) or the object being waited on.
-- ---------------------------------------------------------------------------
PROMPT
PROMPT ==== Top timed events (by total wait time, microseconds) ==============
COLUMN event FORMAT A45
COLUMN wait_class FORMAT A20
SELECT event, wait_class,
       ROUND(SUM(time_waited_micro) / 1e6, 1) AS time_waited_s,
       SUM(total_waits) AS total_waits,
       ROUND(SUM(time_waited_micro) / NULLIF(SUM(total_waits), 0) / 1000, 2) AS avg_wait_ms
FROM (
  SELECT e.event_name AS event, e.wait_class,
         e.time_waited_micro - LAG(e.time_waited_micro) OVER
           (PARTITION BY e.event_name ORDER BY e.snap_id) AS time_waited_micro,
         e.total_waits - LAG(e.total_waits) OVER
           (PARTITION BY e.event_name ORDER BY e.snap_id) AS total_waits
  FROM dba_hist_system_event e
  WHERE e.dbid = &DBID_V
    AND e.snap_id IN (&BSNAP, &ESNAP)
    AND e.wait_class <> 'Idle'
)
WHERE time_waited_micro IS NOT NULL
GROUP BY event, wait_class
ORDER BY time_waited_s DESC
FETCH FIRST 10 ROWS ONLY;

-- ---------------------------------------------------------------------------
-- SECTION 2 - TOP SQL BY ELAPSED TIME
-- WHAT THIS MEANS: the SQL statements that consumed the most elapsed time
--   inside this snapshot window. ELAPSED includes CPU + all waits.
--   'execs' = executions; elapsed_per_exec helps spot whether you have one
--   slow execution or many mediocre ones.
-- WHAT TO DO NEXT: take the top sql_id values and run:
--     SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_AWR('<sql_id>'));
--   Check for plan changes across the window (multiple plan_hash_values),
--   then look at object stats / indexing. One statement dominating usually
--   beats ten small ones for tuning effort.
-- ---------------------------------------------------------------------------
PROMPT
PROMPT ==== Top 10 SQL by elapsed time =======================================
COLUMN sql_id FORMAT A14
COLUMN sql_text FORMAT A60
SELECT sql_id,
       ROUND(SUM(elapsed_time_delta) / 1e6, 1) AS elapsed_s,
       SUM(executions_delta) AS execs,
       ROUND(SUM(elapsed_time_delta) / NULLIF(SUM(executions_delta), 0) / 1e6, 3) AS elapsed_per_exec_s,
       COUNT(DISTINCT plan_hash_value) AS plans,
       SUBSTR(MIN(sql_text), 1, 60) AS sql_text
FROM dba_hist_sqlstat s
JOIN dba_hist_sqltext t USING (dbid, sql_id)
WHERE s.dbid = &DBID_V
  AND s.snap_id BETWEEN &BSNAP AND &ESNAP
GROUP BY sql_id
ORDER BY elapsed_s DESC
FETCH FIRST 10 ROWS ONLY;

-- ---------------------------------------------------------------------------
-- SECTION 3 - INSTANCE EFFICIENCY PERCENTAGES
-- WHAT THIS MEANS: classic ratios.
--   Buffer Nowait %     - how often a buffer was available without waiting;
--                         low values hint at cache contention.
--   Buffer Hit %        - cache hit ratio. NOT a tuning target by itself,
--                         but a sudden drop vs. baseline is a smoke signal.
--   Library Hit %       - shared SQL reuse; low = hard parsing or cursor
--                         churn (check for non-shared SQL / literals).
--   Execute to Parse %  - work per parse; low = over-parsing.
--   Parse CPU to Parse Elapsed % - parse time spent on CPU vs waiting.
--   Soft Parse %        - share of parses that were soft.
-- WHAT TO DO NEXT: compare against YOUR baseline, not textbook numbers.
--   Ratios below ~90% warrant a look at cursor_sharing, bind variables,
--   shared pool sizing, or application SQL patterns.
-- ---------------------------------------------------------------------------
PROMPT
PROMPT ==== Instance efficiency percentages ==================================
COLUMN metric FORMAT A35
SELECT 'Buffer Nowait %' AS metric,
       ROUND(100 * (1 - SUM(CASE WHEN stat_name = 'buffer busy waits' THEN delta END)
                   / NULLIF(SUM(CASE WHEN stat_name = 'session logical reads' THEN delta END), 0)), 2) AS pct
FROM (
  SELECT stat_name,
         value - LAG(value) OVER (PARTITION BY stat_name ORDER BY snap_id) AS delta
  FROM dba_hist_sysstat
  WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP)
)
UNION ALL
SELECT 'Buffer Hit %',
       ROUND(100 * (1 - SUM(CASE WHEN stat_name = 'physical reads cache' THEN delta END)
                   / NULLIF(SUM(CASE WHEN stat_name IN ('consistent gets from cache', 'db block gets from cache') THEN delta END), 0)), 2)
FROM (
  SELECT stat_name,
         value - LAG(value) OVER (PARTITION BY stat_name ORDER BY snap_id) AS delta
  FROM dba_hist_sysstat
  WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP)
)
UNION ALL
SELECT 'Library Hit %',
       ROUND(100 * SUM(CASE WHEN stat_name = 'library cache hits' THEN delta END)
                 / NULLIF(SUM(CASE WHEN stat_name = 'library cache pins' THEN delta END), 0), 2)
FROM (
  SELECT stat_name,
         value - LAG(value) OVER (PARTITION BY stat_name ORDER BY snap_id) AS delta
  FROM dba_hist_sysstat
  WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP)
)
UNION ALL
SELECT 'Execute to Parse %',
       ROUND(100 * (1 - SUM(CASE WHEN stat_name = 'parse count (total)' THEN delta END)
                   / NULLIF(SUM(CASE WHEN stat_name = 'execute count' THEN delta END), 0)), 2)
FROM (
  SELECT stat_name,
         value - LAG(value) OVER (PARTITION BY stat_name ORDER BY snap_id) AS delta
  FROM dba_hist_sysstat
  WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP)
)
UNION ALL
SELECT 'Soft Parse %',
       ROUND(100 * (1 - SUM(CASE WHEN stat_name = 'parse count (hard)' THEN delta END)
                   / NULLIF(SUM(CASE WHEN stat_name = 'parse count (total)' THEN delta END), 0)), 2)
FROM (
  SELECT stat_name,
         value - LAG(value) OVER (PARTITION BY stat_name ORDER BY snap_id) AS delta
  FROM dba_hist_sysstat
  WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP)
);

PROMPT
PROMPT ==== Next steps =======================================================
PROMPT 1. Check the top 1-2 wait events against the top SQL above.
PROMPT 2. DBMS_XPLAN.DISPLAY_AWR('<sql_id>') for plans of the top statements.
PROMPT 3. Compare against your normal baseline window before changing anything.
PROMPT 4. Full AWR report for detail: @?/rdbms/admin/awrrpt.sql

SPOOL OFF
EXIT
