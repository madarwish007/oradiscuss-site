-- OraDiscuss system schema, migration 0001.
-- Data model law: we hold NOTHING that identifies a customer.
-- Emails live at beehiiv. Payment identity lives at Paddle. See BUILD_PLAN.md section 2.

-- The single source of price truth. Every page reads from here, never a hardcoded number.
CREATE TABLE IF NOT EXISTS catalog (
  sku             TEXT PRIMARY KEY,
  tier            INTEGER NOT NULL,
  name            TEXT NOT NULL,
  blurb           TEXT NOT NULL,
  launch_price    INTEGER NOT NULL,   -- minor units (cents)
  regular_price   INTEGER NOT NULL,   -- minor units (cents)
  currency        TEXT NOT NULL DEFAULT 'USD',
  billing_period  TEXT NOT NULL DEFAULT 'year',
  active          INTEGER NOT NULL DEFAULT 1,
  paddle_price_id TEXT,               -- filled in Phase 6
  sort_order      INTEGER NOT NULL DEFAULT 0
);

-- Roadmap demand: AGGREGATE ONLY. The subscriber email goes to beehiiv, never here.
CREATE TABLE IF NOT EXISTS roadmap_interest (
  course_slug TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'planned',  -- planned | building | shipped
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Security Watch briefs. Written as draft by the weekly job, published by the founder.
CREATE TABLE IF NOT EXISTS watch_brief (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT UNIQUE NOT NULL,
  title        TEXT NOT NULL,
  body_md      TEXT NOT NULL,
  sources_json TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'draft',   -- draft | live
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);

-- Changelog is GENERATED from releases, never hand-edited.
CREATE TABLE IF NOT EXISTS changelog (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pack        TEXT NOT NULL,
  version     TEXT NOT NULL,
  body_md     TEXT NOT NULL,
  released_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- What a member is entitled to download, and the artifact's integrity hash.
CREATE TABLE IF NOT EXISTS pack_release (
  pack        TEXT NOT NULL,
  version     TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  min_tier    INTEGER NOT NULL DEFAULT 1,   -- 0 = free
  released_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pack, version)
);

CREATE INDEX IF NOT EXISTS idx_watch_status ON watch_brief(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_changelog_date ON changelog(released_at DESC);
