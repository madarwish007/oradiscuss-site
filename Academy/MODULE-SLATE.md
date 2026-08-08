# ACADEMY MODULE SLATE

**Written:** 9 August 2026, Academy research seat, branch `academy-modules`. **Companion:** `Academy/MODULE-SPEC.md` holds the writing rules.

**THIS IS A RECOMMENDATION, NOT A DECISION.** `SESSION_HANDOFF.md` item 5 reserves the choice of the first Academy module to the founder, and `/roadmap/` and `/academy/` both publicly state that registrations decide build order. Nothing here may be treated as that decision being taken.

---

## 0. FIRST, THE THING THAT WOULD OTHERWISE BE INVISIBLE

**The founder's supplied 20-module proposal is not on disk anywhere this seat can see.** Searched: the whole of `/Users/mahmouddarwish/Working_Area`, the `od-acad` worktree, and `~/Downloads`, for the four track names and for "20 module". Zero hits. `SESSION_HANDOFF.md` and `SESSION_LOG.md` mention Academy module 1 as an open founder decision and never list candidate modules. The only surviving roadmap record is the three-course D1 seed in `migrations/0002_seed_catalog.sql`.

**Consequence, stated plainly rather than papered over:** this slate is a **fresh twenty built under the four track headings supplied in the brief**, not a line-by-line revision of his rows. Individual claims in his table therefore **could not be checked**, because the table was not available to check. Where the brief quoted his content (the four track names, the Track B topic list of performance tuning, backup and recovery, multitenant, RAC and Data Guard, and the lesson template) those quoted items ARE assessed, in sections 5 and 7 and in `MODULE-SPEC.md` section 3.1.

**If he still has the document, one re-read of it would close this gap.** Rows in it that this slate does not contain are not rejected; they are unseen.

---

## 1. THE EVIDENCE. EVERY CLAIM WITH ITS SOURCE AND ITS DATE

Retrieval date is 9 August 2026 unless stated. Anything not verified says so.

### 1.1 Oracle's own certification material

| # | Claim | Source | Confidence |
|---|---|---|---|
| E1 | The 19c OCP path is exams **1Z0-082 and 1Z0-083**, and Oracle's published topic list for them carries **NO percentage weightings at all**. Counted: the string `%` appears three times in the whole document and all three are a *Certification Magazine* salary survey, not an exam weight. | Oracle-hosted PDF, *Oracle Database Administration I and II, Certification Overview and Sample Questions*, `https://www.oracle.com/a/ocom/docs/dc/ww-ou-5297-database2019-studyguide-5.pdf`, 19 pages, downloaded and text-extracted 9 Aug 2026 | **High.** Primary, Oracle-hosted, read in full |
| E2 | On **1Z0-083**, topics are grouped by source course. Counting topic groups: **Managing Multitenant Architecture 8, Backup and Recovery Workshop 10, Deploy Patch and Upgrade 8, 19c New Features 3, and performance 2** ("Monitoring and Tuning Database Performance", "Tuning SQL Statements"). Backup and recovery plus multitenant are **18 of about 31** topic groups. Performance is **2 of about 31**. | Same PDF, pages 8 to 12 | **High** for the topic lists. **Medium** for my group count, which is my arithmetic over Oracle's headings, not an Oracle figure |
| E3 | **RAC and Data Guard are NOT on the core OCP exam.** They are separate specialist exams: **1Z0-078** (19c RAC, ASM and Grid Infrastructure) and **1Z0-076** (19c Data Guard Administration). The only availability items on 1Z0-083 are "Use an RMAN recovery catalog" and "Use Flashback Database". | Topic lists in the PDF above (absence), plus Oracle exam pages for 1Z0-078 and 1Z0-076 surfaced in search on `education.oracle.com` | **High** for the absence from 1Z0-083. **Medium** for the exam numbers, which came from search result titles because the pages themselves would not load (E6) |
| E4 | Current exam **1Z0-183, "Oracle AI Database Administration Professional"**: proctored online, multiple choice, **120 minutes, 65 questions, 60% to pass**. Its overview names, in this order, "multitenant architecture (CDBs/PDBs), RMAN backup and recovery, SQL performance tuning, and implementing new features such as Lock-Free Reservations, True Cache, and Blockchain Tables". | Oracle MyLearn, read in a real browser 9 Aug 2026, `https://mylearn.oracle.com/ou/exam/oracle-database-23ai-administration-professional-1z0-183/105037/149508/246090` | **High.** Oracle's own live page |
| E5 | Current exam **1Z0-182, "Oracle AI Database Administration Associate"**: **120 minutes, 60 questions, 65% to pass**. | Oracle MyLearn, read in a real browser 9 Aug 2026, `https://mylearn.oracle.com/ou/exam/oracle-database-23ai-administration-associate-1z0-182/38560/138639/219333` | **High** |
| E6 | **Oracle's exam-topic pages could not be read at all on 9 Aug 2026.** `education.oracle.com` returned "Our website is currently down for maintenance" to a fetch tool, to `curl` with a browser user agent, to a text-rendering proxy, **and to a real Chrome browser**. On MyLearn, the "Review exam topics" accordion expanded to nothing. | Four independent retrieval routes, all 9 Aug 2026 | **High.** This is a measured absence, not a guess |
| E7 | **A widely repeated third-party weighting for 1Z0-183 (Performance 25%, Multitenant 20%, Backup and Recovery 20%, New Features 20%, Deploy/Patch/Upgrade 15%) is UNVERIFIED.** It appears in exam-prep search results. It could not be confirmed against Oracle because of E6. | Search result summaries, prep and dumps sites | **UNVERIFIED. Do not print this anywhere customer-facing.** |
| E8 | **The prep-site ecosystem is demonstrably unreliable, proven by a direct contradiction.** A prep source states 1Z0-182 is "90 minutes, approximately 55 questions, 68% to pass". Oracle's own page says **120 minutes, 60 questions, 65%** (E5). Three of three figures wrong. | E5 versus search result summary, both 9 Aug 2026 | **High** |

