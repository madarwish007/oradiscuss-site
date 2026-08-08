-- ============================================================================
-- OraDiscuss - RCA Generator Pack v1.0.0
-- sql/rca_awr_evidence.sql - what the workload was doing during the window.
--
-- Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
-- affiliated with, or endorsed by Oracle Corporation.
-- READ-ONLY: this pack issues no DDL and no DML against your data.
--
-- Review it before you run it, and run it somewhere that is not production
-- first. You are the DBA.
--
-- ORACLE DIAGNOSTICS PACK LICENCE REQUIRED. This file reads DBA_HIST_* views,
-- which are licensable separately from the database. The caller checks
-- `control_management_pack_access` BEFORE running this and records an NA check
-- naming the licence when it is not available, so an unlicensed customer gets a
-- report that says why this section is empty rather than a failed run.
--
-- That is stated as a FACT about what the file reads. It is deliberately not
-- advice about whether the reader holds the licence, which is not ours to
-- judge and is exactly the kind of conclusion this product does not draw.
--
-- Invoked by rca_generator.sh with:
--   &1 = window start, 'YYYY-MM-DD HH24:MI:SS'
--   &2 = window end,   'YYYY-MM-DD HH24:MI:SS'
--   &3 = spool file
--
-- Emits SEC|, CHK| and MET| lines. Every status here is NA, and that is a
-- design decision rather than an oversight: see the note on the first check.
--
-- License: single-user license, modify allowed, no redistribution.
-- ============================================================================

SET PAGES 0 FEEDBACK OFF HEADING OFF VERIFY OFF LINES 4000 TRIMSPOOL ON
WHENEVER SQLERROR EXIT SQL.SQLCODE

DEFINE win_from = &1
DEFINE win_to   = &2

SPOOL &3

PROMPT SEC|Workload evidence in the window (Diagnostics Pack)

-- ---------------------------------------------------------------------------
-- EVERY ROW BELOW CARRIES STATUS NA, ON PURPOSE.
--
-- OK, WARN and CRIT are judgements against a threshold. There is no threshold
-- that makes "db file sequential read was the top wait" good or bad: it is the
-- top wait on a great many perfectly healthy databases, and it is the signature
-- of a storage incident on others. The same is true of every number here.
--
-- The pack already made this decision once, for the AWR efficiency ratios, and
-- a guard enforces it there. Emitting a WARN at some invented percentage would
-- contradict the sentence sitting in the same document, and it would be the
-- kind of verdict this product does not give.
--
-- NA in this schema means "could not be determined", and the summary counts it
-- separately from OK precisely so that a reader can tell a clean bill of health
-- from an incomplete one. Evidence is what these are, and evidence is for the
-- reader to weigh.
-- ---------------------------------------------------------------------------

SELECT 'CHK|AWRWAIT_' || TO_CHAR(rn) || '|NA|Top wait ' || TO_CHAR(rn) || '|' ||
       event_name || ' (' || wait_class || '): ' ||
       TO_CHAR(ROUND(secs, 1), 'FM9999999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') ||
       ' seconds waited across the window, ' ||
       TO_CHAR(waits) || ' waits. Evidence only, weighed against your own baseline.'
  FROM (SELECT ROW_NUMBER() OVER (ORDER BY SUM(e.time_waited_micro_fg) DESC, e.event_name) AS rn,
               e.event_name,
               MAX(e.wait_class) AS wait_class,
               SUM(e.time_waited_micro_fg) / 1000000 AS secs,
               SUM(e.total_waits_fg) AS waits
          FROM dba_hist_system_event e
          JOIN dba_hist_snapshot s
            ON s.snap_id = e.snap_id AND s.dbid = e.dbid AND s.instance_number = e.instance_number
         WHERE s.end_interval_time >= TO_TIMESTAMP('&win_from', 'YYYY-MM-DD HH24:MI:SS')
           AND s.begin_interval_time <= TO_TIMESTAMP('&win_to', 'YYYY-MM-DD HH24:MI:SS')
           AND e.wait_class <> 'Idle'
         GROUP BY e.event_name
         ORDER BY SUM(e.time_waited_micro_fg) DESC, e.event_name
         FETCH FIRST 5 ROWS ONLY);

