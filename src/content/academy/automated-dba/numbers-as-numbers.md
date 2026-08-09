---
course: automated-dba
module: "Handing it to your own AI: the briefing, its schema, and prompts that do not invent"
order: 4
title: "Numbers as numbers, and a document that survives its own worst input"
summary: Why the briefing hands over 87.3 with a unit instead of a sentence to parse, how metrics attach to their own check rather than to whichever one came last, and why the escaping is load bearing when the alert log is full of Windows paths, quotes and a decimal comma.
estimatedMinutes: 40
prerequisites:
  - The OraDiscuss Health Check pack unpacked somewhere you can read it.
  - A bash shell, and python3 on the machine you run the lab on.
oracleVersions:
  - 19c
  - 26ai
lastReviewed: 2026-08-09
draft: false
---

## What this lesson answers

Why does the briefing repeat numbers that are already in the prose, and what
happens to this document when the alert log hands it a Windows path, a quoted
parameter name, a pipe and a decimal comma?

## Applicability

**Releases.** The lab contacts no database, so nothing in it depends on your
release. The one Oracle detail discussed below, the number format mask in the
shipped collector SQL, is quoted from the pack rather than asserted here.

**Edition.** Not applicable to the lab.

**Pack the lab uses.** The OraDiscuss Health Check pack, v1.0.0, specifically
`health_check.sh`, `lib/odc_briefing.sh` and `sql/health_check.sql`. Part of the
membership, read-only, and not contacting a database in this lab.

**Oracle licensed options.** None in this lesson.

## The mechanism

### Numbers are handed over already parsed

The human report says this:

```text
Tablespace USERS    87.3% used (100 GB max, 87.3 GB used)
```

The briefing says this:

```json
"metrics": {
  "used_pct": { "value": 87.3, "unit": "percent" },
  "used_gb":  { "value": 87.3, "unit": "GB" },
  "max_gb":   { "value": 100.0, "unit": "GB" }
}
```

Both came from the same query. The second exists so that a consumer never has to
recover a number from an English sentence. That matters more than it sounds,
because sentence parsing fails in a particular way: it usually works, and when it
does not, it produces a number rather than an error. A regular expression that
grabs the first decimal in that line gets 87.3 and cannot tell you whether it
found the percentage or the gigabytes. A reader given `used_pct` and `max_gb`
cannot make that mistake.

The unit travels with the value for the same reason. `87.3` alone is not a
measurement.

The collector SQL emits both, and the shipped comment on the metric query is
worth reading in full because it names the failure it is defending against:

```sql
-- The same tablespace numbers again, as MET| lines for briefing.json.
--
-- These are values the query above already computed; nothing new is measured
-- and nothing extra is read. They exist so the customer's AI is handed
-- 87.3 rather than having to parse it back out of an English sentence.
--
-- The NLS_NUMERIC_CHARACTERS mask is NOT decoration. Under a session whose
-- territory uses a decimal comma, this number renders as "87,3", which is not
-- a JSON number, and one of them invalidates the entire briefing. The mask is
-- used here rather than an ALTER SESSION because ALTER is a DDL verb, and the
-- fix for one requirement must not break the read-only guarantee that is the
-- whole liability position of this pack.
SELECT 'MET|TS_' || m.tablespace_name || '|used_pct|' ||
       TO_CHAR(ROUND(m.used_percent, 1), 'FM99999990.0',
               'NLS_NUMERIC_CHARACTERS=''.,''') || '|percent'
FROM dba_tablespace_usage_metrics m
WHERE m.tablespace_name NOT IN (
        SELECT tablespace_name FROM dba_tablespaces WHERE status = 'OFFLINE')
ORDER BY m.tablespace_name;
```

That is a constraint working two ways at once. The output has to be a JSON
number, and the pack is not allowed to issue a statement that changes session
state to guarantee it. The mask solves both.

### Metrics attach to a check by id, never by position

A raw collection may put its `MET` lines anywhere: interleaved with the checks, or
in one block at the end. They are pooled by check id.

