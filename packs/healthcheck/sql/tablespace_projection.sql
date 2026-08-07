-- ============================================================================
-- OraDiscuss - DBA Health Check Automation Pack v1.0.0
-- sql/tablespace_projection.sql - growth projection from the OPT-IN history
-- table (created separately via sql/create_history_table.sql). If the table
-- does not exist, this script exits quietly and tablespace_monitor.sh falls
-- back to current-only reporting.
--
-- Written for Oracle 19c/21c.
--
-- Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
-- affiliated with, or endorsed by Oracle Corporation.
-- READ-ONLY: this pack issues no DDL and no DML against your data.
--
-- Review it before you run it, and run it somewhere that is not production
-- first. You are the DBA.
-- READ-ONLY: SELECTs only (the history table is written by the opt-in step,
-- never by this script).
--
-- Invoked by tablespace_monitor.sh with:
--   &1 = history table name (from config.env TS_HISTORY_TABLE)
--   &2 = spool file
-- Output rows (CSV, via DBMS_OUTPUT, spooled):
--   <ts_name>,<gb_per_day>,<days_to_90pct_or_-1>
--   gb_per_day = least-squares slope over samples in the last 30 days.
--   days_to_90pct = -1 when not growing or when it cannot be computed.
--
-- License: single-user license, modify allowed, no redistribution.
-- ============================================================================

SET PAGESIZE 0
SET LINESIZE 500
SET TRIMSPOOL ON
SET FEEDBACK OFF
SET VERIFY OFF
SET HEADING OFF
SET SERVEROUTPUT ON SIZE 1000000
WHENEVER SQLERROR EXIT SQL.SQLCODE

DEFINE ODC_HIST  = '&1'
DEFINE ODC_SPOOL = '&2'

SPOOL &ODC_SPOOL

DECLARE
  l_cnt PLS_INTEGER;
  l_sql VARCHAR2(4000);
BEGIN
  -- Does the history table exist?
  SELECT COUNT(*) INTO l_cnt
  FROM user_tables
  WHERE table_name = UPPER('&ODC_HIST');
  IF l_cnt = 0 THEN
    DBMS_OUTPUT.PUT_LINE('#HISTORY_MISSING');
    RETURN;
  END IF;

  -- Least-squares slope of used_gb over time per tablespace, last 30 days,
  -- plus days until 90% of max_gb at that rate. History table columns:
  --   sample_time DATE, tablespace_name, used_gb NUMBER, max_gb NUMBER
  l_sql := q'{
    SELECT tablespace_name,
           ROUND(REGR_SLOPE(used_gb, sample_time - DATE '1970-01-01'), 4) AS gb_per_day,
           CASE
             WHEN REGR_SLOPE(used_gb, sample_time - DATE '1970-01-01') > 0
             THEN ROUND((0.9 * MAX(max_gb) - MAX(used_gb))
                        / REGR_SLOPE(used_gb, sample_time - DATE '1970-01-01'))
             ELSE -1
           END AS days_to_90pct
    FROM (
      SELECT sample_time, tablespace_name,
             AVG(used_gb) AS used_gb, MAX(max_gb) AS max_gb
      FROM }' || '&ODC_HIST' || q'{
      WHERE sample_time > SYSDATE - 30
      GROUP BY sample_time, tablespace_name
    )
    GROUP BY tablespace_name
    HAVING COUNT(*) >= 5
    ORDER BY tablespace_name}';

  -- Execute via ref cursor (PL/SQL cannot loop a dynamic string directly).
  DECLARE
    l_rc  SYS_REFCURSOR;
    l_ts  VARCHAR2(128);
    l_gpd NUMBER;
    l_d   NUMBER;
  BEGIN
    OPEN l_rc FOR l_sql;
    LOOP
      FETCH l_rc INTO l_ts, l_gpd, l_d;
      EXIT WHEN l_rc%NOTFOUND;
      DBMS_OUTPUT.PUT_LINE(l_ts || ',' || NVL(TO_CHAR(l_gpd), '0') || ',' || NVL(TO_CHAR(l_d), '-1'));
    END LOOP;
    CLOSE l_rc;
  END;
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('#PROJECTION_ERROR:' || SQLERRM);
END;
/

SPOOL OFF
EXIT