SELECT 'MET|AWRWAIT_' || TO_CHAR(rn) || '|seconds_waited|' ||
       TO_CHAR(ROUND(secs, 1), 'FM9999999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') || '|seconds'
  FROM (SELECT ROW_NUMBER() OVER (ORDER BY SUM(e.time_waited_micro_fg) DESC, e.event_name) AS rn,
               SUM(e.time_waited_micro_fg) / 1000000 AS secs
          FROM dba_hist_system_event e
          JOIN dba_hist_snapshot s
            ON s.snap_id = e.snap_id AND s.dbid = e.dbid AND s.instance_number = e.instance_number
         WHERE s.end_interval_time >= TO_TIMESTAMP('&win_from', 'YYYY-MM-DD HH24:MI:SS')
           AND s.begin_interval_time <= TO_TIMESTAMP('&win_to', 'YYYY-MM-DD HH24:MI:SS')
           AND e.wait_class <> 'Idle'
         GROUP BY e.event_name
         ORDER BY SUM(e.time_waited_micro_fg) DESC, e.event_name
         FETCH FIRST 5 ROWS ONLY);

PROMPT SEC|Heaviest statements in the window (Diagnostics Pack)

SELECT 'CHK|AWRSQL_' || TO_CHAR(rn) || '|NA|Heaviest statement ' || TO_CHAR(rn) || '|' ||
       'sql_id ' || sql_id || ': ' ||
       TO_CHAR(ROUND(elapsed_s, 1), 'FM9999999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') ||
       ' seconds elapsed across ' || TO_CHAR(execs) ||
       ' executions. Ranked by elapsed time, which is a fact about this window and not a finding about this statement.'
  FROM (SELECT ROW_NUMBER() OVER (ORDER BY SUM(st.elapsed_time_delta) DESC, st.sql_id) AS rn,
               st.sql_id,
               SUM(st.elapsed_time_delta) / 1000000 AS elapsed_s,
               SUM(st.executions_delta) AS execs
          FROM dba_hist_sqlstat st
          JOIN dba_hist_snapshot s
            ON s.snap_id = st.snap_id AND s.dbid = st.dbid AND s.instance_number = st.instance_number
         WHERE s.end_interval_time >= TO_TIMESTAMP('&win_from', 'YYYY-MM-DD HH24:MI:SS')
           AND s.begin_interval_time <= TO_TIMESTAMP('&win_to', 'YYYY-MM-DD HH24:MI:SS')
         GROUP BY st.sql_id
         ORDER BY SUM(st.elapsed_time_delta) DESC, st.sql_id
         FETCH FIRST 5 ROWS ONLY);

SELECT 'MET|AWRSQL_' || TO_CHAR(rn) || '|elapsed_seconds|' ||
       TO_CHAR(ROUND(elapsed_s, 1), 'FM9999999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') || '|seconds'
  FROM (SELECT ROW_NUMBER() OVER (ORDER BY SUM(st.elapsed_time_delta) DESC, st.sql_id) AS rn,
               SUM(st.elapsed_time_delta) / 1000000 AS elapsed_s
          FROM dba_hist_sqlstat st
          JOIN dba_hist_snapshot s
            ON s.snap_id = st.snap_id AND s.dbid = st.dbid AND s.instance_number = st.instance_number
         WHERE s.end_interval_time >= TO_TIMESTAMP('&win_from', 'YYYY-MM-DD HH24:MI:SS')
           AND s.begin_interval_time <= TO_TIMESTAMP('&win_to', 'YYYY-MM-DD HH24:MI:SS')
         GROUP BY st.sql_id
         ORDER BY SUM(st.elapsed_time_delta) DESC, st.sql_id
         FETCH FIRST 5 ROWS ONLY);

SPOOL OFF
EXIT
