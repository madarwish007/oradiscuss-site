-- ============================================================================
-- OraDiscuss - Daily Operations Pack v1.0.0
-- sql/daily_analysis.sql - morning-briefing collector. READ-ONLY (SELECT only;
-- PL/SQL blocks below only PRINT - they contain no DML/DDL).
--
-- Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
-- affiliated with, or endorsed by Oracle Corporation.
--
-- One EXECUTE IMMEDIATE appears below, and it wraps a plain SELECT COUNT(*).
-- It is dynamic on purpose: a static reference to UNIFIED_AUDIT_TRAIL fails to
-- parse wherever the view is not granted, which would take the whole collector
-- down over one optional check. The pack's read-only gate reads the statement
-- INSIDE the dynamic SQL and accepts only SELECT or WITH, so this stays
-- provably a read.
--
-- Args: &1=TS_WARN &2=TS_CRIT &3=RMAN_FULL_H &4=RMAN_ARCH_H
--       &5=STANDBY_LAG_MIN &6=STALE_STATS_WARN &7=VIEW_PREFIX (DBA|CDB)
--       &8=TS_HISTORY_TABLE &9=RAW_OUTPUT_FILE
-- Emits: SEC|title and CHK|id|status|title|detail lines, spooled to &9.
-- ============================================================================

SET PAGES 0 FEEDBACK OFF HEADING OFF VERIFY OFF LINES 4000 TRIMSPOOL ON SERVEROUTPUT ON SIZE UNLIMITED
WHENEVER SQLERROR EXIT SQL.SQLCODE

DEFINE ts_warn      = &1
DEFINE ts_crit      = &2
DEFINE rman_full_h  = &3
DEFINE rman_arch_h  = &4
DEFINE lag_min      = &5
DEFINE stale_warn   = &6
DEFINE vp           = &7
DEFINE hist_tab     = &8

SPOOL &9

-- ---------------------------------------------------------------------------
PROMPT SEC|Instance & database
SELECT 'CHK|INST|OK|Instance|' || instance_name || ' on ' || host_name ||
       ', up since ' || TO_CHAR(startup_time,'YYYY-MM-DD HH24:MI')
  FROM v$instance;
SELECT 'CHK|VERSION|OK|Database version|' || version_full FROM v$instance;
SELECT 'CHK|CDB|OK|Architecture|' ||
       CASE cdb WHEN 'YES' THEN 'Multitenant (CDB)' ELSE 'non-CDB (desupported on 21c+)' END ||
       ', role ' || database_role || ', open ' || open_mode
  FROM v$database;

-- ---------------------------------------------------------------------------
PROMPT SEC|Tablespace usage
SELECT 'CHK|TS_' || tablespace_name || '|' ||
       CASE WHEN used_percent >= &ts_crit THEN 'CRIT'
            WHEN used_percent >= &ts_warn THEN 'WARN' ELSE 'OK' END || '|' ||
       'Tablespace ' || tablespace_name || '|' ||
       ROUND(used_percent,1) || '% used (' ||
       ROUND(tablespace_size * (SELECT value FROM v$parameter WHERE name='db_block_size')/1048576)
       || ' MB allocated)'
  FROM dba_tablespace_usage_metrics
 ORDER BY used_percent DESC;

-- The same numbers again as MET lines, so the AI reads them as numbers instead
-- of parsing them back out of the prose above. No extra query and no extra
-- read: this is the row the CHK line just used.
--
-- The NLS mask is here rather than an ALTER SESSION on purpose. ALTER is a DDL
-- verb, and the read-only guarantee is the entire liability position of this
-- product, so a formatting requirement must not be the thing that breaks it.
SELECT 'MET|TS_' || tablespace_name || '|used_pct|' ||
       TO_CHAR(ROUND(used_percent,1), 'FM9999999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') ||
       '|percent'
  FROM dba_tablespace_usage_metrics
 ORDER BY used_percent DESC;

SELECT 'MET|TS_' || tablespace_name || '|allocated_mb|' ||
       TO_CHAR(ROUND(tablespace_size * (SELECT value FROM v$parameter WHERE name='db_block_size')/1048576),
               'FM9999999990', 'NLS_NUMERIC_CHARACTERS=''.,''') || '|MB'
  FROM dba_tablespace_usage_metrics
 ORDER BY used_percent DESC;