```text
MET|<check id>|<metric name>|<value>|<unit>
```

The shipped library says what the earlier design cost: attaching each metric to
whichever check was last seen quietly forced every SQL author to interleave their
statements, and would have misfiled the metric the first time somebody did not.
The id is already on the line, so using it removes the whole class of error for
the price of one extra pass over a local file.

### The document has to survive its own worst input

A check `detail` carries raw text from the alert log. That text contains, on
ordinary days, double quotes around parameter names, backslashes in file paths,
tabs, pipes, and occasionally a control byte. On the days you actually need this
file, it contains more of all of them.

Two small functions in `lib/odc_briefing.sh` hold that line. The first escapes a
string for a JSON value:

```bash
odc_json_esc() {
  local s="${1-}"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\n'/\\n}"
  # Anything still in the C0 control range is not representable raw in JSON.
  printf '%s' "$s" | LC_ALL=C tr -d '\000-\010\013\014\016-\037'
}
```

The order is not stylistic. Backslash is replaced first, because the backslashes
introduced while escaping the quotes would otherwise be escaped a second time and
the output would be corrupt. The shipped file says so in a comment directly above
the line, which is the right place for that sentence to live.

The second decides whether something is a number at all:

```bash
odc_json_num() {
  local v="${1-}"
  case "$v" in
    ''|*[!0-9.eE+-]*) printf 'null'; return 0 ;;
  esac
  if printf '%s' "$v" | LC_ALL=C grep -Eq '^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?$'; then
    printf '%s' "$v"
  else
    printf 'null'
  fi
}
```

`87,3` is not a JSON number. Without this function, one metric from one
German-locale session would make the entire document unparseable, and every other
measurement in it would be lost with it. With it, that one metric becomes `null`,
the check's `detail` still carries the original text, and the other forty numbers
survive.

That is the general shape of the rule, and it is worth taking away from here even
if you never touch this pack again: **a machine-readable output has to survive its
own worst input, because the worst input arrives exactly when the output matters
most.** A collector that emits perfect JSON on a healthy database and invalid JSON
on a sick one is a collector that works when you do not need it.

## At the terminal

**Setup.**

```bash
ODC_PACK=/opt/oradiscuss/healthcheck      # wherever you unpacked it
LAB="$HOME/odc-lab-numbers"
mkdir -p "$LAB"
cd "$LAB"

cat > "$LAB/lab_config.env" <<CFG
ORACLE_SID=LABDB
ORACLE_HOME=/nonexistent
ORACLE_CONNECT="/ as sysdba"
OUTPUT_DIR=$LAB
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
```

The collection below is deliberately hostile. Every `MET` line sits after every
`CHK` line, which is exactly the arrangement a position-keyed design would
misfile. The alert log rows carry a Windows path, a quoted parameter name and a
pipe inside the detail. One metric arrives with a decimal comma.

```bash
cat > "$LAB/lab_collection.txt" <<'RAW'
SEC|Instance and database
CHK|INSTANCE|OK|Instance status|LABDB OPEN, ARCHIVELOG, "primary" role
SEC|Tablespace usage
CHK|TS_USERS|WARN|Tablespace USERS|87.3% used (100 GB max, 87.3 GB used)
CHK|TS_UNDOTBS1|CRIT|Tablespace UNDOTBS1|96.8% used (16 GB max, 15.5 GB used)
CHK|TS_BADLOCALE|WARN|Tablespace BADLOCALE|87,3% used, written by a session with a decimal comma
SEC|Alert log
CHK|ALERT_WINDOWS_PATH|NA|Recent ORA- sample|ORA-27037: unable to obtain file status for D:\oracle\oradata\LABDB\undotbs01.dbf
CHK|ALERT_QUOTED_NAME|NA|Recent ORA- sample|ORA-19809: limit exceeded for recovery files, "db_recovery_file_dest_size" reached
CHK|ALERT_PIPE_INSIDE|NA|Recent ORA- sample|ORA-00060: deadlock detected while waiting: session 42 held "TX" mode 6 | waiter 77 wants mode 4
MET|TS_USERS|used_pct|87.3|percent
MET|TS_USERS|used_gb|87.3|GB
MET|TS_USERS|max_gb|100.0|GB
MET|TS_UNDOTBS1|used_pct|96.8|percent
MET|TS_BADLOCALE|used_pct|87,3|percent
RAW
```