### 1.2 Oracle product lifecycle, and a naming fact with real consequences

| # | Claim | Source | Confidence |
|---|---|---|---|
| E9 | **Oracle Database 19c is supported far longer than most people assume: Premier Support ends December 2029, Extended Support December 2032**, and it is a Long Term Support Release with GA April 2019. | Oracle Lifetime Support Policy chart, `https://www.oracle.com/assets/lsp-tech-chart-069290.pdf`, **effective date 7 August 2026**, downloaded and text-extracted 9 Aug 2026 | **High.** Primary, Oracle-hosted, two days old at retrieval |
| E10 | **The string "23ai" appears ZERO times in that chart.** The current release row reads **"26ai Enterprise Edition (Long Term Support Release), GA Oct 2025, Premier Support ends Dec 2031, Extended TBD"**. | Same PDF, counted programmatically | **High** |
| E11 | **Oracle AI Database 26ai replaces Oracle Database 23ai.** Moving from 23ai to 26ai is applying the October 2025 Release Update, with no database upgrade and no application re-certification. On-premises Linux x86-64 GA came with the January 2026 quarterly Release Update, version 23.26.1. | `https://blogs.oracle.com/database/oracle-announces-oracle-ai-database-26ai` and `https://blogs.oracle.com/database/ga-of-oracle-ai-database-26ai-for-linux-x86-64-on-premises-platforms`, both surfaced in search 9 Aug 2026 | **Medium-High.** Oracle's own blog, read through search result extraction rather than a direct page fetch |
| E12 | **AWR, ADDM and ASH require the Oracle Diagnostics Pack. SQL Tuning Advisor and SQL Access Advisor require the Oracle Tuning Pack.** Both are separately licensed. Quoted: "Some of the products and tools in the preceding list, including Oracle Diagnostics Pack and Oracle Tuning Pack, require separate licenses." | Oracle documentation, 26ai, *Tools for Tuning the Database*, `https://docs.oracle.com/en/database/oracle/oracle-database/26/tdppt/tools-tuning-database.html`, fetched 9 Aug 2026 | **High.** Primary |

**Why E9 to E11 change what gets written.** `PRODUCT.md` already says the audience runs "19c through 26ai", so the project is not wrong. But any module or lesson that writes **"23ai"** is using a **product name Oracle has retired**, and it will read as out of date to exactly the reader we are selling to. **`oracleVersions` should be `["19c", "26ai"]`.** And 19c is not a legacy bet: with Premier Support to December 2029, a 19c-first lab manual has more than three years of primary relevance.

### 1.3 What the course marketplaces actually rank

Collected by a dedicated research agent on 9 Aug 2026. Every figure below was read on a page in that session. Udemy, Coursera, LinkedIn Learning and Pluralsight all refuse direct fetches, so the working route was a server-side text-rendering proxy.

