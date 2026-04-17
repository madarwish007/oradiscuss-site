---
title: "How to Partition a Large Table Online in Oracle Without Downtime (DBMS_REDEFINITION)"
description: "Converting a 20TB monolithic table to range-interval partitioned IOT with LOB compression — online, using DBMS_REDEFINITION."
pubDate: 2026-01-25
category: dba
tags: ['partitioning', 'dbms-redefinition', 'online-operations']
cover: /images/blog/online-partition-dbms-redefinition.svg
---

## Introduction: When Tables Get Too Big

Every seasoned DBA eventually faces the "Big Table" problem. In our case, it was a monolithic, non-partitioned table that had ballooned to **20 Terabytes**. Full table scans were glacial, index rebuilds were an all-weekend affair, and storage costs were escalating rapidly.

We needed to implement a robust Data Lifecycle Management strategy — online, with minimal to zero downtime. Our solution: **Range-Interval Partitioning**, conversion to an **Index-Organized Table (IOT)**, advanced **LOB compression**, and **DBMS_REDEFINITION**.

## Why This Approach for a 20TB Table?

| Feature | Technical Benefit | Impact |
|---|---|---|
| Online Redefinition | Uses DBMS_REDEFINITION while original table stays fully accessible for DML | Zero Downtime — only brief lock at FINISH_REDEF_TABLE |
| Range-Interval Partitioning | Partitions monthly on CREATION_TIMESTAMP | Enables Partition Pruning — queries scan only a fraction of data |
| Advanced Compression | COMPRESS for historical, COMPRESS ADVANCED for older partitions | Significant storage cost reduction |
| LOB Optimization | SECUREFILE with COMPRESS HIGH and DEDUPLICATE | Can cut size dramatically for repetitive API payloads |

## Step 1: Verify Redefinition Capability

```sql
ALTER SESSION FORCE PARALLEL DML PARALLEL 32;
ALTER SESSION FORCE PARALLEL DDL PARALLEL 32;
ALTER SESSION SET DDL_LOCK_TIMEOUT=900;

BEGIN
  DBMS_REDEFINITION.CAN_REDEF_TABLE(
    user         => 'SCHEMA_OWNER',
    tname        => 'BIG_LOG_TABLE',
    options_flag => DBMS_REDEFINITION.CONS_ORIG_PARAMS
  );
  DBMS_OUTPUT.PUT_LINE('Table can be redefined.');
END;
/
```

## Step 2: Create the Interim Table

```sql
CREATE TABLE SCHEMA_OWNER.BIG_LOG_TABLE_INT (
  MESSAGE_ID         VARCHAR2(50 BYTE),
  CREATION_TIMESTAMP TIMESTAMP(6),
  PAYLOAD_CLOB       CLOB,
  CONSTRAINT PK_BIG_LOG_TABLE_INT
    PRIMARY KEY (CREATION_TIMESTAMP, MESSAGE_ID)
)
ORGANIZATION INDEX
COMPRESS 1
TABLESPACE TS_DATA_HOT
PARTITION BY RANGE (CREATION_TIMESTAMP)
INTERVAL (NUMTOYMINTERVAL(1, 'MONTH'))
( PARTITION P_2026_01
    VALUES LESS THAN (TIMESTAMP' 2026-02-01 00:00:00')
    TABLESPACE TS_DATA_HOT NOCOMPRESS )
LOB (PAYLOAD_CLOB) STORE AS SECUREFILE (
  COMPRESS HIGH DEDUPLICATE CACHE LOGGING)
PARALLEL 32;
```

## Step 3: Start the Redefinition

```sql
BEGIN
  DBMS_REDEFINITION.START_REDEF_TABLE(
    uname        => 'SCHEMA_OWNER',
    orig_table   => 'BIG_LOG_TABLE',
    int_table    => 'BIG_LOG_TABLE_INT',
    options_flag => DBMS_REDEFINITION.CONS_USE_ROWID
  );
END;
/
```

## Step 4: Copy Dependent Objects

```sql
DECLARE num_errors PLS_INTEGER;
BEGIN
  DBMS_REDEFINITION.COPY_TABLE_DEPENDENTS(
    uname            => 'SCHEMA_OWNER',
    orig_table       => 'BIG_LOG_TABLE',
    int_table        => 'BIG_LOG_TABLE_INT',
    copy_indexes     => DBMS_REDEFINITION.COPY_SQL_ERRORS,
    copy_triggers    => TRUE,
    copy_constraints => TRUE,
    copy_grants      => TRUE,
    num_errors       => num_errors
  );
END;
/
```

## Step 5: Synchronize Interim Table (Run Multiple Times)

For a 20TB table, run this periodically while the bulk copy is running to minimize final synchronization time:

```sql
BEGIN
  DBMS_REDEFINITION.SYNC_INTERIM_TABLE(
    uname      => 'SCHEMA_OWNER',
    orig_table => 'BIG_LOG_TABLE',
    int_table  => 'BIG_LOG_TABLE_INT'
  );
END;
/
```

## Step 6: Finalize the Redefinition

This is the switchover — the only point of application downtime. On a 20TB table, this typically takes under 30 seconds:

```sql
BEGIN
  DBMS_REDEFINITION.FINISH_REDEF_TABLE(
    uname      => 'SCHEMA_OWNER',
    orig_table => 'BIG_LOG_TABLE',
    int_table  => 'BIG_LOG_TABLE_INT'
  );
END;
/
```

## Step 7: Drop the Old Interim Table

```sql
DROP TABLE SCHEMA_OWNER.BIG_LOG_TABLE_INT PURGE;
```

## Step 8: Gather Statistics

```sql
BEGIN
  DBMS_STATS.GATHER_TABLE_STATS(
    ownname     => 'SCHEMA_OWNER',
    tabname     => 'BIG_LOG_TABLE',
    degree      => 32,
    cascade     => TRUE,
    granularity => 'ALL'
  );
END;
/
```

**Result:** A 20TB monolithic table transformed into a monthly-partitioned, IOT-organized, LOB-compressed structure — entirely online, with only a brief exclusive lock during the final switchover step.
