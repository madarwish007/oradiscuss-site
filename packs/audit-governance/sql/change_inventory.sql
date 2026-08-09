-- ============================================================================
-- OraDiscuss - Audit and Governance Pack v1.0.0
-- sql/change_inventory.sql - what changed inside the configured window, read
-- two independent ways: the dictionary's own LAST_DDL_TIME, and the statements
-- the audit trail recorded.
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
-- TWO SOURCES ON PURPOSE, AND THEY DO NOT AGREE, WHICH IS THE USEFUL PART.
--   The dictionary knows an object's definition timestamp moved. It does not
--   know who moved it or what statement did. The audit trail knows both, but
--   only for statements some policy was auditing at the time. So a change can
--   appear in one and not the other, and the report carries both counts rather
--   than picking a winner and presenting it as the number.
--
--   LAST_DDL_TIME also moves when an object is recompiled or when a grant on it
--   changes, so the first count is objects whose recorded definition timestamp
--   falls inside the window, not a count of deliberate changes. That sentence
--   is in the row itself, because a number this easy to over-read has to carry
--   its own definition.
--
--   The trail half is native dynamic SQL wrapped in its own handler, for the
--   reason given at length in sql/audit_trail_activity.sql: a static reference
--   to a trail view the session cannot see fails at compile time and would take
--   the object half of this tier down with it.
--
--   The name of the trail that was read is returned by that read as its first
--   column, for the same reason and with the same effect: neither trail view is
--   named in the executable text of this file, only inside the dynamic literals,
--   and the label this half prints is a result of the statement that opened the
--   view rather than an assumption written beside it.
--
-- License: single-user license, modify allowed, no redistribution.
-- ============================================================================

SET PAGES 0 FEEDBACK OFF HEADING OFF VERIFY OFF LINES 4000 TRIMSPOOL ON SERVEROUTPUT ON SIZE UNLIMITED

DEFINE window_days = &1
DEFINE top_n       = &2

SPOOL &3

PROMPT SEC|Change inventory

-- ---------------------------------------------------------------------------
-- Half one: what the dictionary says changed.
-- ---------------------------------------------------------------------------
SELECT 'CHK|CHG_TOTAL|OK|Objects with a definition timestamp inside the window|' || COUNT(*) ||
       ' objects have LAST_DDL_TIME within the last &window_days days, across ' ||
       COUNT(DISTINCT owner) ||
       ' schemas. LAST_DDL_TIME also moves when an object is recompiled or when a grant on it changes, so this counts objects whose recorded definition timestamp falls in the window rather than deliberate changes.'
  FROM dba_objects
 WHERE last_ddl_time >= SYSDATE - &window_days;

SELECT 'MET|CHG_TOTAL|objects|' || COUNT(*) || '|objects'
  FROM dba_objects
 WHERE last_ddl_time >= SYSDATE - &window_days;

SELECT 'MET|CHG_TOTAL|schemas|' || COUNT(DISTINCT owner) || '|schemas'
  FROM dba_objects
 WHERE last_ddl_time >= SYSDATE - &window_days;

-- Ranked by schema. The ORDER BY carries an explicit tiebreaker because the
-- check row and the metric row below are separate executions of the same
-- ranked query and a tie could otherwise return them in two different orders.
SELECT 'CHK|CHGOWN_' || TRANSLATE(UPPER(owner), 'x |()/,.:;+', 'x_') ||
       '|OK|Schema with changed objects|' || owner || ' holds ' || COUNT(*) ||
       ' objects whose definition timestamp falls in the last &window_days days, most recently ' ||
       TO_CHAR(MAX(last_ddl_time), 'YYYY-MM-DD HH24:MI:SS') || '.'
  FROM dba_objects
 WHERE last_ddl_time >= SYSDATE - &window_days
 GROUP BY owner
 ORDER BY COUNT(*) DESC, owner
 FETCH FIRST &top_n ROWS ONLY;

SELECT 'MET|CHGOWN_' || TRANSLATE(UPPER(owner), 'x |()/,.:;+', 'x_') ||
       '|objects|' || COUNT(*) || '|objects'
  FROM dba_objects
 WHERE last_ddl_time >= SYSDATE - &window_days
 GROUP BY owner
 ORDER BY COUNT(*) DESC, owner
 FETCH FIRST &top_n ROWS ONLY;

-- The most recent individual objects, so the reader can see what the counts are
-- made of rather than only how large they are.
SELECT 'CHK|CHGOBJ_' || TRANSLATE(UPPER(owner || '.' || object_name), 'x |()/,:;+', 'x_') ||
       '|OK|Object with a recent definition timestamp|' || owner || '.' || object_name ||
       ' (' || object_type || ', status ' || status || ') last recorded at ' ||
       TO_CHAR(last_ddl_time, 'YYYY-MM-DD HH24:MI:SS') || '.'
  FROM (SELECT owner, object_name, object_type, status, last_ddl_time
          FROM dba_objects
         WHERE last_ddl_time >= SYSDATE - &window_days
         ORDER BY last_ddl_time DESC, owner, object_name
         FETCH FIRST &top_n ROWS ONLY);

