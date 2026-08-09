---
course: automated-dba
module: "Handing it to your own AI: the briefing, its schema, and prompts that do not invent"
order: 2
title: "The schema is a contract, and kind is how a reader knows what it is holding"
summary: Why the briefing carries a schema_version and a kind of state or incident, why a declared discriminator beats inferring the document shape from which keys happen to be present, and how to read the schema file itself.
estimatedMinutes: 35
prerequisites:
  - The OraDiscuss Health Check pack and the RCA Generator pack unpacked somewhere you can read them.
  - A bash shell, and python3 on the machine you run the lab on.
  - Lesson 1 of this module is useful but not required. This lab writes its own collections from scratch.
oracleVersions:
  - 19c
  - 26ai
lastReviewed: 2026-08-09
draft: false
---

## What this lesson answers

Two different collectors wrote me two JSON files. They look similar. Before I
write anything that reads them, or hand either to an assistant, how do I know
what each one actually is?

## Applicability

**Releases.** The lab contacts no database, so nothing in it depends on your
release. It replays two collections written by hand through two shipped parsers.

**Edition.** Not applicable to the lab.

**Packs the lab uses.** The OraDiscuss Health Check pack, v1.0.0
(`health_check.sh`), and the OraDiscuss RCA Generator pack, v1.0.0
(`rca_generator.sh`). Both are part of the membership, both are read-only, and
neither contacts a database in this lab.

**Oracle licensed options.** One line in the incident collection below names
`control_management_pack_access` and the `DBA_HIST` views. Those views are part
of the Oracle Diagnostics Pack, which is licensed separately on Enterprise
Edition. Oracle's own documentation states it: "Some of the products and tools
in the preceding list, including Oracle Diagnostics Pack and Oracle Tuning Pack,
require separate licenses." (*Tools for Tuning the Database*,
`https://docs.oracle.com/en/database/oracle/oracle-database/26/tdppt/tools-tuning-database.html`,
read 9 August 2026.) Nothing in this lab reads those views. The line exists in
the lab collection because it is exactly what a collector writes when it decides
not to read them, and reading that line correctly is part of the lesson.

## The mechanism

Every briefing opens with two fields before anything about your database:

```json
{
  "schema_version": "1.1",
  "kind": "state",
```

**`schema_version` versions the contract, not the pack.** The schema file says so
in its own description: a consumer that understands 1.0 can rely on every field
continuing to mean what it meant. The pack version is a separate field, inside
`generator`, and the two move independently. A pack can be rebuilt without the
document contract changing, and that is the usual case.

Version 1.1 added `kind` and the optional `incident` block. It is a minor bump
rather than a second schema because nothing a 1.0 reader relied on changed.

**`kind` says which question the document answers.** There are two values.

| `kind` | The question | The answer |
|---|---|---|
| `state` | What is the state of this database | The `checks` array is the whole answer |
| `incident` | What happened in one window | The `checks` array plus the `incident` block |

That distinction is real rather than cosmetic. A state collection reports what is
true now. An incident collection reports a window: a reconstructed timeline,
ordering facts split into what was measured and what is being read into it, and a
list of raw evidence files written beside the briefing. Those are different
documents with different uses, and an assistant that treats one as the other will
answer a question you did not ask.

**Why one schema with an optional block, rather than two schemas.** The shipped
source gives the reasoning, and it is worth repeating because it is the same
trade-off you will face the first time your own output grows a second shape: the
header, the collection block, the summary and the checks all mean exactly what
they meant before, so a consumer that already read a briefing keeps working
unchanged. Two schemas would have duplicated all of that, and the duplicate
would drift.

**Why a declared discriminator beats guessing from keys.** You could infer the
shape by testing whether the `incident` key is present. Today that works. It is
still the wrong thing to depend on, for a reason that has nothing to do with
taste:

- `kind` is **required** and its values are an enumeration. The contract promises
  it is there and promises what it can say.
- `incident` is **optional**. The contract promises nothing about when it appears.
  A document that gained an optional block for an unrelated reason would silently
  reclassify itself under a presence test, and nothing would fail loudly.

Key presence describes the documents you happen to have seen. A discriminator
describes the documents the contract permits. In the lab below you will see the
gap directly: the schema requires six top-level keys and the documents carry
eight.

## At the terminal

**Setup.** One directory, two configs, two collections.

