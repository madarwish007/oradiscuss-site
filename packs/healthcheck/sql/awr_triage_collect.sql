-- ============================================================================
-- OraDiscuss - DBA Health Check Automation Pack v1.0.0
-- awr_triage_collect.sql - AWR triage, emitted on the collection contract.
--
-- *** LICENSE REQUIREMENT, STATED AS A FACT AND NOT AS ADVICE ***
-- This script reads DBA_HIST_* views. Reading those views requires the Oracle
-- Diagnostics Pack license. If you are not licensed for Diagnostics Pack on
-- this database, do not run this script. We state the requirement; whether you
-- hold the license is yours to know, and nothing here checks or asserts it.
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
-- Contract emitted (identical to health_check.sql, so one parser serves both):
--          SEC|<section title>
--          CHK|<id>|<OK|WARN|CRIT|NA>|<title>|<detail>
--          MET|<check id>|<name>|<value>|<unit>
--
-- Invoked by awr_triage.sh, which resolves the snapshot pair. It is not run
-- by hand; the wrapper owns argument handling so both argument shapes
-- (a snapshot pair, or --last-hours N) reach the same SQL.
--
-- WHY NO WARN/CRIT ON THE EFFICIENCY RATIOS: the prose version of this script
-- has always told the reader to "compare against YOUR baseline, not textbook
-- numbers". Emitting WARN at some fixed percentage would contradict that in
-- the same breath, and would be exactly the verdict this product does not
-- give. The ratios are therefore reported as measurements with status NA and
-- carried as MET| lines, so an assistant reading the briefing gets the number
-- and the absence of a threshold, rather than a judgement we cannot support.
--
-- License: single-user license, modify allowed, no redistribution.
-- ============================================================================

SET PAGESIZE 0
SET LINESIZE 32767
SET LONG 100000
SET TRIMSPOOL ON
SET TRIMOUT ON
SET FEEDBACK OFF
SET VERIFY OFF
SET HEADING OFF
SET ECHO OFF
SET TERMOUT OFF
WHENEVER SQLERROR EXIT SQL.SQLCODE

-- The wrapper always supplies both, already resolved to real snapshot ids.
DEFINE BSNAP = '&1'
DEFINE ESNAP = '&2'

COLUMN odc_dbid NEW_VALUE DBID_V NOPRINT
SELECT dbid AS odc_dbid FROM v$database;

PROMPT SEC|AWR triage window

-- Both snapshots must exist for this DBID, or every number below is a lie.
-- This is a real check with a real status, unlike the ratios further down.
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

SELECT 'MET|awr_window|begin_snap|' || &BSNAP || '|snap_id' FROM DUAL;
SELECT 'MET|awr_window|end_snap|' || &ESNAP || '|snap_id' FROM DUAL;

-- Elapsed wall-clock of the window, which the assistant needs to turn any
-- "seconds waited" figure into a rate.
SELECT 'MET|awr_window|window_minutes|'
       || TO_CHAR(ROUND((MAX(end_interval_time) - MIN(begin_interval_time)) * 1440, 1))
       || '|minutes'
FROM dba_hist_snapshot
WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP);

SELECT 'CHK|awr_window_times|NA|Window boundaries|'
       || 'Begins ' || TO_CHAR(MIN(begin_interval_time), 'YYYY-MM-DD HH24:MI')
       || ', ends ' || TO_CHAR(MAX(end_interval_time), 'YYYY-MM-DD HH24:MI') || '.'
FROM dba_hist_snapshot
WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP);

PROMPT SEC|Top timed events

-- Foreground wait time by event. Reported as measurements: which event
-- dominates is a fact, what it means for this estate is not ours to say.
SELECT 'CHK|awr_event_' || rn || '|NA|'
       || REPLACE(event, '|', ' ')
       || ' (' || REPLACE(wait_class, '|', ' ') || ')|'
       || time_waited_s || ' s across ' || total_waits
       || ' waits, average ' || avg_wait_ms || ' ms.'
FROM (
  SELECT ROWNUM AS rn, event, wait_class, time_waited_s, total_waits, avg_wait_ms
  FROM (
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
    FETCH FIRST 10 ROWS ONLY
  )
);

SELECT 'MET|awr_event_' || rn || '|time_waited|' || time_waited_s || '|seconds'
FROM (
  SELECT ROWNUM AS rn, time_waited_s FROM (
    SELECT ROUND(SUM(time_waited_micro) / 1e6, 1) AS time_waited_s
    FROM (
      SELECT e.event_name AS event,
             e.time_waited_micro - LAG(e.time_waited_micro) OVER
               (PARTITION BY e.event_name ORDER BY e.snap_id) AS time_waited_micro
      FROM dba_hist_system_event e
      WHERE e.dbid = &DBID_V AND e.snap_id IN (&BSNAP, &ESNAP)
        AND e.wait_class <> 'Idle'
    )
    WHERE time_waited_micro IS NOT NULL
    GROUP BY event
    ORDER BY time_waited_s DESC
    FETCH FIRST 10 ROWS ONLY
  )
);

