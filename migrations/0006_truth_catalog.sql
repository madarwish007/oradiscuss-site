-- Truth pass for the two catalogue blurbs that shipped contradicting locked
-- rulings. 0002 (the seed) is corrected for FRESH databases; this migration
-- corrects the two rows in databases that already ran the old 0002, which is
-- every deployed environment. UPDATE by sku, so it touches the blurb and
-- nothing else, and it is idempotent: a second run sets the same bytes.
--
--   toolkit          "Weekly Security Watch" was false. The cadence is MONTHLY
--                    (founder ruling 9 Aug 2026, timed to Oracle's third-Tuesday
--                    patch drop).
--   toolkit-academy  "text lab-manual courses" pinned a format the 10 Aug
--                    interactive ruling superseded. The replacement names NO
--                    format, so it stays true whatever the Academy prototype
--                    verdict decides.
--
-- STAGED, NOT RUN AGAINST PRODUCTION BY ANY SEAT. Applying it to production D1
-- changes what oradiscuss.com serves, which is the founder's promote-time act.

UPDATE catalog
   SET blurb = 'RCA Generator, Audit and Governance, Daily-Ops. Every pack read-only, every pack dual-output. Monthly Security Watch and quarterly updates included.'
 WHERE sku = 'toolkit';

UPDATE catalog
   SET blurb = 'Everything in Toolkit, plus all the Academy courses and one new module every quarter.'
 WHERE sku = 'toolkit-academy';
