# ACADEMY MODULE AND LESSON SPEC

**Status:** binding on every agent that writes Academy content. **Written:** 9 August 2026, by the Academy research seat, on branch `academy-modules`.
**Companion file:** `Academy/MODULE-SLATE.md` holds the ranked slate and the demand evidence. This file holds the rules.

**What this file is NOT.** It is not a decision that any module gets written. `SESSION_HANDOFF.md` reserves the choice of the first Academy module to the founder, and both `/roadmap/` and `/academy/` publicly say registrations decide build order. The slate is a recommendation waiting on him.

---

## 0. READ THIS FIRST, IN THIS ORDER

1. `src/content.config.ts`, the two Academy collections. It is the schema, and section 6 below is a transcription of it. If the two ever disagree, **the config wins and this file is stale.**
2. `test/academy.test.js`. Six guards run against the built pages. Three of them will fail a lesson that breaks a house rule, and one of them (section 5.2) will fail a perfectly good lesson for a reason nobody expects.
3. `PRODUCT.md`, the register and the anti-references. The audience is defined there as sceptical of marketing, and the voice words are "a calibration certificate, an instrument panel in a control room, a well-set technical manual from a national lab".
4. `oradiscuss-membership-spec.md` sections 2.1 and 6, the pricing decision and the liability rules.

---

## 1. WHAT A MODULE IS, AND WHY THIS QUESTION HAD TO BE ANSWERED FIRST

Three documents use the word "module" and they did not agree, so this section fixes it.

- The Zod schema nests **course, then `modules[]`, then lessons**. A module is a named string inside a course record, and a lesson names its module.
- The catalog sells "**one new module every quarter**" (membership spec section 2, and the D1 catalog row for `toolkit-academy`).
- The founder's proposal is **20 modules across four tracks**.
- The roadmap seed in `migrations/0002_seed_catalog.sql` holds **three courses**, not twenty.

**THE RULING, and it is the one the scaffold was already built for:**

| Proposal word | Content-model object | File |
|---|---|---|
| **Track** | a **course** | one file in `src/content/academy-courses/<course-slug>.md` |
| **Module** | one entry in that course's `modules[]` array | no file of its own, it is a string |
| **Lesson** | a **lesson** | one file in `src/content/academy/<course-slug>/<lesson-slug>.md` |

Four tracks times five modules is exactly the founder's twenty, and it lands on the schema without inventing a field.

**Why this reading and not "a module is a course".** The comment in `content.config.ts` says the course declares its module order so that "a half written course therefore still renders in the right order", and `src/pages/academy/index.astro` lists a course only once it has at least one published lesson. The scaffold was designed for a course that ships **one module at a time**. If a module were a whole course, the quarterly promise would mean shipping an entire course every quarter from one founder, and the roadmap page would have to grow from three rows to twenty.

**Consequences that must be carried, not discovered later:**

- **A course record may be committed with all five module names declared and only the first module written.** That is the intended state, not a half-finished one. The index will list the course as soon as its first lesson exists, and the course page will show the declared shape.
- **A declared module with no lessons in it renders nothing, and that was checked rather than assumed.** `src/pages/academy/[course]/index.astro` builds its module list and then applies `.filter((m) => m.lessons.length > 0)`, so a course that declares five modules and has written one shows one. The "catalogue of things that do not exist" failure is already closed in code. **Do not add a "modules to come" list to that page**, and if a future edit removes that filter, it reopens the failure `/academy/` was built to avoid.
- **Track D (career edge) has no roadmap course behind it.** The three seeded roadmap courses are `automated-dba`, `rac-performance` and `exadata-oci-migration`. A fourth course needs a D1 migration plus a copy touch on `/roadmap/`. See `MODULE-SLATE.md` section 6.

---

## 2. SIZE: MODULE, LESSON, AND WHAT "ONE LESSON" IS AS A UNIT OF WORK

### 2.1 Module

**Four to six lessons.** Below four it does not stand on its own and is not a quarter's work. Above six it stops being shippable in one quarter by one person, and the quarterly cadence is the thing the membership actually sells.

A module must be **coherent enough to be the only thing a member reads that quarter**. If the module's five lessons only make sense after a module that has not been written, the module is wrongly cut.

