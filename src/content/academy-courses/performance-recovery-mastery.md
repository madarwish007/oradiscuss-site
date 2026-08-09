---
title: Performance and Recovery Mastery
summary: Produce evidence about your own database, cite it, and know what it does not prove. The first module works the collection end to end without a live incident and without a licensed pack.
modules:
  - "Performance evidence: from 'the database is slow' to a ranked set of cited facts"
oracleVersions:
  - 19c
  - 26ai
prerequisites:
  - A machine with bash and the usual text tools. The first module's labs run there and never contact a database.
  - The OraDiscuss DBA Health Check Automation Pack v1.0.0, unpacked somewhere you can read it.
  - A lab estate if you want to go past the labs. That means one Oracle instance you are allowed to break, on your own machine or your own VM, that is not production and holds no real data.
lastReviewed: 2026-08-09
draft: false
---

This course is a text lab manual. It is worked at a terminal, not read on a train.

It starts where a real morning starts. Somebody says the database is slow, and you have to turn that sentence into a set of facts that can be cited, ranked, and argued with. The work is not clever. It is a sequence: establish what you are allowed to read, establish which window you are actually looking at, collect once, and then read the collection carefully enough to notice what it did not measure.

**What this course does not do.** It does not tell you what to change on your estate. Every number here is reported as a measurement, and every interpretation is labelled as an interpretation. When a threshold is missing it is missing on purpose, because a fixed percentage compared against no baseline is a verdict wearing a number's clothes.

**How the labs are built, stated plainly.** The labs in the first module run on a machine with no Oracle home set, drive the pack's replay path, and never contact a database. That is a deliberate choice with two reasons. The first is licensing: the views this subject is about are part of a separately licensed pack, and a lab that assumed you hold that licence would be a lab that costs some readers money. The second is reproducibility: an incident is not something you can schedule, and a lesson you can only do during one is a lesson you will never do.

**What has not happened.** No lab in this Academy has been run against a real production estate by this project. Where a statement here is addressed to a running instance, it is addressed to your lab estate, it is marked as documented rather than observed, or both.
