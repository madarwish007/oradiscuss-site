-- ============================================================================
-- OraDiscuss - RCA Generator Pack v1.0.0
-- sql/rca_alertlog.sql - alert-log entries inside the incident window.
--
-- Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
-- affiliated with, or endorsed by Oracle Corporation.
-- READ-ONLY: this pack issues no DDL and no DML against your data.
--
-- Review it before you run it, and run it somewhere that is not production
-- first. You are the DBA.
--
-- Invoked by rca_generator.sh, and ONLY after the caller has probed that
-- X$DBGALERTEXT is readable. When it is not, the caller falls back to reading
-- the text alert log and this file is never run.
--
--   &1 = window start, 'YYYY-MM-DD HH24:MI:SS'
--   &2 = window end,   'YYYY-MM-DD HH24:MI:SS'
--   &3 = maximum rows to return
--   &4 = starting sequence number for EVT lines
--   &5 = spool file
--
-- Emits EVT|seq|epoch|timestamp|source|severity|message lines.
--
-- WHY EVERY EVENT CARRIES BOTH AN EPOCH AND A FORMATTED TIMESTAMP.
-- The epoch is what the timeline is SORTED by. The formatted string is what the
-- report DISPLAYS, and it is formatted here, at collection time, on the machine
-- that saw the incident. Re-reading an archived collection somewhere else must
-- not silently rewrite the clock the incident actually happened on, and a
-- renderer that formats an epoch itself would do exactly that. It also means
-- --render-only never needs a date library at all.
--
-- WHY THE SEQUENCE NUMBER EXISTS.
-- Alert log entries routinely share a second, and an ORA- error and the trace
-- file it wrote are frequently the same second. Sorting on the epoch alone
-- leaves their order to whichever sort implementation is installed, which is
-- how the same collection tells two different stories on two machines. seq is
-- assigned here, once, and the renderer sorts on (epoch, seq).
--
-- License: single-user license, modify allowed, no redistribution.
-- ============================================================================

SET PAGES 0 FEEDBACK OFF HEADING OFF VERIFY OFF LINES 32767 LONG 32767 TRIMSPOOL ON
WHENEVER SQLERROR EXIT SQL.SQLCODE

DEFINE win_from = &1
DEFINE win_to   = &2
DEFINE max_rows = &3
DEFINE seq_base = &4

SPOOL &5

SELECT 'EVT|' ||
       TO_CHAR(&seq_base + ROW_NUMBER() OVER (ORDER BY originating_timestamp, message_text)) || '|' ||
       TO_CHAR(ROUND((CAST(originating_timestamp AS DATE) - TO_DATE('1970-01-01','YYYY-MM-DD')) * 86400)) || '|' ||
       TO_CHAR(originating_timestamp, 'YYYY-MM-DD HH24:MI:SS') || '|' ||
       'alert-log' || '|' ||
       CASE message_level
            WHEN 1 THEN 'CRITICAL'
            WHEN 2 THEN 'SEVERE'
            WHEN 8 THEN 'IMPORTANT'
            WHEN 16 THEN 'NORMAL'
            ELSE 'LEVEL-' || TO_CHAR(message_level) END || '|' ||
       -- Tabs, newlines and pipes are removed here rather than in the shell,
       -- because a message carrying a pipe would split into the wrong fields
       -- before any shell ever saw it. Alert log text is arbitrary: ORA- errors
       -- quote file paths, bind values and SQL fragments.
       TRANSLATE(SUBSTR(message_text, 1, 900), 'x' || CHR(9) || CHR(10) || CHR(13) || '|', 'x   ')
  FROM x$dbgalertext
 WHERE originating_timestamp >= TO_TIMESTAMP('&win_from', 'YYYY-MM-DD HH24:MI:SS')
   AND originating_timestamp <= TO_TIMESTAMP('&win_to',   'YYYY-MM-DD HH24:MI:SS')
   AND message_level <= 8
 ORDER BY originating_timestamp, message_text
 FETCH FIRST &max_rows ROWS ONLY;

SPOOL OFF
EXIT
