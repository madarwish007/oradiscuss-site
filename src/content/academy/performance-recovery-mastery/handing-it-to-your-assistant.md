---
course: performance-recovery-mastery
module: "Performance evidence: from 'the database is slow' to a ranked set of cited facts"
order: 5
title: Handing it to your assistant, and checking what comes back
summary: Assemble the prompt and the briefing into one handoff, then read the answer against the file rather than against how confident it sounds. The checks are arithmetic, not judgement.
estimatedMinutes: 30
prerequisites:
  - A machine with bash and grep. No database is contacted.
  - The OraDiscuss DBA Health Check Automation Pack v1.0.0, unpacked somewhere you can read and copy files.
  - An assistant you already use, if you want to do the second half. The lab and its checks work without one.
oracleVersions:
  - 19c
  - 26ai
lastReviewed: 2026-08-09
draft: false
---

## What this lesson answers

I have a briefing and I have an assistant. How do I ask so the answer stays inside the evidence, and how do I check what comes back rather than trusting it?

## Applicability

Written against the OraDiscuss DBA Health Check Automation Pack **v1.0.0**, and against briefings produced from Oracle Database **19c** and **Oracle AI Database 26ai** collections. The file assembly and every check below are ordinary text work and do not depend on the Oracle release.

**Licence requirement.** Nothing here reads a database. The collection that produced the briefing does, and lesson 1 has the licence position for that. Moving a file around does not change what it took to produce.

**One thing this lesson deliberately does not claim.** It makes **no claim about what any particular assistant will answer.** Model behaviour is not documented, not versioned, and not reproducible in the way a view definition is. So the lab produces the handoff and the ground truth to check an answer against, and the checking is arithmetic you can do yourself.

**What was checked, and what was not.** The assembly, the line counts and the ground truth figures below were run on 9 August 2026, GNU bash 3.2.57, pack v1.0.0, on a machine with no Oracle home, against the pack's own synthetic fixture. **Its numbers are not a measurement of any database.** **No statement here has been run against a running Oracle instance by this project, and no assistant's output is reproduced anywhere on this page.**

## The mechanism

A screenshot of a report gives an assistant pixels. A briefing gives it a document with stable ids, a status per finding, a separate count of what could not be determined, and units on the numbers. The difference shows up when you check the answer: with ids, every claim in the reply can be traced back to a line in the file, and a claim that cannot be traced is visible immediately.

The pack ships prompts beside the collectors, and `prompts/triage.md` is the one for this collection. It asks for three things, in a deliberate order:

1. **What needs attention, ranked**, worked from `summary.needs_attention` but ranked by consequence rather than by collection order.
2. **What the evidence does not tell you**, worked from `summary.counts.NA`, with the instruction that every NA "is a check that could not be determined, not a check that passed".
3. **What to look at next, and why**, as questions and observations.

That third one carries the line that matters most, and it is the product's liability position written into a prompt:

> Do not give me statements to run against this database. I decide what runs on my estate, and I need your reasoning, not your SQL.

The prompt also asks for something rarer than a diagnosis: "The evidence does not distinguish between X and Y, and here is what would" is named in the file as a better answer than a confident guess.

### The residency decision is yours and it is not automatic

The briefing carries a sentence about itself: it was written on the machine that ran the collector, and OraDiscuss never receives it. That is a fact about the pack. It is not a fact about what happens next. If you paste the file into a hosted assistant, the file goes to that assistant's operator, and whether that is allowed is a question about your employer's rules and your estate's data, not about this tool.

Two things follow, and neither is a recommendation. Read the file before you send it, because you are the only person who knows what your `sql_id` texts and instance names reveal. And know that the same handoff works with an assistant running on your own machine, where the question does not arise.

## At the terminal

**Setup.** Produce a briefing, from its own replay, so this lab does not depend on any earlier lesson.

```bash
export PACK_DIR="${HOME}/oradiscuss-healthcheck/packs/healthcheck"   # wherever you unpacked it
export LAB="${HOME}/od-lab-b1"
mkdir -p "${LAB}/out"
sed 's|^OUTPUT_DIR=.*|OUTPUT_DIR="'"${LAB}"'/out"|' "${PACK_DIR}/config.env" > "${LAB}/config.env"
cp "${PACK_DIR}/test-fixtures/awr_raw_hostile.txt" "${LAB}/awr_raw_LAB_001.txt"
cd "${PACK_DIR}"
./awr_triage.sh --config "${LAB}/config.env" --render-only "${LAB}/awr_raw_LAB_001.txt"
export BRIEF="${LAB}/out/reports/awr_triage_LAB_001.json"
```

**The lab, part one.** Assemble the handoff. The prompt ends with the words "Here is the briefing:", so concatenation in that order produces a single coherent document.