**The lab.** Replay it, then read the metrics back.

```bash
bash "$ODC_PACK/health_check.sh" --config "$LAB/lab_config.env" \
  --render-only "$LAB/lab_collection.txt"

python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
for c in d['checks']:
    print(c['id'], '|', c['status'], '|', json.dumps(c['metrics']))
" "$LAB/reports/health_LABDB_latest.json"
```

Captured from a `--render-only` replay on 9 August 2026. No database was
contacted; the collection is written by hand and is synthetic.

```text
INSTANCE | OK | {}
TS_USERS | WARN | {"used_pct": {"value": 87.3, "unit": "percent"}, "used_gb": {"value": 87.3, "unit": "GB"}, "max_gb": {"value": 100.0, "unit": "GB"}}
TS_UNDOTBS1 | CRIT | {"used_pct": {"value": 96.8, "unit": "percent"}}
TS_BADLOCALE | WARN | {"used_pct": {"value": null, "unit": "percent"}}
ALERT_WINDOWS_PATH | NA | {}
ALERT_QUOTED_NAME | NA | {}
ALERT_PIPE_INSIDE | NA | {}
LISTENER | WARN | {}
```

Five things happened there, and each one is worth naming.

Every metric landed on its own check although all of them arrived after all of the
checks. `TS_BADLOCALE` has a metric whose value is `null` and whose unit survived.
`INSTANCE` has no metrics at all, which is not the same as having a metric of
zero. The document parsed, so `json.load` succeeded, which it would not have done
had `87,3` been written through unchecked. And `LISTENER` appeared without being
in your collection, for the reason lesson 1 gives.

Now the details, which are where the escaping earns its keep:

```bash
python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
for c in d['checks']:
    if c['id'].startswith('ALERT_') or c['id'] == 'TS_BADLOCALE':
        print(c['id'])
        print('   ', c['detail'])
" "$LAB/reports/health_LABDB_latest.json"
```

```text
TS_BADLOCALE
    87,3% used, written by a session with a decimal comma
ALERT_WINDOWS_PATH
    ORA-27037: unable to obtain file status for D:\oracle\oradata\LABDB\undotbs01.dbf
ALERT_QUOTED_NAME
    ORA-19809: limit exceeded for recovery files, "db_recovery_file_dest_size" reached
ALERT_PIPE_INSIDE
    ORA-00060: deadlock detected while waiting: session 42 held "TX" mode 6 | waiter 77 wants mode 4
```

Every character arrived intact. The backslashes are stored escaped in the file
and come back as backslashes. The quotes are stored escaped and come back as
quotes. The pipe survived the field split. And the decimal comma is still there in
the prose, where a human can see what the collector saw, while the numeric field
for the same check honestly says it could not turn that into a number.

Finally, read the thresholds, because a status is meaningless without them:

```bash
python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
print(json.dumps(d['thresholds'], indent=2))
" "$LAB/reports/health_LABDB_latest.json"
```

```json
{
  "tablespace_warn_pct": 85,
  "tablespace_crit_pct": 95,
  "asm_warn_pct": 80,
  "asm_crit_pct": 90,
  "fra_warn_pct": 80,
  "fra_crit_pct": 90,
  "rman_full_max_age_hours": 30,
  "rman_arch_max_age_hours": 8,
  "invalid_object_warn": 1
}
```

`TS_USERS` is WARN at 87.3 percent because you set the warn line at 85. Somebody
else's briefing with the same number and a warn line of 90 says OK. The status is
a comparison, the thresholds are half of it, and they travel in the document so
that the comparison can be checked rather than assumed.

