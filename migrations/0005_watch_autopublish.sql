-- OraDiscuss system schema, migration 0005: the Security Watch autopublish cycle.
--
-- WHY THIS EXISTS. Founder ruling 9 Aug 2026, verbatim: "Monthly is okay, and
-- that should be automated workflow without any human intervention, as a
-- Founder, i need to get an aknowledgement about the updated kits only." That
-- reverses the 5 Aug standing gate under which publishing and sending were
-- founder-only actions. 0004 was written for the old gate; this migration adds
-- the two things the new one needs, and nothing else.
--
-- DATA LAW, unchanged: we hold NOTHING that identifies a person. Every column
-- added here holds a period label, a slug, a verdict word, a machine generated
-- reason string, or a count. There is no column below that could take an
-- address, a name, an IP, or a mailing list identifier, and that is a property
-- of the schema rather than of anyone's discipline.
--
-- APPLY ONCE. SQLite has no "ADD COLUMN IF NOT EXISTS", so a second run of this
-- file fails on the first ALTER. That is loud rather than silent, which is the
-- behaviour we want.

-- WHO PUBLISHED A BRIEF, which is now a real question because two callers can.
--   'auto'         the scheduled cycle published it after the breaker passed
--   'manual'       the founder's token gated POST /api/watch/publish, breaker passed
--   'manual-force' the founder's token gated publish with force: true, over a
--                  breaker refusal. Recorded because an override that leaves no
--                  trace is indistinguishable from a check that never ran.
-- NULL until a brief is published, and NULL forever on a brief that never is.
ALTER TABLE watch_brief ADD COLUMN published_by TEXT;

-- THE CYCLE LEDGER, and it is the founder's acknowledgement record.
--
-- One row per cycle, written whether the cycle published, held or was quiet.
-- A HOLD IS A CYCLE EVENT AND NOT BRIEF STATE: the same draft can be held in
-- March and published in April, so the reason lives here beside the run that
-- produced it rather than being overwritten on the brief.
--
-- `verdict` is the closed set the breaker returns:
--   published  every check passed and the brief was set live
--   held       a check failed; the brief stayed a draft and `reasons` says why
--   quiet      nothing was found and nothing was wrong, so there was nothing to
--              publish. This is the only verdict that is silent by default.
--
-- `reasons` is the breaker's failure texts joined with '; ', or NULL when there
-- were none. They are generated from source ids, status codes and URLs, which
-- is why a machine written reason can be stored without a privacy question.
--
-- `notified` and `notify_status` are the second half of "he gets told": the row
-- is written BEFORE the notification is attempted, so a cycle whose webhook was
-- unreachable is visible as a cycle that happened and did not reach him, rather
-- than as no cycle at all.
CREATE TABLE IF NOT EXISTS watch_cycle (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at        TEXT NOT NULL DEFAULT (datetime('now')),
  period        TEXT,                                   -- the Oracle patch cycle, as 2026-08
  brief_slug    TEXT,                                   -- the draft this cycle looked at, or NULL when there was none
  verdict       TEXT NOT NULL,                          -- published | held | quiet
  item_count    INTEGER NOT NULL DEFAULT 0,
  items_new     INTEGER NOT NULL DEFAULT 0,
  reasons       TEXT,                                   -- the breaker's failure texts, or NULL
  send_status   TEXT,                                   -- sent | not_configured | no_segment | empty_brief | not_live | failed | unreachable, or NULL when no send was due
  notified      INTEGER NOT NULL DEFAULT 0,             -- 1 an acknowledgement was delivered, 0 it was not attempted or did not land
  notify_status TEXT                                    -- delivered | not_configured | suppressed_quiet | failed | unreachable
);

CREATE INDEX IF NOT EXISTS idx_watch_cycle_recent ON watch_cycle(ran_at DESC);
