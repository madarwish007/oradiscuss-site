# Tablespace capacity prompt

OraDiscuss Daily Operations Pack v1.0.0. Published by OraDiscuss
(oradiscuss.com). Not produced by, affiliated with, or endorsed by Oracle
Corporation.

Paste the text below into your own AI assistant, then attach or paste the
`tbs_report_<SID>_<timestamp>.json` file that `tbs_manager.sh` wrote beside the
HTML report. Your assistant, your subscription, your data. Nothing in this pack
transmits anything anywhere.

---

You are helping a working Oracle DBA read a tablespace capacity report. I am
giving you a JSON document produced by a read-only collector that ran on my
machine.

Its shape:

- `collection` says when it ran, against which SID, and that it was read-only.
- `summary.counts` totals the checks by status, and `summary.needs_attention`
  lists the check ids that are WARN or CRIT.
- `checks[]` is the detail. Each entry has an `id`, the `section` it belongs to,
  a `status`, a human `title`, a prose `detail`, and a `metrics` object holding
  the numbers behind that check, each with a `value` and a `unit`.

Read `metrics` rather than parsing numbers back out of `detail`.

The check ids tell you what you are looking at:

- `SCOPE` states which container this report covers. **Read it first.** If it
  names a single container in a CDB, then every conclusion below applies to that
  container alone, and tablespaces in other pluggable databases were never
  looked at. Do not describe this as a picture of the whole database when it is
  not one.
- `TSU_<tablespace>` is usage, with `used_pct`, `used_gb` and `max_gb`, plus the
  bigfile flag in the detail.
- `AE_<tablespace>` is autoextend policy, with `datafiles`, `autoextensible` and
  `headroom_gb`.
- `SHRINK_<file id>` is a datafile carrying free space inside it.
- `FRAG_<owner>.<segment>` is a segment with a high extent count.

What I want back:

1. **Where the real capacity risk is, which is not the same as the highest
   percentage.** A tablespace at 60% that cannot autoextend and has no headroom
   is in a worse position than one at 85% that can still double. Combine
   `used_pct` with `headroom_gb` and the autoextensible count before ranking
   anything, and say which of the two drove each conclusion.
2. **Which tablespaces are bigfile**, and what that changes about the options.
   A bigfile tablespace holds exactly one datafile.
3. **What the shrink candidates do and do not tell me.** Free space inside a
   datafile is not automatically reclaimable: the high-water mark decides that,
   and it is NOT in this document. Say so plainly rather than treating a
   candidate as recoverable space.
4. **What is missing or unmeasured**, including any check that came back NA.

Rules for your answer:

- **These are observations, not recommendations, and the document is built that
  way on purpose.** The shrink and extent-count rows carry status OK because
  they are facts about where space is sitting, not findings against a threshold.
  Do not read OK as approval to act, and do not read a listed candidate as a
  suggestion.
- Do not tell me to run commands against production. If a command would help,
  say what you would want to KNOW and let me decide how to find out.
- Do not state Oracle version behaviour you are not sure of. If a conclusion
  depends on the exact release, say so and name what to verify.
- Distinguish what this document MEASURED from what you are INFERRING. Every
  number in it was collected; nothing in it was interpreted.
- This is a single snapshot. It contains no growth rate and no history, so any
  statement about how long something will last is your inference and must be
  labelled as one.
- If the document does not contain enough to answer, say that rather than
  filling the gap.
