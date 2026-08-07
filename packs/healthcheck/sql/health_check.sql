-- ============================================================================
-- OraDiscuss - DBA Health Check Automation Pack v1.0.0
-- sql/health_check.sql - daily database health check data collector.
--
-- Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
-- affiliated with, or endorsed by Oracle Corporation.
-- READ-ONLY: this script performs SELECTs only. No DDL, no DML.
--
-- Written for Oracle 19c/21c. Review it before you run it, and run it
-- somewhere that is not production first. You are the DBA.
--
-- Usage: normally invoked by health_check.sh (which passes thresholds as
--        substitution variables &1..&6). Can be run manually:
--          sqlplus / as sysdba @health_check.sql 80 90 80 90 80 90 30 8 1 /tmp/hc_raw.txt
--        args: &1 TS_WARN &2 TS_CRIT &3 ASM_WARN &4 ASM_CRIT &5 FRA_WARN
--              &6 FRA_CRIT &7 RMAN_FULL_H &8 RMAN_ARCH_H &9 INV_WARN &10 spool
--
-- Output: spools pipe-delimited rows to &ODC_SPOOL (default health_check_raw.txt):
--          SEC|<section title>
--          CHK|<id>|<OK|WARN|CRIT|NA>|<title>|<detail>
--          MET|<check id>|<name>|<value>|<unit>
--        health_check.sh parses this ONCE into BOTH outputs: the HTML report
--        for the human and briefing.json for the customer's own AI.
--
--        MET| lines are new in v1.0 and are keyed by check id, so they may
--        appear anywhere in the spool. They re-state numbers the CHK| lines
--        already computed; they add no queries and read nothing extra.
--        A parser that does not know the line type ignores it, which is why
--        adding them did not break anything that consumed v0.9 output.
--
-- License: single-user license, modify allowed, no redistribution.
-- ============================================================================

SET PAGESIZE 0
SET LINESIZE 1000
SET TRIMSPOOL ON
SET TRIMOUT ON
SET FEEDBACK OFF
SET VERIFY OFF
SET HEADING OFF
SET ECHO OFF
SET SERVEROUTPUT OFF
WHENEVER SQLERROR EXIT SQL.SQLCODE

-- Defaults if run standalone without arguments.
DEFINE ODC_TS_WARN  = '&1'
DEFINE ODC_TS_CRIT  = '&2'
DEFINE ODC_ASM_WARN = '&3'
DEFINE ODC_ASM_CRIT = '&4'
DEFINE ODC_FRA_WARN = '&5'
DEFINE ODC_FRA_CRIT = '&6'
DEFINE ODC_RM_FULL  = '&7'
DEFINE ODC_RM_ARCH  = '&8'
DEFINE ODC_INV_WARN = '&9'
DEFINE ODC_SPOOL    = '&10'

SPOOL &ODC_SPOOL

-- ---------------------------------------------------------------------------
-- SECTION 1: Instance & database status
-- ---------------------------------------------------------------------------
SELECT 'SEC|Instance & Database' FROM DUAL;

SELECT 'CHK|INSTANCE_STATUS|' ||
       CASE WHEN i.status = 'OPEN' THEN 'OK' ELSE 'CRIT' END ||
       '|Instance status|' ||
       i.instance_name || ' on ' || i.host_name ||
       ' - status ' || i.status || ', version ' || i.version ||
       ', up since ' || TO_CHAR(i.startup_time, 'YYYY-MM-DD HH24:MI')
FROM v$instance i;

SELECT 'CHK|DATABASE_STATUS|' ||
       CASE WHEN d.open_mode LIKE 'READ WRITE%' AND d.database_status = 'ACTIVE'
            THEN 'OK'
            WHEN d.open_mode LIKE 'READ ONLY%' AND d.database_status = 'ACTIVE'
            THEN 'OK'
            ELSE 'CRIT' END ||
       '|Database status|' ||
       d.name || ' (' || d.database_role || ') open_mode=' || d.open_mode ||
       ', log_mode=' || d.log_mode
FROM v$database d;

