-- ============================================================================
-- OraDiscuss - Daily Operations Pack v1.0.0
-- sql/tbs_report.sql - the tablespace deep read: usage, bigfile shape,
-- autoextend headroom, and shrink / extent-count hints.
--
-- Generated and published by OraDiscuss (oradiscuss.com). Not produced by,
-- affiliated with, or endorsed by Oracle Corporation.
-- READ-ONLY: this pack issues no DDL and no DML against your data.
--
-- Review it before you run it, and run it somewhere that is not production
-- first. You are the DBA.
--
-- Invoked by tbs_manager.sh with:
--   &1 = TS_WARN_PCT
--   &2 = TS_CRIT_PCT
--   &3 = TS_SHRINK_FREE_PCT (free-space percentage that makes a datafile a
--        shrink CANDIDATE, expressed 0 to 100)
--   &4 = TS_FRAG_EXTENTS (extent count above which a segment is worth a look)
--   &5 = spool file
--
-- Emits SEC|title, CHK|id|status|title|detail and MET|id|name|value|unit lines.
--
-- WHY THIS EXISTS BESIDE daily_analysis.sql, WHICH ALSO READS TABLESPACES.
-- The morning briefing answers "is anything full". This one answers the three
-- questions you ask once something is: can the file grow by itself, how much
-- room is actually reachable before a human has to act, and is any of this
-- space recoverable rather than purchasable. Those come from different views
-- (_data_files, _free_space, _segments) and they are why a tablespace deep read
-- is its own script. The check ids are deliberately distinct from the briefing's
-- TS_ ids so the two documents can sit side by side without either appearing to
-- overwrite the other.
--
-- WHY EVERY VIEW HERE IS DBA_ AND NOT CDB_, WHICH IS A CORRECTION.
-- The v0.9 script took a DBA/CDB view prefix and applied it to some views while
-- joining them to dba_tablespace_usage_metrics, which is container-scoped and
-- has no CDB_ counterpart in that join. In a CDB root that mixture produces
-- DUPLICATE ROWS: SYSTEM and SYSAUX exist in every pluggable database, so a
-- join on tablespace_name alone multiplies every row by the number of open
-- containers, and the report silently describes databases nobody asked about.
--
-- The coherent answer is that this script reports on ONE container, the one the
-- session is connected to, and says so on its face in the SCOPE check below.
-- Every view it reads then describes the same thing, which is the property the
-- v0.9 mixture did not have. To cover a whole CDB, run it once per container.
-- That is the same shape as the RAC answer elsewhere in this product: state the
-- scope in the data rather than leave the reader to assume it is total.
--
-- License: single-user license, modify allowed, no redistribution.
-- ============================================================================

SET PAGES 0 FEEDBACK OFF HEADING OFF VERIFY OFF LINES 4000 TRIMSPOOL ON
WHENEVER SQLERROR EXIT SQL.SQLCODE

DEFINE ts_warn    = &1
DEFINE ts_crit    = &2
DEFINE shrink_pct = &3
DEFINE frag_ext   = &4

SPOOL &5

-- ---------------------------------------------------------------------------
-- Section 0: what this report can and cannot see, stated in the data.
--
-- An unstated scope is indistinguishable from a bug. A DBA reading a clean
-- tablespace report from a CDB root, not knowing it covered the root only,
-- would draw exactly the wrong conclusion about the pluggable database that is
-- actually full, and nothing in the report would have warned them.
-- ---------------------------------------------------------------------------
PROMPT SEC|Report scope

SELECT 'CHK|SCOPE|OK|Report scope|' ||
       CASE WHEN d.cdb = 'YES'
            THEN 'container ' || SYS_CONTEXT('USERENV','CON_NAME') ||
                 ' only. These views describe the container this session is connected to, so tablespaces belonging to other pluggable databases are NOT in this report. Run it once per container you are responsible for.'
            ELSE 'the whole database. This is not a CDB, so there is one container and this report covers all of it.' END
  FROM v$database d;