### 2.2 Lesson

- **`estimatedMinutes`: 20 to 60.** The schema requires this field and defines it as **working time at a terminal, not reading time**. A lesson that genuinely needs more than 60 minutes at a terminal is two lessons and must be split.
- **Body: roughly 900 to 1,800 words of prose, plus code blocks.** Code blocks do not count toward that. A lesson under 900 words is usually a section of another lesson. A lesson over 1,800 is usually two.
- **One lab per lesson.** Not zero, not three.

### 2.3 What "one lesson" means as a unit of work

**A lesson is the smallest thing that can be published alone.** Concretely, all five of these are true or it is not a lesson:

1. It answers **one question** a working DBA would actually ask, phrased in his words, not in a syllabus's words.
2. It has **one lab** the reader can run on his own machine and **check**, so he can tell whether it worked.
3. It **does not require the next lesson** to make sense.
4. It can be **reviewed and dated on its own**, because `lastReviewed` is per lesson.
5. It can be **thrown away on its own** when a release makes it wrong, without taking a neighbour with it.

Writing agents receive work **one lesson at a time**, and a lesson is done when it satisfies section 8's checklist, not when the prose reads well.

---

## 3. THE LESSON TEMPLATE

### 3.1 The proposal, and what happens to it

The supplied proposal was: concept, why it hurts done by hand, the automated way, terminal walkthrough, lab script, failure modes, further reading.

**Adopted in part, with two beats removed, three added, and one renamed.** The reasoning is below the table because a template nobody understands gets ignored under pressure.

| Proposed beat | Verdict |
|---|---|
| concept | **Kept**, renamed "The mechanism" |
| why it hurts done by hand | **Removed as a standing beat** |
| the automated way | **Removed as a standing beat**, folded into the lab and into part 7 |
| terminal walkthrough | **Kept**, merged with "lab script" |
| lab script | **Merged** into the walkthrough |
| failure modes | **Kept**, widened and renamed "Read it wrong" |
| further reading | **Kept**, narrowed and renamed "Where this goes next" |
| (new) | **What this lesson answers** |
| (new) | **Applicability**, because the schema demands versions and prose must carry them too |
| (new) | **Check your work** |

**Why the two removals.** "Why it hurts done by hand" followed by "the automated way" is a sales beat, and repeating it in every one of twenty modules turns a lab manual into an infomercial. `PRODUCT.md` names "the AI-era SaaS landing page" as an anti-reference and states that the buyer "has seen every vendor promise". A member who has already paid does not need to be sold to on every page; he needs to be taught. The product still appears, twice, in places where it is a fact rather than an argument: **in the lab, when the pack genuinely is the tool being used**, and **in part 7, as one sentence**.

**Why "Check your work" is not optional.** A lab with no falsifiable outcome cannot be got wrong, which means it also cannot be got right. It is the difference between a manual and a demonstration.

### 3.2 The template

Seven parts, in this order. Heading text is fixed so twenty modules read as one product. Parts 1 to 7 all appear in every lesson; a part with nothing to say is a signal the lesson is wrongly cut, not a part to delete.

**1. What this lesson answers**
One short paragraph. The question in the reader's words. No throat-clearing about what the reader will learn.

**2. Applicability**
A short block, before any command. States the releases this lesson was written against, the edition, and **any licensed pack the lesson's tools require** (section 5.5). Where behaviour differs between releases, say which and where. This duplicates `oracleVersions` on purpose: the frontmatter feeds the page furniture, this feeds the reader who is about to type something.

**3. The mechanism**
What Oracle actually does. Name the views, parameters and files by name. This is the part that must be right, and it is the part section 7 governs: **do not recite behaviour you are not certain of.**

**4. At the terminal**
The walkthrough. Commands, the output, and what each column means. Prose between blocks, not a wall of code. Output is real or labelled (section 7.3). Where the module has an OraDiscuss pack behind it, the pack's script is used here **and the underlying SQL is also shown**, because a lesson that cannot be followed without the product is a demo, not a lesson.

