---
title: Configuring Bidirectional Replication using Oracle GoldenGate 12c
description: Step-by-step GoldenGate 12c bidirectional replication setup on Oracle 12.1 and Solaris 11.2 SPARC — Extract, DataPump and Replicat.
pubDate: 2015-12-27
updatedDate: ''
category: goldengate
tags:
  - goldengate
  - replication
  - solaris
cover: /images/blog/bidirectional-replication-12c.png
coverAlt: ''
---

_By: Mahmoud Darwish_

Today I will simplify the Oracle GoldenGate configurations for the bidirectional path setup between homogeneous environments (Oracle to Oracle). This was implemented on Oracle Solaris 11.2 SPARC with Oracle Database 12.1.0.2.0 and Oracle GoldenGate 12c.

## 1. Preparing the Source and Target Databases

Both source and target must be in ARCHIVELOG mode with supplemental logging enabled:

```sql
-- Verify archivelog mode
SELECT log_mode FROM v$database;

-- Enable supplemental logging and forced logging
ALTER DATABASE ADD SUPPLEMENTAL LOG DATA;
ALTER DATABASE FORCE LOGGING;
ALTER SYSTEM SWITCH LOGFILE;

-- Verify
SELECT force_logging, supplemental_log_data_min FROM v$database;
-- Both should return YES
```

## 2. Create the GoldenGate Administrator Users

```sql
-- On SOURCE (Test1):
CREATE USER oggadm1 IDENTIFIED BY ****;
GRANT dba TO oggadm1;
EXEC DBMS_GOLDENGATE_AUTH.GRANT_ADMIN_PRIVILEGE(
  grantee=>'OGGADM1', privilege_type=>'capture',
  grant_select_privileges=>true, do_grants=>TRUE);

-- On TARGET (Test2):
CREATE USER oggadm2 IDENTIFIED BY ****;
GRANT dba TO oggadm2;
```

## 3. Configure Primary Extract (Source)

```text
-- Primary Extract EXTXP01 (in dirprm/EXTXP01.prm)
Extract EXTXP01
ExtTrail ./dirdat/aa
UserID oggadm1@TEST1, Password *****
TranLogOptions ExcludeUser oggadm1
Table schema.*;

-- Add in GGSCI:
GGSCI> Add Extract EXTXP01, TranLog, Begin Now
GGSCI> Add ExtTrail ./dirdat/aa, Extract EXTXP01
```

## 4. Configure DataPump (Source)

```text
-- Secondary Extract EXTSE01 (in dirprm/EXTSE01.prm)
Extract EXTSE01
RmtHost oragg2, MgrPort 7810, Compress
RmtTrail ./dirdat/se
Passthru
Table schema.table_name;

-- Add in GGSCI:
GGSCI> Add Extract EXTSE01, ExtTrailSource ./dirdat/aa
GGSCI> Add RmtTrail ./dirdat/se, Extract EXTSE01
```

## 5. Configure Replicat (Target)

```text
-- Replicat REPPR01 (in dirprm/REPPR01.prm)
Replicat REPPR01
UserID oggadm2@TEST2, Password *****
AssumeTargetDefs
SourceDefs dirdef/oratabs.def
DiscardFile dirrpt/oratabs.dsc, Append
Map schema_name.table_name, Target schema_name.table_name;

-- Add in GGSCI:
GGSCI> Add Replicat REPPR01, ExtTrail ./dirdat/se
```

## 6. Configure Bidirectional Support

```text
-- Extract on TARGET:
GGSCI> Add Extract EXTPR01, TranLog, Begin Now
GGSCI> Add ExtTrail ./dirdat/bb, Extract EXTPR01
GGSCI> Add Extract EXTSEC01, ExtTrailSource ./dirdat/bb
GGSCI> Add RmtTrail ./dirdat/ra, Extract EXTSEC01

-- Replicat on SOURCE:
GGSCI> Add Replicat REPSE01, ExtTrail ./dirdat/ra
```

## 7. Start All Services and Verify

```text
-- On both Source and Target:
GGSCI> Start extract *
GGSCI> Start replicat *
GGSCI> Info all

-- Monitor reports:
GGSCI> Send extract EXTSE01, Report
GGSCI> View report EXTSE01
```

**Note:** The count of inserts/updates/deletes for the Replicat should match the Extract. Always tail `ggserr.log` during startup: `tail -100f $OGG_HOME/ggserr.log`