| # | Claim | Figure | Source | Confidence |
|---|---|---|---|---|
| E13 | The **largest single Oracle specialist course found anywhere** is a performance tuning course, and it is **developer-facing SQL tuning** | *Oracle SQL Performance Tuning Masterclass (2026)*: **57,209 students**, 9,826 ratings, 4.7, badged Bestseller **and** Highest Rated, updated 1/2026 | `udemy.com/course/sql-performance-tuning-masterclass/` | **High** |
| E14 | The largest **generalist** Oracle DBA course is smaller than that, and is years out of date | *Oracle DBA 11g/12c Database Administration for Junior DBA*: **45,189 students**, updated 5/2022 | `udemy.com/course/oracledbatraining/` | **High** |
| E15 | A current generalist DBA course sits far below both | *Complete Oracle Database Administration course (19C,21C)*: **22,322 students**, Bestseller, updated 2/2026 | `udemy.com/course/oracle-database-course/` | **High** |
| E16 | **Within a controlled comparison** (one instructor, one course per topic, same audience and marketing held constant), DBA-facing performance tuning is **third**, behind RAC and Data Guard | RAC **3,923** > Data Guard **3,316** > **Performance Tuning 2,809** > Multitenant **2,461** > RMAN **2,190** > Cloud for DBAs **1,230** > Zero Downtime Migration **543** > 23ai New Features **156** | Ahmed Baraka's Udemy catalogue, nine course pages read individually | **High** for the figures. **Medium** for the inference, see the confound below |
| E17 | Cross-instructor rating counts point the same way for high availability | RAC (TISYA) **2,467 ratings**, Data Guard (Arun Kumar) **2,030 ratings**, both larger than any DBA-side tuning course found | Udemy topic pages `/topic/oracle-rac/` and `/topic/oracle-data-guard/` | **Medium-High.** Read on search cards, student counts not shown there |
| E18 | **The newest Oracle release is almost untaught.** | *Mastering Oracle Database 23ai New Features*: **156 students**, 22 ratings, updated 5/2026 | `udemy.com/course/oracle-23ai-new-features/` | **High** |
| E19 | Coursera's largest Oracle listing is entry level, and its unit is not comparable to Udemy's | *Oracle Database Foundations*: **32,304 already enrolled** | `coursera.org/learn/introduction-to-oracle-sql` | **High** |
| E20 | **Class Central data could not be obtained at all.** 403 to fetch, 403 to curl, Cloudflare CAPTCHA through the proxy. **Zero figures.** LinkedIn Learning **publishes no viewer count on the page**; a search snippet asserting 42,633 viewers was **not read on a page and is unverified**. Pluralsight **publishes no enrolment figure at all**, which is a platform property, not a fetch failure. | Measured absences | **High** |

**The confounds, stated because they change how much weight E16 can carry.** Cumulative student counts confound with **time on market**: Baraka's RAC and Data Guard courses are 12c-era catalogue items while ZDM (543) and 23ai (156) launched recently, so part of the RAC-over-tuning gap measures years of accumulation rather than current appetite. Cross-platform figures are **not the same unit**: Coursera's "already enrolled" includes free auditors and Udemy's "students" includes free coupons and bundles, so 32,304 and 57,209 must never be ranked against each other. And Udemy search-result totals (Data Guard 10,000, performance tuning 7,666, RMAN 5,319) are **supply**, not demand, and cluster suspiciously around 4,3xx for three unrelated topics, which shows the keyword matching is diluted. **They were not used to rank anything here.**

### 1.4 What job postings ask for

**Status at the time this file was committed: a dedicated research agent was still running.** Findings arrive in section 9, which is appended rather than assumed. **Nothing in the ranking below rests on job-posting evidence**, precisely so that a late or thin result cannot invalidate it.

---

## 2. THE SINGLE MOST IMPORTANT FINDING, AND IT COMPLICATES THE FOUNDER'S INSTINCT RATHER THAN CONFIRMING IT

He said the answer is "most probably related to DB / AI / Performance Tuning". The evidence says **yes to performance tuning, and then splits it in half**.

**There are two different products both called performance tuning**, and they have wildly different demand:

- **Developer-facing SQL and query optimisation.** Reading plans, indexes, rewriting statements. This is where the mass demand is: **57,209 students on one course** (E13), larger than the biggest generalist DBA course and roughly twenty times the DBA-side tuning course by the same measure.
- **DBA-facing instance tuning.** AWR, ASH, wait events, memory, the whole-database view. In a controlled comparison this is **third**, behind RAC and Data Guard (E16).

**Conflating the two inverts the conclusion.** A slate that writes "performance tuning is the top demand" and then builds an AWR module has used the demand of one thing to justify building another.

**And the highest-demand topic is also the least defensible.** A generic SQL tuning course is precisely what a heavily discounted marketplace bestseller already is, with a Bestseller badge, a Highest Rated badge and 9,826 ratings. This product cannot win a price fight there and must not try.

**The resolution, and it is the trade-off rule this whole slate runs on:**

> **Demand decides the SUBJECT. Defensibility decides the ANGLE. Cross-sell decides the ORDER.**

- **Demand** tells us what the module is about. It is the only one of the three forces that comes from outside the building, so it gets the first word.
- **Defensibility** tells us what we say about that subject that a marketplace course structurally cannot say. For this product that is always the same thing: **the reader's own estate, read-only, evidence separated from interpretation, no verdict issued, and the output handed to his own AI.** A $12.99 course teaches you to tune a toy schema; it cannot teach you to read yours, because it has no collector.
- **Cross-sell decides the order**, and only the order, because it is the only one of the three that changes what a module **COSTS**. At one module per quarter, cost is the binding constraint. A module whose labs are already written, already tested against hostile fixtures and already shipped is worth writing before an equally good module whose labs must be invented and then verified against a real estate that this project has never run against.

---

## 3. THE FOUR COURSES

Track becomes course, module becomes an entry in that course's `modules[]`, per `MODULE-SPEC.md` section 1. Four courses times five modules is the founder's twenty.

| Track | Course | Roadmap slug in D1 | Status |
|---|---|---|---|
| A, automation and AI | The Automated DBA | `automated-dba` | seeded, title matches |
| B, core DBA mastery | Performance and Recovery Mastery | `rac-performance` | **seeded as "RAC and Performance Mastery", which does not match this scope.** See section 6 |
| C, cloud and modernisation | Cloud and Modernisation | `exadata-oci-migration` | seeded as "Exadata and OCI Migration Playbook", close enough |
| D, career edge | The DBA's Career Edge | **none** | **no roadmap row exists.** See section 6 |

---

## 4. THE RANKED TWENTY, WITH PACK BACKING STATED FOR EVERY ONE

**Pack-backed** means the lab runs a script that already ships in `packs/`, tested, at v1.0.0. **Partial** means a pack collects the raw material but the teaching lab still has to be built. **None** means the lab is invented from nothing.

**Audit and Governance is deliberately absent from the backing column.** It is being built right now by a sibling agent and **is not shipped**, so no module may be counted as backed by it today.

### Course A: The Automated DBA (Track A)

| Rank | Module | Backing | Files behind the lab |
|---|---|---|---|
| **2** | **A1. Incident reconstruction: evidence, timeline, and the explanations that compete** | **Pack-backed** | `packs/rca/rca_generator.sh`, `sql/rca_alertlog.sql`, `sql/rca_awr_evidence.sql`, `prompts/incident-review.md` |
| **5** | **A2. Handing it to your own AI: the briefing, its schema, and prompts that do not invent** | **Pack-backed** | `lib/odc_briefing.sh` (in all four packs), `schema/briefing.schema.json`, every `prompts/*.md` |
| 7 | A3. The morning briefing, and an operating rhythm that survives a bad week | **Pack-backed** | `packs/daily-ops/daily_analysis.sh`, `sql/daily_analysis.sql`, `prompts/morning-triage.md` |
| 8 | A4. Capacity you can defend: headroom, growth, and what is recoverable rather than purchasable | **Pack-backed** | `packs/healthcheck/tablespace_monitor.sh`, `sql/tablespace_projection.sql`, `packs/daily-ops/tbs_manager.sh`, `prompts/tablespace-capacity.md` |
| 11 | A5. Knowing the estate before you touch it: host, cluster and home discovery | **Pack-backed** | `packs/daily-ops/env_collector.sh`, `packs/healthcheck/orchestrate.sh` |

**Course A is entirely pack-backed.** That is not a coincidence and it is the single strongest structural fact on this page: the four shipped packs ARE an automation curriculum that has already been written and tested.

