# DBA Health Check Pack

**OraDiscuss - DBA Health Check Automation Pack v1.0.0.** Generated and
published by OraDiscuss (oradiscuss.com). Not produced by, affiliated with, or
endorsed by Oracle Corporation. READ-ONLY: this pack issues no DDL and no DML
against your data. License: single-user license, modify allowed, no
redistribution.

> Your scripts collect. Your AI reasons. Your data never leaves.

## What it does

One run against your database produces **two files from one collection**:

| File | For |
|---|---|
| `health_<SID>_<ts>.html` | You. A self-contained report you can open, keep, or mail to yourself. |
| `health_<SID>_<ts>.json` | Your AI. A structured briefing you hand to whichever assistant you already pay for. |

Both are written on the machine that ran the collector. Nothing is transmitted.
OraDiscuss never receives your estate data, and there is no account to create,
no agent to install, and no endpoint to allow through your firewall.

## Read-only, and how you can check rather than trust

Every script here runs SELECTs. The pack issues no DDL and no DML.

You do not have to take that on faith:

- Every file ships as readable source. Read it. We expect you to.
- The briefing states it in the data: `collection.read_only` is `true`.
- There is exactly **one** file in this pack that writes anything, it is named
  `sql/create_history_table.sql`, no script ever calls it, and the pack is
  fully functional if you delete it. Its own header explains why it exists.
  If your answer to "does this tooling write to the database" has to be an
  unqualified no, delete that file and carry on.

## Quick start

```bash
cp config.env config.env.local      # then edit it for your environment
./health_check.sh --dry-run --config config.env.local
./health_check.sh --config config.env.local
```

`--dry-run` validates the config and proves the database is reachable without
collecting anything. Run it first.

Exit codes are cron-friendly: `0` all OK, `1` at least one WARN, `2` at least
one CRIT or the check could not run.

### Handing the briefing to your AI

```bash
cat prompts/triage.md output/reports/health_ORCL_latest.json | pbcopy
```

Three prompts ship in `prompts/`: `triage.md` when something is wrong,
`capacity.md` when you are planning space, `explain.md` when you want to
understand a check before acting. They deliberately do not ask your assistant
for commands to paste at production; see `prompts/README.md` for why.

## What is in the box

```
health_check.sh          the daily check. Produces both outputs.
tablespace_monitor.sh    focused tablespace monitor with growth projection
orchestrate.sh           runs the pack in sequence into a dated run directory
config.env               one config, sourced by every script
lib/odc_briefing.sh      the dual-output layer
schema/                  the briefing contract, versioned
prompts/                 prompts for your own assistant
sql/                     the collectors
```

## Before you run it

You are the DBA. Review any script before you run it, run it somewhere that is
not production first, and hold valid backups. Every script here has been run on
real production estates by a working DBA before release, which is a statement
about our care and not a warranty about your environment. Estates differ,
versions differ, and a read-only query can still consume resources on a system
under pressure.

Written for Oracle 19c/21c on Linux. The collector needs `SELECT_CATALOG_ROLE`
or equivalent. `sql/awr_triage.sql` reads `DBA_HIST_*` views and therefore
requires a Diagnostics Pack licence; do not run it where you are not licensed.

## Support

`support@oradiscuss.com`. If a script is broken, say what you ran, on what
version, and what happened. It gets fixed and returned to you.