-- ---------------------------------------------------------------------------
-- SECTION 2: Tablespace usage (autoextend-aware via DBA_TABLESPACE_USAGE_METRICS)
-- ---------------------------------------------------------------------------
SELECT 'SEC|Tablespace Usage' FROM DUAL;

SELECT 'CHK|TS_' || m.tablespace_name || '|' ||
       CASE WHEN m.used_percent >= &ODC_TS_CRIT THEN 'CRIT'
            WHEN m.used_percent >= &ODC_TS_WARN THEN 'WARN'
            ELSE 'OK' END ||
       '|Tablespace ' || m.tablespace_name || '|' ||
       ROUND(m.used_percent, 1) || '% used (' ||
       ROUND(m.tablespace_size * tp.bytes / 1024 / 1024 / 1024, 1) || ' GB max, ' ||
       ROUND(m.used_space   * tp.bytes / 1024 / 1024 / 1024, 1) || ' GB used)'
FROM dba_tablespace_usage_metrics m
CROSS JOIN (SELECT TO_NUMBER(p.value) AS bytes
            FROM v$parameter p WHERE p.name = 'db_block_size') tp
WHERE m.tablespace_name NOT IN (
        SELECT tablespace_name FROM dba_tablespaces WHERE status = 'OFFLINE')
ORDER BY m.used_percent DESC;

-- The same tablespace numbers again, as MET| lines for briefing.json.
--
-- These are values the query above already computed; nothing new is measured
-- and nothing extra is read. They exist so the customer's AI is handed
-- 87.3 rather than having to parse it back out of an English sentence.
--
-- The NLS_NUMERIC_CHARACTERS mask is NOT decoration. Under a session whose
-- territory uses a decimal comma, this number renders as "87,3", which is not
-- a JSON number, and one of them invalidates the entire briefing. The mask is
-- used here rather than an ALTER SESSION because ALTER is a DDL verb, and the
-- fix for one requirement must not break the read-only guarantee that is the
-- whole liability position of this pack.
SELECT 'MET|TS_' || m.tablespace_name || '|used_pct|' ||
       TO_CHAR(ROUND(m.used_percent, 1), 'FM99999990.0',
               'NLS_NUMERIC_CHARACTERS=''.,''') || '|percent'
FROM dba_tablespace_usage_metrics m
WHERE m.tablespace_name NOT IN (
        SELECT tablespace_name FROM dba_tablespaces WHERE status = 'OFFLINE')
ORDER BY m.tablespace_name;

SELECT 'MET|TS_' || m.tablespace_name || '|used_gb|' ||
       TO_CHAR(ROUND(m.used_space * tp.bytes / 1024 / 1024 / 1024, 1),
               'FM99999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') || '|GB'
FROM dba_tablespace_usage_metrics m
CROSS JOIN (SELECT TO_NUMBER(p.value) AS bytes
            FROM v$parameter p WHERE p.name = 'db_block_size') tp
WHERE m.tablespace_name NOT IN (
        SELECT tablespace_name FROM dba_tablespaces WHERE status = 'OFFLINE')
ORDER BY m.tablespace_name;

SELECT 'MET|TS_' || m.tablespace_name || '|max_gb|' ||
       TO_CHAR(ROUND(m.tablespace_size * tp.bytes / 1024 / 1024 / 1024, 1),
               'FM99999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') || '|GB'
FROM dba_tablespace_usage_metrics m
CROSS JOIN (SELECT TO_NUMBER(p.value) AS bytes
            FROM v$parameter p WHERE p.name = 'db_block_size') tp
WHERE m.tablespace_name NOT IN (
        SELECT tablespace_name FROM dba_tablespaces WHERE status = 'OFFLINE')
ORDER BY m.tablespace_name;

-- ---------------------------------------------------------------------------
-- SECTION 3: Invalid objects
-- ---------------------------------------------------------------------------
SELECT 'SEC|Objects & Jobs' FROM DUAL;

SELECT 'CHK|INVALID_OBJECTS|' ||
       CASE WHEN COUNT(*) >= &ODC_INV_WARN THEN 'WARN' ELSE 'OK' END ||
       '|Invalid objects|' ||
       COUNT(*) || ' invalid object(s) in the database'
FROM dba_objects
WHERE status = 'INVALID';

SELECT 'MET|INVALID_OBJECTS|count|' || TO_CHAR(COUNT(*)) || '|objects'
FROM dba_objects
WHERE status = 'INVALID';

-- Failed scheduler jobs: last run in the last 7 days with FAILED status.
SELECT 'CHK|FAILED_SCHED_JOBS|' ||
       CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'WARN' END ||
       '|Failed scheduler jobs (7d)|' ||
       COUNT(*) || ' failed scheduler job run(s) in the last 7 days'
FROM dba_scheduler_job_run_details
WHERE status = 'FAILED'
  AND log_date > SYSDATE - 7;

-- Broken legacy DBA_JOBS.
SELECT 'CHK|BROKEN_JOBS|' ||
       CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'WARN' END ||
       '|Broken DBA_JOBS|' ||
       COUNT(*) || ' broken legacy job(s)'
FROM dba_jobs
WHERE broken = 'Y';

-- ---------------------------------------------------------------------------
-- SECTION 4: Alert log scan (ADR-aware) - ORA- errors in the last 24h
-- Uses X$DBGALERTEXT (the ADR alert log as a table). Diagnostic destination
-- is reported from V$DIAG_INFO.
-- ---------------------------------------------------------------------------
SELECT 'SEC|Alert Log (last 24h)' FROM DUAL;

SELECT 'CHK|ADR_LOCATION|NA|ADR diagnostic destination|' ||
       MAX(CASE WHEN name = 'Diag Trace' THEN value END)
FROM v$diag_info;

SELECT 'CHK|ALERT_ORA_ERRORS|' ||
       CASE WHEN COUNT(*) = 0 THEN 'OK'
            WHEN COUNT(*) >= 10 THEN 'CRIT'
            ELSE 'WARN' END ||
       '|ORA- errors in alert log (24h)|' ||
       COUNT(*) || ' ORA- error line(s) in the last 24 hours'
FROM x$dbgalertext
WHERE originating_timestamp > SYSTIMESTAMP - INTERVAL '1' DAY
  AND message_text LIKE '%ORA-%';

-- Sample of the most recent ORA- errors (max 5) for context.
SELECT 'CHK|ALERT_SAMPLE_' || ROWNUM || '|NA|Recent ORA- sample|' ||
       TO_CHAR(originating_timestamp, 'MM-DD HH24:MI') || ' ' ||
       REPLACE(SUBSTR(message_text, 1, 180), '|', '/')
FROM (SELECT originating_timestamp, message_text
      FROM x$dbgalertext
      WHERE originating_timestamp > SYSTIMESTAMP - INTERVAL '1' DAY
        AND message_text LIKE '%ORA-%'
      ORDER BY originating_timestamp DESC)
WHERE ROWNUM <= 5;

-- ---------------------------------------------------------------------------
-- SECTION 5: Archivelog mode & FRA / DB_RECOVERY_FILE_DEST usage
-- ---------------------------------------------------------------------------
SELECT 'SEC|Archivelog & FRA' FROM DUAL;

SELECT 'CHK|ARCHIVELOG_MODE|' ||
       CASE WHEN log_mode = 'ARCHIVELOG' THEN 'OK' ELSE 'WARN' END ||
       '|Archivelog mode|Database log_mode = ' || log_mode
FROM v$database;

-- FRA usage; NA if no recovery destination configured.
SELECT 'CHK|FRA_USAGE|' ||
       CASE WHEN v.name IS NULL THEN 'NA'
            WHEN v.percent_space_used >= &ODC_FRA_CRIT THEN 'CRIT'
            WHEN v.percent_space_used >= &ODC_FRA_WARN THEN 'WARN'
            ELSE 'OK' END ||
       '|FRA (DB_RECOVERY_FILE_DEST) usage|' ||
       CASE WHEN v.name IS NULL THEN 'no recovery file destination configured'
            ELSE v.name || ' - ' || ROUND(v.percent_space_used, 1) ||
                 '% used (' || ROUND(v.space_used / 1024 / 1024 / 1024, 1) ||
                 ' GB of ' || ROUND(v.space_limit / 1024 / 1024 / 1024, 1) || ' GB)'
       END
