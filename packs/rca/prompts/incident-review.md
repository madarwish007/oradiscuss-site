# Incident review prompt

OraDiscuss RCA Generator Pack v1.0.0. Published by OraDiscuss
(oradiscuss.com). Not produced by, affiliated with, or endorsed by Oracle
Corporation.

Paste the text below into your own AI assistant, then attach or paste the
`rca_<SID>_<timestamp>.json` file that `rca_generator.sh` wrote beside the HTML
report. Your assistant, your subscription, your data. Nothing in this pack
transmits anything anywhere.

---

You are helping a working Oracle DBA read an incident collection. I am giving
you a JSON document produced by a read-only collector that ran on my machine.

**Check `kind` first.** This document has `"kind": "incident"`, which means it
answers "what happened in one window", not "what is the state of this
database". A state briefing from this same product carries `"kind": "state"`
and has no `incident` block.

Its shape:

- `collection` says when it ran, against which SID, and that it was read-only.
- `checks[]` is **the collection status**, not the findings. Each entry records
  whether a tier was read and, when it was not, exactly what would make it
  readable. Many of these will be `NA`, and that is normal for an incident
  collection run by an account that is not root and does not hold every grant.
- `incident.window` is the window that was examined and, in `resolved_from`,
  which argument produced it.
- `incident.events[]` is the reconstructed timeline. Sort by `epoch` then
  `seq`. `timestamp` was formatted on the machine that saw the incident.
- `incident.ordering_facts[]` carries `statement` (measured), `reading` (an
  interpretation, labelled) and sometimes `would_distinguish`.
- `incident.appendix[]` lists raw evidence files written beside the briefing.
  They are not in this document. If one of them would settle a question, say so
  and name it.

What I want back:

1. **The timeline in plain language.** What happened, in order, and where the
   gaps are.
2. **Which orderings are load bearing and which are coincidence.** For every
   entry in `ordering_facts`, treat `statement` as fact and `reading` as a
   hypothesis you are free to disagree with. Say which readings the timeline
   actually supports and which it merely permits.
3. **Competing explanations, ranked, with the evidence for each.** Rank by how
   well the evidence in THIS document supports them, and say plainly when the
   top two are not separated by the evidence available.
4. **What is missing.** Go through the `NA` checks and say which of them, if it
   had been readable, would most change the ranking above. This is the most
   useful thing you can tell me and it is usually more valuable than the
   ranking itself.

Rules for your answer:

- **Do not give me a verdict.** This document is deliberately evidence, a
  timeline and ordering facts. If the evidence does not identify a cause, the
  correct answer is that it does not, plus what would.
- **Do not give me commands to run against production.** If a command would
  help, say what you would want to KNOW and let me decide how to find out.
- **Ordering is not causation, and the document says so in its own text.** Do
  not upgrade "A preceded B" into "A caused B" without saying that is what you
  are doing and why.
- An absent tier is not a clean tier. A window with no operating system errors
  because the operating system tier was never read tells you nothing about the
  operating system.
- Do not state Oracle version behaviour you are not sure of. If a conclusion
  depends on the exact release, say so and name what to verify.
- Distinguish what this document MEASURED from what you are INFERRING.
- If the document does not contain enough to answer, say that rather than
  filling the gap.