```bash
ODC_PACK=/opt/oradiscuss/healthcheck      # wherever you unpacked it
RCA_PACK=/opt/oradiscuss/rca              # wherever you unpacked it
LAB="$HOME/odc-lab-kinds"
mkdir -p "$LAB"
cd "$LAB"

cat > "$LAB/state_config.env" <<CFG
ORACLE_SID=LABDB
ORACLE_HOME=/nonexistent
ORACLE_CONNECT="/ as sysdba"
OUTPUT_DIR=$LAB/state
TS_WARN_PCT=85
TS_CRIT_PCT=95
ASM_WARN_PCT=80
ASM_CRIT_PCT=90
FRA_WARN_PCT=80
FRA_CRIT_PCT=90
RMAN_FULL_MAX_AGE_HOURS=30
RMAN_ARCH_MAX_AGE_HOURS=8
INVALID_OBJ_WARN=1
RETENTION_DAYS=30
CFG

cat > "$LAB/incident_config.env" <<CFG
ORACLE_SID=LABDB
ORACLE_HOME=/nonexistent
ORACLE_CONNECT="/ as sysdba"
OUTPUT_DIR=$LAB/incident
RCA_MAX_EVENTS=500
RCA_CORRELATION_WINDOW_SEC=600
CFG
```

The state collection:

```bash
cat > "$LAB/state_collection.txt" <<'RAW'
SEC|Instance and database
CHK|INSTANCE|OK|Instance status|LABDB OPEN, ARCHIVELOG, "primary" role
SEC|Tablespace usage
CHK|TS_USERS|WARN|Tablespace USERS|87.3% used (100 GB max, 87.3 GB used)
MET|TS_USERS|used_pct|87.3|percent
RAW
```

The incident collection. It carries a window, a mix of readable and unreadable
tiers, three events with their epoch seconds, and one appendix entry:

```bash
cat > "$LAB/incident_collection.txt" <<'RAW'
WIN|2026-08-08 02:00:00|2026-08-08 06:00:00|--at 2026-08-08 04:00, widened to plus and minus 2 hours
SEC|Collection status
CHK|IDENT|OK|Instance identity|version 19.22.0.0.0, CDB=YES, role PRIMARY
CHK|ALERT|OK|Alert log source|read through X$DBGALERTEXT, filtered on the window in the database
CHK|OSTIER|NA|Operating system tier|skipped. Running as oracle, which cannot read the system logs, and no passwordless sudo is available.
CHK|AWR|NA|Workload evidence|control_management_pack_access is "NONE", so DBA_HIST views were not read.
EVT|1|1754640000|2026-08-08 03:20:00|os-messages|OS-ERROR|kernel: I/O error, dev sdc, sector 88213344 on "/u02/oradata"
EVT|2|1754640042|2026-08-08 03:20:42|alert-log|SEVERE|ORA-01578: ORACLE data block corrupted (file # 7, block # 1234)
EVT|3|1754640301|2026-08-08 03:25:01|alert-log|SEVERE|ORA-00600: internal error code, arguments: [kcbzib_kcrsds_1], [], []
APX|alertlog_window.txt|18422|raw evidence captured during collection
RAW
```

**The lab.** Replay both.

```bash
bash "$ODC_PACK/health_check.sh"  --config "$LAB/state_config.env"    --render-only "$LAB/state_collection.txt"
bash "$RCA_PACK/rca_generator.sh" --config "$LAB/incident_config.env" --render-only "$LAB/incident_collection.txt"
```

Captured from those two replays on 9 August 2026. No database was contacted; both
collections are written by hand and are synthetic.

```text
[rca_generator] window 2026-08-08 02:00:00 to 2026-08-08 06:00:00, 3 events, collection status WARN
[rca_generator] collection completeness: 2 of 4 checks could not be read, so this collection is incomplete
[rca_generator] hand the briefing to your own AI with prompts/incident-review.md - nothing left this machine.
```

Now compare the two documents against the contract they both claim to follow.
Save this as `compare.py` in the lab directory:

```python
import json, sys

schema = json.load(open(sys.argv[1]))
print("schema requires:", schema["required"])
print("schema permits :", list(schema["properties"].keys()))
print()

for path in sys.argv[2:]:
    doc = json.load(open(path))
    major = doc["schema_version"].split(".")[0]
    if major != "1":
        print(path, "is schema_version", doc["schema_version"], "which this reader does not know")
        continue
    print(path.split("/")[-1])
    print("   kind          :", doc["kind"])
    print("   keys present  :", list(doc.keys()))
    extra = [k for k in doc if k not in schema["required"]]
    print("   present, not required:", extra)
    if doc["kind"] == "incident":
        print("   incident block:", list(doc["incident"].keys()))
        print("   events        :", len(doc["incident"]["events"]))
```

