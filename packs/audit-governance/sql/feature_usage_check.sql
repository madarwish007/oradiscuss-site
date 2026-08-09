-- ============================================================================
-- OraDiscuss - Audit and Governance Pack v1.0.0
-- sql/feature_usage_check.sql - which options this Oracle home reports as
-- installed, and which features the database has actually recorded usage of.
--
-- Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
-- affiliated with, or endorsed by Oracle Corporation.
-- READ-ONLY: this pack issues no DDL and no DML against your data.
--
-- Review it before you run it, and run it somewhere that is not production
-- first. You are the DBA.
--
-- Invoked by audit_governance.sh with:
--   &1 = AUDIT_WINDOW_DAYS   (not used by this tier: Oracle's own sampling
--        decides the period, and the dates it recorded are reported as it
--        recorded them rather than filtered to this pack's window)
--   &2 = AUDIT_TOP_N
--   &3 = spool file
--
-- Emits SEC|title, CHK|id|status|title|detail and MET|id|name|value|unit lines.
--
-- ============================================================================
-- THE HARD RULE FOR THIS FILE, CARRIED WORD FOR WORD FROM THIS PACK'S
-- REGISTERED SCOPE: IT REPORTS USAGE FACTS AND NEVER A LICENCE CONCLUSION.
--
--   "Partitioning shows 14 detected usages, first recorded on 12 March" is a
--   fact. It was read out of a view, it can be checked, and it is exactly what
--   somebody preparing for a conversation about agreements needs to take into
--   that conversation.
--
--   Anything past that sentence is a judgement about an agreement this pack has
--   never seen. What an estate is permitted to use lives in a contract, in
--   whatever was bought, and in terms that change between releases and between
--   customers. None of that is readable from inside a database, and a script
--   that pronounced on it would be guessing with authority.
--
--   So this file names no option as licensable, classifies nothing, and grades
--   nothing. It reports what V$OPTION says is installed, what Oracle's own
--   sampling recorded as used, and the dates it recorded them.
--
-- WHY THERE IS NO BUILT-IN LIST OF "THE ONES THAT COST MONEY".
--   Encoding such a list would itself be a licence claim, made by this pack, on
--   every database it ever runs against, and it would be wrong somewhere within
--   a release or two. The feature rows are ranked by detected usage instead, so
--   the features an estate has actually exercised surface on their own, under
--   Oracle's own names for them, without this file asserting anything about
--   what any of them costs.
--
-- WHY THE DBID FILTER AND THE ONE-ROW-PER-FEATURE FILTER ARE BOTH NEEDED.
--   DBA_FEATURE_USAGE_STATISTICS keeps rows against the DBID that produced
--   them, so a database that was cloned or restored carries rows belonging to
--   its ancestor and a straight count of everything doubles. It also keeps one
--   row per feature per database VERSION, so an upgraded database carries the
--   same feature more than once. Both are filtered here: the current DBID, and
--   the most recently sampled row for each feature name.
-- ============================================================================

SET PAGES 0 FEEDBACK OFF HEADING OFF VERIFY OFF LINES 4000 TRIMSPOOL ON

DEFINE window_days = &1
DEFINE top_n       = &2

SPOOL &3

PROMPT SEC|Option and feature usage

-- ---------------------------------------------------------------------------
-- What this section is, stated in the document rather than only in this header.
-- A report outlives the file it was generated from, and the reader of the HTML
-- has never seen these comments.
-- ---------------------------------------------------------------------------
SELECT 'CHK|FEAT_NOTICE|OK|What this section reports|usage FACTS only: what V$OPTION says was linked into this Oracle home, what Oracle''s own sampling recorded as used, how many times, and on which dates. It reaches no conclusion about any licence, because the terms of an agreement are not readable from inside a database and this pack has never seen yours. These numbers exist so you can take them to whoever holds the agreement.'
  FROM dual;

-- ---------------------------------------------------------------------------
-- Options: what the software reports as installed.
--
-- Installed is a property of what was linked into this Oracle home. It is not
-- the same question as whether anything ever used it, which is the section
-- below, and the two are deliberately reported side by side.
-- ---------------------------------------------------------------------------
SELECT 'CHK|FEAT_OPTIONS_INSTALLED|OK|Options reported installed|' ||
       SUM(CASE WHEN value = 'TRUE' THEN 1 ELSE 0 END) || ' of ' || COUNT(*) ||
       ' rows in V$OPTION report TRUE. Installed describes what was linked into this Oracle home, which is a different question from whether anything ever used it.'
  FROM v$option;

SELECT 'MET|FEAT_OPTIONS_INSTALLED|options_installed|' ||
       SUM(CASE WHEN value = 'TRUE' THEN 1 ELSE 0 END) || '|options'
  FROM v$option;

SELECT 'MET|FEAT_OPTIONS_INSTALLED|options_total|' || COUNT(*) || '|options'
  FROM v$option;

-- Listed alphabetically rather than by any classification, for the reason in
-- the header: ordering them by "the ones that matter" would be this file
-- asserting which ones cost money. The ORDER BY carries an explicit tiebreaker
-- for the same reason as every other capped query in this pack.
SELECT 'CHK|FEATOPT_' || SUBSTR(TRANSLATE(UPPER(parameter), 'x |()/,.:;+-', 'x_'), 1, 60) ||
       '|OK|Option reported installed|' || parameter || ' = ' || value || '.'
  FROM (SELECT parameter, value
          FROM v$option
         WHERE value = 'TRUE'
         ORDER BY parameter, value
         FETCH FIRST &top_n ROWS ONLY);

-- ---------------------------------------------------------------------------
-- Features: what the database recorded as actually used.
-- ---------------------------------------------------------------------------
SELECT 'CHK|FEAT_USED_COUNT|OK|Features with recorded usage|' || COUNT(*) ||
       ' features carry at least one detected usage against this database''s current DBID. Oracle samples these itself on its own schedule, so a feature used once between two samples can be missed, and a count of zero means nothing was detected rather than that nothing happened.'
  FROM (SELECT DISTINCT name
          FROM dba_feature_usage_statistics
         WHERE dbid = (SELECT dbid FROM v$database)
           AND detected_usages > 0);

SELECT 'MET|FEAT_USED_COUNT|features|' || COUNT(*) || '|features'
  FROM (SELECT DISTINCT name
          FROM dba_feature_usage_statistics
         WHERE dbid = (SELECT dbid FROM v$database)
           AND detected_usages > 0);

SELECT 'MET|FEAT_USED_COUNT|features_currently_used|' || COUNT(*) || '|features'
  FROM (SELECT DISTINCT name
          FROM dba_feature_usage_statistics
         WHERE dbid = (SELECT dbid FROM v$database)
           AND currently_used = 'TRUE');

-- One row per feature, with the counts and the dates Oracle recorded, and
-- nothing else. The inner ROW_NUMBER keeps the most recently sampled row for
-- each feature name, so an upgraded database does not report the same feature
-- once per version it has run.
SELECT 'CHK|FEAT_' || SUBSTR(TRANSLATE(UPPER(name), 'x |()/,.:;+-', 'x_'), 1, 60) ||
       '|OK|Feature usage recorded|' || name || ': ' || detected_usages ||
       ' detected usages, currently in use ' || NVL(currently_used, 'not reported') ||
       ', first recorded ' || NVL(TO_CHAR(first_usage_date, 'YYYY-MM-DD'), 'no date recorded') ||
       ', last recorded ' || NVL(TO_CHAR(last_usage_date, 'YYYY-MM-DD'), 'no date recorded') ||
       ', sampled against version ' || version || '.'
  FROM (SELECT name, version, detected_usages, currently_used, first_usage_date, last_usage_date
          FROM (SELECT name, version, detected_usages, currently_used,
                       first_usage_date, last_usage_date,
                       ROW_NUMBER() OVER (PARTITION BY name
                                          ORDER BY last_sample_date DESC NULLS LAST, version DESC) AS rn
                  FROM dba_feature_usage_statistics
                 WHERE dbid = (SELECT dbid FROM v$database)
                   AND detected_usages > 0)
         WHERE rn = 1
         ORDER BY detected_usages DESC, name
         FETCH FIRST &top_n ROWS ONLY);

SELECT 'MET|FEAT_' || SUBSTR(TRANSLATE(UPPER(name), 'x |()/,.:;+-', 'x_'), 1, 60) ||
       '|detected_usages|' || detected_usages || '|usages'
  FROM (SELECT name, detected_usages
          FROM (SELECT name, detected_usages,
                       ROW_NUMBER() OVER (PARTITION BY name
                                          ORDER BY last_sample_date DESC NULLS LAST, version DESC) AS rn
                  FROM dba_feature_usage_statistics
                 WHERE dbid = (SELECT dbid FROM v$database)
                   AND detected_usages > 0)
         WHERE rn = 1
         ORDER BY detected_usages DESC, name
         FETCH FIRST &top_n ROWS ONLY);

-- ---------------------------------------------------------------------------
-- The one arithmetic mistake a reader of these two counts will otherwise make.
-- ---------------------------------------------------------------------------
SELECT 'CHK|FEAT_NAMING|OK|Why the two counts above cannot be subtracted|V$OPTION names OPTIONS and DBA_FEATURE_USAGE_STATISTICS names FEATURES, and the two vocabularies do not line up: one option can appear as several features, as one, or as none at all. The difference between the two numbers above is not a quantity that means anything. Read each list on its own terms.'
  FROM dual;

SPOOL OFF
EXIT
