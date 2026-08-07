-- ============================================================================
-- OraDiscuss - DBA Health Check Automation Pack v1.0.0
-- sql/create_history_table.sql - OPT-IN, RUN MANUALLY, REVIEW FIRST.
--
-- Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
-- affiliated with, or endorsed by Oracle Corporation.
--
-- *** THIS IS THE ONE EXCEPTION TO THE PACK'S READ-ONLY RULE, AND IT IS THE
-- *** ONLY ONE. Read this paragraph before you run it.
--
-- Every other file in this pack issues no DDL and no DML against your data.
-- This file issues CREATE TABLE and CREATE INDEX, once, deliberately, and
-- only because YOU ran it. Specifically:
--
--   - No script in this pack invokes it. Not health_check.sh, not
--     orchestrate.sh, not tablespace_monitor.sh, not cron. It runs when you
--     type it and at no other time.
--   - The pack is fully functional without it. tablespace_monitor.sh detects
--     that the table is absent and falls back to current-only reporting.
--     Nothing breaks, nothing warns, and no feature silently degrades except
--     the growth projection this table exists to feed.
--   - It creates one table and one index in a schema you name. It reads no
--     data of yours and modifies nothing that already exists.
--
-- If your organisation's answer to "does this tooling write to the database"
-- must be an unqualified no, delete this file. The pack keeps working.
--
-- Written for Oracle 19c/21c. Review it before you run it, and run it
-- somewhere that is not production first. You are the DBA.
--
-- How to run (as the user the monitor connects as - typically SYS/SYSTEM,
-- or better: a dedicated monitoring user):
--   sqlplus / as sysdba @create_history_table.sql ORADISCUSS_TS_HISTORY
--     &1 = table name (must match TS_HISTORY_TABLE in config.env)
--
-- To also capture a sample immediately after creating (optional):
--   INSERT ... SELECT is provided commented-out at the bottom.
--
-- License: single-user license, modify allowed, no redistribution.
-- ============================================================================

SET FEEDBACK ON
SET VERIFY OFF
WHENEVER SQLERROR EXIT SQL.SQLCODE

DEFINE ODC_HIST = '&1'

CREATE TABLE &ODC_HIST (
  sample_time     DATE            DEFAULT SYSDATE NOT NULL,
  tablespace_name VARCHAR2(128)   NOT NULL,
  used_gb         NUMBER          NOT NULL,
  max_gb          NUMBER          NOT NULL
);

CREATE INDEX &ODC_HIST._IDX1 ON &ODC_HIST (tablespace_name, sample_time);

COMMENT ON TABLE &ODC_HIST IS 'OraDiscuss healthcheck pack: tablespace usage history (opt-in)';

-- Optional: capture one snapshot right now.
-- INSERT INTO &ODC_HIST (sample_time, tablespace_name, used_gb, max_gb)
-- SELECT SYSDATE, m.tablespace_name,
--        ROUND(m.used_space * p.bytes / 1024/1024/1024, 2),
--        ROUND(m.tablespace_size * p.bytes / 1024/1024/1024, 2)
-- FROM dba_tablespace_usage_metrics m
-- CROSS JOIN (SELECT TO_NUMBER(value) bytes FROM v$parameter
--             WHERE name = 'db_block_size') p;
-- COMMIT;

EXIT
