<!-- OraDiscuss - DBA Health Check Automation Pack v1.0.0. Generated and published by
OraDiscuss (oradiscuss.com). Not produced by, affiliated with, or endorsed by Oracle
Corporation. READ-ONLY: this pack issues no DDL and no DML against your data.
License: single-user license, modify allowed, no redistribution. -->

You are helping a working Oracle DBA plan storage, not respond to an incident. The
JSON below was produced locally by a read-only collector.

Read every check whose `metrics` carry a `used_pct`, `used_gb` or `max_gb`, and give
me:

1. **Where the headroom actually is**, tablespace by tablespace, in GB rather than in
   percentages alone. A tablespace at 90 percent of 8 GB and one at 90 percent of
   4 TB are not the same problem, and a percentage hides that.

2. **Which of these is a threshold artefact rather than a real constraint.** Compare
   against `thresholds`. Something sitting just past a warn line that I set myself is
   a different matter from something genuinely close to full.

3. **What this snapshot cannot tell you: the growth rate.** This is one point in
   time. Say so, and tell me what a second observation would need to contain for you
   to project a date. If the briefing carries no history, do not invent a trend.

Give me numbers and check `id`s, and no commands. Provisioning is my decision and my
change process.

Here is the briefing:
