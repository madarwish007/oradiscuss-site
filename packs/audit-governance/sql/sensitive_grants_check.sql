-- ============================================================================
-- OraDiscuss - Audit and Governance Pack v1.0.0
-- sql/sensitive_grants_check.sql - which of a named list of high-capability
-- packages carry an EXECUTE grant held by PUBLIC, and how many EXECUTE grants
-- PUBLIC holds in total.
--
-- Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
-- affiliated with, or endorsed by Oracle Corporation.
-- READ-ONLY: this pack issues no DDL and no DML against your data.
--
-- Review it before you run it, and run it somewhere that is not production
-- first. You are the DBA.
--
-- Invoked by audit_governance.sh with:
--   &1 = AUDIT_WINDOW_DAYS   (not used by this tier: a grant has no window)
--   &2 = AUDIT_TOP_N         (not used by this tier: the list below is fixed)
--   &3 = spool file
--
-- Emits SEC|title, CHK|id|status|title|detail and MET|id|name|value|unit lines.
--
-- THE LIST IS NAMED, AND WHAT EACH PACKAGE CAN REACH IS PRINTED BESIDE IT.
--   Every package below is reported whether or not the grant exists, because
--   "UTL_TCP is not granted to PUBLIC here" is as much of an answer as the
--   opposite and a report that only listed hits would leave the reader unable
--   to tell a clean read from a read that never happened.
--
--   Each row states what the package can reach rather than what the grant is
--   worth. A grant on UTL_FILE is ordinary on an estate whose applications move
--   files and is worth a second look on one that does not, and this script has
--   not been told which it is looking at. The capability is the fact. The
--   judgement belongs to the reader.
--
--   Oracle itself grants EXECUTE on several of these to PUBLIC when a database
--   is created, and that is stated in the rows rather than left for the reader
--   to discover, because a number that looks the same on every database ever
--   built teaches nobody anything until it is labelled.
--
-- License: single-user license, modify allowed, no redistribution.
-- ============================================================================

SET PAGES 0 FEEDBACK OFF HEADING OFF VERIFY OFF LINES 4000 TRIMSPOOL ON

DEFINE window_days = &1
DEFINE top_n       = &2

SPOOL &3

PROMPT SEC|Package grants held by PUBLIC

-- ---------------------------------------------------------------------------
-- Everything PUBLIC can execute, as one number.
--
-- Printed first so the named list below is read in proportion. On a freshly
-- created database this number is in the thousands and none of it was anybody's
-- decision.
-- ---------------------------------------------------------------------------
SELECT 'CHK|PKG_PUBLIC_EXEC_ALL|OK|EXECUTE grants held by PUBLIC in total|' || COUNT(*) ||
       ' objects have EXECUTE granted to PUBLIC in this container, ' ||
       SUM(CASE WHEN owner = 'SYS' THEN 1 ELSE 0 END) ||
       ' of them owned by SYS. Oracle makes most of these itself when the database is created.'
  FROM dba_tab_privs
 WHERE grantee = 'PUBLIC'
   AND privilege = 'EXECUTE';

SELECT 'MET|PKG_PUBLIC_EXEC_ALL|grants|' || COUNT(*) || '|grants'
  FROM dba_tab_privs
 WHERE grantee = 'PUBLIC'
   AND privilege = 'EXECUTE';

SELECT 'MET|PKG_PUBLIC_EXEC_ALL|grants_not_owned_by_sys|' ||
       SUM(CASE WHEN owner = 'SYS' THEN 0 ELSE 1 END) || '|grants'
  FROM dba_tab_privs
 WHERE grantee = 'PUBLIC'
   AND privilege = 'EXECUTE';

