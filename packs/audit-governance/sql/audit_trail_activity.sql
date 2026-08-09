-- ============================================================================
-- OraDiscuss - Audit and Governance Pack v1.0.0
-- sql/audit_trail_activity.sql - what the audit trail actually recorded inside
-- the configured window: top actions, top users, failed logons, DDL activity.
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
-- WHY EVERY READ OF THE TRAIL IS DYNAMIC, AND WHY THAT IS NOT A LOOPHOLE.
--   UNIFIED_AUDIT_TRAIL is frequently not granted. It needs the AUDIT_VIEWER
--   role or an explicit SELECT, and neither is implied by SELECT_CATALOG_ROLE.
--   A STATIC reference to a view the session cannot see fails at COMPILE time,
--   which takes this whole tier down over one view rather than degrading it. So
--   every trail read below is native dynamic SQL wrapped in its own exception
--   handler, exactly as daily-ops/sql/daily_analysis.sql already does.
--
--   Each one is a plain literal beginning with SELECT, never a concatenation.
--   This product's read-only gate reads the statement INSIDE the dynamic SQL
--   and passes only SELECT or WITH, and it fails closed on anything it cannot
--   read with certainty, including a name built by joining strings together. A
--   literal is what keeps this provably a read.
--
--   The traditional trail is read the same way as a FALLBACK, for estates still
--   on DBA_AUDIT_TRAIL. Which one was read is reported, because "no records" and
--   "read the wrong trail" look identical in a total of zero.
--
--   THE NAME OF THE TRAIL THAT WAS READ IS RETURNED BY THE READ ITSELF, as the
--   first column of the same statement, rather than assigned beside it. Two
--   reasons, and the second is the one that matters.
--
--   It keeps the view name out of the executable text of this file entirely, so
--   the only place either trail view is named below is inside a dynamic literal.
--   A guard in this product's test suite asserts exactly that, and it asserts it
--   over the source rather than over one rendered fixture, so an edit that put a
--   trail view back into a plain SELECT would be caught here rather than on a
--   customer's database.
--
--   And the label is then a RESULT of the statement that opened the view, so
--   this report cannot name a trail it did not read: a run that failed over to
--   the traditional trail has no way to print the unified one. Which branch was
--   taken is carried in a boolean below, not by comparing that label back to a
--   name written in this file.
--
-- NOT ONE ROW BELOW IS GRADED. A busy trail is not a finding and a quiet one is
-- not either: how much a database should be recording depends on what it is
-- for. The counts are the answer, and the reader is the one who knows the rest.
--
-- License: single-user license, modify allowed, no redistribution.
-- ============================================================================

SET PAGES 0 FEEDBACK OFF HEADING OFF VERIFY OFF LINES 4000 TRIMSPOOL ON SERVEROUTPUT ON SIZE UNLIMITED

DEFINE window_days = &1
DEFINE top_n       = &2

SPOOL &3

PROMPT SEC|Audit trail activity

