-- Seed the price truth. Source: oradiscuss-membership-spec.md section 2 (FINAL, ratified 5 Aug 2026).
-- Rules encoded here: launch price AND regular price both shown from day one;
-- launch price is locked for life while continuously subscribed; annual billing only.
-- Prices are in minor units (cents) so no float ever touches money.

INSERT OR REPLACE INTO catalog
  (sku, tier, name, blurb, launch_price, regular_price, currency, billing_period, active, sort_order)
VALUES
  ('free-kit', 0, 'DBA First Aid Kit',
   'The full read-only Health Check pack. Two outputs from one run: a report you read, and a briefing your own AI reads.',
   0, 0, 'USD', 'once', 1, 0),

  ('toolkit', 1, 'Toolkit',
   'RCA Generator, Audit and Governance, Daily-Ops. Every pack read-only, every pack dual-output. Monthly Security Watch and quarterly updates included.',
   9900, 14900, 'USD', 'year', 1, 1),

  ('toolkit-academy', 2, 'Toolkit + Academy',
   'Everything in Toolkit, plus all the Academy courses and one new module every quarter.',
   19900, 24900, 'USD', 'year', 1, 2);

-- Roadmap courses, from course-outlines.md. Counts start at 0 and are only ever
-- incremented by real registrations. Never hand-write a count.
INSERT OR REPLACE INTO roadmap_interest (course_slug, title, summary, count, status)
VALUES
  ('automated-dba',
   'The Automated DBA',
   'The scripts, runbooks and operating rhythm that remove the 2am pages.',
   0, 'planned'),

  ('rac-performance',
   'RAC and Performance Mastery',
   'Global cache, interconnect, wait-event analysis and plan stability on real RAC estates.',
   0, 'planned'),

  ('exadata-oci-migration',
   'Exadata and OCI Migration Playbook',
   'DBCS to ExaCS, on-prem to OCI, and the decisions the official guides leave out.',
   0, 'planned');