-- ---------------------------------------------------------------------------
-- Section 1: usage, with the bigfile flag stated rather than implied.
--
-- Bigfile matters operationally and it is the single fact most likely to be
-- stale in somebody's head: 23ai NEW databases default SYSTEM, SYSAUX and USER
-- to BIGFILE, and a bigfile tablespace holds exactly one datafile. Whoever
-- reads this is choosing between two different actions depending on that flag,
-- so the flag belongs in the report rather than in a footnote.
-- ---------------------------------------------------------------------------
PROMPT SEC|Tablespace usage and shape

SELECT 'CHK|TSU_' || t.tablespace_name || '|' ||
       CASE WHEN m.used_percent >= &ts_crit THEN 'CRIT'
            WHEN m.used_percent >= &ts_warn THEN 'WARN' ELSE 'OK' END || '|' ||
       'Tablespace ' || t.tablespace_name || '|' ||
       TO_CHAR(ROUND(m.used_percent,1), 'FM9999999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') ||
       '% used, bigfile=' || t.bigfile || ', status ' || t.status ||
       ', extent management ' || t.extent_management ||
       CASE WHEN t.bigfile = 'YES'
            THEN '. A bigfile tablespace holds one datafile, so capacity here is a resize question.'
            ELSE '. Capacity here is a resize or an additional-file question.' END
  FROM dba_tablespaces t
  JOIN dba_tablespace_usage_metrics m ON m.tablespace_name = t.tablespace_name
 ORDER BY m.used_percent DESC, t.tablespace_name;

-- The same numbers as machine-readable measurements, so the AI reads them as
-- numbers instead of parsing them back out of the prose above.
--
-- The NLS mask is here rather than an ALTER SESSION on purpose. ALTER is a DDL
-- verb, and the read-only guarantee is the entire liability position of this
-- product, so a number-formatting requirement must not be the thing that breaks
-- it. Without the mask a German-locale session emits 87,3 and one such value
-- invalidates the whole briefing document.
SELECT 'MET|TSU_' || t.tablespace_name || '|used_pct|' ||
       TO_CHAR(ROUND(m.used_percent,1), 'FM9999999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') ||
       '|percent'
  FROM dba_tablespaces t
  JOIN dba_tablespace_usage_metrics m ON m.tablespace_name = t.tablespace_name
 ORDER BY m.used_percent DESC, t.tablespace_name;

SELECT 'MET|TSU_' || t.tablespace_name || '|used_gb|' ||
       TO_CHAR(ROUND(m.used_space * b.block_bytes / 1073741824, 2),
               'FM9999999990.00', 'NLS_NUMERIC_CHARACTERS=''.,''') || '|GB'
  FROM dba_tablespaces t
  JOIN dba_tablespace_usage_metrics m ON m.tablespace_name = t.tablespace_name
 CROSS JOIN (SELECT TO_NUMBER(value) AS block_bytes FROM v$parameter WHERE name = 'db_block_size') b
 ORDER BY m.used_percent DESC, t.tablespace_name;

SELECT 'MET|TSU_' || t.tablespace_name || '|max_gb|' ||
       TO_CHAR(ROUND(m.tablespace_size * b.block_bytes / 1073741824, 2),
               'FM9999999990.00', 'NLS_NUMERIC_CHARACTERS=''.,''') || '|GB'
  FROM dba_tablespaces t
  JOIN dba_tablespace_usage_metrics m ON m.tablespace_name = t.tablespace_name
 CROSS JOIN (SELECT TO_NUMBER(value) AS block_bytes FROM v$parameter WHERE name = 'db_block_size') b
 ORDER BY m.used_percent DESC, t.tablespace_name;

-- ---------------------------------------------------------------------------
-- Section 2: autoextend policy, aggregated PER TABLESPACE.
--
-- Aggregated deliberately, and this is a bug fix rather than a preference. The
-- v0.9 script emitted one row per datafile under the single shared check id
-- "AE", so a tablespace with six datafiles produced six checks all claiming to
-- be the same check, and any measurement recorded against that id would land on
-- all six at once. A check id has to identify exactly one thing.
--
-- The per-file detail worth keeping is the count and the headroom, and both
-- survive the aggregation. headroom_gb is the number this section exists for:
-- how much this tablespace can still reach WITHOUT anybody doing anything. A
-- tablespace at 60% that cannot grow is a worse position than one at 85% that
-- can still double, and a report showing only percentages hides exactly that.
-- ---------------------------------------------------------------------------
PROMPT SEC|Autoextend policy and reachable headroom

