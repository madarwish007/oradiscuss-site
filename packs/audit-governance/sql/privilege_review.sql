-- ============================================================================
-- OraDiscuss - Audit and Governance Pack v1.0.0
-- sql/privilege_review.sql - who holds what: the DBA role, system privileges
-- that apply across every schema, grants held by PUBLIC, Oracle-supplied
-- accounts that are open, accounts on the shipped default password list, and
-- the contents of the password file.
--
-- Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
-- affiliated with, or endorsed by Oracle Corporation.
-- READ-ONLY: this pack issues no DDL and no DML against your data.
--
-- Review it before you run it, and run it somewhere that is not production
-- first. You are the DBA.
--
-- Invoked by audit_governance.sh with:
--   &1 = AUDIT_WINDOW_DAYS   (not used by this tier: a grant has no window, it
--        is either held right now or it is not)
--   &2 = AUDIT_TOP_N
--   &3 = spool file
--
-- Emits SEC|title, CHK|id|status|title|detail and MET|id|name|value|unit lines.
--
-- THIS IS THE TIER WHERE THE TEMPTATION TO JUDGE IS STRONGEST, AND IT DOES NOT.
--   Every row is a named, counted observation and every row carries status OK,
--   meaning it was read. Not one of them is coloured as a finding.
--
--   The reason is not squeamishness. A privilege that applies across every
--   schema is exactly right for a backup account and exactly wrong for a
--   reporting one, and nothing readable from inside the database tells these
--   two apart. An Oracle-supplied account that is open may be open because a
--   feature the estate depends on requires it. A report that graded any of this
--   would be guessing, and it would be guessing with authority, which is worse
--   than not answering.
--
--   So each row also carries the fact a reader needs in order to judge it
--   themselves: the account status beside a default password, the grantor and
--   the admin option beside a grant, and the note that most object grants held
--   by PUBLIC were made by Oracle when the database was created.
--
-- ORDER OF THE SUB-READS IS DELIBERATE: most portable first.
--   A statement that references a column absent on this release stops the whole
--   tier, and the collector keeps whatever was produced before that point. So
--   the reads that work on every supported release run first, and the two that
--   depend on 12c-era columns (ORACLE_MAINTAINED, the extended password file
--   columns) run last, where the cost of losing them is smallest.
--
-- License: single-user license, modify allowed, no redistribution.
-- ============================================================================

SET PAGES 0 FEEDBACK OFF HEADING OFF VERIFY OFF LINES 4000 TRIMSPOOL ON

DEFINE window_days = &1
DEFINE top_n       = &2

SPOOL &3

PROMPT SEC|Privilege and access

-- ---------------------------------------------------------------------------
-- The DBA role, by name.
--
-- A count on its own would say something is true of the estate without saying
-- of whom, which is the half of the answer nobody can act on.
-- ---------------------------------------------------------------------------
SELECT 'CHK|PRIV_DBA_ROLE|OK|Grantees of the DBA role|' || COUNT(*) ||
       ' grantees hold DBA in this container. A grantee can be an account or another role, and a role holding DBA passes it to everyone who holds that role.'
  FROM dba_role_privs
 WHERE granted_role = 'DBA';

SELECT 'MET|PRIV_DBA_ROLE|grantees|' || COUNT(*) || '|grantees'
  FROM dba_role_privs
 WHERE granted_role = 'DBA';

SELECT 'CHK|DBAROLE_' || TRANSLATE(UPPER(grantee), 'x |()/,.:;+', 'x_') ||
       '|OK|DBA role holder|' || grantee || ' holds DBA. Admin option ' || admin_option ||
       ', default role ' || default_role || '.'
  FROM dba_role_privs
 WHERE granted_role = 'DBA'
 ORDER BY grantee, admin_option;

