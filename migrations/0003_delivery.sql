-- OraDiscuss system schema, migration 0003: the Phase 6 delivery ledgers.
--
-- DATA LAW, unchanged and load bearing: we hold NOTHING that identifies a
-- customer. Both tables below store DIGESTS and event metadata only. There is
-- no column here that could take an address, a name, a card, or an IP, and that
-- is a property of the schema rather than of anyone's discipline.
--
-- The entitlement itself lives in KV, keyed by sha256 of the transaction
-- reference, exactly as BUILD_PLAN section 2 records it. These tables exist for
-- the two things KV is the wrong shape for: an atomic idempotency claim, and a
-- durable record of what did not apply.

-- THE IDEMPOTENCY LEDGER. A verified webhook claims its event here with
-- INSERT OR IGNORE before anything is granted, so a redelivered event finds the
-- claim already made and writes no entitlement.
--
-- `processed_at` is what separates a true replay from an attempt that died
-- halfway. A claim with no timestamp is allowed to run again; a claim with one
-- is refused. Without that column, a crash between the claim and the write
-- would strand a paid purchase forever.
CREATE TABLE IF NOT EXISTS webhook_event (
  event_hash   TEXT PRIMARY KEY,          -- sha256(processor + ':' + event id)
  processor    TEXT NOT NULL,             -- 'paddle', 'lemonsqueezy', ...
  event_type   TEXT NOT NULL,
  received_at  TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_event_unprocessed
  ON webhook_event(processed_at, received_at DESC);

-- THE DEAD LETTER. Anything verified but not applied lands here before the
-- retry queue is even attempted, so a queue outage cannot make an event vanish.
-- A row here is a question for a human: an unrecognised price id, a lifecycle
-- event whose purchase we never saw, a D1 error mid write.
CREATE TABLE IF NOT EXISTS webhook_failure (
  event_hash    TEXT PRIMARY KEY,
  processor     TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  reason        TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_failure_last_seen
  ON webhook_failure(last_seen_at DESC);