FROM (SELECT name, space_limit, space_used,
             ROUND(space_used / NULLIF(space_limit, 0) * 100, 1) AS percent_space_used
      FROM v$recovery_file_dest) v;

-- FRA usage as a metric. Emitted only when a destination is configured: a
-- briefing that reports 0 percent used for an FRA that does not exist would
-- read to an AI as "plenty of headroom" rather than "not applicable".
SELECT 'MET|FRA_USAGE|used_pct|' ||
       TO_CHAR(ROUND(v.percent_space_used, 1), 'FM99999990.0',
               'NLS_NUMERIC_CHARACTERS=''.,''') || '|percent'
FROM (SELECT name, ROUND(space_used / NULLIF(space_limit, 0) * 100, 1) AS percent_space_used
      FROM v$recovery_file_dest) v
WHERE v.name IS NOT NULL AND v.percent_space_used IS NOT NULL;

-- ---------------------------------------------------------------------------
-- SECTION 6: ASM diskgroup usage - gracefully NA when ASM is not present.
-- Wrapped in PL/SQL with an exception handler so non-ASM databases do not
-- fail the script (V$ASM_DISKGROUP errors out without an ASM instance).
-- ---------------------------------------------------------------------------
SELECT 'SEC|ASM Diskgroups' FROM DUAL;

SET SERVEROUTPUT ON SIZE 1000000
BEGIN
  FOR r IN (SELECT name, total_mb, free_mb,
                   ROUND((1 - free_mb / NULLIF(total_mb, 0)) * 100, 1) AS used_pct
            FROM v$asm_diskgroup
            WHERE state = 'MOUNTED')
  LOOP
    DBMS_OUTPUT.PUT_LINE('CHK|ASM_' || r.name || '|' ||
      CASE WHEN r.used_pct >= &ODC_ASM_CRIT THEN 'CRIT'
           WHEN r.used_pct >= &ODC_ASM_WARN THEN 'WARN'
           ELSE 'OK' END ||
      '|ASM diskgroup ' || r.name || '|' ||
      r.used_pct || '% used (' ||
      ROUND((r.total_mb - r.free_mb) / 1024, 1) || ' GB of ' ||
      ROUND(r.total_mb / 1024, 1) || ' GB)');
  END LOOP;
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('CHK|ASM_NA|NA|ASM diskgroups|ASM not present or V$ASM_DISKGROUP not accessible - check skipped');
END;
/
SET SERVEROUTPUT OFF

-- ---------------------------------------------------------------------------
-- SECTION 7: RMAN backup recency - last completed backup per input type.
-- ---------------------------------------------------------------------------
SELECT 'SEC|RMAN Backup Recency' FROM DUAL;

SELECT 'CHK|RMAN_' || REPLACE(t.input_type, ' ', '_') || '|' ||
       CASE
         WHEN t.input_type LIKE 'DB%' AND t.hrs_ago > &ODC_RM_FULL THEN 'CRIT'
         WHEN t.input_type LIKE 'ARCHIVELOG%' AND t.hrs_ago > &ODC_RM_ARCH THEN 'CRIT'
         ELSE 'OK' END ||
       '|Last ' || t.input_type || ' backup|' ||
       TO_CHAR(t.last_end, 'YYYY-MM-DD HH24:MI') ||
       ' (' || ROUND(t.hrs_ago, 1) || ' hours ago, status ' || t.status || ')'
FROM (SELECT input_type, status,
             MAX(end_time) AS last_end,
             (SYSDATE - MAX(end_time)) * 24 AS hrs_ago
      FROM v$rman_backup_job_details
      WHERE status = 'COMPLETED'
      GROUP BY input_type, status) t;

-- If no RMAN backups recorded at all, surface a single CRIT row.
SELECT 'CHK|RMAN_NONE|CRIT|RMAN backups|' ||
       'no completed RMAN backup jobs found in V$RMAN_BACKUP_JOB_DETAILS'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM v$rman_backup_job_details
                  WHERE status = 'COMPLETED');

SPOOL OFF
EXIT