```bash
cat "${PACK_DIR}/prompts/triage.md" "${BRIEF}" > "${LAB}/handoff.txt"
wc -l < "${LAB}/handoff.txt"
grep -n -A 2 'Here is the briefing' "${LAB}/handoff.txt"
```

```text
# captured 2026-08-09, GNU bash 3.2.57, pack v1.0.0, synthetic fixture input
      65
34:Here is the briefing:
35-{
36-  "schema_version": "1.1",
```

Sixty-five lines, and the document opens on the line after the prompt's last sentence. Read the whole thing once before it goes anywhere.

**The lab, part two.** Build the ground truth you will check an answer against. Do this **before** you read any answer, because a number you have already seen asserted is a number you will find reasons to accept.

```bash
echo "checks:      $(grep -o '"id":"' "${BRIEF}" | wc -l | tr -d ' ')"
echo "NA:          $(grep -o '"status":"NA"' "${BRIEF}" | wc -l | tr -d ' ')"
echo "WARN+CRIT:   $(grep -oE '"status":"(WARN|CRIT)"' "${BRIEF}" | wc -l | tr -d ' ')"
echo "null values: $(grep -o '"value":null' "${BRIEF}" | wc -l | tr -d ' ')"
```

```text
# captured 2026-08-09, same run, synthetic fixture input
checks:      9
NA:          8
WARN+CRIT:   0
null values: 1
```

**The lab, part three.** If you have an assistant to hand, give it `handoff.txt` and then apply these four checks to whatever comes back. Each one is decidable by looking at the file, without knowing anything about Oracle.

1. **Does it name a `WARN` or a `CRIT`?** There are none. Any such claim is false about this file.
2. **Is every number it quotes findable in the file?** Copy one into `grep` and look. A number that is not there was not measured.
3. **Does it name the eight undetermined checks, or does it pass over them?** The prompt asked for them by name. Silence about the NA count is the failure this document exists to make visible.
4. **Did it hand you statements to run?** The prompt asked it not to. Whatever it hands you, running anything is your decision and belongs on your lab estate first.

**Teardown.**

```bash
rm -rf "${HOME}/od-lab-b1"
```

The handoff file goes with it. If you sent a copy somewhere, deleting your local copy does not recall it, which is a good reason to have read it first.

## Read it wrong

**Fluency is not grounding.** A well-organised answer with the right vocabulary and a number that is not in the file is worse than a clumsy one that cites ids, because it is harder to catch. Check ids are the cheapest test there is.

**A threshold that appears in the answer did not come from the collection.** The efficiency ratios are carried with no threshold on purpose, so any sentence of the form "this ratio is healthy" is a judgement introduced somewhere between the file and you. It may still be a reasonable judgement. It is not evidence, and it should not be repeated to anybody else as though it were.

**An assistant cannot tell an empty collection from a quiet estate unless you make it look.** That is the whole reason `counts.NA` exists as its own field, and it is why the prompt asks for the NA list as a numbered section rather than as an afterthought.

**The briefing describes one window.** Every limit from lesson 2 is still in force after the file changes hands. An answer that generalises from a four hour window to "your database" has left the evidence, and nothing in the document stopped it.

**Sending the file is an action with consequences, and it is not undone by a teardown.** The lab uses a synthetic fixture precisely so this lesson can be worked through without that decision being forced.

## Check your work

1. `wc -l < "${LAB}/handoff.txt"` prints **65**.
2. `grep -n 'Here is the briefing' "${LAB}/handoff.txt"` reports line **34**, and line 35 is the opening brace. If the brace is not on 35, the two files were concatenated in the wrong order and the assistant would meet the evidence before the instructions.
3. The ground truth block prints `9`, `8`, `0`, `1`. Nine checks, eight of them undetermined, nothing at `WARN` or above, and one measurement that arrived in a form the document could not hold.
4. `grep -c 'Do not give me statements to run' "${PACK_DIR}/prompts/triage.md"` returns 1. The instruction is in the prompt you are about to send, not only in this lesson.
5. Applied to any answer you receive, check 1 in the lab is decidable in one `grep`. If you cannot decide it, you do not have the file open, and having the file open is the point.

## Where this goes next

- *Oracle Database Licensing Information User Manual, 26ai*, `https://docs.oracle.com/en/database/oracle/oracle-database/26/dblic/Licensing-Information.html`. Moving evidence between tools does not change what its collection required
- *Get Started with Performance Tuning, 26ai: Tools for Tuning the Database*, `https://docs.oracle.com/en/database/oracle/oracle-database/26/tdppt/tools-tuning-database.html`
- Inside the pack, `prompts/README.md` explains how the prompts are meant to be used, and `schema/briefing.schema.json` is the contract the document is written to

The OraDiscuss DBA Health Check Automation Pack ships `prompts/triage.md` and the briefing schema used above, and it is part of the membership.
