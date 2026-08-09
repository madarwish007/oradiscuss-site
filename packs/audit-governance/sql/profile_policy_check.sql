-- ============================================================================
-- OraDiscuss - Audit and Governance Pack v1.0.0
-- sql/profile_policy_check.sql - what each profile actually sets: the password
-- verify function, password lifetime, failed login attempts, idle time, and how
-- many accounts sit on each profile.
--
-- Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
-- affiliated with, or endorsed by Oracle Corporation.
-- READ-ONLY: this pack issues no DDL and no DML against your data.
--
-- Review it before you run it, and run it somewhere that is not production
-- first. You are the DBA.
--
-- Invoked by audit_governance.sh with:
--   &1 = AUDIT_WINDOW_DAYS   (not used by this tier: a profile has no window)
--   &2 = AUDIT_TOP_N         (not used by this tier: every profile is listed,
--        because a profile nobody listed is a profile nobody reviewed)
--   &3 = spool file
--
-- Emits SEC|title, CHK|id|status|title|detail and MET|id|name|value|unit lines.
--
-- WHY THE ACCOUNT COUNT SITS BESIDE EVERY PROFILE.
--   A profile with no accounts on it describes nothing, and a profile carrying
--   most of the estate describes almost everything. Reading the limits without
--   that number in the same row is how a reader ends up examining the settings
--   of a profile nobody uses. DBA_PROFILES cannot answer it, so it is joined
--   from DBA_USERS and printed as its own row per profile.
--
-- NOTHING HERE IS GRADED, INCLUDING THE ABSENT VERIFY FUNCTION.
--   DBA_PROFILES records "no verify function" as the four literal characters
--   NULL in the LIMIT column, which is stated in the rows below so nobody reads
--   an unset value as a missing row. Whether a profile ought to name one
--   depends on whether the accounts on it authenticate by password at all, and
--   a directory-authenticated or externally-identified estate can hold none by
--   design. The setting is the fact. The reader knows the estate.
--
-- License: single-user license, modify allowed, no redistribution.
-- ============================================================================

SET PAGES 0 FEEDBACK OFF HEADING OFF VERIFY OFF LINES 4000 TRIMSPOOL ON

DEFINE window_days = &1
DEFINE top_n       = &2

SPOOL &3

PROMPT SEC|Profile and password policy

SELECT 'CHK|PROFILES_DEFINED|OK|Profiles defined|' || COUNT(DISTINCT profile) ||
       ' profiles exist in this container.'
  FROM dba_profiles;

SELECT 'MET|PROFILES_DEFINED|profiles|' || COUNT(DISTINCT profile) || '|profiles'
  FROM dba_profiles;

SELECT 'CHK|PROFILES_WITH_VERIFY|OK|Profiles naming a password verify function|' ||
       COUNT(*) || ' of ' ||
       (SELECT COUNT(DISTINCT profile) FROM dba_profiles) ||
       ' profiles name a verify function. The rest carry the four literal characters NULL in the LIMIT column, which is how DBA_PROFILES records that none is set, rather than a row being missing.'
  FROM dba_profiles
 WHERE resource_name = 'PASSWORD_VERIFY_FUNCTION'
   AND limit NOT IN ('NULL', 'DEFAULT');

SELECT 'MET|PROFILES_WITH_VERIFY|profiles|' || COUNT(*) || '|profiles'
  FROM dba_profiles
 WHERE resource_name = 'PASSWORD_VERIFY_FUNCTION'
   AND limit NOT IN ('NULL', 'DEFAULT');

-- ---------------------------------------------------------------------------
-- One row per profile, with the four settings the founder's scope names plus
-- the verify function, pivoted out of the row-per-resource shape.
--
-- The ORDER BY carries an explicit tiebreaker for the same reason as every
-- other multi-execution query in this pack.
-- ---------------------------------------------------------------------------
SELECT 'CHK|PROF_' || TRANSLATE(UPPER(profile), 'x |()/,.:;+', 'x_') ||
       '|OK|Profile settings|' || profile ||
       ': PASSWORD_VERIFY_FUNCTION ' || NVL(MAX(CASE WHEN resource_name = 'PASSWORD_VERIFY_FUNCTION' THEN limit END), 'not present') ||
       ', PASSWORD_LIFE_TIME ' || NVL(MAX(CASE WHEN resource_name = 'PASSWORD_LIFE_TIME' THEN limit END), 'not present') ||
       ', FAILED_LOGIN_ATTEMPTS ' || NVL(MAX(CASE WHEN resource_name = 'FAILED_LOGIN_ATTEMPTS' THEN limit END), 'not present') ||
       ', PASSWORD_LOCK_TIME ' || NVL(MAX(CASE WHEN resource_name = 'PASSWORD_LOCK_TIME' THEN limit END), 'not present') ||
       ', PASSWORD_GRACE_TIME ' || NVL(MAX(CASE WHEN resource_name = 'PASSWORD_GRACE_TIME' THEN limit END), 'not present') ||
       ', PASSWORD_REUSE_MAX ' || NVL(MAX(CASE WHEN resource_name = 'PASSWORD_REUSE_MAX' THEN limit END), 'not present') ||
       ', IDLE_TIME ' || NVL(MAX(CASE WHEN resource_name = 'IDLE_TIME' THEN limit END), 'not present') ||
       '. A limit of DEFAULT takes its value from the DEFAULT profile, and UNLIMITED means the limit is not applied.'
  FROM dba_profiles
 GROUP BY profile
 ORDER BY profile, COUNT(*) DESC;

-- ---------------------------------------------------------------------------
-- How many accounts each profile actually governs, and how many of those are
-- not locked. An account that cannot connect is governed by the profile on
-- paper only, and the two numbers separate that.
-- ---------------------------------------------------------------------------
SELECT 'CHK|PROFUSR_' || TRANSLATE(UPPER(profile), 'x |()/,.:;+', 'x_') ||
       '|OK|Accounts on this profile|' || profile || ' governs ' || COUNT(*) ||
       ' accounts, of which ' ||
       SUM(CASE WHEN account_status LIKE '%LOCKED%' THEN 0 ELSE 1 END) ||
       ' are not locked.'
  FROM dba_users
 GROUP BY profile
 ORDER BY COUNT(*) DESC, profile;

SELECT 'MET|PROFUSR_' || TRANSLATE(UPPER(profile), 'x |()/,.:;+', 'x_') ||
       '|accounts|' || COUNT(*) || '|accounts'
  FROM dba_users
 GROUP BY profile
 ORDER BY COUNT(*) DESC, profile;

SELECT 'MET|PROFUSR_' || TRANSLATE(UPPER(profile), 'x |()/,.:;+', 'x_') ||
       '|accounts_not_locked|' ||
       SUM(CASE WHEN account_status LIKE '%LOCKED%' THEN 0 ELSE 1 END) || '|accounts'
  FROM dba_users
 GROUP BY profile
 ORDER BY COUNT(*) DESC, profile;

SPOOL OFF
EXIT
