-- ============================================================================
-- OraDiscuss - Audit and Governance Pack v1.0.0
-- sql/tde_encryption_check.sql - keystore status, encrypted tablespaces, and
-- encrypted columns.
--
-- Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
-- affiliated with, or endorsed by Oracle Corporation.
-- READ-ONLY: this pack issues no DDL and no DML against your data.
--
-- Review it before you run it, and run it somewhere that is not production
-- first. You are the DBA.
--
-- Invoked by audit_governance.sh with:
--   &1 = AUDIT_WINDOW_DAYS   (not used by this tier: encryption is a state, not
--        an event)
--   &2 = AUDIT_TOP_N         (not used by this tier: every encrypted tablespace
--        and column is listed)
--   &3 = spool file
--
-- Emits SEC|title, CHK|id|status|title|detail and MET|id|name|value|unit lines.
--
-- AN EMPTY ANSWER HERE IS A REAL ANSWER, AND IT IS NOT A FINDING.
--   A database with no keystore configured reports a keystore status of
--   NOT_AVAILABLE and no encrypted tablespaces, and there is nothing wrong with
--   that: encryption at rest is frequently provided by the storage layer or the
--   file system instead, neither of which is visible from inside the database.
--   So this tier reports what Oracle's own views hold and stops there. It has
--   no way to see the layers underneath it and it does not pretend otherwise.
--
--   Transparent Data Encryption is a licensed feature. This tier reports
--   whether the views show it in use. It draws no conclusion about any
--   agreement, for the same reason as sql/feature_usage_check.sql.
--
-- WHY THE ENCRYPTED TABLESPACE READ USES ONLY TWO COLUMNS.
--   TS# and ENCRYPTIONALG are present in V$ENCRYPTED_TABLESPACES on every
--   release this pack supports. The columns describing key state were renamed
--   and extended between 11g and 19c, and reading one that is absent on the
--   release in front of you stops the rest of this tier.
--
-- License: single-user license, modify allowed, no redistribution.
-- ============================================================================

SET PAGES 0 FEEDBACK OFF HEADING OFF VERIFY OFF LINES 4000 TRIMSPOOL ON

DEFINE window_days = &1
DEFINE top_n       = &2

SPOOL &3

PROMPT SEC|Encryption at rest

-- ---------------------------------------------------------------------------
-- The keystore.
--
-- Grouped by type and status rather than keyed by row number, because a row
-- number is not stable between runs and two collections of the same database
-- would not be comparable. In a container database this view carries one row
-- per container, so the count in each group is meaningful on its own.
-- ---------------------------------------------------------------------------
SELECT 'CHK|TDE_WALLET|OK|Keystore rows|' || COUNT(*) ||
       ' rows in V$ENCRYPTION_WALLET, of which ' ||
       SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) ||
       ' report status OPEN. A status of NOT_AVAILABLE means no keystore is configured for that container, which is a fact about configuration and says nothing about whether the data is encrypted somewhere beneath the database.'
  FROM v$encryption_wallet;

SELECT 'MET|TDE_WALLET|rows|' || COUNT(*) || '|rows'
  FROM v$encryption_wallet;

SELECT 'MET|TDE_WALLET|rows_open|' || SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) || '|rows'
  FROM v$encryption_wallet;

SELECT 'CHK|TDEWLT_' || TRANSLATE(UPPER(wrl_type || '_' || status), 'x |()/,.:;+', 'x_') ||
       '|OK|Keystore state|' || COUNT(*) || ' rows report type ' || wrl_type ||
       ' with status ' || status || ', location ' ||
       NVL(MIN(wrl_parameter), 'not recorded in this view') || '.'
  FROM v$encryption_wallet
 GROUP BY wrl_type, status
 ORDER BY wrl_type, status;

-- ---------------------------------------------------------------------------
-- Encrypted tablespaces, counted against the total so the number has a
-- denominator. "Four tablespaces are encrypted" means something different in a
-- database with five than in one with ninety.
-- ---------------------------------------------------------------------------
SELECT 'CHK|TDE_TS_COUNT|OK|Encrypted tablespaces|' ||
       (SELECT COUNT(*) FROM v$encrypted_tablespaces) || ' of ' || COUNT(*) ||
       ' tablespaces in this container appear in V$ENCRYPTED_TABLESPACES.'
  FROM v$tablespace;

SELECT 'MET|TDE_TS_COUNT|encrypted_tablespaces|' || COUNT(*) || '|tablespaces'
  FROM v$encrypted_tablespaces;

SELECT 'MET|TDE_TS_COUNT|tablespaces_total|' || COUNT(*) || '|tablespaces'
  FROM v$tablespace;

SELECT 'CHK|TDETS_' || TRANSLATE(UPPER(NVL(t.name, 'TS_' || e.ts#)), 'x |()/,.:;+', 'x_') ||
       '|OK|Encrypted tablespace|' || NVL(t.name, 'tablespace number ' || e.ts#) ||
       ' is encrypted with ' || NVL(e.encryptionalg, 'an algorithm this view did not report') || '.'
  FROM v$encrypted_tablespaces e
  LEFT JOIN v$tablespace t ON t.ts# = e.ts#
 ORDER BY t.name, e.ts#;

-- ---------------------------------------------------------------------------
-- Encrypted columns. A separate feature from tablespace encryption, using the
-- same keystore, and a database can use either, both or neither.
-- ---------------------------------------------------------------------------
SELECT 'CHK|TDE_COL_COUNT|OK|Encrypted columns|' || COUNT(*) ||
       ' columns are encrypted, across ' || COUNT(DISTINCT owner || '.' || table_name) ||
       ' tables. Column encryption and tablespace encryption are separate features and a database can use either, both or neither.'
  FROM dba_encrypted_columns;

SELECT 'MET|TDE_COL_COUNT|columns|' || COUNT(*) || '|columns'
  FROM dba_encrypted_columns;

SELECT 'MET|TDE_COL_COUNT|tables|' || COUNT(DISTINCT owner || '.' || table_name) || '|tables'
  FROM dba_encrypted_columns;

SELECT 'CHK|TDECOL_' || TRANSLATE(UPPER(owner || '.' || table_name || '.' || column_name), 'x |()/,:;+', 'x_') ||
       '|OK|Encrypted column|' || owner || '.' || table_name || '.' || column_name ||
       ' is encrypted with ' || NVL(encryption_alg, 'an algorithm this view did not report') ||
       ', salt ' || NVL(salt, 'not reported') || '.'
  FROM dba_encrypted_columns
 ORDER BY owner, table_name, column_name;

SPOOL OFF
EXIT
