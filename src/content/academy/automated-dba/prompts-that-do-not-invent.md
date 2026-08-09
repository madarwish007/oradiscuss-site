---
course: automated-dba
module: "Handing it to your own AI: the briefing, its schema, and prompts that do not invent"
order: 5
title: "Prompts that do not invent: two things the shipped prompts refuse to do"
summary: The prompts that ship beside the briefing teach an assistant the shape of the document and nothing about Oracle, and they ask what it would want to know rather than what to run. Both refusals are deliberate, both are checkable, and both transfer to prompts you write yourself.
estimatedMinutes: 35
prerequisites:
  - The OraDiscuss Health Check pack unpacked somewhere you can read it. The RCA Generator and Daily Operations packs are useful for the comparison but are not required.
  - A bash shell, and python3 on the machine you run the lab on.
  - An AI assistant of your own is optional. Every check in this lesson is done at the terminal without one.
oracleVersions:
  - 19c
  - 26ai
lastReviewed: 2026-08-09
draft: false
---

## What this lesson answers

I have a briefing and I have an assistant. What do I actually say to it, and why
do the prompts that came with the pack look so much emptier than I expected?

## Applicability

**Releases.** Nothing in this lesson depends on your Oracle release. The lab reads
text files that ship with your packs and assembles one file on your machine. No
database is contacted.

**Edition.** Not applicable.

**Pack the lab uses.** The OraDiscuss Health Check pack, v1.0.0, specifically
`prompts/`. Part of the membership, read-only.

**Oracle licensed options.** None in this lesson.

**About AI assistants.** This lesson names no assistant, no vendor and no model.
Which one you use is your choice, the products move constantly, and a lesson that
described one of them would be wrong within a release or two. Everything below is
about the file you hand over and the instructions you send with it, which is the
half of the arrangement that stays still.

## The mechanism

Beside every briefing, each pack ships plain text prompt files. You paste or pipe
one together with the briefing, into the assistant you already use, in your own
account. Nothing in the pack calls an API and nothing in it transmits your file.

Read one and the first impression is that something is missing. `triage.md` is
about thirty lines. It contains no Oracle background, no glossary, no explanation
of what a tablespace is. That absence is the design, and it has two halves.

### One: they do not teach the assistant about Oracle

The pack's own `prompts/README.md` states it plainly:

> They do not teach your assistant about Oracle. Your assistant already knows more
> Oracle than a prompt file could carry, and a prompt that recites half-remembered
> version behaviour is how a confident wrong answer gets made. These prompts teach
> it the shape of the briefing, then get out of the way.

Consider what the alternative costs. A prompt that says "in this release, feature
X behaves like Y" has to stay right in a file nobody rereads, and when it goes
stale it does not fail loudly. It produces an answer that is confident, fluent,
wrong, and grounded in something you wrote. You have used your own prompt to talk
your assistant out of what it knew.

So the prompts describe the document instead. Here is `morning-triage.md`
describing the shape and nothing else:

> - `summary.counts` totals the checks by status, and `summary.needs_attention`
>   lists the check ids that are WARN or CRIT.
> - `checks[]` is the detail. Each entry has an `id`, the `section` it belongs to,
>   a `status` of OK, WARN, CRIT or NA, a human `title`, a prose `detail`, and a
>   `metrics` object holding the numbers behind that check, each with a `value`
>   and a `unit`.

That is a description of a data structure. It is true regardless of release, it is
checkable against the schema, and it goes stale only when the contract changes,
which is the one event that also bumps `schema_version`.

The same prompts also state the reading rule that lesson 3 was about, because that
one is a property of the document rather than of Oracle:

> `NA` means the check could not run, usually a missing grant or an absent
> optional feature. It is not a pass and it is not a failure. Say what would make
> it runnable, and do not count it as healthy.

This is the transferable part, and it is worth stating as a rule you can use
anywhere: **teach the model the shape of your evidence, not your domain.** The
shape is something you control and can verify. The domain is something the model
already has, in more detail than you can restate, and every sentence you add about
it is a sentence that can be wrong.

### Two: they do not ask for commands to paste

Every shipped prompt refuses this, in its own words. From `triage.md`:

> **What you would want to look at next, and why.** Questions and observations, not
> commands. Do not give me statements to run against this database. I decide what
> runs on my estate, and I need your reasoning, not your SQL.

From `incident-review.md`:

> **Do not give me commands to run against production.** If a command would help,
> say what you would want to KNOW and let me decide how to find out.

And the README says why:

> The briefing reports what your database recorded. What to do about it is your
> call as the DBA, on your estate, with your change process. An assistant that
> hands you a command to run against production has skipped every one of those
> steps.

There is a liability argument there and there is also a craft argument, and the
craft argument is the one that changes your answers.

An assistant asked for a command produces one, because that is the shape of the
request. It will be plausible, and it will be written without knowing your
version, your patch level, your grants or your change window. An assistant asked
what it would want to **know** produces something different in kind: a list of
things that would separate one explanation from another, useful even when
incomplete, and safe to read.

The same distinction is built into the document itself. In the incident block,
each ordering fact may carry a `would_distinguish` field, and the schema says what
that field is for:

> What further knowledge would separate this reading from a competing one.
> Deliberately phrased as something to KNOW rather than something to RUN.

Document and prompt are making the same move. Neither of them is trying to be your
change process.

## At the terminal

**Setup.** You need a briefing to hand over. Build one from a collection you write
yourself, exactly as in the earlier lessons.

```bash
ODC_PACK=/opt/oradiscuss/healthcheck      # wherever you unpacked it
LAB="$HOME/odc-lab-prompts"
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

cat > "$LAB/lab_collection.txt" <<'RAW'
SEC|Instance and database
CHK|INSTANCE|OK|Instance status|LABDB OPEN, ARCHIVELOG, "primary" role
SEC|Tablespace usage
CHK|TS_USERS|WARN|Tablespace USERS|87.3% used (100 GB max, 87.3 GB used)
CHK|TS_UNDOTBS1|CRIT|Tablespace UNDOTBS1|96.8% used (16 GB max, 15.5 GB used)
SEC|Alert log
CHK|ADR_LOCATION|NA|ADR diagnostic destination|V$DIAG_INFO was not readable by this account
MET|TS_USERS|used_pct|87.3|percent
MET|TS_USERS|max_gb|100.0|GB
MET|TS_UNDOTBS1|used_pct|96.8|percent
RAW

bash "$ODC_PACK/health_check.sh" --config "$LAB/lab_config.env" \
  --render-only "$LAB/lab_collection.txt"
```

**The lab, part one: assemble the thing you would actually send.**

```bash
cat "$ODC_PACK/prompts/triage.md" \
    "$LAB/reports/health_LABDB_latest.json" > "$LAB/for_my_assistant.txt"

wc -l < "$LAB/for_my_assistant.txt"
head -3 "$LAB/for_my_assistant.txt"
tail -1 "$LAB/for_my_assistant.txt"
```

Captured on 9 August 2026 from the collection above. No database was contacted;
the collection is written by hand and is synthetic.

```text
      65
<!-- OraDiscuss - DBA Health Check Automation Pack v1.0.0. Generated and published by
OraDiscuss (oradiscuss.com). Not produced by, affiliated with, or endorsed by Oracle
Corporation. READ-ONLY: this pack issues no DDL and no DML against your data.
}
```

Sixty-five lines. The prompt ends with the words "Here is the briefing:" and the
document follows it. That whole file is what you paste, and it is the only thing
that leaves your machine, at the moment you choose to send it.

**The lab, part two: check the two refusals rather than believing them.**

Both are ordinary text searches over files you already have. First, look for
anything release-specific, any dictionary view, and any error code in every prompt
that ships:

```bash
cd "$ODC_PACK"
grep -rnoE '19c|21c|23ai|26ai|Oracle Database [0-9]' prompts/ ; echo "release strings: done"
grep -rnoE 'V\$[A-Z_]+|DBA_[A-Z_]+|X\$[A-Z_]+|ORA-[0-9]+' prompts/ ; echo "views and codes: done"
```

Captured output:

```text
release strings: done
views and codes: done
```

Nothing matched either search. Not one release name, not one dictionary view, not
one error code, in any prompt in the pack. If you own the other packs, run the
same two searches across their `prompts/` directories and you get the same result.

Second, confirm that every prompt does carry the refusal about commands:

```bash
for f in prompts/*.md; do
  printf '%-24s %s\n' "$f" "$(grep -icE 'command|SQL to run|statements to run' "$f")"
done
```

```text
prompts/README.md        2
prompts/capacity.md      1
prompts/explain.md       1
prompts/triage.md        1
```

Every file, at least once. The wording differs because the prompts differ:
`capacity.md` says "and no commands", `explain.md` says "I do not need SQL to
run", `triage.md` spells it out in a sentence. The rule is the same one.

**Teardown.**

```bash
rm -rf "$LAB"
```

## Read it wrong

**A prompt is a request, not a constraint.** Nothing in a text file forces an
assistant to obey it. These prompts make the wrong answer less likely and less
tempting; they do not make it impossible. Read what comes back with the same
suspicion you would apply to any other unverified source, and check any Oracle
claim in it against Oracle's documentation before it reaches a decision.

**"No Oracle recitation" is not the same as "no domain vocabulary".** The prompts
carry no release names, no view names and no error codes, which is what the
searches above measure. Two of them do state a structural fact in passing:
`tablespace-capacity.md` in the Daily Operations pack says that a bigfile
tablespace holds exactly one datafile, and that free space inside a datafile is
not automatically reclaimable because the high water mark decides that. Those are
quoted here as what the shipped prompt says. The line these prompts hold is
against **version behaviour**, which rots, rather than against the words of the
trade.

**An assistant will answer confidently over an incomplete briefing unless the
prompt makes room for it not to.** That is why every shipped prompt has a beat
asking what the evidence does not tell you, and why `triage.md` asks the assistant
to say plainly if the collection is incomplete enough that the overall status is
unreliable. If you write your own prompt and leave that beat out, you will get
fluent answers over documents that measured almost nothing, and nothing in the
exchange will look wrong.

**The pack transmits nothing; sending the file is your own act.** The briefing is
written on your machine and stays there. Pasting it into an assistant sends it to
a service under whatever terms you hold with that service, and the briefing
carries a SID, host paths, tablespace names and raw alert log text. The pack
states the residency fact in the document rather than deciding anything for you.
That decision is yours, once per file, knowing what is in it.

**A prompt written for one document kind will mislead over the other.**
`incident-review.md` opens by telling the assistant to check `kind` first, and
describes the incident block. Handing it a `state` briefing produces an answer
about a timeline that is not there. Match the prompt to the `kind`, which is the
field lesson 2 was about.

## Check your work

**One.** The assembled file contains both halves, in order:

```bash
python3 -c "
import sys
text = open(sys.argv[1]).read()
here = text.find('Here is the briefing:')
brace = text.find('{\"')
print('prompt ends at character:', here)
print('document starts at character:', brace)
print('document follows the prompt:', here != -1 and brace > here)
" "$LAB/for_my_assistant.txt"
```

The third line must print `True`. If the document came first, the assistant reads
several kilobytes of JSON before being told what it is.

**Two.** The two searches over `prompts/` return nothing, and you have watched
the search work rather than assuming it did. Prove the search is capable of
matching by running it against something that does contain a view name:

```bash
grep -rnoE 'V\$[A-Z_]+|DBA_[A-Z_]+' "$LAB/lab_collection.txt"
```

That prints one hit, `V$DIAG_INFO`, on line 7 of the collection you wrote. Same
expression, same invocation, a match this time. A search that matches nothing
looks exactly like a search that is broken, so run it once against input you know
it should catch.

## Where this goes next

This lesson makes no claim about Oracle behaviour and cites no Oracle
documentation. Where a shipped prompt states an Oracle fact, it is quoted above
and attributed to the prompt.

Read next, in your own pack: `prompts/README.md`, whose closing section lists the
fields worth building a prompt of your own on, and the `prompts/` directories of
any other pack you hold, which solve the same problem for a different document.

The OraDiscuss Health Check pack, part of the membership, ships the prompts and
the collector used above.
