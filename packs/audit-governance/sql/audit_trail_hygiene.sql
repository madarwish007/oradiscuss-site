-- ============================================================================
-- OraDiscuss - Audit and Governance Pack v1.0.0
-- sql/audit_trail_hygiene.sql - how much space the audit trail is holding, how
-- far back it reaches, how fast it is arriving, and what the purge and archive
-- machinery has recorded.
--
-- Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
-- affiliated with, or endorsed by Oracle Corporation.
-- READ-ONLY: this pack issues no DDL and no DML against your data.
--
-- Review it before you run it, and run it somewhere that is not production
-- first. You are the DBA.
--
-- Invoked by audit_governance.sh with:
--   &1 = AUDIT_WINDOW_DAYS
--   &2 = AUDIT_TOP_N
--   &3 = spool file
--
-- Emits SEC|title, CHK|id|status|title|detail and MET|id|name|value|unit lines.
--
-- THE ONE PLACE THIS PACK READS OUTSIDE ITS WINDOW, AND WHY.
--   "How far back does the trail reach" cannot be answered from inside a
--   thirty day window. So the oldest and newest recorded timestamps are read
--   with MIN and MAX aggregates over the whole trail. That is three numbers
--   rather than a dump of rows, and it is the slowest read in this pack on a
--   very large trail: it is in its own handler for that reason, so a read that
--   cannot complete costs this one row and nothing else.
--
--   The arrival rate is derived from the windowed count instead, which keeps
--   the expensive read to the two aggregates above.
--
--   Every trail read here is native dynamic SQL wrapped in its own handler, for
--   the reason set out in sql/audit_trail_activity.sql.
--
-- NO ROW HERE IS GRADED. How long a trail should be kept is set by the estate's
-- own retention policy, which this script has not been given, and a trail
-- holding two years of records may be exactly right or may be an oversight.
-- The numbers are the answer.
--
-- License: single-user license, modify allowed, no redistribution.
-- ============================================================================

SET PAGES 0 FEEDBACK OFF HEADING OFF VERIFY OFF LINES 4000 TRIMSPOOL ON SERVEROUTPUT ON SIZE UNLIMITED

DEFINE window_days = &1
DEFINE top_n       = &2

SPOOL &3

PROMPT SEC|Audit trail hygiene

-- ---------------------------------------------------------------------------
-- Space, from DBA_SEGMENTS. Read first because it is the most portable read in
-- this tier and needs no access to the trail views at all.
--
-- AUDSYS owns the unified trail. SYS.AUD$ and SYS.FGA_LOG$ are the traditional
-- and fine grained trails. A database in mixed mode holds both, so both are
-- counted and the split is printed.
-- ---------------------------------------------------------------------------
SELECT 'CHK|HYG_SEGMENTS|OK|Space held by audit trail segments|' ||
       TO_CHAR(ROUND(NVL(SUM(bytes), 0) / 1073741824, 2), 'FM9999999990.00', 'NLS_NUMERIC_CHARACTERS=''.,''') ||
       ' GB across ' || COUNT(*) || ' segments, of which ' ||
       TO_CHAR(ROUND(NVL(SUM(CASE WHEN owner = 'AUDSYS' THEN bytes ELSE 0 END), 0) / 1073741824, 2), 'FM9999999990.00', 'NLS_NUMERIC_CHARACTERS=''.,''') ||
       ' GB belongs to the unified trail owned by AUDSYS and the rest to the traditional trails owned by SYS. A database in mixed mode holds both.'
  FROM dba_segments
 WHERE owner = 'AUDSYS'
    OR (owner = 'SYS' AND segment_name IN ('AUD$', 'FGA_LOG$'));

SELECT 'MET|HYG_SEGMENTS|total_gb|' ||
       TO_CHAR(ROUND(NVL(SUM(bytes), 0) / 1073741824, 2), 'FM9999999990.00', 'NLS_NUMERIC_CHARACTERS=''.,''') || '|GB'
  FROM dba_segments
 WHERE owner = 'AUDSYS'
    OR (owner = 'SYS' AND segment_name IN ('AUD$', 'FGA_LOG$'));

SELECT 'MET|HYG_SEGMENTS|segments|' || COUNT(*) || '|segments'
  FROM dba_segments
 WHERE owner = 'AUDSYS'
    OR (owner = 'SYS' AND segment_name IN ('AUD$', 'FGA_LOG$'));

