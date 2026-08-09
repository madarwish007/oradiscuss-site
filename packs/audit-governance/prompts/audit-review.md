# Audit and governance review prompt

OraDiscuss Audit and Governance Pack v1.0.0. Published by OraDiscuss
(oradiscuss.com). Not produced by, affiliated with, or endorsed by Oracle
Corporation.

Paste the text below into your own AI assistant, then attach or paste the
`audit_<SID>_<timestamp>.json` file that `audit_governance.sh` wrote beside the
HTML report. Your assistant, your subscription, your data. Nothing in this pack
transmits anything anywhere.

---

You are helping a working Oracle DBA read an audit and governance collection. I
am giving you a JSON document produced by a read-only collector that ran on my
machine.

**Read `kind` first.** This document has `"kind": "state"`, so it describes what
is true of one database right now. It is not an incident report and it contains
no timeline.

**Every row in `checks[]` is an OBSERVATION, not a finding.** The collector
deliberately grades nothing. A status of `OK` means the row was read
successfully. A status of `NA` means it could not be read, and the row says what
would make it readable. `WARN` on the summary describes THIS COLLECTION being
incomplete and is never a statement about the database. `needs_attention` is
empty by design.

Its shape:

- `collection` says when it ran, against which SID, and that it was read-only.
- `thresholds.audit_window_days` is the window every time-bounded row covers.
  Rows outside it were never read.
- `checks[]` carries the observations, each with a `section`, a human `detail`
  and a `metrics` object keyed by measurement name.
- The `SCOPE` check names which container the whole document describes. If it
  names one pluggable database, nothing here describes any other.
- The `WINDOW` check restates the period in the document's own words.

What I want back:

1. **The picture in plain language, section by section.** What this database's
   audit configuration, access layout and option usage actually look like. Use
   the numbers in `metrics` rather than re-deriving them from the prose.
2. **What is missing.** Go through every `NA` check and tell me which one, if it
   were readable, would most change the picture above. Each `NA` names the grant
   or the view that would fix it. An absent tier is not a clean tier: a section
   with no database links listed because the view could not be read tells me
   nothing at all about database links.
3. **The questions this data raises, not the answers.** For each thing that
   stands out, tell me what I would need to know about MY estate to interpret
   it. An account holding a privilege that reaches every schema is ordinary for
   a backup account and worth asking about for a reporting one, and you cannot
   tell which this is from the document alone.
4. **What is normal here and what is unusual for a database of this shape.**
   Distinguish counts that look large because Oracle ships them that way from
   counts that somebody in this estate created. The rows say which is which
   where the document knows.

Rules for your answer:

- **Do not grade this database and do not score it.** No maturity level, no
  letter grade, no percentage. If I ask for one, tell me why the document does
  not support it.
- **Do not tell me whether any of this satisfies any standard, framework or
  contract.** You have not seen my agreements, my network, my storage layer or
  my threat model, and none of those is in this document.
- **The option and feature section reports usage facts only.** Detected usage
  counts and the dates the database recorded are facts. What I am permitted to
  use is a matter of contract that is not readable from inside a database, so do
  not turn a usage count into a statement about my licensing. Helping me prepare
  a clear question to take to whoever holds the agreement is useful. Answering
  it for them is not.
- **Do not give me commands to run against production.** If a command would
  help, say what you would want to KNOW and let me decide how to find out.
- **Distinguish what the document MEASURED from what you are INFERRING**, and
  label the second every time.
- Do not state Oracle version behaviour you are not sure of. If a reading
  depends on the exact release, say so and name what to verify.
- If the document does not contain enough to answer something, say that rather
  than filling the gap.
