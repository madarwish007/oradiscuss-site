# HELD CODE. In git, out of the product, awaiting review.

Nothing in this directory ships. It is excluded from the customer package by
`scripts/publish-pack-to-project.sh`, excluded from the pack's shipped file set
by `test/packs.test.js`, and a test asserts both, so the exclusion cannot be
quietly lost by an edit to either one.

## The ruling this directory exists to obey

The operating plan says **disable, do not delete**. A script that has been taken
out of a release is not dead: the founder reviews it offline and comes back with
comments, and a decision to revive it must not require anybody to reconstruct
code from memory or from a zip nobody can diff against.

So the removed code is kept here, byte for byte as it shipped in v0.9, and the
reason it was removed is written down beside it rather than left in a commit
message that nobody reads at review time.

## What is here

| File | What it is | Why it is held |
|---|---|---|
| `tbs_manager-v0.9.0-with-generators.sh.held` | The complete v0.9.0 `tbs_manager.sh`, verbatim | It generated `ADD DATAFILE`, `RESIZE` and autoextend statements |
| `tbs_report-v0.9.0.sql.held` | The v0.9.0 report SQL, verbatim | Superseded, kept so the v1.0 rewrite can be diffed against what it replaced |

The `.held` suffix is deliberate. These files are not executable, are not named
like the scripts they came from, and cannot be run by accident by anybody who
finds them.

## Why the generator paths were removed rather than allowlisted

They were careful code. `--add-datafile`, `--resize` and `--set-autoextend` all
printed the statement and stopped; only an explicit `--execute` ran anything,
and the product specification already excluded `--execute` from anything sold.

They were removed anyway, and the reason is a sentence rather than a rule.
The sentence this product is sold on is:

> Read every line and you will find no way for this to touch your database.

That sentence with a footnote attached is worth considerably less than the
feature was. The read-only gate agreed independently: its own self-test fires on
`GEN_SQL="ALTER DATABASE DATAFILE ... RESIZE 1G;"`, so a print-only generator
still failed the gate on its contents. Allowlisting it would have meant carrying
a permanent exception in the one guard the whole liability position rests on.

## What reviving them would take

1. A decision that the sentence above can carry a footnote, which is a founder
   call about the product rather than an engineering one.
2. A named allowlist entry in `test/packs.test.js`, plus an increase in the
   cross-pack assertion that the whole product holds exactly one allowlisted
   path. That assertion is counted across every pack on purpose, so three packs
   each holding "just one exception" cannot pass unnoticed.
3. The v1.0 argument parsing, config validation and dual-output layer applied to
   the revived paths, since the file here predates all three.

## The v0.9 defects found while converting, recorded so a revival does not reintroduce them

- **The autoextend section emitted one row per datafile under the single shared
  check id `AE`.** A tablespace with six datafiles produced six checks all
  claiming to be the same check, and any measurement recorded against that id
  would attach to all six. v1.0 aggregates per tablespace.
- **Shrink and fragmentation rows were keyed by `ROWNUM`.** `SHRINK_3` named a
  different datafile whenever the ordering changed, so two collections of the
  same database could not be compared. v1.0 keys by `file_id` and by owner plus
  segment name.
- **The DBA/CDB view prefix was applied to some views and not to
  `dba_tablespace_usage_metrics`, which has no CDB counterpart in that join.** In
  a CDB root the join on `tablespace_name` alone multiplies every row by the
  number of open containers, because SYSTEM and SYSAUX exist in all of them.
  v1.0 reads one container and states which one in the report.
- **`DATAFILE_NAME_STANDARD` was required config for the generator paths only.**
  It is gone from v1.0's config, and from the config that `env_collector.sh`
  generates.