-- ---------------------------------------------------------------------------
-- System privileges that apply across every schema.
--
-- Oracle spells these with ANY in the privilege name, and that word is the
-- whole difference: SELECT ANY TABLE reaches every schema in the container
-- rather than one. Reported as a count per grantee, ranked, because the list of
-- individual grants runs to hundreds of rows on a normal database and a report
-- nobody finishes reading is not a report.
--
-- The ORDER BY carries an explicit tiebreaker. The check row and the metric row
-- below it are SEPARATE executions of the same ranked query, so two grantees
-- tied on the same count could otherwise be returned in two different orders,
-- and a measurement would attach to a grantee that is not in the document. The
-- briefing would still be valid JSON and would still pass its schema, which is
-- exactly why this belongs here rather than in a later check.
-- ---------------------------------------------------------------------------
SELECT 'CHK|PRIV_ANY_TOTAL|OK|System privileges that apply across all schemas|' || COUNT(*) ||
       ' such grants are held in this container by ' || COUNT(DISTINCT grantee) ||
       ' grantees. Oracle names these privileges with the word ANY, which is what makes them reach every schema rather than one.'
  FROM dba_sys_privs
 WHERE privilege LIKE '%ANY%';

SELECT 'MET|PRIV_ANY_TOTAL|grants|' || COUNT(*) || '|grants'
  FROM dba_sys_privs
 WHERE privilege LIKE '%ANY%';

SELECT 'MET|PRIV_ANY_TOTAL|grantees|' || COUNT(DISTINCT grantee) || '|grantees'
  FROM dba_sys_privs
 WHERE privilege LIKE '%ANY%';

SELECT 'CHK|PRIVANY_' || TRANSLATE(UPPER(grantee), 'x |()/,.:;+', 'x_') ||
       '|OK|Holder of cross-schema privileges|' || grantee || ' holds ' || COUNT(*) ||
       ' privileges whose name contains ANY, of which ' ||
       SUM(CASE WHEN admin_option = 'YES' THEN 1 ELSE 0 END) ||
       ' carry the admin option, meaning that grantee can pass them on.'
  FROM dba_sys_privs
 WHERE privilege LIKE '%ANY%'
 GROUP BY grantee
 ORDER BY COUNT(*) DESC, grantee
 FETCH FIRST &top_n ROWS ONLY;

SELECT 'MET|PRIVANY_' || TRANSLATE(UPPER(grantee), 'x |()/,.:;+', 'x_') ||
       '|privileges|' || COUNT(*) || '|privileges'
  FROM dba_sys_privs
 WHERE privilege LIKE '%ANY%'
 GROUP BY grantee
 ORDER BY COUNT(*) DESC, grantee
 FETCH FIRST &top_n ROWS ONLY;

-- ---------------------------------------------------------------------------
-- What PUBLIC holds.
--
-- PUBLIC is held by every account that exists, so a grant here is a grant to
-- everybody. The note about Oracle's own grants is in the row rather than in a
-- footnote, because without it the object-grant number reads as alarming on
-- every database ever created, and a number that always looks alarming stops
-- being read at all.
-- ---------------------------------------------------------------------------
SELECT 'CHK|PRIV_PUBLIC_SYS|OK|System privileges held by PUBLIC|' || COUNT(*) ||
       ' system privileges are granted to PUBLIC, which every account in the container holds.'
  FROM dba_sys_privs
 WHERE grantee = 'PUBLIC';

SELECT 'MET|PRIV_PUBLIC_SYS|grants|' || COUNT(*) || '|grants'
  FROM dba_sys_privs
 WHERE grantee = 'PUBLIC';

SELECT 'CHK|PRIV_PUBLIC_ROLE|OK|Roles granted to PUBLIC|' || COUNT(*) ||
       ' roles are granted to PUBLIC. A role here reaches every account in the container.'
  FROM dba_role_privs
 WHERE grantee = 'PUBLIC';

SELECT 'MET|PRIV_PUBLIC_ROLE|grants|' || COUNT(*) || '|grants'
  FROM dba_role_privs
 WHERE grantee = 'PUBLIC';

SELECT 'CHK|PRIV_PUBLIC_OBJ|OK|Object privileges held by PUBLIC|' || COUNT(*) ||
       ' object grants are held by PUBLIC, of which ' ||
       SUM(CASE WHEN owner = 'SYS' THEN 1 ELSE 0 END) ||
       ' are on objects owned by SYS. Oracle makes several thousand of these itself when the database is created, so a large number here is the shipped state rather than something anybody did.'
  FROM dba_tab_privs
 WHERE grantee = 'PUBLIC';

SELECT 'MET|PRIV_PUBLIC_OBJ|grants|' || COUNT(*) || '|grants'
  FROM dba_tab_privs
 WHERE grantee = 'PUBLIC';

