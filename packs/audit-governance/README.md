# OraDiscuss Audit and Governance Pack v1.0.0

Published by OraDiscuss (oradiscuss.com). Not produced by, affiliated with, or
endorsed by Oracle Corporation.

**Everything here is read-only.** SELECT-only SQL, and nothing else. It issues no
DDL and no DML, it writes nothing to your database, and there is no flag
anywhere in the pack that makes it. Read the scripts before you run them, and
run them somewhere that is not production first. You are the DBA.

## It reports what is. It never reports what that means.

That sentence is the entire design and it is the thing to understand before
reading a single row of output.

"Three accounts hold a password from the list Oracle ships with its own
accounts" is a fact. It was read out of a dictionary view, it is printed with
each account's status beside it, and you can check it. "This estate would not
survive an audit" is a judgement. It depends on what the database is for, who
reaches it, what the storage underneath it does, and what somebody agreed in a
contract, and not one of those is readable from inside a database.

So every row in this report is a counted, named observation, and every row
carries the numbers you would need in order to judge it yourself. Nothing is
scored, nothing is graded, and nothing is coloured as a problem.

This is not caution for its own sake. A privilege that reaches every schema is
exactly right for a backup account and exactly wrong for a reporting one. An
Oracle-supplied account that is open may be open because a feature this estate
depends on requires it. A report that graded either would be guessing, and it
would be guessing with the authority of a tool, which is worse than not
answering at all.

## What the statuses mean here, which is narrower than in the other packs

| Status | Meaning |
|---|---|
| `OK` | This was read. Here is what it says. |
| `NA` | This could **not** be read. Here is what would make it readable. |
| `WARN` | **The collection is incomplete.** Never a statement about your database. |
| `CRIT` | Not used by this pack at all. |

`needs_attention` in the briefing is therefore always empty, and a guard in this
product's test suite asserts that it stays empty.

**Any `NA` makes the overall status `WARN`,** which is a deliberate difference
from the health check pack, where one unreadable check among thirty does not
move the summary. In an access review it has to. "No account holds a privilege
that reaches every schema" and "`DBA_SYS_PRIVS` could not be read" are opposite
answers, and a report that printed a clean overall status over a tier nobody
could open would be committing the exact error this pack exists to expose. The
report states how many of its checks could not be read, and the exit code agrees
with it.

## The window

`AUDIT_WINDOW_DAYS` in `config.env` bounds every time-based tier, and it
defaults to 30. Nothing here ever dumps the audit trail: an unbounded read on a
busy estate is millions of rows, is slow enough that the people running the
database notice, and produces a document nobody finishes.

The window is printed at the top of the report, carried in the briefing's
`thresholds` block, restated inside every row that depends on it, and recorded
as its own `WINDOW` check. A reader never has to open the config file to know
what period they are looking at.

One tier reads outside it, on purpose and in one place. "How far back does the
trail reach" cannot be answered from inside a thirty day window, so
`audit_trail_hygiene.sql` takes `MIN` and `MAX` aggregates over the whole trail.
That is three numbers rather than a dump of rows, and it is the slowest read in
the pack on a very large trail, which is why it sits in its own error handler
where a read that cannot finish costs that one row and nothing else.

## Running it

    cp config.env config-prod.env        # edit ORACLE_SID, ORACLE_HOME, window

    ./audit_governance.sh --dry-run                    # prints the plan only
    ./audit_governance.sh --config ./config-prod.env
    ./audit_governance.sh --render-only /path/to/audit_raw_SID_ts.txt

`--render-only` rebuilds both outputs from a collection that already happened,
without contacting the database. It leaves the collection exactly as it found
it.

## Two outputs, one read

- `audit_<SID>_<timestamp>.html` for you
- `audit_<SID>_<timestamp>.json` for **your own** AI assistant

The database is read once. Two reads is how two outputs end up describing the
same database at two different moments.

The briefing carries `"kind": "state"`, the same as every collector in this
product except the RCA generator.

## The ten tiers, and what happens when one cannot run

| Tier | Check id | Collector | Reads |
|---|---|---|---|
| Audit posture | `AUDIT_MODE` | `sql/audit_mode_check.sql` | `V$OPTION`, `V$PARAMETER`, `AUDIT_UNIFIED_POLICIES`, `AUDIT_UNIFIED_ENABLED_POLICIES` |
| Audit trail activity | `TRAIL_ACTIVITY` | `sql/audit_trail_activity.sql` | `UNIFIED_AUDIT_TRAIL`, falling back to `DBA_AUDIT_TRAIL` |
| Audit trail hygiene | `TRAIL_HYGIENE` | `sql/audit_trail_hygiene.sql` | `UNIFIED_AUDIT_TRAIL`, `DBA_SEGMENTS`, the audit management views |
| Privilege and access | `PRIV_REVIEW` | `sql/privilege_review.sql` | `DBA_ROLE_PRIVS`, `DBA_SYS_PRIVS`, `DBA_TAB_PRIVS`, `DBA_USERS`, `DBA_USERS_WITH_DEFPWD`, `V$PWFILE_USERS` |
| Package grants held by PUBLIC | `PKG_GRANTS` | `sql/sensitive_grants_check.sql` | `DBA_TAB_PRIVS` |
| Profile and password policy | `PROFILE_POLICY` | `sql/profile_policy_check.sql` | `DBA_PROFILES`, `DBA_USERS` |
| Change inventory | `CHANGE_INV` | `sql/change_inventory.sql` | `DBA_OBJECTS.LAST_DDL_TIME`, `UNIFIED_AUDIT_TRAIL` |
| Database links | `DBLINKS` | `sql/db_links_inventory.sql` | `DBA_DB_LINKS` |
| Encryption at rest | `TDE` | `sql/tde_encryption_check.sql` | `V$ENCRYPTION_WALLET`, `V$ENCRYPTED_TABLESPACES`, `DBA_ENCRYPTED_COLUMNS` |
| Option and feature usage | `FEATURE_USAGE` | `sql/feature_usage_check.sql` | `DBA_FEATURE_USAGE_STATISTICS`, `V$OPTION` |