### Course B: Performance and Recovery Mastery (Track B)

| Rank | Module | Backing | Files behind the lab |
|---|---|---|---|
| **1** | **B1. Performance evidence: from "the database is slow" to a ranked set of cited facts** | **Pack-backed** | `packs/healthcheck/awr_triage.sh`, `sql/awr_triage.sql`, `sql/awr_triage_collect.sql`, `prompts/triage.md` |
| **3** | **B2. Execution plans, and making a good plan stay** | **None** | invented from nothing |
| **4** | **B3. Backup and recovery you have actually rehearsed** | **None** | invented from nothing. `daily_analysis` reads backup *recency* only, which is not a restore drill |
| 6 | B4. Optimizer statistics: what is stale, what is wrong, and what to leave alone | Partial | `daily_analysis.sql` reports stale stats; the teaching labs are new |
| 9 | B5. Multitenant operations: CDB, PDB, and what only bites inside a container | **None** | invented from nothing |

### Course C: Cloud and Modernisation (Track C)

| Rank | Module | Backing | Notes |
|---|---|---|---|
| 10 | C1. Data Guard you have failed over on purpose | **None** | needs two hosts, which breaks the single-instance lab assumption. See section 7 |
| 12 | C2. RAC and Grid Infrastructure: what changes when there are two of everything | Partial | `healthcheck` is genuinely RAC-aware and `env_collector` reaches other nodes; the teaching is new, and the lab needs a cluster |
| 13 | C3. Upgrades and patching, with a rollback you have tested | **None** | |
| 14 | C4. Moving to OCI: the decisions the official guides leave out | **None** | |
| 17 | C5. Exadata for the DBA who does not have one | **None** | unlabbable by design, see section 7 |

### Course D: The DBA's Career Edge (Track D)

| Rank | Module | Backing | Notes |
|---|---|---|---|
| 15 | D1. Writing the incident report your manager forwards | **Pack-backed** | the RCA report is the artifact; overlaps A1 and must be cut against it |
| 16 | D2. Working with an AI without leaking your estate | Partial | overlaps A2 heavily; consider merging rather than writing both |
| 18 | D3. Certification, honestly: what the current Oracle path is and is not | **None** | high truth value, low labbability. E1 to E8 are most of its research already |
| 19 | D4. The interview, the estate walkthrough, and the questions that reveal a real DBA | **None** | |
| 20 | D5. Visibility: writing, community, and the ACE track | **None** | **liability watch:** membership spec 6.5 makes ACE a bio fact and never a product claim, so this module is the easiest place on the whole slate to break that rule |

---

## 5. THE FIRST FIVE, RANKED, WITH REASONING AND COST

Writing order is the rank. Each is one module of four to six lessons.

### 1. B1. Performance evidence: from "the database is slow" to a ranked set of cited facts

**Course:** Performance and Recovery Mastery. **Backing: pack-backed** (`awr_triage.sh` and its two SQL collectors, plus `prompts/triage.md`).

**Why first.** The founder named performance tuning, and the evidence supports the subject even after section 2 splits it: performance is one of the four things Oracle's own current OCP overview names (E4), and performance tuning is the single largest Oracle specialist course on the market (E13). The angle is what makes it ours rather than a commodity: this module does not teach a reader to tune a demo schema, it teaches him to **produce evidence about his own database and to know what the evidence does not prove**. That is the product's thesis, and it is unavailable to any course without a collector.

**It also carries the licence discipline that most marketplace courses skip.** AWR and ASH require the Diagnostics Pack (E12). A module that states that before the first command, and shows the unlicensed path as well, reads as written by somebody who has been audited. That is credibility no discount can buy.

**Cost: LOW to MEDIUM.** Roughly five lessons. The collection, its hostile-input fixtures and both outputs already exist and are tested, so the writing agent explains rather than invents. The verification burden is real but bounded: the claims are about views and about what the pack already does.

### 2. A1. Incident reconstruction: evidence, timeline, and the explanations that compete

**Course:** The Automated DBA. **Backing: pack-backed** (`rca_generator.sh`, both SQL collectors, `prompts/incident-review.md`).

**Why second.** This is the **most defensible module on the entire slate**, and defensibility is worth more per hour written than demand at this stage. Nothing in the marketplace teaches "collect the evidence, reconstruct the timeline, rank the ordering facts, separate what you measured from what you are reading into it, and issue no verdict". That is not a topic choice, it is a professional stance, and it is the stance the RCA pack was built to embody (`packs/rca/README.md`, and membership spec 6.2). A course that teaches it teaches judgement, which is the thing a discounted course cannot ship.