SELECT 'MET|PRIV_PUBLIC_OBJ|grants_not_owned_by_sys|' ||
       SUM(CASE WHEN owner = 'SYS' THEN 0 ELSE 1 END) || '|grants'
  FROM dba_tab_privs
 WHERE grantee = 'PUBLIC';

-- ---------------------------------------------------------------------------
-- Accounts on the shipped default password list.
--
-- DBA_USERS_WITH_DEFPWD compares an account's password verifier against the
-- passwords Oracle ships with its OWN accounts. It is not a password strength
-- test and it knows nothing about accounts the estate created, and saying so is
-- what stops the row being read as more than it is. The account status travels
-- beside each name, because a locked account and an open one are different
-- facts and the view itself does not carry the difference.
-- ---------------------------------------------------------------------------
SELECT 'CHK|PRIV_DEFPWD|OK|Accounts whose password matches a shipped default|' || COUNT(*) ||
       ' accounts appear in DBA_USERS_WITH_DEFPWD. That view compares against the passwords Oracle ships with its own accounts. It does not measure password strength and it does not look at accounts you created.'
  FROM dba_users_with_defpwd;

SELECT 'MET|PRIV_DEFPWD|accounts|' || COUNT(*) || '|accounts'
  FROM dba_users_with_defpwd;

SELECT 'CHK|DEFPWD_' || TRANSLATE(UPPER(d.username), 'x |()/,.:;+', 'x_') ||
       '|OK|Account on the shipped default password list|' || d.username ||
       ', account status ' || NVL(u.account_status, 'not found in DBA_USERS') ||
       ', profile ' || NVL(u.profile, 'unknown') || '.'
  FROM dba_users_with_defpwd d
  LEFT JOIN dba_users u ON u.username = d.username
 ORDER BY d.username, u.account_status;

-- ---------------------------------------------------------------------------
-- Oracle-supplied accounts that are not locked.
--
-- ORACLE_MAINTAINED arrived in 12.1, which is why this read sits near the end.
-- ---------------------------------------------------------------------------
SELECT 'CHK|PRIV_BUILTIN_OPEN|OK|Oracle-supplied accounts that are not locked|' || COUNT(*) ||
       ' of the accounts Oracle creates with the database carry a status other than LOCKED. Some database features require their own supplied account to be open, so this is a count rather than a finding.'
  FROM dba_users
 WHERE oracle_maintained = 'Y'
   AND account_status NOT LIKE '%LOCKED%';

SELECT 'MET|PRIV_BUILTIN_OPEN|accounts|' || COUNT(*) || '|accounts'
  FROM dba_users
 WHERE oracle_maintained = 'Y'
   AND account_status NOT LIKE '%LOCKED%';

SELECT 'CHK|BUILTIN_' || TRANSLATE(UPPER(username), 'x |()/,.:;+', 'x_') ||
       '|OK|Oracle-supplied account that is not locked|' || username ||
       ', status ' || account_status || ', profile ' || profile ||
       ', authentication ' || authentication_type || '.'
  FROM dba_users
 WHERE oracle_maintained = 'Y'
   AND account_status NOT LIKE '%LOCKED%'
 ORDER BY username, account_status;

-- ---------------------------------------------------------------------------
-- The password file.
--
-- An account here can connect with administrative privilege before the database
-- is open, which is a different route from any role grant above and is why it
-- is read separately. The extended columns arrived in 12.1, so this read is
-- last.
-- ---------------------------------------------------------------------------
SELECT 'CHK|PRIV_PWFILE|OK|Accounts in the password file|' || COUNT(*) ||
       ' accounts are listed in V$PWFILE_USERS. An account here can connect with administrative privilege before the database is open, which is a separate route from any role listed above.'
  FROM v$pwfile_users;

SELECT 'MET|PRIV_PWFILE|accounts|' || COUNT(*) || '|accounts'
  FROM v$pwfile_users;

SELECT 'CHK|PWFILE_' || TRANSLATE(UPPER(username), 'x |()/,.:;+', 'x_') ||
       '|OK|Password file account|' || username || ': SYSDBA ' || sysdba ||
       ', SYSOPER ' || sysoper || ', SYSBACKUP ' || sysbackup ||
       ', SYSDG ' || sysdg || ', SYSKM ' || syskm || '.'
  FROM v$pwfile_users
 ORDER BY username, sysdba DESC;

SPOOL OFF
EXIT
