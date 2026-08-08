-- OraDiscuss system schema, migration 0004: the Security Watch pipeline.
--
-- DATA LAW, unchanged: we hold NOTHING that identifies a person. Every column
-- added here holds a PUBLIC Oracle advisory, a URL, a date, or a machine
-- generated digest of those. There is no column below that could take an
-- address, a name, an IP, or a mailing list identifier, and that is a property
-- of the schema rather than of anyone's discipline.
--
-- `watch_brief` ALREADY EXISTS from 0001 and is EXTENDED here rather than
-- duplicated. Its original columns (slug, title, body_md, sources_json, status,
-- created_at, published_at) are untouched and still mean what they meant.
--
-- APPLY ONCE. SQLite has no "ADD COLUMN IF NOT EXISTS", so a second run of this
-- file fails on the first ALTER. That is loud rather than silent, which is the
-- behaviour we want; see the run instruction in the session report.

-- What the drafting job needs to know about a brief that 0001 did not carry.
--   period      the ISO week the draft was opened for, as 2026-W33. Human
--               readable, sortable, and the thing the slug is derived from.
--   item_count  how many cited items the brief carries, so a listing does not
--               have to parse sources_json to say "9 items".
--   updated_at  when the drafting job last rebuilt the body. A brief that has
--               not moved in three weeks is visible without reading a log.
--   sent_at     when the member send was accepted, and NULL until it is. This
--               is what makes "publishing twice does not send twice" a check
--               against a FACT rather than against an intention.
--   send_status the outcome word from the send attempt: sent, not_configured,
--               no_segment, failed. NULL means no send has been attempted.
ALTER TABLE watch_brief ADD COLUMN period      TEXT;
ALTER TABLE watch_brief ADD COLUMN item_count  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE watch_brief ADD COLUMN updated_at  TEXT;
ALTER TABLE watch_brief ADD COLUMN sent_at     TEXT;
ALTER TABLE watch_brief ADD COLUMN send_status TEXT;

-- THE IDEMPOTENCY LEDGER FOR ITEMS, and it is the whole reason a second run
-- over the same source cannot produce a second draft of the same advisory.
--
-- `item_key` is sha256(source id + ':' + the item's own identity), and for the
-- Oracle advisory index that identity includes the REVISION string. A revision
-- bump is genuinely new information for a security brief ("Critical Patch
-- Update July 2026 is now Rev 5"), so it earns a new row; the same revision
-- seen a second time collides on this primary key and is ignored.
--
-- `brief_id` is NULL until the item is attached to a draft. That nullable
-- column is the queue: the job attaches everything unattached to the one open
-- draft, so an item found the day after a brief was published lands in the
-- next brief instead of silently rewriting a published one.
CREATE TABLE IF NOT EXISTS watch_item (
  item_key      TEXT PRIMARY KEY,
  source_id     TEXT NOT NULL,
  brief_id      INTEGER,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL,
  revision      TEXT,
  published_on  TEXT,                                   -- YYYY-MM-DD, or NULL when the source did not carry a parseable date
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_watch_item_unassigned ON watch_item(brief_id, published_on DESC);
CREATE INDEX IF NOT EXISTS idx_watch_item_brief ON watch_item(brief_id, published_on DESC, item_key);

-- THE SOURCE RUN LEDGER. One row per source per run, written whether the fetch
-- succeeded or failed.
--
-- This table exists because of the failure mode the whole feature has: a watch
-- that quietly stopped watching looks exactly like a quiet week. A source that
-- 403s now leaves a row saying so, with the status code and the reason, and the
-- founder can see it without reading a log that ages out.
CREATE TABLE IF NOT EXISTS watch_source_run (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id   TEXT NOT NULL,
  ran_at      TEXT NOT NULL DEFAULT (datetime('now')),
  ok          INTEGER NOT NULL,                         -- 1 fetched and parsed, 0 failed
  http_status INTEGER,
  items_found INTEGER NOT NULL DEFAULT 0,
  items_new   INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_watch_source_run_recent ON watch_source_run(source_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_brief_period ON watch_brief(period, status);