Second rather than first because a reader arrives wanting the thing he came for. B1 answers his question. A1 changes how he works.

**Cost: LOW to MEDIUM.** Roughly five lessons. RCA is at v1.0 with its own briefing `kind`, `--dry-run` and `--render-only`, so labs can be rerun from a captured collection without a live incident. **That `--render-only` path is what makes this module reproducible on a reader's laptop at all**, and it is the reason this module is cheap while its subject is not.

### 3. B2. Execution plans, and making a good plan stay

**Course:** Performance and Recovery Mastery. **Backing: NONE. Every lab invented from nothing.**

**Why third, despite being the expensive one.** This is where the mass demand actually lives (E13, and section 2). More importantly, **without it the founder's named topic is only half delivered**: B1 answers "what is slow" and never answers "why this statement, and how do I stop the plan flipping back". A performance course that stops at AWR is a monitoring course.

**Why not first, even though demand is highest.** Section 2. Generic plan reading is the most price-shopped subject in the whole catalogue and we would be entering it with no reputation, no reviews and no discount. It works here because it arrives **after** two modules have established the house method, so it inherits their credibility instead of competing bare.

**Cost: HIGH, and the highest verification risk on the slate.** Roughly five to six lessons, all lab material designed from scratch: a synthetic schema, plans that genuinely change, and baselines that genuinely hold. It is also the module most likely to contain a confidently wrong sentence about optimizer behaviour, which is exactly what `MODULE-SPEC.md` sections 5.6 and 7.2 exist for. **Note the licence trap: SQL Tuning Advisor needs the Tuning Pack (E12), so the unlicensed spine must be `DBMS_XPLAN`, SQL trace and `DBMS_SPM` baselines.**

### 4. B3. Backup and recovery you have actually rehearsed

**Course:** Performance and Recovery Mastery. **Backing: NONE.** `daily_analysis` reads backup and archivelog **recency**, which is a monitoring fact and not a restore drill.

**Why fourth.** The certification evidence is the least ambiguous thing in this whole file: **backup and recovery is the single largest block of the OCP exam** (E2), and Oracle's own current professional-exam overview names RMAN backup and recovery second of four (E4). It is also the topic where the gap between what a DBA can describe and what he has actually done is widest, and that gap is a teachable product.

**The angle that makes it defensible:** not RMAN syntax, which is documented to death, but **rehearsal and proof**. Restore it, prove it, time it, and write down what you now know. "Check your work" is trivially falsifiable here, which is rare and valuable.

**Cost: MEDIUM to HIGH.** Roughly five lessons, labs invented, but the labs are the most mechanically reproducible on the slate: back up, break something the lesson itself created, restore, verify. Reproducibility is nearly free here, and that is why it outranks the modules below it despite having no pack behind it.

### 5. A2. Handing it to your own AI: the briefing, its schema, and prompts that do not invent

**Course:** The Automated DBA. **Backing: pack-backed** by `lib/odc_briefing.sh`, `schema/briefing.schema.json` and every `prompts/*.md` in all four packs.

**Why in the five.** It is the founder's "DB / AI" instinct, it is the positioning line itself ("Your scripts collect. Your AI reasons. Your data never leaves."), and it is the **only module on the slate that literally cannot be copied**, because it teaches an artifact nobody else ships. It is also the module that teaches the product most directly while teaching a real skill: giving a language model structured evidence instead of a pasted screenshot, and knowing when it is inventing.

**Why fifth and not second.** A module about our own file format, shipped early, reads as **documentation rather than a course**. It needs three modules of genuine Oracle substance in front of it so that the reader meets the briefing as the answer to a problem he already has.

**Cost: LOW.** Roughly four lessons. The schema is written, the prompt files are written, and four packs' worth of real output exists to work from.

**The one swap worth offering the founder:** if he wants the AI story visible on the shelf sooner, **move A2 to position 2**. The cost is that the Academy then leads with our own artifact rather than with Oracle substance, which is a positioning choice and therefore his, not a seat's.

### 5.1 What performance tuning got, since he named it

It got **rank 1 and rank 3**, which is two of the five, more than any other subject. It did not get all five, because section 2 shows the demand behind the phrase belongs to two different products and only one of them is defensible for us today.