-- ---------------------------------------------------------------------------
-- Half two: what the audit trail recorded.
-- ---------------------------------------------------------------------------
DECLARE
  TYPE t_txt IS TABLE OF VARCHAR2(4000);
  TYPE t_num IS TABLE OF NUMBER;
  l_user  t_txt;
  l_act   t_txt;
  l_cnt   t_num;
  n       NUMBER := 0;
  src     VARCHAR2(30) := 'none';
  l_unified BOOLEAN := FALSE;

  FUNCTION as_id(p IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN SUBSTR(TRANSLATE(UPPER(NVL(p, 'UNKNOWN')), 'x |()/,.:;+', 'x_'), 1, 60);
  END as_id;
BEGIN
  BEGIN
    EXECUTE IMMEDIATE q'[
      SELECT 'UNIFIED_AUDIT_TRAIL', COUNT(*) FROM unified_audit_trail
       WHERE event_timestamp >= SYSDATE - &window_days
         AND (action_name LIKE 'CREATE%' OR action_name LIKE 'ALTER%'
           OR action_name LIKE 'DROP%' OR action_name LIKE 'TRUNCATE%'
           OR action_name LIKE 'RENAME%')]' INTO src, n;
    l_unified := TRUE;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      EXECUTE IMMEDIATE q'[
        SELECT 'DBA_AUDIT_TRAIL', COUNT(*) FROM dba_audit_trail
         WHERE timestamp >= SYSDATE - &window_days
           AND (action_name LIKE 'CREATE%' OR action_name LIKE 'ALTER%'
             OR action_name LIKE 'DROP%' OR action_name LIKE 'TRUNCATE%'
             OR action_name LIKE 'RENAME%')]' INTO src, n;
      l_unified := FALSE;
    EXCEPTION WHEN OTHERS THEN
      src := 'none';
    END;
  END;

  IF src = 'none' THEN
    DBMS_OUTPUT.PUT_LINE('CHK|CHG_AUDITED_DDL|NA|Audited statements that changed definitions|no audit trail view could be read by this account, so the dictionary half above is the only source in this section. Grant the AUDIT_VIEWER role, or SELECT on the trail view your database writes to, and this half reports on the next run.');
    RETURN;
  END IF;

  DBMS_OUTPUT.PUT_LINE('CHK|CHG_AUDIT_SOURCE|OK|Audited change source|read from ' || src ||
    '. Only statements a policy was auditing at the time appear here, so a change absent from this half may still have happened and be present in the dictionary half above.');
  DBMS_OUTPUT.PUT_LINE('CHK|CHG_AUDITED_DDL|OK|Audited statements that changed definitions|' || n ||
    ' recorded in the last &window_days days, under the same definition used elsewhere in this pack: action names beginning CREATE, ALTER, DROP, TRUNCATE or RENAME.');
  DBMS_OUTPUT.PUT_LINE('MET|CHG_AUDITED_DDL|records|' || n || '|records');

  IF l_unified THEN
    EXECUTE IMMEDIATE q'[
      SELECT dbusername, action_name, COUNT(*) FROM unified_audit_trail
       WHERE event_timestamp >= SYSDATE - &window_days
         AND (action_name LIKE 'CREATE%' OR action_name LIKE 'ALTER%'
           OR action_name LIKE 'DROP%' OR action_name LIKE 'TRUNCATE%'
           OR action_name LIKE 'RENAME%')
       GROUP BY dbusername, action_name
       ORDER BY COUNT(*) DESC, dbusername, action_name
       FETCH FIRST &top_n ROWS ONLY]' BULK COLLECT INTO l_user, l_act, l_cnt;
  ELSE
    EXECUTE IMMEDIATE q'[
      SELECT username, action_name, COUNT(*) FROM dba_audit_trail
       WHERE timestamp >= SYSDATE - &window_days
         AND (action_name LIKE 'CREATE%' OR action_name LIKE 'ALTER%'
           OR action_name LIKE 'DROP%' OR action_name LIKE 'TRUNCATE%'
           OR action_name LIKE 'RENAME%')
       GROUP BY username, action_name
       ORDER BY COUNT(*) DESC, username, action_name
       FETCH FIRST &top_n ROWS ONLY]' BULK COLLECT INTO l_user, l_act, l_cnt;
  END IF;

  FOR i IN 1 .. NVL(l_user.COUNT, 0) LOOP
    DBMS_OUTPUT.PUT_LINE('CHK|CHGDDL_' || as_id(l_user(i)) || '_' || as_id(l_act(i)) ||
      '|OK|Audited definition change|' || NVL(l_user(i), 'no database user recorded') ||
      ' issued ' || l_act(i) || ' ' || l_cnt(i) || ' times in the last &window_days days.');
    DBMS_OUTPUT.PUT_LINE('MET|CHGDDL_' || as_id(l_user(i)) || '_' || as_id(l_act(i)) ||
      '|records|' || l_cnt(i) || '|records');
  END LOOP;

EXCEPTION WHEN OTHERS THEN
  DBMS_OUTPUT.PUT_LINE('CHK|CHG_AUDITED_PARTIAL|NA|Audited change half|this half stopped part way through (' ||
    SQLERRM || '), so the dictionary half above is all that was read here. Grant the AUDIT_VIEWER role, or SELECT on the trail view your database writes to.');
END;
/

SPOOL OFF
EXIT