**5. Read it wrong**
The failure modes, and, harder and more valuable, the **misreadings**. What does this measurement not prove? What competing explanation produces the same number? This is where the product's "measured versus reading" discipline (RCA pack README, membership spec section 6.2) lives in prose.

**6. Check your work**
How the reader knows the lab did what it claims. A specific observable: a value that changes, a row that appears, a file that exists. If the only way to know is to trust the manual, rewrite the lab.

**7. Where this goes next**
Links to official Oracle documentation, by title and URL, never reproduced in bulk (section 5.9). Then, where one exists, **one sentence** naming the OraDiscuss pack that automates this same collection, factual, no adjectives, no comparison, no price.

---

## 4. LABS: REPRODUCIBILITY, AND WHAT A LAB MAY ASSUME

### 4.1 The lab estate

Every lab runs on **the lab estate**: one Oracle instance the reader is allowed to break, on his own machine or his own VM, that is not production and holds no real data. That phrase is used consistently across all twenty modules so the reader learns it once.

### 4.2 A lab MAY assume

- Oracle Database **19c** or **26ai**, Enterprise Edition, on **Linux x86-64**.
- A **DBA-privileged account** and **SQL\*Plus**.
- A **bash** shell on the database host.
- Permission to create and drop **tablespaces, users, schemas and objects the lesson itself creates**.
- The **sample schemas**, only if the lesson says so and gives the install step or a link to it.
- That the reader can read the **alert log** and the **ADR** home.

### 4.3 A lab MUST NOT assume

- RAC, ASM, Grid Infrastructure, Exadata, a Data Guard standby, or more than one host. A module about those states its own extra requirement in part 2 and in the course `prerequisites`, and it must still describe what a single-instance reader can and cannot do.
- An OCI tenancy, a cloud account, or any credential the reader has to buy.
- **A Diagnostics Pack or Tuning Pack licence.** See 5.5. This is the single most likely way an Academy lesson causes a reader real harm.
- Internet access from the database host.
- My Oracle Support access. MOS is paywalled, so a lesson may not cite a MOS note as evidence for a claim.
- A specific patch level or RU, unless the lesson states it and says how to check.
- **That a previous lesson's objects still exist.** Every lab starts from its own stated starting point.

### 4.4 Reproducible means three blocks, always

1. **Setup.** Gets any reader from the assumptions in 4.2 to this lab's starting state. Copy-pasteable. If setup takes more than about five minutes, that is part of `estimatedMinutes`.
2. **The lab itself.**
3. **Teardown.** Removes what setup created. A lab that leaves a tablespace behind will be run twice by somebody and fail the second time for a reason the lesson never mentions.

Setup and teardown are the only places a lesson may issue DDL or DML, they act only on objects the lesson itself created, and both blocks are labelled as such. **No step in any lesson mutates anything the reader did not make.**

### 4.5 Pack-backed labs

A module is **pack-backed** when its lab uses a script from `packs/` that already ships. Those labs are cheaper to write and safer, because the script is written, tested against hostile fixtures, and shipped. When a lab is pack-backed:

- Name the pack, the file, and the pack version, for example `packs/healthcheck/awr_triage.sh`, v1.0.0.
- Show the underlying SQL too (4.1 of the template's part 4).
- Say plainly that the pack is part of the membership. **Do not say what it costs.**
- The pack is read-only and the lesson repeats that where the reader is about to run it (5.3).

`MODULE-SLATE.md` section 4 lists which candidate modules are pack-backed and which need lab material invented from nothing.

---

## 5. HOUSE RULES. EVERY LESSON, NO EXCEPTIONS

These are numbered so a review can cite one.

**5.1 No em dashes. Anywhere.** Not in prose, not in code blocks, not in HTML or CSS comments, not in a table. Founder rule, and `PRODUCT.md` principle 5. Two guards enforce it: `test/academy.test.js` reads the whole built document, and `test/built-pages.test.js` guards every non-exempt page. **`academy/` is deliberately NOT on the em dash exemption list**, so lessons are guarded from the first one. Use commas, colons, parentheses, or a full stop.

**5.2 No price. Ever. And beware how this one is enforced.** Per-course pricing was raised by the founder and **rejected** (membership spec 2.1). Academy is flat all-access on the membership. No lesson names a price, a discount, a comparison to another vendor's price, or a currency amount of any kind.

**The trap, measured rather than assumed.** `test/academy.test.js` implements this as `/\$\s?\d/` over the rendered body text. The regex was run against representative lab shell on 9 August 2026 and these are the actual results:

| Snippet | Guard |
|---|---|
| `awk '{print $1}'` | **FIRES** |
| `@script.sql $1` | **FIRES** |
| `$ 42` | **FIRES** |
| `${1}` | passes |
| `$ORACLE_HOME`, `$SID` | passes |
| `$ ./health_check.sh` (prompt) | passes |
| `SQL> select 1 from dual;` | passes |

`awk '{print $1}'` is ordinary in DBA shell, so the first real lesson containing one fails the suite for a reason that has nothing to do with prices. **Rules for writers, until the lead rules otherwise:** use named variables, brace positional parameters as `${1}`, and prefer `awk '{print $NF}'` or a named field. **Do not edit the test to get a lesson through.** Registered for the lead in `MODULE-SLATE.md` section 7.

**5.3 The read-only and no-verdicts line applies to anything the reader is told to run.** Where a lesson tells the reader to run a collection, it states that the step is read-only. Where a lesson interprets what came back, it separates **measured** from **reading**, exactly as the RCA pack does, and it does not issue a verdict about the reader's estate. The lesson may say what a number is; it may not say what the reader must do about his.

**5.4 Never tell a reader to paste a command at production.** Not as a shortcut, not "if you are confident", not in a note. Every command in every lesson is addressed to the lab estate. If a technique is only meaningful against production, the lesson describes it and does not instruct it.

**5.5 State version applicability, and state pack licensing.** `oracleVersions` is a **required** array on both collections; the schema refuses a lesson that will not say. The prose says it too (template part 2).

**AWR, ADDM and ASH require the Oracle Diagnostics Pack. SQL Tuning Advisor and SQL Access Advisor require the Oracle Tuning Pack, which itself requires Diagnostics.** These are separately licensed on Enterprise Edition, and the licence is required even when the feature is used only from the command line. Verified 9 August 2026 against Oracle's own 26ai documentation, *Tools for Tuning the Database*, which states: "Some of the products and tools in the preceding list, including Oracle Diagnostics Pack and Oracle Tuning Pack, require separate licenses." (`https://docs.oracle.com/en/database/oracle/oracle-database/26/tdppt/tools-tuning-database.html`)

**Therefore: any lesson that touches AWR, ASH, ADDM, SQL Tuning Advisor or SQL Access Advisor MUST carry the licence statement in part 2, before the first command**, and must offer what the reader can do without those packs (`V$` views, SQL trace, `DBMS_XPLAN`, Statspack where applicable) or say plainly that there is no unlicensed equivalent. A lesson that walks an unlicensed reader into running an AWR report has cost him money and cost us the trust the whole product runs on.

**5.6 Do not recite Oracle behaviour you are not certain of.** If you are not certain, either verify it against the documentation and cite the page, or do not write the sentence. Where behaviour is version-dependent and you have not checked every release named in `oracleVersions`, mark it (section 7.2). **A confident wrong sentence in a lab manual is worse than a gap**, because the reader cannot tell it from the rest.

**5.7 No "coming soon", and no promise of unwritten content.** Guarded by `test/academy.test.js`. A lesson may name a module that exists. It may not tell the reader that something is on its way, because nobody has committed to when.

**5.8 No invented statistics, no scarcity, no countdowns.** `PRODUCT.md` anti-references, and it is absolute. No "most DBAs", no "90% of incidents", no benchmark figure that was not measured and cited.

**5.9 Link Oracle documentation, never reproduce it in bulk.** Same rule the Security Watch runs on (membership spec 6.3). Short quotes with attribution and a URL. Never a translated or lightly reworded copy of a documentation section.

**5.10 The ACE credential is a bio fact, never a product claim** (membership spec 6.5). It does not appear in lesson bodies at all.

**5.11 Never print a count of nothing**, and never advertise a lesson tally. Guarded.

**5.12 One voice.** `PRODUCT.md`: precise, unhurried, load-bearing. No exclamation marks, no "let's", no "simply", no "just", no "obviously". Second person is fine. Humour is not.

---

## 6. FRONTMATTER, TRANSCRIBED FROM `src/content.config.ts`

**Read from the actual Zod schema on 9 August 2026, field for field.** If a field below is not in the config, it is a bug in this document. Astro validates at build time and an unknown field or a missing required one fails the build.

### 6.1 Lesson files: collection `academy`

Path: `src/content/academy/<course-slug>/<lesson-slug>.md` or `.mdx`.

| Field | Type in the schema | Required | Notes from the config |
|---|---|---|---|
| `course` | `reference('academyCourses')` | **yes** | The course slug. A dangling reference does not fail the Astro build by itself, so `[lesson].astro` throws on it explicitly. |
| `module` | `z.string()` | **yes** | **Must match one of the parent course's `modules` entries**, exactly. |
| `order` | `z.number().int().positive()` | **yes** | Position within the module. Explicit because file names sort alphabetically and lesson 10 would land between 1 and 2. |
| `title` | `z.string()` | **yes** | |
| `summary` | `z.string()` | **yes** | Becomes the page meta description. |
| `estimatedMinutes` | `z.number().int().positive()` | **yes** | **Working time at a terminal, not reading time.** Rendered as "N min at the terminal". |
| `prerequisites` | `z.array(z.string())`, default `[]` | no | Plain sentences, not links. Rendered as a "Have this ready" block above the body. |
| `oracleVersions` | `z.array(z.string()).min(1)` | **yes** | At least one. Free text, because real applicability is often "19c RU 19.20 and later", which no enum survives. |
| `lastReviewed` | `z.coerce.date()` | **yes** | Rendered on the page and used as the document `modifiedTime`. Section 7.1 governs what may be written here. |
| `draft` | `z.boolean()`, default `false` | no | A drafted lesson is not built and is not counted by the guards. |

### 6.2 Course files: collection `academyCourses`

Path: `src/content/academy-courses/<course-slug>.md` or `.mdx`. The **file name is the course id** and the URL segment.

| Field | Type in the schema | Required | Notes from the config |
|---|---|---|---|
| `title` | `z.string()` | **yes** | |
| `summary` | `z.string()` | **yes** | Shown on the Academy index card. |
| `modules` | `z.array(z.string()).min(1)` | **yes** | **The modules in teaching order.** Declared once here, not inferred from whichever lessons exist. |
| `oracleVersions` | `z.array(z.string()).min(1)` | **yes** | Which releases the course as a whole was written against. |
| `prerequisites` | `z.array(z.string())`, default `[]` | no | What a reader needs before lesson one. Plain sentences. |
| `lastReviewed` | `z.coerce.date()` | **yes** | Required, not optional: a lab manual aimed at a moving product is only trustworthy if it says when it was last checked. |
| `draft` | `z.boolean()`, default `false` | no | A drafted course is skipped quietly and its lessons with it. That is not an error. |

**There is no price field on either collection, and none may be added.** The config comment says why: it would be "a place for a rejected decision to grow back".

### 6.3 Two mechanical rules the routes enforce, watched failing before they were trusted

1. **The folder must equal the course reference.** `[lesson].astro` throws if a lesson in `src/content/academy/foo/` declares `course: bar`. Put the file in `src/content/academy/<course>/`.
2. **A dangling `course` reference throws.** Measured on Astro 6.1.7: a lesson pointing at a course that does not exist built with exit code 0 and silently produced one page fewer. The route asserts the course exists rather than trusting the reference.

### 6.4 Parking an unfinished lesson

**Prefix the file name with an underscore** (`_draft-lesson.md`). Both loaders' glob patterns exclude `!**/_*`, and that exclusion is load bearing: Astro's glob loader does not skip underscore-prefixed files the way `src/pages` does, and dropping one in without the exclusion failed the build. `draft: true` in the frontmatter is the other route and is the better one for a lesson that is complete but not released.

---

## 7. THE HONESTY RULE

**The plain fact this section exists for: nothing in this Academy has ever been taught to a real student, and no Academy lab has been run against a real estate by this project.** The Showcase seat hit the same wall and solved it by rendering every asset from a synthetic lab collection and saying so in the asset's own pixels. Lessons follow the same discipline.

### 7.1 `lastReviewed` is a measurement, not a formality

`lastReviewed` is **the date somebody checked this lesson against a running release**. It is not the date the file was edited, and it is not today's date because today is when you wrote it. If nothing has been checked, the lesson is not publishable and belongs behind `draft: true` until it is. **Do not set `lastReviewed` to a date on which no check happened.** That single field is what the whole page furniture stakes its trustworthiness on.

### 7.2 A claim you cannot verify gets marked, in the body, in a fixed form

Not omitted, not hedged with adverbs, not quietly softened. Use this shape, adapted to the claim:

> **Not verified on this release.** This is documented for 19c and has not been checked against 26ai for this lesson. Confirm on your own instance before relying on it.

Or, where documentation is the only source:

> **Documented, not observed here.** Oracle's documentation states X. This lesson has not reproduced it. Source: *(title and URL)*.

Two words that must never appear as a substitute for this marker: "typically" and "generally". They are how an unverified claim gets published looking verified.

### 7.3 Terminal output is real or labelled

Any output block is one of exactly two things:

1. **Real output**, captured from an actual run, with the release and edition stated.
2. **A constructed illustration**, labelled in the block itself, for example a comment line reading `constructed example, not captured output`.

**Never invent output that looks captured.** A fabricated AWR excerpt reads as evidence and is a lie in the shape of a fact. Prefer 1. Where only 2 is possible, keep the numbers plainly illustrative rather than plausible.

### 7.4 Sentences no lesson may contain

- "In my experience" or "I have seen this on production estates." The project cannot stand behind that sentence for text written by an agent. The trust line, *"Every script here ran on real production estates by a working DBA before it was published"*, belongs to the **packs** and is the founder's own claim about his own work. **A lesson does not borrow it.**
- Any claim about students, completions, outcomes or results. There are none.
- Any claim about how many members, readers or customers anything has.
- A MOS note number offered as evidence for a claim, when MOS is paywalled and the writer has not read it.
- A bug number that has not been verified.

### 7.5 When the reviewer cannot verify it either

Then it does not ship. A lesson with an unverifiable core mechanism is not a lesson with a caveat; it is a lesson with a hole. Cut the section, or cut the lesson, and say so in the handoff.

---

## 8. THE CHECKLIST A LESSON PASSES BEFORE IT IS DONE

A writing agent asserts each of these explicitly in its handoff. "Looks fine" is not an entry.

1. Frontmatter matches section 6 exactly. Every required field present, `module` matches a declared module string, folder matches the `course` value.
2. `estimatedMinutes` is terminal time and somebody actually estimated it.
3. `lastReviewed` names a date on which a check happened (7.1).
4. All seven template parts present, in order, with the fixed headings (3.2).
5. Part 2 states versions, edition, and any pack licence requirement (5.5).
6. Setup, lab and teardown all present, and teardown removes what setup created (4.4).
7. "Check your work" gives a specific observable, not an instruction to trust the manual.
8. No em dash anywhere in the file. Grep for it; do not trust your eye.
9. No `$` followed by a digit anywhere in a displayed block (5.2), and no currency amount.
10. No command addressed at production (5.4).
11. Every unverified claim carries the marker in 7.2, and every output block is real or labelled (7.3).
12. No sentence from 7.4.
13. Oracle documentation is linked, not reproduced (5.9).
14. `npm run build` passes, then the Academy guards pass. **Do not report done on a build you did not run.**

---

## 9. WHAT THIS SPEC DOES NOT DECIDE

Registered so nobody assumes silence is permission.

- **Which module is written first.** The founder's, reserved in `SESSION_HANDOFF.md`. `MODULE-SLATE.md` recommends; it does not choose.
- **Whether `/academy/` is gated.** See `MODULE-SLATE.md` section 8. Academy is the paid tier and the routes currently render publicly to everyone.
- **Whether the `$`-then-digit price guard is refined** (5.2). Until it is, writers work around it.
- **Whether a fourth roadmap course is added for Track D** (section 1, and `MODULE-SLATE.md` section 6).