### 5.2 The alternative that was considered and rejected

**Write all five modules of Course B, so one complete course lands.** Attractive: the shelf shows one finished thing rather than two partial ones. Rejected because it forces B4 (optimizer statistics) and B5 (multitenant) into the first five ahead of two pack-backed modules, drops the most defensible module on the slate (A1) and the only uncopyable one (A2), and leaves the founder's "DB / AI" instinct entirely unserved in the first year of the Academy.

**What the split actually produces on the shelf:** Course B with three modules and Course A with two, roughly 24 to 26 lessons total. Both courses render as real courses, because `src/pages/academy/[course]/index.astro` already suppresses modules with no lessons in them (verified in code, `MODULE-SPEC.md` section 1).

### 5.3 The honest cost headline

**Five modules is roughly 24 to 26 lessons.** No wall-clock estimate is given here on purpose: this seat has no measurement of what an Academy lesson costs to write, and an invented number would be exactly the kind of confident figure `MODULE-SPEC.md` section 7 forbids.

What CAN be said with confidence is the shape of the cost: **two of the five (B2, B3) carry the entire lab-invention burden, and the other three are largely explanation of tested code.** If the founder wants to cut the first tranche from five modules to three, cut B2 and B3, keep B1, A1 and A2, and accept that performance tuning then ships as evidence-gathering only.

**And the thing that gates all of it, stated once here and enforced in the spec: no Academy lab has ever been run against a real estate by this project.** Every invented lab needs a verification pass that does not currently exist as a step in anybody's plan.

---

## 6. WHAT THIS SLATE BREAKS IF ADOPTED, AND WHO HAS TO FIX IT

1. **`/roadmap/` and `/academy/` both publicly say registrations decide build order.** Picking a module directly contradicts both pages. `SESSION_HANDOFF.md` item 47 already registers this coupling: **choosing directly needs a copy touch on both pages**, and the coupling is a reason to route the choice through him rather than around him.
2. **The roadmap row `rac-performance` is titled "RAC and Performance Mastery"**, and this slate puts RAC in Course C and backup and recovery in Course B. Either the D1 row's title and summary change (a migration plus a live-data update), or Course B takes a different slug. **Not fixed here. The roadmap reads live from D1 and this seat did not touch it.**
3. **Track D has no roadmap row at all.** A fourth course needs a D1 migration and a copy touch. Alternatively D1 and D2 fold into Courses A and B, where they overlap anyway, and Track D disappears. **Founder or lead call.**
4. **`/academy/` has no entitlement gate.** Section 8.
5. **The `$`-then-digit price guard will fail ordinary lab shell.** Section 7.

---

## 7. THINGS THAT ARE WRONG, UNVERIFIABLE, OR WILL BITE