**Teardown.**

```bash
rm -rf "$LAB"
```

## Read it wrong

**`null` is not zero, and an absent metric is not zero either.** The schema is
explicit: a value of `null` means the collector produced something that was not a
valid number, and the check's detail still holds the original text. Absent metrics
mean the check is not numeric. A consumer that coerces either to zero has invented
a measurement, and the invented one will look exactly like a real one.

**A unit is not a scale.** `used_pct` is a percentage of the tablespace's own
maximum size, which is why the shipped capacity prompt asks for headroom in GB
rather than in percentages alone: a tablespace at 90 percent of 8 GB and one at
90 percent of 4 TB are not the same problem, and a percentage hides that. Reading
`unit` tells you what kind of number you have, not what it is a proportion of. The
check `id` and `detail` are where that lives.

**A pipe is safe in a detail and unsafe in a title, and nothing will tell you.**
The parser splits a `CHK` line into five fields and gives the remainder to the
last one, so a pipe inside the detail is preserved. A pipe inside the title shifts
the boundary instead. Replay a line like this and look at what you get:

```text
SEC|Pipes
CHK|GOOD|OK|Detail holds a pipe|left | right
CHK|BAD|OK|Title | holds a pipe|the detail
```

```json
{"id": "GOOD", "section": "Pipes", "status": "OK", "title": "Detail holds a pipe",
 "detail": "left | right", "metrics": {}}
{"id": "BAD", "section": "Pipes", "status": "OK", "title": "Title ",
 "detail": " holds a pipe|the detail", "metrics": {}}
```

That is still valid JSON. Nothing failed, no guard fired, and the document is
quietly wrong. It is the reason to keep pipes out of anything a collector puts in
a title field, and the general reason to be suspicious of a format that cannot
distinguish a separator from data. A validator checks a document against itself,
so a wrong but self-consistent record passes every gate.

**Metrics are what the collector computed, not a second opinion.** They come from
the same query as the prose. If the SQL was reading the wrong view, the number is
wrong in both outputs, in the same way, and the fact that two places agree proves
only that they share a source.

**The escaping protects the document, not your reading of it.** A control byte in
an alert log line is dropped rather than represented. That is the right trade for
a document that must parse, and it means the briefing is not a byte-exact copy of
the log. When the exact bytes matter, read the log.

## Check your work

**One.** The document parses, and the bad number is `null` rather than a number:

```bash
python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
print('checks parsed:', len(d['checks']))
bad = [c for c in d['checks'] if c['id'] == 'TS_BADLOCALE'][0]
print('value:', bad['metrics']['used_pct']['value'])
print('unit :', bad['metrics']['used_pct']['unit'])
print('detail still holds the comma:', '87,3' in bad['detail'])
" "$LAB/reports/health_LABDB_latest.json"
```

Expect eight checks parsed, a value of `None`, the unit intact, and the comma
still present in the detail. Reaching the first line at all is the real assertion:
`json.load` raises on a malformed document, so a printed count means the file was
valid JSON. If the value came back as 87 or as 873, something recovered a number
that was never there.

**Two.** Break it on purpose, and watch the protection fire. Edit
`lab_collection.txt` and change the `MET|TS_USERS|used_pct|87.3|percent` line so
the value reads `87.3.1`, then replay. The document must still parse and that one
value must be `null`. A guard you have never watched fire is not a guard, and this
one is easy to watch.

## Where this goes next

This lesson makes no claim about Oracle behaviour. The number format mask
discussed in part 3 is quoted from the shipped collector SQL, and its effect is
visible in the lab above rather than asserted here.

The files to read next both ship with your pack: `lib/odc_briefing.sh`, where
`odc_json_esc` and `odc_json_num` live with their reasoning attached, and the
`metrics` section of `schema/briefing.schema.json`, which states what `null` and
absence each mean.

The OraDiscuss Health Check pack, part of the membership, is the collector used
above.