-- ---------------------------------------------------------------------------
-- The named list, each package reported whether or not the grant exists.
--
-- The list is written out rather than matched with a wildcard on DBMS_ and
-- UTL_. A wildcard returns several hundred Oracle-shipped rows on any database
-- and buries the dozen that a reader came here to check.
--
-- The ORDER BY carries an explicit tiebreaker so the check row and the metric
-- row below it, which are separate executions of the same query, cannot come
-- back in two different orders.
-- ---------------------------------------------------------------------------
WITH watched AS (
  SELECT 'UTL_FILE'   AS pkg, 'reads and writes files on the database server file system' AS reach FROM dual
  UNION ALL SELECT 'UTL_HTTP',  'opens outbound HTTP connections from the database server' FROM dual
  UNION ALL SELECT 'UTL_TCP',   'opens outbound TCP connections from the database server' FROM dual
  UNION ALL SELECT 'UTL_SMTP',  'sends mail from the database server' FROM dual
  UNION ALL SELECT 'UTL_MAIL',  'sends mail from the database server' FROM dual
  UNION ALL SELECT 'UTL_INADDR','resolves host names from the database server' FROM dual
  UNION ALL SELECT 'DBMS_LDAP', 'opens outbound LDAP connections from the database server' FROM dual
  UNION ALL SELECT 'DBMS_SQL',  'builds and runs statements assembled at run time' FROM dual
  UNION ALL SELECT 'DBMS_JOB',  'schedules work to run inside the database' FROM dual
  UNION ALL SELECT 'DBMS_SCHEDULER', 'schedules work inside the database and, with the right credential, on the operating system' FROM dual
  UNION ALL SELECT 'DBMS_LOB',  'reads and writes large objects, including through directory objects on the file system' FROM dual
  UNION ALL SELECT 'DBMS_CRYPTO', 'performs encryption and hashing inside the database' FROM dual
  UNION ALL SELECT 'DBMS_NETWORK_ACL_ADMIN', 'administers the access control lists that decide which accounts may use the network packages above' FROM dual
  UNION ALL SELECT 'DBMS_BACKUP_RESTORE', 'reaches the backup and restore layer beneath the database' FROM dual
),
granted AS (
  SELECT table_name, COUNT(*) AS n, MIN(owner) AS owner, MIN(grantor) AS grantor
    FROM dba_tab_privs
   WHERE grantee = 'PUBLIC'
     AND privilege = 'EXECUTE'
   GROUP BY table_name
)
SELECT 'CHK|PKG_' || w.pkg || '|OK|EXECUTE grant to PUBLIC|' || w.pkg ||
       ' (' || w.reach || '): ' ||
       CASE WHEN NVL(g.n, 0) > 0
            THEN 'EXECUTE is granted to PUBLIC, owner ' || NVL(g.owner, 'unknown') ||
                 ', granted by ' || NVL(g.grantor, 'unknown') || '.'
            ELSE 'no EXECUTE grant to PUBLIC in this container.' END
  FROM watched w
  LEFT JOIN granted g ON g.table_name = w.pkg
 ORDER BY NVL(g.n, 0) DESC, w.pkg;

WITH watched AS (
  SELECT 'UTL_FILE'   AS pkg FROM dual
  UNION ALL SELECT 'UTL_HTTP'  FROM dual
  UNION ALL SELECT 'UTL_TCP'   FROM dual
  UNION ALL SELECT 'UTL_SMTP'  FROM dual
  UNION ALL SELECT 'UTL_MAIL'  FROM dual
  UNION ALL SELECT 'UTL_INADDR' FROM dual
  UNION ALL SELECT 'DBMS_LDAP' FROM dual
  UNION ALL SELECT 'DBMS_SQL'  FROM dual
  UNION ALL SELECT 'DBMS_JOB'  FROM dual
  UNION ALL SELECT 'DBMS_SCHEDULER' FROM dual
  UNION ALL SELECT 'DBMS_LOB'  FROM dual
  UNION ALL SELECT 'DBMS_CRYPTO' FROM dual
  UNION ALL SELECT 'DBMS_NETWORK_ACL_ADMIN' FROM dual
  UNION ALL SELECT 'DBMS_BACKUP_RESTORE' FROM dual
),
granted AS (
  SELECT table_name, COUNT(*) AS n
    FROM dba_tab_privs
   WHERE grantee = 'PUBLIC'
     AND privilege = 'EXECUTE'
   GROUP BY table_name
)
SELECT 'MET|PKG_' || w.pkg || '|public_execute_grants|' || NVL(g.n, 0) || '|grants'
  FROM watched w
  LEFT JOIN granted g ON g.table_name = w.pkg
 ORDER BY NVL(g.n, 0) DESC, w.pkg;

