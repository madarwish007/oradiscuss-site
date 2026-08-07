# Prompts for your own AI

OraDiscuss - DBA Health Check Automation Pack v1.0.0. Generated and published
by OraDiscuss (oradiscuss.com). Not produced by, affiliated with, or endorsed
by Oracle Corporation. READ-ONLY: this pack issues no DDL and no DML against
your data. License: single-user license, modify allowed, no redistribution.

## What these are

Your collector wrote two files. `report.html` is for you. The `.json` beside it
is a briefing for whichever AI assistant you already pay for.

These prompts are the other half of that. Each one is a plain text file you
paste, or pipe, together with the briefing. Nothing here calls an API, and
nothing here sends your data anywhere: you are handing your own file to your
own assistant, in your own account. We never see it.

```
cat prompts/triage.md output/reports/health_ORCL_latest.json | pbcopy
```

## Which one to use

| File | Use it when |
|---|---|
| `triage.md` | Something is WARN or CRIT and you want the order to work in |
| `capacity.md` | You are planning space, not firefighting |
| `explain.md` | A check fired and you want to understand it before acting |

## Two things these prompts deliberately do not do

**They do not ask your assistant for commands to paste.** The briefing reports
what your database recorded. What to do about it is your call as the DBA, on
your estate, with your change process. An assistant that hands you a command
to run against production has skipped every one of those steps. If you want
that anyway, that is your decision to make explicitly, not a default we ship.

**They do not teach your assistant about Oracle.** Your assistant already knows
more Oracle than a prompt file could carry, and a prompt that recites half-
remembered version behaviour is how a confident wrong answer gets made. These
prompts teach it the shape of the briefing, then get out of the way.

## Writing your own

The briefing's contract is in `schema/briefing.schema.json`, and it is stable
within a `schema_version`. The fields worth building on:

- `summary.needs_attention` is the ordered list of ids that are not OK.
- `summary.counts.NA` is the honesty field. NA means a check could not be
  determined, usually a missing grant or an absent feature. A high NA count
  means the collection was incomplete, which is a different conversation from
  a clean bill of health, and any prompt worth using should say so.
- `checks[].metrics` carries the numbers already parsed out, so your assistant
  never has to read them back out of an English sentence.
- `thresholds` is what this run was judged against. A WARN means nothing
  without it, because the thresholds are yours.