SELECT 'CHK|AE_' || tablespace_name || '|' ||
       CASE WHEN SUM(CASE WHEN autoextensible = 'YES' THEN 1 ELSE 0 END) = 0 THEN 'WARN'
            ELSE 'OK' END || '|' ||
       'Autoextend ' || tablespace_name || '|' ||
       COUNT(*) || ' datafiles, ' ||
       SUM(CASE WHEN autoextensible = 'YES' THEN 1 ELSE 0 END) || ' autoextensible, ' ||
       TO_CHAR(ROUND(SUM(bytes)/1073741824, 1), 'FM9999999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') ||
       ' GB allocated, ' ||
       TO_CHAR(ROUND(SUM(GREATEST(maxbytes, bytes))/1073741824, 1), 'FM9999999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') ||
       ' GB reachable without intervention' ||
       CASE WHEN SUM(CASE WHEN autoextensible = 'YES' THEN 1 ELSE 0 END) = 0
            THEN '. No file here can grow by itself, so capacity is a planned action rather than an automatic one.'
            ELSE '.' END
  FROM dba_data_files
 GROUP BY tablespace_name
 ORDER BY tablespace_name;

SELECT 'MET|AE_' || tablespace_name || '|datafiles|' || COUNT(*) || '|files'
  FROM dba_data_files
 GROUP BY tablespace_name
 ORDER BY tablespace_name;

SELECT 'MET|AE_' || tablespace_name || '|autoextensible|' ||
       SUM(CASE WHEN autoextensible = 'YES' THEN 1 ELSE 0 END) || '|files'
  FROM dba_data_files
 GROUP BY tablespace_name
 ORDER BY tablespace_name;

SELECT 'MET|AE_' || tablespace_name || '|headroom_gb|' ||
       TO_CHAR(ROUND((SUM(GREATEST(maxbytes, bytes)) - SUM(bytes))/1073741824, 2),
               'FM9999999990.00', 'NLS_NUMERIC_CHARACTERS=''.,''') || '|GB'
  FROM dba_data_files
 GROUP BY tablespace_name
 ORDER BY tablespace_name;

-- ---------------------------------------------------------------------------
-- Section 3: shrink candidates. HINTS, never advice, and never a verdict.
--
-- Keyed by file_id, which is stable across runs. The v0.9 script keyed these by
-- ROWNUM, so check SHRINK_3 named a different datafile whenever the ordering
-- changed and two collections could not be compared at all.
--
-- THE ORDER BY CARRIES AN EXPLICIT TIEBREAKER, and that is load bearing rather
-- than tidiness. The check row and its two metric rows are three separate
-- executions of the same ranked query. With ties in the ranking column and no
-- tiebreaker, Oracle is free to return a different twenty rows to each of them,
-- and the result would be a metric recorded against a check id that is not in
-- the document. The briefing would still be valid JSON and would still pass the
-- schema, which is exactly why this had to be fixed here rather than caught
-- later.
--
-- Status is deliberately OK on every row. These are observations about where
-- space is sitting, not findings against a threshold, and a product whose whole
-- position is "ranked facts, never verdicts" must not colour an observation as
-- a problem. The high-water mark is the fact that decides whether a shrink is
-- possible at all, it is not in this view, and the detail says so rather than
-- letting the silence read as permission.
-- ---------------------------------------------------------------------------
PROMPT SEC|Shrink candidates (hints, not advice)

SELECT 'CHK|SHRINK_' || d.file_id || '|OK|Shrink candidate|' ||
       d.file_name || ' in ' || d.tablespace_name || ': ' ||
       TO_CHAR(ROUND(d.bytes/1073741824, 1), 'FM9999999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') ||
       ' GB allocated, ' ||
       TO_CHAR(ROUND(NVL(f.free_bytes,0)/1073741824, 1), 'FM9999999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') ||
       ' GB free inside the file. Check the high-water mark first, because free space below it cannot be released.'
  FROM dba_data_files d
  LEFT JOIN (SELECT file_id, SUM(bytes) AS free_bytes FROM dba_free_space GROUP BY file_id) f
         ON f.file_id = d.file_id
 WHERE d.bytes > 1073741824
   AND NVL(f.free_bytes,0) * 100 / d.bytes > &shrink_pct
 ORDER BY NVL(f.free_bytes,0) DESC, d.file_id
 FETCH FIRST 20 ROWS ONLY;