-- How many of the named list carry the grant, so the section has a headline
-- number that does not require counting the rows above by eye.
WITH watched AS (
  SELECT 'UTL_FILE'   AS pkg FROM dual
  UNION ALL SELECT 'UTL_HTTP'  FROM dual
  UNION ALL SELECT 'UTL_TCP'   FROM dual
  UNION ALL SELECT 'UTL_SMTP'  FROM dual
  UNION ALL SELECT 'UTL_MAIL'  FROM dual
  UNION ALL SELECT 'UTL_INADDR' FROM dual
  UNION ALL SELECT 'DBMS_LDAP' FROM dual
  UNION ALL SELECT 'DBMS_SQL'  FROM dual
  UNION ALL SELECT 'DBMS_JOB'  FROM dual
  UNION ALL SELECT 'DBMS_SCHEDULER' FROM dual
  UNION ALL SELECT 'DBMS_LOB'  FROM dual
  UNION ALL SELECT 'DBMS_CRYPTO' FROM dual
  UNION ALL SELECT 'DBMS_NETWORK_ACL_ADMIN' FROM dual
  UNION ALL SELECT 'DBMS_BACKUP_RESTORE' FROM dual
),
granted AS (
  SELECT DISTINCT table_name
    FROM dba_tab_privs
   WHERE grantee = 'PUBLIC'
     AND privilege = 'EXECUTE'
)
SELECT 'CHK|PKG_WATCHED_TOTAL|OK|Named packages carrying the grant|' ||
       SUM(CASE WHEN g.table_name IS NULL THEN 0 ELSE 1 END) || ' of ' || COUNT(*) ||
       ' packages on the list above have EXECUTE granted to PUBLIC in this container.'
  FROM watched w
  LEFT JOIN granted g ON g.table_name = w.pkg;

WITH watched AS (
  SELECT 'UTL_FILE'   AS pkg FROM dual
  UNION ALL SELECT 'UTL_HTTP'  FROM dual
  UNION ALL SELECT 'UTL_TCP'   FROM dual
  UNION ALL SELECT 'UTL_SMTP'  FROM dual
  UNION ALL SELECT 'UTL_MAIL'  FROM dual
  UNION ALL SELECT 'UTL_INADDR' FROM dual
  UNION ALL SELECT 'DBMS_LDAP' FROM dual
  UNION ALL SELECT 'DBMS_SQL'  FROM dual
  UNION ALL SELECT 'DBMS_JOB'  FROM dual
  UNION ALL SELECT 'DBMS_SCHEDULER' FROM dual
  UNION ALL SELECT 'DBMS_LOB'  FROM dual
  UNION ALL SELECT 'DBMS_CRYPTO' FROM dual
  UNION ALL SELECT 'DBMS_NETWORK_ACL_ADMIN' FROM dual
  UNION ALL SELECT 'DBMS_BACKUP_RESTORE' FROM dual
),
granted AS (
  SELECT DISTINCT table_name
    FROM dba_tab_privs
   WHERE grantee = 'PUBLIC'
     AND privilege = 'EXECUTE'
)
SELECT 'MET|PKG_WATCHED_TOTAL|packages_granted|' ||
       SUM(CASE WHEN g.table_name IS NULL THEN 0 ELSE 1 END) || '|packages'
  FROM watched w
  LEFT JOIN granted g ON g.table_name = w.pkg;

SPOOL OFF
EXIT