PROMPT SEC|Top SQL by elapsed time

SELECT 'CHK|awr_sql_' || rn || '|NA|sql_id ' || sql_id || '|'
       || elapsed_s || ' s over ' || NVL(TO_CHAR(execs), 'unknown')
       || ' executions, ' || NVL(TO_CHAR(elapsed_per_exec_s), 'n/a')
       || ' s each, ' || plans || ' distinct plan hash value(s). '
       || REPLACE(REPLACE(sql_text, '|', ' '), CHR(10), ' ')
FROM (
  SELECT ROWNUM AS rn, sql_id, elapsed_s, execs, elapsed_per_exec_s, plans, sql_text
  FROM (
    SELECT s.sql_id,
           ROUND(SUM(s.elapsed_time_delta) / 1e6, 1) AS elapsed_s,
           SUM(s.executions_delta) AS execs,
           ROUND(SUM(s.elapsed_time_delta) / NULLIF(SUM(s.executions_delta), 0) / 1e6, 3) AS elapsed_per_exec_s,
           COUNT(DISTINCT s.plan_hash_value) AS plans,
           SUBSTR(MIN(t.sql_text), 1, 60) AS sql_text
    FROM dba_hist_sqlstat s
    JOIN dba_hist_sqltext t ON t.dbid = s.dbid AND t.sql_id = s.sql_id
    WHERE s.dbid = &DBID_V
      AND s.snap_id BETWEEN &BSNAP AND &ESNAP
    GROUP BY s.sql_id
    ORDER BY elapsed_s DESC
    FETCH FIRST 10 ROWS ONLY
  )
);

SELECT 'MET|awr_sql_' || rn || '|elapsed|' || elapsed_s || '|seconds'
FROM (
  SELECT ROWNUM AS rn, elapsed_s FROM (
    SELECT ROUND(SUM(elapsed_time_delta) / 1e6, 1) AS elapsed_s
    FROM dba_hist_sqlstat
    WHERE dbid = &DBID_V AND snap_id BETWEEN &BSNAP AND &ESNAP
    GROUP BY sql_id
    ORDER BY elapsed_s DESC
    FETCH FIRST 10 ROWS ONLY
  )
);

-- A plan change inside the window is a FACT worth surfacing on its own,
-- because it is the single most common cause of "it was fine yesterday".
-- Still no verdict: it reports that the plan changed, not that it is wrong.
SELECT 'CHK|awr_plan_changes|NA|SQL with more than one plan in the window|'
       || CASE WHEN COUNT(*) = 0
               THEN 'No statement in the top set used more than one plan hash value.'
               ELSE COUNT(*) || ' statement(s) in the window used more than one plan '
                    || 'hash value. A plan change is a fact here, not a fault.'
          END
FROM (
  SELECT sql_id
  FROM dba_hist_sqlstat
  WHERE dbid = &DBID_V AND snap_id BETWEEN &BSNAP AND &ESNAP
  GROUP BY sql_id
  HAVING COUNT(DISTINCT plan_hash_value) > 1
);

PROMPT SEC|Instance efficiency

-- Reported with status NA on purpose. See the header: this pack tells the
-- reader to compare against their own baseline, so it does not invent a
-- threshold it cannot defend.
SELECT 'CHK|awr_eff_' || LOWER(REPLACE(REPLACE(metric, ' ', '_'), '%', 'pct'))
       || '|NA|' || metric || '|'
       || NVL(TO_CHAR(pct), 'not available')
       || CASE WHEN pct IS NULL THEN '' ELSE ' percent' END
       || '. No threshold is applied: compare against this database''s own baseline.'