-- ---------------------------------------------------------------------------
PROMPT SEC|Tablespace growth trend (7 days)
-- Dynamic: only when the opt-in history table exists (created separately by
-- the Health Check pack's sql/create_history_table.sql). NA otherwise.
BEGIN
  DECLARE
    n        NUMBER;
    cur      SYS_REFCURSOR;
    v_ts     VARCHAR2(128);
    v_delta  NUMBER;
    v_found  NUMBER := 0;
  BEGIN
    SELECT COUNT(*) INTO n FROM dba_tables
     WHERE table_name = UPPER('&hist_tab') AND owner = SYS_CONTEXT('USERENV','CURRENT_SCHEMA');
    IF n = 0 THEN
      DBMS_OUTPUT.PUT_LINE('CHK|TSGROWTH|NA|Growth trend|history table &hist_tab not found - run the Health Check pack''s opt-in sql/create_history_table.sql to enable trends');
    ELSE
      OPEN cur FOR
        'SELECT tablespace_name, ROUND(MAX(used_mb) - MIN(used_mb)) ' ||
        'FROM ' || SYS_CONTEXT('USERENV','CURRENT_SCHEMA') || '."&hist_tab" ' ||
        'WHERE sample_time >= SYSDATE - 7 GROUP BY tablespace_name ' ||
        'HAVING COUNT(*) > 1 ORDER BY 2 DESC';
      LOOP
        FETCH cur INTO v_ts, v_delta;
        EXIT WHEN cur%NOTFOUND;
        v_found := v_found + 1;
        DBMS_OUTPUT.PUT_LINE('CHK|TSG_' || v_ts || '|' ||
          CASE WHEN v_delta > 10240 THEN 'WARN' ELSE 'OK' END ||
          '|Growth 7d: ' || v_ts || '|+' || v_delta || ' MB over the last 7 days');
        -- These two are the only numbers in the whole pack that describe MOTION
        -- rather than a snapshot, which is exactly what an assistant needs to
        -- answer a capacity question instead of a status one. They are ABSENT,
        -- never zero, when no history exists: a fabricated 0 GB/day would read
        -- as "this database is not growing".
        DBMS_OUTPUT.PUT_LINE('MET|TSG_' || v_ts || '|growth_mb_7d|' ||
          TO_CHAR(v_delta, 'FM9999999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') || '|MB');
        DBMS_OUTPUT.PUT_LINE('MET|TSG_' || v_ts || '|gb_per_day|' ||
          TO_CHAR(ROUND(v_delta / 7 / 1024, 3), 'FM9999999990.000', 'NLS_NUMERIC_CHARACTERS=''.,''') || '|GB/day');
      END LOOP;
      CLOSE cur;
      IF v_found = 0 THEN
        DBMS_OUTPUT.PUT_LINE('CHK|TSGROWTH|OK|Growth trend|history table present but <2 samples in 7 days - trends appear once history accumulates');
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('CHK|TSGROWTH|NA|Growth trend|could not read history table (' || SQLERRM || ')');
  END;
END;
/

-- ---------------------------------------------------------------------------
PROMPT SEC|Top 10 segments by size
SELECT 'CHK|SEG' || ROWNUM || '|OK|Segment|' || owner || '.' || segment_name ||
       ' (' || segment_type || ', ' || tablespace_name || '): ' ||
       ROUND(bytes/1073741824,2) || ' GB'
  FROM (SELECT owner, segment_name, segment_type, tablespace_name, bytes
          FROM &vp._segments ORDER BY bytes DESC)
 WHERE ROWNUM <= 10;
PROMPT CHK|SEGNOTE|OK|Growth note|segment GROWTH ranking requires the history table; sizes above are current snapshots

-- ---------------------------------------------------------------------------
PROMPT SEC|Backup & recovery verification
SELECT 'CHK|RMAN_FULL|' ||
       CASE WHEN MAX(end_time) IS NULL THEN 'CRIT'
            WHEN MAX(end_time) < SYSDATE - (&rman_full_h/24) THEN 'CRIT' ELSE 'OK' END ||
       '|RMAN level-0/full backup|' ||
       CASE WHEN MAX(end_time) IS NULL THEN 'no successful full backup found'
            ELSE 'last successful: ' || TO_CHAR(MAX(end_time),'YYYY-MM-DD HH24:MI') END
  FROM v$rman_backup_job_details
 WHERE input_type = 'DB FULL' AND status = 'COMPLETED';
SELECT 'CHK|RMAN_ARCH|' ||
       CASE WHEN MAX(end_time) IS NULL THEN 'WARN'
            WHEN MAX(end_time) < SYSDATE - (&rman_arch_h/24) THEN 'WARN' ELSE 'OK' END ||
       '|RMAN archivelog backup|' ||
       CASE WHEN MAX(end_time) IS NULL THEN 'no archivelog backup found'
            ELSE 'last successful: ' || TO_CHAR(MAX(end_time),'YYYY-MM-DD HH24:MI') END
  FROM v$rman_backup_job_details
 WHERE input_type LIKE 'ARCHIVELOG%' AND status = 'COMPLETED';

-- Backup AGE as a number. "last successful: 2026-08-05 22:14" makes a human
-- do date arithmetic and makes an assistant guess at the current time; hours
-- since is the same fact with neither problem. Absent, not zero, when no
-- backup exists, because 0 hours would read as "backed up just now", which is
-- the exact opposite of what a missing backup means.
SELECT 'MET|RMAN_FULL|age_hours|' ||
       TO_CHAR(ROUND((SYSDATE - MAX(end_time)) * 24, 1), 'FM9999999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') ||
       '|hours'
  FROM v$rman_backup_job_details
 WHERE input_type = 'DB FULL' AND status = 'COMPLETED'
 HAVING MAX(end_time) IS NOT NULL;

SELECT 'MET|RMAN_ARCH|age_hours|' ||
       TO_CHAR(ROUND((SYSDATE - MAX(end_time)) * 24, 1), 'FM9999999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') ||
       '|hours'
  FROM v$rman_backup_job_details
 WHERE input_type LIKE 'ARCHIVELOG%' AND status = 'COMPLETED'
 HAVING MAX(end_time) IS NOT NULL;

-- Standby apply lag - only meaningful when this DB is a standby.
BEGIN
  DECLARE
    v_role VARCHAR2(30);
    v_gap  NUMBER := NULL;
  BEGIN
    SELECT database_role INTO v_role FROM v$database;
    IF v_role LIKE '%STANDBY%' THEN
      -- Heuristic lag: wall-clock age of the most recently APPLIED archived
      -- log. Labeled as heuristic in the report; v$dataguard_stats 'apply
      -- lag' is an interval string that is awkward to compare portably.
      SELECT ROUND((SYSDATE - MAX(next_time)) * 86400) INTO v_gap
        FROM v$archived_log
       WHERE applied = 'YES' AND next_time IS NOT NULL;
      IF v_gap IS NULL THEN
        DBMS_OUTPUT.PUT_LINE('CHK|STBY_GAP|NA|Standby apply lag|role=' || v_role || ' but no applied archived logs found to estimate lag');
      ELSE
        DBMS_OUTPUT.PUT_LINE('CHK|STBY_GAP|' ||
          CASE WHEN v_gap > &lag_min*60 THEN 'WARN' ELSE 'OK' END ||
          '|Standby apply lag (heuristic)|role=' || v_role || ', newest applied archivelog is ' || v_gap || 's old (threshold ' || &lag_min || ' min)');
      END IF;
    ELSE
      DBMS_OUTPUT.PUT_LINE('CHK|STBY_GAP|OK|Standby check|role=' || v_role || ' - not a standby, gap check not applicable');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('CHK|STBY_GAP|NA|Standby check|could not evaluate (' || SQLERRM || ')');
  END;
END;
/

-- ---------------------------------------------------------------------------
PROMPT SEC|Statistics freshness
SELECT 'CHK|STALE|' ||
       CASE WHEN COUNT(*) >= &stale_warn THEN 'WARN' ELSE 'OK' END ||
       '|Stale optimizer statistics|' || COUNT(*) || ' objects with STALE_STATS=YES'
  FROM &vp._tab_statistics
 WHERE stale_stats = 'YES';
SELECT 'MET|STALE|stale_objects|' || COUNT(*) || '|objects'
  FROM &vp._tab_statistics
 WHERE stale_stats = 'YES';

-- ---------------------------------------------------------------------------
PROMPT SEC|Failed logins (24h, unified audit)
-- Unified auditing is available 12c+ and the ONLY audit trail on 23ai
-- (traditional AUD$/DBA_AUDIT_TRAIL desupported there - never queried here).
BEGIN
  DECLARE
    n NUMBER := -1;
  BEGIN
    EXECUTE IMMEDIATE q'[
      SELECT COUNT(*) FROM unified_audit_trail
       WHERE event_timestamp >= SYSDATE - 1
         AND action_name = 'LOGON'
         AND return_code != 0]' INTO n;
    DBMS_OUTPUT.PUT_LINE('CHK|FAILLOGON|' ||
      CASE WHEN n >= 100 THEN 'WARN' ELSE 'OK' END ||
      '|Failed logins 24h|' || n || ' failed logons in the last 24h (UNIFIED_AUDIT_TRAIL)');
    DBMS_OUTPUT.PUT_LINE('MET|FAILLOGON|failed_logons|' || n || '|logons');
  EXCEPTION WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('CHK|FAILLOGON|NA|Failed logins 24h|UNIFIED_AUDIT_TRAIL not accessible (' || SQLERRM || ') - grant AUDIT_VIEWER or SELECT on the view');
  END;
END;
/

-- ---------------------------------------------------------------------------
PROMPT SEC|Invalid objects
SELECT 'CHK|INVALID|' ||
       CASE WHEN COUNT(*) > 0 THEN 'WARN' ELSE 'OK' END ||
       '|Invalid objects|' || COUNT(*) || ' invalid objects (all schemas)'
  FROM &vp._objects
 WHERE status = 'INVALID';
SELECT 'MET|INVALID|invalid_objects|' || COUNT(*) || '|objects'
  FROM &vp._objects
 WHERE status = 'INVALID';

SPOOL OFF
EXIT