-- The largest individual segments. The ORDER BY carries an explicit tiebreaker
-- because the check row and the metric row are separate executions of the same
-- ranked query, and two segments of identical size could otherwise be returned
-- in two different orders, attaching a measurement to a row that is not in the
-- document.
SELECT 'CHK|HYGSEG_' || TRANSLATE(UPPER(owner || '.' || segment_name), 'x |()/,:;+', 'x_') ||
       '|OK|Audit trail segment|' || owner || '.' || segment_name ||
       ' (' || segment_type || ' in ' || tablespace_name || ') holds ' ||
       TO_CHAR(ROUND(bytes / 1073741824, 2), 'FM9999999990.00', 'NLS_NUMERIC_CHARACTERS=''.,''') || ' GB.'
  FROM (SELECT owner, segment_name, segment_type, tablespace_name, bytes
          FROM dba_segments
         WHERE owner = 'AUDSYS'
            OR (owner = 'SYS' AND segment_name IN ('AUD$', 'FGA_LOG$'))
         ORDER BY bytes DESC, owner, segment_name
         FETCH FIRST &top_n ROWS ONLY);

SELECT 'MET|HYGSEG_' || TRANSLATE(UPPER(owner || '.' || segment_name), 'x |()/,:;+', 'x_') ||
       '|size_gb|' ||
       TO_CHAR(ROUND(bytes / 1073741824, 2), 'FM9999999990.00', 'NLS_NUMERIC_CHARACTERS=''.,''') || '|GB'
  FROM (SELECT owner, segment_name, bytes
          FROM dba_segments
         WHERE owner = 'AUDSYS'
            OR (owner = 'SYS' AND segment_name IN ('AUD$', 'FGA_LOG$'))
         ORDER BY bytes DESC, owner, segment_name
         FETCH FIRST &top_n ROWS ONLY);

-- ---------------------------------------------------------------------------
-- Reach, arrival rate, and what the purge machinery has recorded.
--
-- Three independent reads, each in its own handler, so one view this account
-- cannot open does not cost the other two.
-- ---------------------------------------------------------------------------
DECLARE
  v_old   VARCHAR2(64) := 'none';
  v_new   VARCHAR2(64) := 'none';
  v_span  NUMBER := NULL;
  v_win   NUMBER := NULL;
  v_cnt   NUMBER := NULL;
  v_ts    VARCHAR2(64) := 'none recorded';
  src     VARCHAR2(30) := 'none';
