-- ============================================================================
-- OraDiscuss - DBA Health Check Automation Pack v1.0.0
-- sql/tablespace_usage.sql - current tablespace usage snapshot (CSV rows).
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
-- Invoked by tablespace_monitor.sh with:
--   &1 = TS_WARN_PCT &2 = TS_CRIT_PCT &3 = spool file
-- Output rows (CSV):
--   <ts_name>,<used_pct>,<status>,<used_gb>,<max_gb>,<autoextend_on>
--
-- License: single-user license, modify allowed, no redistribution.
-- ============================================================================

SET PAGESIZE 0
SET LINESIZE 500
SET TRIMSPOOL ON
SET TRIMOUT ON
SET FEEDBACK OFF
SET VERIFY OFF
SET HEADING OFF
WHENEVER SQLERROR EXIT SQL.SQLCODE

DEFINE ODC_TS_WARN = '&1'
DEFINE ODC_TS_CRIT = '&2'
DEFINE ODC_SPOOL   = '&3'

SPOOL &ODC_SPOOL

SELECT m.tablespace_name || ',' ||
       ROUND(m.used_percent, 2) || ',' ||
       CASE WHEN m.used_percent >= &ODC_TS_CRIT THEN 'CRIT'
            WHEN m.used_percent >= &ODC_TS_WARN THEN 'WARN'
            ELSE 'OK' END || ',' ||
       ROUND(m.used_space * tp.bytes / 1024 / 1024 / 1024, 2) || ',' ||
       ROUND(m.tablespace_size * tp.bytes / 1024 / 1024 / 1024, 2) || ',' ||
       (SELECT CASE WHEN COUNT(*) > 0 THEN 'Y' ELSE 'N' END
        FROM dba_data_files f
        WHERE f.tablespace_name = m.tablespace_name
          AND f.autoextensible = 'YES')
FROM dba_tablespace_usage_metrics m
CROSS JOIN (SELECT TO_NUMBER(p.value) AS bytes
            FROM v$parameter p WHERE p.name = 'db_block_size') tp
WHERE m.tablespace_name NOT IN (
        SELECT tablespace_name FROM dba_tablespaces WHERE status = 'OFFLINE')
ORDER BY m.tablespace_name;

SPOOL OFF
EXIT
