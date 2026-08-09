---
title: The Automated DBA
summary: Collect evidence about your own estate with read-only scripts, read what came back without overstating it, and hand the machine-readable half to your own AI assistant on your own machine.
modules:
  - "A1. Incident reconstruction: evidence, timeline, and the explanations that compete"
  - "A2. Handing it to your own AI: the briefing, its schema, and prompts that do not invent"
  - "A3. The morning briefing, and an operating rhythm that survives a bad week"
  - "A4. Capacity you can defend: headroom, growth, and what is recoverable rather than purchasable"
  - "A5. Knowing the estate before you touch it: host, cluster and home discovery"
oracleVersions:
  - 19c
  - 26ai
prerequisites:
  - A working knowledge of Oracle administration at the level of a DBA who already runs a production estate.
  - A lab estate, meaning one Oracle instance you are allowed to break, on your own machine or your own VM, that is not production and holds no real data.
  - A bash shell, and the OraDiscuss automation packs unpacked somewhere you can read them.
lastReviewed: 2026-08-09
draft: false
---

This course is about the part of the job that happens before any decision: getting
a true, dated, read-only picture of a database, and then reading it without saying
more than the picture supports.

Two habits run through every lesson. The first is that a collection and its
interpretation are different objects, and the interpretation is labelled as one.
The second is that a measurement nobody could take is not a measurement that came
back clean.

Nothing in this course has been run against a production estate by OraDiscuss.
Every command here is addressed to the lab estate, and several lessons contact no
database at all.