Run it against the shipped schema and both briefings:

```bash
python3 compare.py "$RCA_PACK/schema/briefing.schema.json" \
  "$LAB"/state/reports/health_LABDB_latest.json \
  "$LAB"/incident/rca/rca_LABDB_latest.json
```

Captured output, reformatted only for width:

```text
schema requires: ['schema_version', 'kind', 'generator', 'collection', 'summary', 'checks']
schema permits : ['schema_version', 'kind', 'generator', 'collection', 'summary',
                  'thresholds', 'incident', 'checks']

health_LABDB_latest.json
   kind          : state
   keys present  : ['schema_version', 'kind', 'generator', 'collection', 'summary',
                    'thresholds', 'checks']
   present, not required: ['thresholds']
rca_LABDB_latest.json
   kind          : incident
   keys present  : ['schema_version', 'kind', 'generator', 'collection', 'summary',
                    'thresholds', 'incident', 'checks']
   present, not required: ['thresholds', 'incident']
   incident block: ['window', 'events', 'ordering_facts', 'appendix']
   events        : 3
```

There is the gap, in one screen. Six keys are required and eight are permitted.
Both documents carry `thresholds` although nothing obliges them to. The reader
above branches on `kind`, which the contract guarantees, and it checks the major
version before trusting any field name at all.

**Teardown.**

```bash
rm -rf "$LAB"
```

## Read it wrong

**`kind` tells you the question, not the answer.** An incident briefing is not a
statement that an incident occurred. It is a statement that somebody asked about
a window and this is what could be collected for it. The window itself is in
`incident.window`, including `resolved_from`, which records the argument the
operator actually used. A triage that quietly examined a different window than
the one somebody meant is worse than one that refused to run, which is why that
field exists.

**An empty optional block is present, not absent.** In the incident document
above, `incident.appendix` holds one entry. Rerun with the `APX` line removed and
the key is still there, holding an empty array. That is another reason presence
tests are a poor foundation: an emitter is free to write an empty container, and
a reader that treats an empty array as a missing section is now wrong in a way
that never raises an error.

**A minor version bump is a promise about meanings, not about keys.** Moving from
1.0 to 1.1 added fields. It did not change any field a 1.0 reader was using. If
you write a consumer, pin on the major version and tolerate unknown keys. A reader
that rejects a document because it contains a key it has not seen will break on
the next honest addition.

**The schema ships in every pack and is byte-identical across them.** That is not
a coincidence to be relied on casually: the packs are sold and downloaded
separately, so each has to be self-contained, and the repository asserts the
copies byte for byte precisely because two copies of a file are two copies that
can drift. Read the schema from the pack you are actually consuming.

## Check your work

**One.** Both documents pass the same contract, and one field separates them:

```bash
python3 -c "import json,sys; d=[json.load(open(p)) for p in sys.argv[1:]]; \
print([x['kind'] for x in d]); \
print(sorted(set(d[1]) - set(d[0])))" \
  "$LAB"/state/reports/health_LABDB_latest.json \
  "$LAB"/incident/rca/rca_LABDB_latest.json
```

This prints `['state', 'incident']` and then `['incident']`. One key differs, and
`kind` named it without you looking.

**Two.** The version guard fires when it should. Copy the state briefing, edit the
copy so `schema_version` reads `9.0`, and run `compare.py` against the copy. It
must print that it does not know the version, and must not print any field from
the document. A guard you have never watched fire is not a guard.

## Where this goes next

This lesson makes no claim about Oracle behaviour beyond the licensing fact cited
in part 2, whose source is Oracle's own documentation:

- *Tools for Tuning the Database*, Oracle Database documentation, 26,
  `https://docs.oracle.com/en/database/oracle/oracle-database/26/tdppt/tools-tuning-database.html`

The document contract itself is `schema/briefing.schema.json` in your pack. It is
JSON Schema draft-07, it is commented in its own `description` fields, and it is
the file to read before you write anything that consumes a briefing.

The OraDiscuss Health Check pack and the OraDiscuss RCA Generator pack, both part
of the membership, are the collectors used above.