FROM (
  SELECT 'Buffer Nowait' AS metric,
         ROUND(100 * (1 - SUM(CASE WHEN stat_name = 'buffer busy waits' THEN delta END)
                     / NULLIF(SUM(CASE WHEN stat_name = 'session logical reads' THEN delta END), 0)), 2) AS pct
  FROM (SELECT stat_name, value - LAG(value) OVER (PARTITION BY stat_name ORDER BY snap_id) AS delta
        FROM dba_hist_sysstat WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP))
  UNION ALL
  SELECT 'Buffer Hit',
         ROUND(100 * (1 - SUM(CASE WHEN stat_name = 'physical reads cache' THEN delta END)
                     / NULLIF(SUM(CASE WHEN stat_name IN ('consistent gets from cache', 'db block gets from cache') THEN delta END), 0)), 2)
  FROM (SELECT stat_name, value - LAG(value) OVER (PARTITION BY stat_name ORDER BY snap_id) AS delta
        FROM dba_hist_sysstat WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP))
  UNION ALL
  SELECT 'Library Hit',
         ROUND(100 * SUM(CASE WHEN stat_name = 'library cache hits' THEN delta END)
                   / NULLIF(SUM(CASE WHEN stat_name = 'library cache pins' THEN delta END), 0), 2)
  FROM (SELECT stat_name, value - LAG(value) OVER (PARTITION BY stat_name ORDER BY snap_id) AS delta
        FROM dba_hist_sysstat WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP))
  UNION ALL
  SELECT 'Execute to Parse',
         ROUND(100 * (1 - SUM(CASE WHEN stat_name = 'parse count (total)' THEN delta END)
                     / NULLIF(SUM(CASE WHEN stat_name = 'execute count' THEN delta END), 0)), 2)
  FROM (SELECT stat_name, value - LAG(value) OVER (PARTITION BY stat_name ORDER BY snap_id) AS delta
        FROM dba_hist_sysstat WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP))
  UNION ALL
  SELECT 'Soft Parse',
         ROUND(100 * (1 - SUM(CASE WHEN stat_name = 'parse count (hard)' THEN delta END)
                     / NULLIF(SUM(CASE WHEN stat_name = 'parse count (total)' THEN delta END), 0)), 2)
  FROM (SELECT stat_name, value - LAG(value) OVER (PARTITION BY stat_name ORDER BY snap_id) AS delta
        FROM dba_hist_sysstat WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP))
);

-- The same five ratios again as measurements. NLS_NUMERIC_CHARACTERS is set by
-- the wrapper rather than by an ALTER SESSION here, because ALTER is a DDL verb
-- and the read-only guarantee is worth more than the convenience.
SELECT 'MET|awr_eff_' || LOWER(REPLACE(REPLACE(metric, ' ', '_'), '%', 'pct'))
       || '|' || metric || '|' || NVL(TO_CHAR(pct), '') || '|percent'
FROM (
  SELECT 'Buffer Nowait' AS metric,
         ROUND(100 * (1 - SUM(CASE WHEN stat_name = 'buffer busy waits' THEN delta END)
                     / NULLIF(SUM(CASE WHEN stat_name = 'session logical reads' THEN delta END), 0)), 2) AS pct
  FROM (SELECT stat_name, value - LAG(value) OVER (PARTITION BY stat_name ORDER BY snap_id) AS delta
        FROM dba_hist_sysstat WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP))
  UNION ALL
  SELECT 'Buffer Hit',
         ROUND(100 * (1 - SUM(CASE WHEN stat_name = 'physical reads cache' THEN delta END)
                     / NULLIF(SUM(CASE WHEN stat_name IN ('consistent gets from cache', 'db block gets from cache') THEN delta END), 0)), 2)
  FROM (SELECT stat_name, value - LAG(value) OVER (PARTITION BY stat_name ORDER BY snap_id) AS delta
        FROM dba_hist_sysstat WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP))
  UNION ALL
  SELECT 'Library Hit',
         ROUND(100 * SUM(CASE WHEN stat_name = 'library cache hits' THEN delta END)
                   / NULLIF(SUM(CASE WHEN stat_name = 'library cache pins' THEN delta END), 0), 2)
  FROM (SELECT stat_name, value - LAG(value) OVER (PARTITION BY stat_name ORDER BY snap_id) AS delta
        FROM dba_hist_sysstat WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP))
  UNION ALL
  SELECT 'Execute to Parse',
         ROUND(100 * (1 - SUM(CASE WHEN stat_name = 'parse count (total)' THEN delta END)
                     / NULLIF(SUM(CASE WHEN stat_name = 'execute count' THEN delta END), 0)), 2)
  FROM (SELECT stat_name, value - LAG(value) OVER (PARTITION BY stat_name ORDER BY snap_id) AS delta
        FROM dba_hist_sysstat WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP))
  UNION ALL
  SELECT 'Soft Parse',
         ROUND(100 * (1 - SUM(CASE WHEN stat_name = 'parse count (hard)' THEN delta END)
                     / NULLIF(SUM(CASE WHEN stat_name = 'parse count (total)' THEN delta END), 0)), 2)
  FROM (SELECT stat_name, value - LAG(value) OVER (PARTITION BY stat_name ORDER BY snap_id) AS delta
        FROM dba_hist_sysstat WHERE dbid = &DBID_V AND snap_id IN (&BSNAP, &ESNAP))
);

EXIT
