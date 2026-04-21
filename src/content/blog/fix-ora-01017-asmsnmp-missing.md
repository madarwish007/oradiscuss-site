---
title: 'Fix ORA-01017: ASMSNMP User Missing After Grid Infrastructure Install'
description: Why DBCA fails with ORA-01017 after an 11.2.0.4 Grid Infrastructure install — the ASMSNMP user is missing, and here is how to create it.
pubDate: 2014-08-24
updatedDate: ''
category: dba
tags:
  - asm
  - troubleshooting
  - ora-01017
  - grid-infrastructure
cover: /images/blog/fix-ora-01017-asmsnmp-missing.png
coverAlt: ''
---

_By: Mahmoud Darwish_

Recently, I was trying to install a single Oracle Database Enterprise Edition 11.2.0.4 with ASM. Everything completed successfully from the RAW device format through to the grid infrastructure and database software installation. But when I started to create the database using DBCA, I got this error:

```text
Can not use ASM for database storage due to the following reason:
Could not connect to ASM due to the following error:
ORA-01017: invalid username/password; logon denied.
```

Everyone will say there is a wrong provided password — that was my first thought too. But I found the ASMSNMP user simply was not created.

## Diagnosis

```bash
-- Step 1: Recreate the password file (this did NOT fix it)
orapwd file=$ORACLE_HOME/dbs/orapw+ASM password=oracle entries=5

-- Step 2: Try connecting as ASMSNMP (fails)
sqlplus asmsnmp/oracle@+ASM as sysdba

-- Step 3: Check existing ASM users
$ asmcmd
ASMCMD> lspwusr
Username  sysdba  sysoper  sysasm
     SYS    TRUE     TRUE   FALSE
-- Only SYS exists. ASMSNMP is missing.
```

## The Fix

```sql
-- Login to +ASM instance using SYSASM privilege
sqlplus / as sysasm

SQL> CREATE USER asmsnmp IDENTIFIED BY oracle;
User created.

SQL> GRANT sysdba TO asmsnmp;
Grant succeeded.

-- Verify
ASMCMD> lspwusr
Username  sysdba  sysoper  sysasm
     SYS    TRUE     TRUE   FALSE
 ASMSNMP    TRUE    FALSE   FALSE
```

After creating the ASMSNMP user and granting SYSDBA, DBCA was able to connect to ASM and the database creation completed successfully. The root cause appears to be a bug in certain 11.2.0.4 grid infrastructure installations where the ASMSNMP user is not automatically created.