BEGIN
  BEGIN
    EXECUTE IMMEDIATE q'[
      SELECT NVL(TO_CHAR(MIN(event_timestamp), 'YYYY-MM-DD HH24:MI:SS'), 'none'),
             NVL(TO_CHAR(MAX(event_timestamp), 'YYYY-MM-DD HH24:MI:SS'), 'none'),
             CAST(MAX(event_timestamp) AS DATE) - CAST(MIN(event_timestamp) AS DATE)
        FROM unified_audit_trail]' INTO v_old, v_new, v_span;
    src := 'UNIFIED_AUDIT_TRAIL';
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      EXECUTE IMMEDIATE q'[
        SELECT NVL(TO_CHAR(MIN(timestamp), 'YYYY-MM-DD HH24:MI:SS'), 'none'),
               NVL(TO_CHAR(MAX(timestamp), 'YYYY-MM-DD HH24:MI:SS'), 'none'),
               MAX(timestamp) - MIN(timestamp)
          FROM dba_audit_trail]' INTO v_old, v_new, v_span;
      src := 'DBA_AUDIT_TRAIL';
    EXCEPTION WHEN OTHERS THEN
      src := 'none';
    END;
  END;

  IF src = 'none' THEN
    DBMS_OUTPUT.PUT_LINE('CHK|HYG_SPAN|NA|How far back the trail reaches|neither trail view could be read by this account, so the oldest and newest recorded timestamps are unknown. The segment sizes above were still read. Grant the AUDIT_VIEWER role, or SELECT on the trail view your database writes to.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('CHK|HYG_SPAN|OK|How far back the trail reaches|' || src ||
      ' holds records from ' || v_old || ' to ' || v_new || ', a span of ' ||
      NVL(TO_CHAR(ROUND(v_span, 1), 'FM9999999990.0', 'NLS_NUMERIC_CHARACTERS=''.,'''), 'no') ||
      ' days. Whether that matches the retention this estate intends is a question this pack has not been told the answer to.');
    IF v_span IS NOT NULL THEN
      DBMS_OUTPUT.PUT_LINE('MET|HYG_SPAN|days_held|' ||
        TO_CHAR(ROUND(v_span, 1), 'FM9999999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') || '|days');
    END IF;
  END IF;

  IF src <> 'none' THEN
    BEGIN
      IF src = 'UNIFIED_AUDIT_TRAIL' THEN
        EXECUTE IMMEDIATE q'[
          SELECT COUNT(*) FROM unified_audit_trail
           WHERE event_timestamp >= SYSDATE - &window_days]' INTO v_win;
      ELSE
        EXECUTE IMMEDIATE q'[
          SELECT COUNT(*) FROM dba_audit_trail
           WHERE timestamp >= SYSDATE - &window_days]' INTO v_win;
      END IF;
      DBMS_OUTPUT.PUT_LINE('CHK|HYG_RATE|OK|Records arriving|' || v_win ||
        ' records were written in the last &window_days days, which is ' ||
        TO_CHAR(ROUND(v_win / GREATEST(&window_days, 1), 1), 'FM9999999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') ||
        ' per day averaged across the window. Arrival is uneven on most estates, so this is an average and not a daily figure.');
      DBMS_OUTPUT.PUT_LINE('MET|HYG_RATE|records_in_window|' || v_win || '|records');
      DBMS_OUTPUT.PUT_LINE('MET|HYG_RATE|records_per_day|' ||
        TO_CHAR(ROUND(v_win / GREATEST(&window_days, 1), 1), 'FM9999999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') || '|records/day');
    EXCEPTION WHEN OTHERS THEN
      DBMS_OUTPUT.PUT_LINE('CHK|HYG_RATE|NA|Records arriving|the windowed count could not be read (' ||
        SQLERRM || '), so the arrival rate is unknown.');
    END;
  END IF;

  BEGIN
    EXECUTE IMMEDIATE q'[
      SELECT COUNT(*), NVL(MAX(TO_CHAR(last_archive_ts, 'YYYY-MM-DD HH24:MI:SS')), 'none recorded')
        FROM dba_audit_mgmt_last_arch_ts]' INTO v_cnt, v_ts;
    DBMS_OUTPUT.PUT_LINE('CHK|HYG_ARCHIVE|OK|Archive timestamp set for purging|' || v_cnt ||
      ' rows in DBA_AUDIT_MGMT_LAST_ARCH_TS, newest ' || v_ts ||
      '. That timestamp is what a purge uses to decide which records it may remove, so a trail with none set has nothing telling a purge where to stop.');
    DBMS_OUTPUT.PUT_LINE('MET|HYG_ARCHIVE|rows|' || v_cnt || '|rows');
  EXCEPTION WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('CHK|HYG_ARCHIVE|NA|Archive timestamp set for purging|DBA_AUDIT_MGMT_LAST_ARCH_TS could not be read (' ||
      SQLERRM || '). The AUDIT_ADMIN role, or SELECT on that view, would make it readable.');
  END;

  BEGIN
    EXECUTE IMMEDIATE q'[
      SELECT COUNT(*), NVL(MAX(TO_CHAR(cleanup_time, 'YYYY-MM-DD HH24:MI:SS')), 'none recorded')
        FROM dba_audit_mgmt_clean_events]' INTO v_cnt, v_ts;
    DBMS_OUTPUT.PUT_LINE('CHK|HYG_PURGE|OK|Purge events recorded|' || v_cnt ||
      ' rows in DBA_AUDIT_MGMT_CLEAN_EVENTS, newest ' || v_ts ||
      '. Zero rows means no purge has been recorded through the audit management package, which is what a trail that has never been purged through it looks like.');
    DBMS_OUTPUT.PUT_LINE('MET|HYG_PURGE|events|' || v_cnt || '|events');
  EXCEPTION WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('CHK|HYG_PURGE|NA|Purge events recorded|DBA_AUDIT_MGMT_CLEAN_EVENTS could not be read (' ||
      SQLERRM || '). The AUDIT_ADMIN role, or SELECT on that view, would make it readable.');
  END;
END;
/

SPOOL OFF
EXIT
