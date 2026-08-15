-- create-reader.sql
-- Creates the customer-shaped monitoring account the packs are designed for:
-- CREATE SESSION + SELECT_CATALOG_ROLE in the pluggable database FREEPDB1, and
-- nothing more. This is the input that matters: connecting as SYSDBA masks every
-- "not authorised / not available" path a real reader account would hit, so the
-- run that proves the pack behaves is the run as this user, not as SYSDBA.
--
-- Idempotent: safe to re-run. Lab-only throwaway credentials.

WHENEVER SQLERROR CONTINUE
ALTER SESSION SET CONTAINER = FREEPDB1;

BEGIN
  EXECUTE IMMEDIATE 'DROP USER odc_reader CASCADE';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

CREATE USER odc_reader IDENTIFIED BY "Odc_Reader#2026";
GRANT CREATE SESSION TO odc_reader;
GRANT SELECT_CATALOG_ROLE TO odc_reader;

SELECT 'READER_READY' AS status FROM dual;
EXIT
