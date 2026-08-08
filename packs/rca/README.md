# OraDiscuss RCA Generator Pack v1.0.0

Published by OraDiscuss (oradiscuss.com). Not produced by, affiliated with, or
endorsed by Oracle Corporation.

**Everything here is read-only.** SELECT-only SQL, ADRCI show commands, and log
file reads. The only commands that want root are READS of operating system
logs. Read the scripts before you run them, and run them somewhere that is not
production first. You are the DBA.

## What it produces, and what it deliberately does not

It produces **evidence**, a reconstructed **timeline**, and ranked **ordering
facts**. It does not produce a diagnosis, and it does not produce commands.

That is the line this whole product stands on, and it is worth being precise
about why. An ordering correlation is a real measurement: this error was
recorded 42 seconds before that one. What it MEANS is an inference, and the
inference belongs to the person who knows the estate. So every correlation is
carried as two separate things:

- **Measured**: the fact, checkable against the timeline printed beside it.
- **Reading**: an interpretation of that fact, labelled as one, which you are
  free to reject while keeping the measurement.

Where a reading has a competing explanation, the report also says what would
**distinguish** them. That is what replaces a "recommended next steps" section:
something to know, rather than something to run.

## Running it

    cp config.env config-labdb.env      # edit ORACLE_SID, ORACLE_HOME, limits

    ./rca_generator.sh --since 2h
    ./rca_generator.sh --at "2026-08-08 04:00"           # window is at +/- 2h
    ./rca_generator.sh --from "2026-08-08 02:00" --to "2026-08-08 06:00"
    ./rca_generator.sh --dry-run --since 24h             # prints the plan only
    ./rca_generator.sh --render-only /path/to/rca_raw_SID_ts.txt

**Giving more than one window shape is a hard error, not a precedence rule.**
A triage that quietly examined a different window than you meant is worse than
one that refused to start, so it refuses.

The window that was actually used is logged when it is resolved, printed at the
top of the report, and recorded in the briefing along with which argument
produced it.

`--render-only` rebuilds both outputs from a collection that already happened,
without contacting anything. It leaves the collection exactly as it found it.

## Two outputs, one collection

- `rca_<SID>_<timestamp>.html` for you
- `rca_<SID>_<timestamp>.json` for **your own** AI assistant

The briefing carries `"kind": "incident"`. Every other OraDiscuss collector
emits `"kind": "state"`. A consumer reads that field rather than guessing the
document shape from which keys happen to be present.

Raw evidence (alert log excerpts, listener errors, system logs) is written to an
`appendix_<SID>_<timestamp>/` directory beside the report and LISTED in the
briefing rather than embedded in it. An alert log excerpt is routinely larger
than everything else in the document combined.

## What it collects, and what happens when it cannot

| Tier | Needs |
|---|---|
| Alert log via `X$DBGALERTEXT` | SYS, or an explicit grant on the fixed table |
| Alert log, text fallback | read access to the ADR trace directory |
| ADR incidents | `adrci` on the PATH |
| Workload evidence from `DBA_HIST_*` | **Oracle Diagnostics Pack licence** |
| Listener log | read access to the ADR listener trace directory |
| Operating system logs | root, or passwordless sudo |

**Every tier that cannot run becomes an `NA` check that names what would make it
run.** This matters more than it sounds. A tier that is silently absent looks
exactly like a tier that found nothing, and during an incident those are
completely different answers. A window with no operating system errors because
the operating system tier was never read tells you nothing at all about the
operating system, and the report says so rather than leaving you to notice.

The Diagnostics Pack requirement is stated as a fact about which views were
read. It is deliberately not advice about whether you hold that licence.

## Grants

`SELECT_CATALOG_ROLE` or the equivalent SELECT grants on the dictionary views,
plus `SELECT` on `V$DIAG_INFO`. The alert log tier additionally wants access to
`X$DBGALERTEXT`, an undocumented fixed table that normally needs SYS; without it
the pack falls back to the text alert log and records that it did.

## Handing the briefing to your AI

`prompts/incident-review.md` contains a prompt to paste alongside the JSON. It
teaches your assistant the SHAPE of the document, tells it that ordering is not
causation, and asks it for competing explanations rather than an answer. It
deliberately does not recite Oracle version behaviour, because a prompt reciting
half-remembered facts is how a confident wrong answer gets made.

Your assistant, your subscription, your data. Nothing in this pack transmits
anything anywhere, and OraDiscuss never receives your output.

## Changed from the v0.9 field-test release

- **The "recommended next steps" section is gone**, along with cause entries
  phrased as instructions. Those were verdicts and commands.
- **The timeline sorts on a collected sequence number as well as the epoch.**
  Alert log entries routinely share a second, and sorting on the second alone
  left their order to whichever `sort` implementation was installed, so one
  collection could tell two different stories on two machines.
- **Timestamps are formatted at collection time and carried**, rather than
  recomputed when the report is built. Re-reading an archived collection in
  another timezone must not rewrite the clock the incident happened on.
- **Degradation notes became checks.** They used to live in a separate notes
  file; they are now `NA` entries in the same document as everything else, which
  means the summary counts them and an assistant reading the briefing cannot
  miss them.
