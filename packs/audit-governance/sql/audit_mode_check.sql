-- ============================================================================
-- OraDiscuss - Audit and Governance Pack v1.0.0
-- sql/audit_mode_check.sql - which auditing mode this database is in, where the
-- records go, and which unified policies are defined and enabled.
--
-- Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
-- affiliated with, or endorsed by Oracle Corporation.
-- READ-ONLY: this pack issues no DDL and no DML against your data.
--
-- Review it before you run it, and run it somewhere that is not production
-- first. You are the DBA.
--
-- Invoked by audit_governance.sh with:
--   &1 = AUDIT_WINDOW_DAYS   (not used by this tier; the argument list is the
--        same for every tier so the collector has one call shape)
--   &2 = AUDIT_TOP_N
--   &3 = spool file
--
-- Emits SEC|title, CHK|id|status|title|detail and MET|id|name|value|unit lines.
--
-- EVERY ROW HERE IS A FACT ABOUT A SETTING. None of them is graded, because
-- what an audit configuration ought to be depends on what the database is for,
-- and this script has not been told that. The reader is given the setting, what
-- Oracle does with it, and nothing else.
--
-- WHY THIS TIER READS ONLY THREE COLUMNS OF AUDIT_UNIFIED_ENABLED_POLICIES.
-- POLICY_NAME, SUCCESS and FAILURE are present from 12.1 through 23ai. The
-- column that names WHO a policy is enabled for was ENABLED_OPTION in 12.1 and
-- became ENABLED_OPT plus ENTITY_NAME and ENTITY_TYPE in 12.2. Reading a column
-- that does not exist on the release in front of you stops the whole tier, so
-- this reports the portable columns and the enablement row count instead.
--
-- License: single-user license, modify allowed, no redistribution.
-- ============================================================================

SET PAGES 0 FEEDBACK OFF HEADING OFF VERIFY OFF LINES 4000 TRIMSPOOL ON

DEFINE window_days = &1
DEFINE top_n       = &2

SPOOL &3

PROMPT SEC|Audit posture

-- ---------------------------------------------------------------------------
-- Which auditing mode is in force.
--
-- Read from V$OPTION rather than inferred from the audit_trail parameter,
-- because the two answer different questions and a database can be in mixed
-- mode where both are meaningful at once.
-- ---------------------------------------------------------------------------
SELECT 'CHK|AUD_UNIFIED|OK|Unified auditing mode|V$OPTION reports Unified Auditing = ' ||
       NVL((SELECT value FROM v$option WHERE parameter = 'Unified Auditing'),
           'no row, which is what a release older than 12c reports') ||
       '. TRUE is pure unified mode, where the traditional trail is no longer written. FALSE is mixed mode, where unified policies and the traditional audit_trail setting below can both be active at the same time.'
  FROM dual;

SELECT 'CHK|AUD_TRAIL_PARAM|OK|audit_trail parameter|set to ' ||
       NVL((SELECT value FROM v$parameter WHERE name = 'audit_trail'), 'not reported') ||
       '. This governs the TRADITIONAL trail only. NONE means the traditional trail is off, which says nothing either way about unified policies, and DB or OS or XML name where traditional records are written.'
  FROM dual;

SELECT 'CHK|AUD_SYS_OPS|OK|audit_sys_operations parameter|set to ' ||
       NVL((SELECT value FROM v$parameter WHERE name = 'audit_sys_operations'), 'not reported') ||
       '. TRUE means statements issued by an administrative connection are written to the operating system trail. In pure unified mode this parameter is not consulted.'
  FROM dual;

-- ---------------------------------------------------------------------------
-- Where traditional operating system records land: syslog, or files.
--
-- These two parameters together decide whether records leave the database host
-- at all, which is the fact a reader of an audit report most often wants and
-- most often has to go and look up.
-- ---------------------------------------------------------------------------
SELECT 'CHK|AUD_DEST|OK|Traditional trail destination|audit_syslog_level is ' ||
       NVL((SELECT DECODE(value, NULL, 'not set', value) FROM v$parameter WHERE name = 'audit_syslog_level'), 'not reported') ||
       ' and audit_file_dest is ' ||
       NVL((SELECT value FROM v$parameter WHERE name = 'audit_file_dest'), 'not reported') ||
       '. When audit_syslog_level carries a value, operating system audit records go to syslog and therefore off this host. When it is not set, they are files in audit_file_dest on this host.'
  FROM dual;

-- ---------------------------------------------------------------------------
-- Unified policies: how many exist, and how many are switched on.
--
-- Those are different numbers and the gap between them is the point. A policy
-- that is defined and not enabled collects nothing, and a report that printed
-- only one of the two counts would let that pass unnoticed.
-- ---------------------------------------------------------------------------
SELECT 'CHK|AUD_POL_DEFINED|OK|Unified audit policies defined|' || COUNT(DISTINCT policy_name) ||
       ' policies are defined in this container. Defined is not the same as enabled: the count below is how many are actually switched on.'
  FROM audit_unified_policies;

SELECT 'MET|AUD_POL_DEFINED|policies_defined|' || COUNT(DISTINCT policy_name) || '|policies'
  FROM audit_unified_policies;

SELECT 'CHK|AUD_POL_ENABLED|OK|Unified audit policies enabled|' || COUNT(DISTINCT policy_name) ||
       ' policies are enabled. A policy that is defined but not enabled records nothing.'
  FROM audit_unified_enabled_policies;

SELECT 'MET|AUD_POL_ENABLED|policies_enabled|' || COUNT(DISTINCT policy_name) || '|policies'
  FROM audit_unified_enabled_policies;

-- One row per enabled policy, named. A count alone tells a reader that
-- something is enabled without telling them what, which is the least useful
-- half of the answer.
--
-- The id is built from the policy name with the characters that would break the
-- line format removed, and the ORDER BY carries an explicit tiebreaker for the
-- same reason as every other ranked query in this product: the check row and any
-- metric row are separate executions of the same query, and ties left to the
-- optimiser can return them in two different orders.
SELECT 'CHK|AUDPOL_' || TRANSLATE(UPPER(policy_name), 'x |()/,.:;+', 'x_') ||
       '|OK|Enabled audit policy|' || policy_name || ' is enabled through ' || COUNT(*) ||
       ' enablement rows in this container, audit on success ' || MAX(success) ||
       ', audit on failure ' || MAX(failure) || '.'
  FROM audit_unified_enabled_policies
 GROUP BY policy_name
 ORDER BY policy_name, COUNT(*) DESC;

SPOOL OFF
EXIT
