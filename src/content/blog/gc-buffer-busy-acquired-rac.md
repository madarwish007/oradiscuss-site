---
title: "gc buffer busy acquired: The RAC Wait Event That Ruined My Weekend"
description: "A RAC gc buffer busy acquired war story — how an application optimisation concentrated hot blocks and doubled transaction times."
pubDate: 2026-04-03
category: dba
tags: ['rac', 'wait-events', 'performance', 'awr']
---

If you've spent any meaningful time managing Oracle RAC, you've developed a personal relationship with `gc buffer busy acquired`. Not a *good* relationship. The kind where you see the name in an AWR report and reach for your coffee.

## The Setup

We run a 2-node RAC cluster for a financial processing system with a very specific access pattern: lots of small, targeted transactions hitting a relatively small set of "hot" rows — account balance tables, transaction status tables.

For months it ran fine. Then we upgraded the application, and suddenly response times for certain transaction types doubled. Not crashed, not errored out — just doubled. Which, in financial services, is enough to get people very upset very quickly.

## What AWR Was Telling Me

The top wait event was `gc buffer busy acquired` with an average wait time around 15–20ms. In RAC, this means your session is trying to get a buffer that another session is in the process of transferring between nodes.

```sql
SELECT inst_id, event, total_waits,
       time_waited_micro / 1000000 AS time_waited_sec,
       average_wait
FROM   gv$system_event
WHERE  event LIKE 'gc buffer busy%'
ORDER BY time_waited_micro DESC;
```

Node 1 was the aggressor — it was generating the hot block requests. Node 2 was mostly the victim.

## Drilling Down to the Hot Blocks

```sql
SELECT owner, object_name, object_type,
       SUM(CASE WHEN statistic_name = 'gc current blocks received'
           THEN value ELSE 0 END) AS current_blocks_received,
       SUM(CASE WHEN statistic_name = 'gc cr blocks received'
           THEN value ELSE 0 END) AS cr_blocks_received
FROM   gv$segment_statistics
WHERE  statistic_name IN (
         'gc current blocks received',
         'gc cr blocks received')
GROUP BY owner, object_name, object_type
ORDER BY current_blocks_received DESC
FETCH FIRST 10 ROWS ONLY;
```

One table came back as a clear outlier — our account balance table. Several "hot" rows that get updated by almost every transaction were sitting in just a handful of blocks, and every node was fighting over them constantly.

## The Root Cause Was the Application Change

The developer had made an "optimisation" — they changed a query to use an index range scan on a status column. The problem: this index access pattern was now hitting the same small set of "active status" rows repeatedly, concentrating I/O on very few blocks.

The old code was scattering the I/O slightly more — and that slight scatter was actually *better* in a RAC context because it reduced per-block contention.

## What We Fixed

**Short term:** We used `DBMS_STATS` to increase the number of hash partitions on the hot table's status index. Reverse key indexes were not suitable here because we still needed range scans.

**The real fix:** We added a sequence-generated "shard key" to the hot rows, and the application was updated to distribute updates across a set of N "slots" for the same logical account balance. It reduced gc buffer busy wait time by about 85% within the first day.

**Infrastructure side:** We also reviewed `gv$cluster_interconnects` and found packet retransmits pointing to a firmware issue on one of the network cards. That got patched during the next maintenance window.

## The Takeaway

`gc buffer busy acquired` is not an "Oracle RAC problem." It's an *application design meeting a shared-everything architecture* problem. Before you tune the database, understand what the application is actually doing to those blocks. And when a developer tells you an "optimisation" is making things worse in production — they're usually not wrong.