That table and the collector's own tier list are checked against each other by a
test. A document promising a tier the pack does not have is the same defect as a
tier that silently does not run, and this product has shipped the second one
before.

**A tier that cannot run becomes an `NA` check naming what would make it run,**
and the other nine still produce their rows. A tier that stopped part way
through says that too, and keeps the rows it did produce, because four rows plus
a note that it stopped is more useful than an empty tier and far more useful
than four rows presented as the whole answer.

## `UNIFIED_AUDIT_TRAIL` is read through dynamic SQL, and that is not a loophole

That view needs the `AUDIT_VIEWER` role or an explicit `SELECT`, and neither is
implied by `SELECT_CATALOG_ROLE`, so on most estates a reading account does not
have it. A **static** reference to a view the session cannot see fails when the
statement is compiled, which would take a whole tier down over one view instead
of degrading it.

So every read of the trail is native dynamic SQL, each one a plain literal
beginning with `SELECT` and never a name joined together from strings. This
product's read-only gate reads the statement inside the dynamic SQL and passes
only `SELECT` or `WITH`, and it fails closed on anything it cannot read with
certainty. A test asserts that no `.sql` file in this pack references the trail
view any other way.

## Option and feature usage: facts, never a licence conclusion

`sql/feature_usage_check.sql` reports what `V$OPTION` says was linked into this
Oracle home, and what Oracle's own sampling in `DBA_FEATURE_USAGE_STATISTICS`
recorded as used: how many detected usages, whether the feature is currently in
use, and the first and last dates the database recorded.

"Partitioning shows 14 detected usages, first recorded on 12 March" is the kind
of sentence this section produces, and it is exactly what somebody preparing for
a conversation about agreements needs to take into that conversation.

It stops there, permanently and by design. What an estate is permitted to use
lives in a contract, in whatever was actually bought, and in terms that differ
between releases and between customers. None of that is readable from inside a
database.

**The file contains no built-in list of "the ones that cost money",** and that is
also deliberate. Such a list would itself be a claim about licensing, made by
this pack, on every database it ever ran against, and it would be wrong
somewhere within a release or two. The feature rows are ranked by detected usage
instead, so whatever an estate has actually exercised surfaces on its own under
Oracle's own names for it.

Two arithmetic notes the report carries in its own rows, because both are easy
to get wrong: `V$OPTION` names **options** while
`DBA_FEATURE_USAGE_STATISTICS` names **features**, one option can appear as
several features or as none, so the difference between the two counts is not a
quantity that means anything. And the feature view keeps rows against the DBID
that produced them and one row per database version, so a cloned, restored or
upgraded database carries rows that would double every count. The current DBID
and the most recently sampled row per feature are both filtered for.

## Scope: it describes ONE container

`SCOPE` records which container the collection describes. Nearly every view read
here is container scoped: `DBA_USERS` in a CDB root describes the root's common
users, not the accounts inside a pluggable database. Run it once per container
you are responsible for. An unstated scope is indistinguishable from a complete
one, so the report states it on its own face.

## Grants

`SELECT_CATALOG_ROLE` or the equivalent `SELECT` grants on the dictionary views
covers eight of the ten tiers. The two trail tiers additionally want the
`AUDIT_VIEWER` role, or `SELECT` on `UNIFIED_AUDIT_TRAIL`. The purge and archive
rows inside the hygiene tier want `AUDIT_ADMIN`, or `SELECT` on
`DBA_AUDIT_MGMT_LAST_ARCH_TS` and `DBA_AUDIT_MGMT_CLEAN_EVENTS`.

Every one of those is named in the `NA` row that appears when the grant is
absent, so the report tells you what to ask for rather than leaving you to work
it out from an error code.

## Portability, and the columns this pack deliberately does not read

Written for Oracle 19c, 21c and 23ai on Linux. Two views changed shape across
those releases and are read narrowly on purpose, because a reference to a column
that does not exist stops the tier that contains it:

- `AUDIT_UNIFIED_ENABLED_POLICIES`: only `POLICY_NAME`, `SUCCESS` and `FAILURE`
  are read. The column naming who a policy is enabled for was `ENABLED_OPTION`
  in 12.1 and became `ENABLED_OPT` plus `ENTITY_NAME` and `ENTITY_TYPE` in 12.2.
- `V$ENCRYPTED_TABLESPACES`: only `TS#` and `ENCRYPTIONALG` are read. The columns
  describing key state were renamed and extended between 11g and 19c.

Inside each tier the sub-reads are ordered most-portable first, so if one does
stop the tier, the rows before it survive.

## Handing the briefing to your AI

`prompts/audit-review.md` contains a prompt to paste alongside the JSON. It
teaches your assistant the shape of the document, tells it that every row is an
observation rather than a finding, and asks it for the questions this data
raises rather than for a score.

Your assistant, your subscription, your data. Nothing in this pack transmits
anything anywhere, and OraDiscuss never receives your output.

## What has not happened yet

**This pack has never run against a real Oracle database.** It is exercised end
to end by this product's test suite, which drives the real parser and the real
rendering path through `--render-only` against a recorded collection, and every
`.sql` file is checked by the read-only gate. That proves the parsing, the
escaping, the metric keying and the read-only property. It does not prove that
every column named above exists on your release, that every view is readable by
your account, or that any query performs acceptably on your data.

The field test against a real estate is the designed next gate and it belongs to
the founder. Treat this release as ready for that test rather than as proven by
it.