SELECT 'MET|SHRINK_' || d.file_id || '|allocated_gb|' ||
       TO_CHAR(ROUND(d.bytes/1073741824, 2), 'FM9999999990.00', 'NLS_NUMERIC_CHARACTERS=''.,''') || '|GB'
  FROM dba_data_files d
  LEFT JOIN (SELECT file_id, SUM(bytes) AS free_bytes FROM dba_free_space GROUP BY file_id) f
         ON f.file_id = d.file_id
 WHERE d.bytes > 1073741824
   AND NVL(f.free_bytes,0) * 100 / d.bytes > &shrink_pct
 ORDER BY NVL(f.free_bytes,0) DESC, d.file_id
 FETCH FIRST 20 ROWS ONLY;

SELECT 'MET|SHRINK_' || d.file_id || '|free_pct|' ||
       TO_CHAR(ROUND(NVL(f.free_bytes,0) * 100 / d.bytes, 1), 'FM9999999990.0', 'NLS_NUMERIC_CHARACTERS=''.,''') ||
       '|percent'
  FROM dba_data_files d
  LEFT JOIN (SELECT file_id, SUM(bytes) AS free_bytes FROM dba_free_space GROUP BY file_id) f
         ON f.file_id = d.file_id
 WHERE d.bytes > 1073741824
   AND NVL(f.free_bytes,0) * 100 / d.bytes > &shrink_pct
 ORDER BY NVL(f.free_bytes,0) DESC, d.file_id
 FETCH FIRST 20 ROWS ONLY;

-- ---------------------------------------------------------------------------
-- Section 4: extent-count hints. Also facts, also not advice.
--
-- Keyed by owner and segment name rather than by row number, and ordered with
-- the same explicit tiebreaker, for the same two reasons as section 3.
--
-- A pipe inside an object name would corrupt the line format, so it is removed
-- from the ID. Object names containing a pipe are pathological, and they are
-- exactly the input that turns a parser into a support ticket.
-- ---------------------------------------------------------------------------
PROMPT SEC|Extent count hints (facts, not advice)

SELECT 'CHK|FRAG_' || TRANSLATE(owner || '.' || segment_name, 'x|', 'x') || '|OK|Extent count|' ||
       owner || '.' || segment_name || ' (' || segment_type || ' in ' || tablespace_name || '): ' ||
       extents || ' extents across ' ||
       TO_CHAR(ROUND(bytes/1073741824, 2), 'FM9999999990.00', 'NLS_NUMERIC_CHARACTERS=''.,''') ||
       ' GB. A high extent count is a fact about allocation history, not a defect in itself.'
  FROM (SELECT owner, segment_name, segment_type, tablespace_name, extents, bytes
          FROM dba_segments
         WHERE segment_type IN ('TABLE','INDEX')
           AND extents > &frag_ext
         ORDER BY extents DESC, owner, segment_name
         FETCH FIRST 20 ROWS ONLY);

SELECT 'MET|FRAG_' || TRANSLATE(owner || '.' || segment_name, 'x|', 'x') || '|extents|' ||
       extents || '|extents'
  FROM (SELECT owner, segment_name, extents, bytes
          FROM dba_segments
         WHERE segment_type IN ('TABLE','INDEX')
           AND extents > &frag_ext
         ORDER BY extents DESC, owner, segment_name
         FETCH FIRST 20 ROWS ONLY);

SELECT 'MET|FRAG_' || TRANSLATE(owner || '.' || segment_name, 'x|', 'x') || '|size_gb|' ||
       TO_CHAR(ROUND(bytes/1073741824, 2), 'FM9999999990.00', 'NLS_NUMERIC_CHARACTERS=''.,''') || '|GB'
  FROM (SELECT owner, segment_name, extents, bytes
          FROM dba_segments
         WHERE segment_type IN ('TABLE','INDEX')
           AND extents > &frag_ext
         ORDER BY extents DESC, owner, segment_name
         FETCH FIRST 20 ROWS ONLY);

SPOOL OFF
EXIT