DECLARE
  TYPE t_txt IS TABLE OF VARCHAR2(4000);
  TYPE t_num IS TABLE OF NUMBER;
  l_name  t_txt;
  l_cnt   t_num;
  n       NUMBER := 0;
  src     VARCHAR2(30) := 'none';
  l_unified BOOLEAN := FALSE;

  -- Ids have to survive the pipe-delimited line format and the briefing's
  -- id-keyed metric pool, so the characters that would break either one are
  -- removed and spaces become underscores. An action name is free text as far
  -- as this script is concerned.
  FUNCTION as_id(p IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN SUBSTR(TRANSLATE(UPPER(NVL(p, 'UNKNOWN')), 'x |()/,.:;+', 'x_'), 1, 60);
  END as_id;
BEGIN
  BEGIN
    EXECUTE IMMEDIATE q'[
      SELECT 'UNIFIED_AUDIT_TRAIL', COUNT(*) FROM unified_audit_trail
       WHERE event_timestamp >= SYSDATE - &window_days]' INTO src, n;
    l_unified := TRUE;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      EXECUTE IMMEDIATE q'[
        SELECT 'DBA_AUDIT_TRAIL', COUNT(*) FROM dba_audit_trail
         WHERE timestamp >= SYSDATE - &window_days]' INTO src, n;
      l_unified := FALSE;
    EXCEPTION WHEN OTHERS THEN
      src := 'none';
    END;
  END;

  IF src = 'none' THEN
    DBMS_OUTPUT.PUT_LINE('CHK|TRAIL_SOURCE|NA|Audit trail source|neither trail view could be read by this account, so nothing below was collected. Grant the AUDIT_VIEWER role, or SELECT on the trail view your database writes to, and this tier reports on the next run.');
    RETURN;
  END IF;

  DBMS_OUTPUT.PUT_LINE('CHK|TRAIL_SOURCE|OK|Audit trail source|read from ' || src ||
    ', covering the last &window_days days. Records outside that window were not read, so every count below describes that period only.');
  DBMS_OUTPUT.PUT_LINE('CHK|TRAIL_TOTAL|OK|Audited records in the window|' || n ||
    ' records in ' || src || ' over the last &window_days days.');
  DBMS_OUTPUT.PUT_LINE('MET|TRAIL_TOTAL|records|' || n || '|records');

  -- ------------------------------------------------------------------------
  -- Top actions.
  --
  -- The ORDER BY carries an explicit tiebreaker. The check row and its metric
  -- row are written from ONE fetch here, so a tie could not misfile a metric in
  -- this particular tier, but the ranking itself would still be unstable
  -- between runs and two collections of the same database could not be
  -- compared. The tiebreaker is cheap and the instability is not.
  -- ------------------------------------------------------------------------
  IF l_unified THEN
    EXECUTE IMMEDIATE q'[
      SELECT action_name, COUNT(*) FROM unified_audit_trail
       WHERE event_timestamp >= SYSDATE - &window_days
       GROUP BY action_name
       ORDER BY COUNT(*) DESC, action_name
       FETCH FIRST &top_n ROWS ONLY]' BULK COLLECT INTO l_name, l_cnt;
  ELSE
    EXECUTE IMMEDIATE q'[
      SELECT action_name, COUNT(*) FROM dba_audit_trail
       WHERE timestamp >= SYSDATE - &window_days
       GROUP BY action_name
       ORDER BY COUNT(*) DESC, action_name
       FETCH FIRST &top_n ROWS ONLY]' BULK COLLECT INTO l_name, l_cnt;
  END IF;

  FOR i IN 1 .. NVL(l_name.COUNT, 0) LOOP
    DBMS_OUTPUT.PUT_LINE('CHK|TRAILACT_' || as_id(l_name(i)) || '|OK|Audited action|' ||
      l_name(i) || ' was recorded ' || l_cnt(i) || ' times in the last &window_days days.');
    DBMS_OUTPUT.PUT_LINE('MET|TRAILACT_' || as_id(l_name(i)) || '|records|' || l_cnt(i) || '|records');
  END LOOP;
  DBMS_OUTPUT.PUT_LINE('CHK|TRAIL_ACTIONS_KEPT|OK|Actions listed|the ' ||
    NVL(l_name.COUNT, 0) || ' most frequent action names are listed above, out of however many the trail holds. The list is capped at &top_n rows by configuration.');

  -- ------------------------------------------------------------------------
  -- Top database users.
  -- ------------------------------------------------------------------------
  IF l_unified THEN
    EXECUTE IMMEDIATE q'[
      SELECT dbusername, COUNT(*) FROM unified_audit_trail
       WHERE event_timestamp >= SYSDATE - &window_days
       GROUP BY dbusername
       ORDER BY COUNT(*) DESC, dbusername
       FETCH FIRST &top_n ROWS ONLY]' BULK COLLECT INTO l_name, l_cnt;
  ELSE
    EXECUTE IMMEDIATE q'[
      SELECT username, COUNT(*) FROM dba_audit_trail
       WHERE timestamp >= SYSDATE - &window_days
       GROUP BY username
       ORDER BY COUNT(*) DESC, username
       FETCH FIRST &top_n ROWS ONLY]' BULK COLLECT INTO l_name, l_cnt;
  END IF;

  FOR i IN 1 .. NVL(l_name.COUNT, 0) LOOP
    DBMS_OUTPUT.PUT_LINE('CHK|TRAILUSR_' || as_id(l_name(i)) || '|OK|Audited account|' ||
      NVL(l_name(i), 'no database user recorded') || ' produced ' || l_cnt(i) ||
      ' audited records in the last &window_days days.');
    DBMS_OUTPUT.PUT_LINE('MET|TRAILUSR_' || as_id(l_name(i)) || '|records|' || l_cnt(i) || '|records');
  END LOOP;

  -- ------------------------------------------------------------------------
  -- Failed logons, counted separately from the action ranking above because a
  -- failed logon and a successful one share the LOGON action name and the
  -- ranking would fold them together.
  -- ------------------------------------------------------------------------
  IF l_unified THEN
    EXECUTE IMMEDIATE q'[
      SELECT COUNT(*) FROM unified_audit_trail
       WHERE event_timestamp >= SYSDATE - &window_days
         AND action_name = 'LOGON'
         AND return_code <> 0]' INTO n;
  ELSE
    EXECUTE IMMEDIATE q'[
      SELECT COUNT(*) FROM dba_audit_trail
       WHERE timestamp >= SYSDATE - &window_days
         AND action_name = 'LOGON'
         AND returncode <> 0]' INTO n;
  END IF;
  DBMS_OUTPUT.PUT_LINE('CHK|TRAIL_FAILED_LOGON|OK|Logon attempts that did not succeed|' || n ||
    ' recorded in the last &window_days days. A count on its own carries no meaning: routine application reconnect storms and a password being guessed both land here, and only the account names and the times separate them.');
  DBMS_OUTPUT.PUT_LINE('MET|TRAIL_FAILED_LOGON|records|' || n || '|records');

  -- ------------------------------------------------------------------------
  -- DDL activity, under a definition that is printed rather than assumed.
  --
  -- Neither trail carries a DDL flag, so this counts the action names beginning
  -- with the five statement words that create, change or remove objects. Saying
  -- which definition produced the number is the difference between a fact and a
  -- number somebody has to reverse engineer.
  -- ------------------------------------------------------------------------
  IF l_unified THEN
    EXECUTE IMMEDIATE q'[
      SELECT COUNT(*) FROM unified_audit_trail
       WHERE event_timestamp >= SYSDATE - &window_days
         AND (action_name LIKE 'CREATE%' OR action_name LIKE 'ALTER%'
           OR action_name LIKE 'DROP%' OR action_name LIKE 'TRUNCATE%'
           OR action_name LIKE 'RENAME%')]' INTO n;
  ELSE
    EXECUTE IMMEDIATE q'[
      SELECT COUNT(*) FROM dba_audit_trail
       WHERE timestamp >= SYSDATE - &window_days
         AND (action_name LIKE 'CREATE%' OR action_name LIKE 'ALTER%'
           OR action_name LIKE 'DROP%' OR action_name LIKE 'TRUNCATE%'
           OR action_name LIKE 'RENAME%')]' INTO n;
  END IF;
  DBMS_OUTPUT.PUT_LINE('CHK|TRAIL_DDL|OK|Audited statements that changed object definitions|' || n ||
    ' recorded in the last &window_days days. Definition used, so the number can be checked: action names beginning CREATE, ALTER, DROP, TRUNCATE or RENAME. Statements that no policy audits are absent from this count, so it describes what was RECORDED rather than what happened.');
  DBMS_OUTPUT.PUT_LINE('MET|TRAIL_DDL|records|' || n || '|records');

EXCEPTION WHEN OTHERS THEN
  DBMS_OUTPUT.PUT_LINE('CHK|TRAIL_PARTIAL|NA|Audit trail activity|this tier stopped part way through (' ||
    SQLERRM || '), so any rows above it are all that was read. Grant the AUDIT_VIEWER role, or SELECT on the trail view your database writes to.');
END;
/

SPOOL OFF
EXIT
