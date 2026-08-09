-- ============================================================================
-- OraDiscuss - Audit and Governance Pack v1.0.0
-- sql/db_links_inventory.sql - every database link defined in this container:
-- who owns it, which account it connects as, and which host it reaches.
--
-- Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
-- affiliated with, or endorsed by Oracle Corporation.
-- READ-ONLY: this pack issues no DDL and no DML against your data.
--
-- Review it before you run it, and run it somewhere that is not production
-- first. You are the DBA.
--
-- Invoked by audit_governance.sh with:
--   &1 = AUDIT_WINDOW_DAYS   (not used by this tier: a link has no window)
--   &2 = AUDIT_TOP_N         (not used by this tier: every link is listed. A
--        link nobody listed is a route out of this database that nobody
--        reviewed, and truncating that list would be the one place a cap
--        actually costs something)
--   &3 = spool file
--
-- Emits SEC|title, CHK|id|status|title|detail and MET|id|name|value|unit lines.
--
-- WHAT THIS PACK DOES NOT READ, STATED SO NOBODY LOOKS FOR IT.
--   The credential a fixed-user link connects with is stored in the data
--   dictionary in a form this pack does not read and does not attempt to read.
--   The account NAME is in DBA_DB_LINKS and is reported. Nothing else about the
--   credential is.
--
--   A link owned by PUBLIC is usable by every account in the container, which
--   is why the owner is printed beside every row rather than summarised away.
--   Whether any given link ought to exist is a question about the estate this
--   database sits in, and this script has not been shown that estate.
--
-- License: single-user license, modify allowed, no redistribution.
-- ============================================================================

SET PAGES 0 FEEDBACK OFF HEADING OFF VERIFY OFF LINES 4000 TRIMSPOOL ON

DEFINE window_days = &1
DEFINE top_n       = &2

SPOOL &3

PROMPT SEC|Database links

SELECT 'CHK|DBL_TOTAL|OK|Database links defined|' || COUNT(*) ||
       ' links exist in this container, owned by ' || COUNT(DISTINCT owner) ||
       ' accounts and reaching ' || COUNT(DISTINCT host) || ' distinct connect strings. ' ||
       SUM(CASE WHEN owner = 'PUBLIC' THEN 1 ELSE 0 END) ||
       ' of them are owned by PUBLIC, which means every account in the container can use them.'
  FROM dba_db_links;

SELECT 'MET|DBL_TOTAL|links|' || COUNT(*) || '|links'
  FROM dba_db_links;

SELECT 'MET|DBL_TOTAL|public_links|' || SUM(CASE WHEN owner = 'PUBLIC' THEN 1 ELSE 0 END) || '|links'
  FROM dba_db_links;

SELECT 'MET|DBL_TOTAL|distinct_hosts|' || COUNT(DISTINCT host) || '|hosts'
  FROM dba_db_links;

-- One row per link. The ORDER BY carries an explicit tiebreaker so two links
-- sharing an owner cannot come back in a different order between the runs that
-- produce the check rows and any future metric rows.
SELECT 'CHK|DBLINK_' || TRANSLATE(UPPER(owner || '.' || db_link), 'x |()/,:;+', 'x_') ||
       '|OK|Database link|' || owner || '.' || db_link ||
       ' connects as ' ||
       NVL(username, 'the connected user, so it carries whatever privileges the caller has on the far side') ||
       ' to ' || NVL(host, 'no connect string recorded') ||
       ', created ' || TO_CHAR(created, 'YYYY-MM-DD HH24:MI:SS') || '.'
  FROM dba_db_links
 ORDER BY owner, db_link;

SPOOL OFF
EXIT