| # | Finding | Severity |
|---|---|---|
| **F1** | **The founder's 20-module table could not be found on disk**, so no claim inside it was checkable. Section 0. | **Blocking for the "audit his table" half of the task** |
| **F2** | **"23ai" is a retired product name.** Zero occurrences in Oracle's current Lifetime Support chart (E10); the release is **Oracle AI Database 26ai** (E11). If his table names 23ai modules, they should say 26ai. `oracleVersions` should be `["19c", "26ai"]`. | **High.** Reads as out of date to the exact buyer we want |
| **F3** | **"Performance tuning is the top demand" is true and misleading.** True for developer-facing SQL tuning (57,209 students, E13). False for DBA-facing instance tuning, which is third behind RAC and Data Guard in a controlled comparison (E16). Section 2. | **High.** It is the kind of claim that builds the wrong module |
| **F4** | **Any percentage weighting quoted for a current Oracle DBA exam is unverified.** Oracle's exam-topic pages were unreachable by four independent routes on 9 Aug 2026 (E6), and Oracle's published 19c topic list has **no weightings at all** (E1). The 25/20/20/20/15 figures circulating for 1Z0-183 come from prep sites (E7). **Do not print them.** | **High** |
| **F5** | **Prep sites get basic exam facts wrong.** One states 1Z0-182 is 90 minutes, 55 questions, 68% to pass. Oracle's own page says 120, 60, 65% (E5, E8). Three for three. Any Academy lesson citing exam mechanics must cite Oracle. | **Medium**, and it is the case study for `MODULE-SPEC.md` section 7 |
| **F6** | **The price guard fires on ordinary DBA shell.** `test/academy.test.js` uses `/\$\s?\d/`. Measured 9 Aug 2026: `awk '{print $1}'` **FIRES**, `@script.sql $1` **FIRES**, while `${1}`, `$ORACLE_HOME` and `$ ./health_check.sh` pass. The first real lesson with an awk one-liner fails the suite for a reason unrelated to prices. **Registered for the lead. Writers work around it per `MODULE-SPEC.md` 5.2; nobody edits the test to get a lesson through.** | **Medium, certain to occur** |
| **F7** | **Two modules on the slate cannot be labbed on one host.** C1 (Data Guard) needs a standby and C2 (RAC) needs a cluster, both of which `MODULE-SPEC.md` 4.3 forbids assuming. They need either a container-based lab recipe written first, or an explicit read-only-observation framing. **C5 (Exadata) is worse: it cannot be labbed at all** and should probably be reframed as a decision-and-reading module or dropped. | **Medium**, and it is why all three rank 10 or lower |
| **F8** | **D1 and A1 overlap, and D2 and A2 overlap.** Written independently they will repeat each other. Cut them against each other or merge. | **Low**, but it wastes a quarter if missed |
| **F9** | **Marketplace student counts confound with time on market**, and cross-platform figures are different units. Section 1.3 confounds. The RAC-over-tuning gap is partly years of accumulation. | **Medium.** It caps how hard E16 can be leaned on |
| **F10** | **RAC and Data Guard are not on the core OCP exam** (E3). If the founder's Track B groups them with performance, backup and multitenant as "core", that grouping does not match Oracle's own certification structure. Not wrong as a curriculum choice, but it is a choice rather than a given. | **Low** |

---

## 8. THE GATING FLAG. FLAGGED, NOT SOLVED

**`/academy/` is the paid Tier 2 and it renders to everybody.** Verified rather than assumed, on 9 Aug 2026: there is **no Astro middleware** anywhere in `src/`, and the strings `academy` and `Academy` appear **zero times** in `worker/`, in `worker.js` and in `wrangler.toml`. The Academy routes are static HTML built into `dist/academy/` and served like any other page. The entitlement store (`worker/entitlement.js`, `migrations/0003_delivery.sql`) exists and works, but it is wired to **signed R2 downloads**, not to page access.

**The constraint that rules out the obvious answer.** There is **no login and no session anywhere in this product**, deliberately: the membership spec says "nothing is hosted for the member, there is no login or portal anywhere in the spec", and the privacy page's live sentence commits us to holding only a one-way hash of a Merchant of Record transaction reference. **A conventional account gate cannot be added without inventing the thing the product promises it does not have.**

**The options, with their real costs. The lead should put these to the founder rather than pick one.**

1. **Leave it open.** Every lesson is public. Tier 2 then sells "the library, kept current, plus one new module a quarter" rather than access. Costs nothing to build, gets the pages indexed by Google, which is real acquisition value. Cost: the tier's headline benefit stops being a benefit, and `/pricing/` copy has to stop implying otherwise.
2. **The spec's free-preview split**: one or two open lessons per module, the rest gated. Good marketing shape, but it still requires a gate for the remainder, so it **shrinks the problem rather than removing it**.
3. **Gate behind the entitlement store.** The pages must leave the static build and be served by the worker, or the body must be fetched at runtime from an authorised API. With no session, the reader would paste a transaction reference to read a lesson, which is a poor experience for a thing meant to be read in modules over weeks. A shared reference cannot be meaningfully limited beyond the existing download counter.
4. **Ship the Academy as a downloadable document through the delivery path that already exists and is already gated**, keeping the web pages as index and free preview. The signed R2 route, the entitlement check and the self-serve re-issue are all built and tested. A text lab manual is a document, files are already keepable by design (spec 6.4), and this needs almost no new mechanism. Cost: the reading experience leaves the web, and every lesson's page furniture (versions, reviewed date, terminal minutes) has to be reproduced in the document.

**This seat's view, offered as input and not as a decision:** option 4 deserves to be put to him first, because it is the only one that reuses infrastructure that already exists and already passes tests, and option 1 deserves to be put beside it, because a public Academy is a genuine acquisition asset for a product with no traffic. **Neither is a seat's call, and nothing here changes any route.**

---

## 9. JOB POSTING EVIDENCE

*Appended when the dedicated research agent returns. Nothing in sections 2 to 5 depends on it.*
