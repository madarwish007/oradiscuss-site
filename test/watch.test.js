// GUARDS over the Security Watch pipeline.
//
// The five the work order names, each written so it CAN fail and each watched
// failing against deliberately broken input before it was trusted:
//
//   1. a draft does not appear on the public archive
//   2. a second run over the same source creates no duplicate
//   3. a failing source is RECORDED as failed, not skipped
//   4. the publish endpoint refuses an unauthenticated caller
//   5. nothing sends to the member list without an explicit publish
//
// Plus the ones the shape of this feature earns: a published brief is never
// rewritten by the job, a hostile feed cannot plant a link or markup on a page
// that carries our name, and no code outside worker/watch-publish.js can set a
// brief live or call the list.
//
// NOTHING HERE REACHES THE NETWORK. Every fetch goes through the stub in
// test/support/watch-fixtures.js, which records what it was asked for, so "the
// scheduled run sent nothing" is a measurement of calls rather than a reading
// of the code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import worker from '../worker.js';
import { handleApi } from '../worker/api.js';
import {
  runWatch,
  rollUpDraft,
  extractAlertIndex,
  extractFeed,
  normaliseItem,
  plainText,
  parseRevisionCell,
  patchCyclePeriod,
  thirdTuesdayOf,
  briefTitleFor,
  listLiveBriefs,
  RECENT_DAYS,
} from '../worker/watch.js';
import {
  SOURCES,
  enabledSources,
  registryHosts,
  registrySummary,
  ORACLE_ALERT_INDEX,
} from '../worker/watch-sources.js';
import {
  renderIndex,
  renderCitations,
  citationUrl,
  rewriteHead,
  watchIndexPage,
  watchBriefPage,
} from '../worker/watch-pages.js';
import { makeEnv, captureConsole, everythingWritten } from './support/system-env.js';
import {
  oracleIndexHtml,
  oracleIndexWithExtraAlert,
  feedXml,
  stubFetch,
  daysAgo,
} from './support/watch-fixtures.js';

const DIST = process.env.DIST_DIR ?? new URL('../dist', import.meta.url).pathname;
const WORKER_DIR = new URL('../worker', import.meta.url).pathname;

// Synthetic. 64 hex characters, the shape `openssl rand -hex 32` produces, and
// it has never been anywhere near a real account.
const TEST_ADMIN_TOKEN = 'f'.repeat(32) + '0'.repeat(32);
const BEEHIIV_POSTS = 'https://api.beehiiv.com/v2/publications/pub_test/posts';

function builtPage(rel) {
  const path = join(DIST, rel);
  assert.ok(existsSync(path), `${path} does not exist. Run npm run build first.`);
  return readFileSync(path, 'utf8');
}

// An ASSETS binding that serves the REAL built pages, which is what the Worker
// receives in production. A hand written stub would agree with whatever the
// injector expected and prove nothing about the page that ships.
function siteAssets() {
  const index = builtPage('watch/index.html');
  const shell = builtPage('watch/brief/index.html');
  const missing = builtPage('404.html');
  return {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const body = path === '/watch/brief/' ? shell : path === '/404.html' ? missing : index;
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    },
  };
}

function watchEnv(overrides = {}) {
  return makeEnv({
    ASSETS: siteAssets(),
    WATCH_ADMIN_TOKEN: TEST_ADMIN_TOKEN,
    ...overrides,
  });
}

// beehiiv fully wired, so that "it did not send" is never explained by a
// missing key. Every send test that expects silence uses this.
function sendableEnv(overrides = {}) {
  return watchEnv({
    BEEHIIV_API_KEY: 'bh_synthetic_key_for_tests_only_0000000',
    BEEHIIV_PUBLICATION_ID: 'pub_test',
    BEEHIIV_MEMBERS_SEGMENT_ID: 'seg_members_test',
    ...overrides,
  });
}

function oracleRoutes(now = new Date(), html = null) {
  return {
    [ORACLE_ALERT_INDEX]: { body: html ?? oracleIndexHtml(now) },
    [BEEHIIV_POSTS]: { body: JSON.stringify({ data: { id: 'post_1' } }), type: 'application/json' },
  };
}

async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

function publishRequest(body, token = TEST_ADMIN_TOKEN) {
  return new Request('https://oradiscuss.com/api/watch/publish', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.9',
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}

async function publish(env, slug, token = TEST_ADMIN_TOKEN) {
  const res = await handleApi(publishRequest({ slug }, token), env, '/api/watch/publish');
  return { res, body: await res.json() };
}

async function draftSlug(env) {
  const row = await env.DB.prepare(
    "SELECT slug FROM watch_brief WHERE status = 'draft' ORDER BY id DESC LIMIT 1",
  ).first();
  return row?.slug ?? null;
}

async function briefRow(env, slug) {
  return env.DB.prepare('SELECT * FROM watch_brief WHERE slug = ?1').bind(slug).first();
}

/* ================================================================ registry */

test('every registry row carries what the pipeline reads, and says whether it was verified', () => {
  assert.ok(SOURCES.length >= 4, `only ${SOURCES.length} sources registered`);
  for (const s of SOURCES) {
    assert.match(s.id, /^[a-z][a-z0-9-]{2,40}$/, `bad source id: ${s.id}`);
    assert.ok(s.label && s.detail, `${s.id} has no label or detail`);
    assert.match(s.url, /^https:\/\//, `${s.id} must be fetched over https`);
    assert.ok(['oracle-alert-index', 'feed'].includes(s.kind), `${s.id} has an unknown kind`);
    assert.ok(Array.isArray(s.hosts) && s.hosts.length > 0, `${s.id} declares no host allowlist`);
    if (s.kind === 'oracle-alert-index') {
      assert.ok(s.pathPattern instanceof RegExp, `${s.id} has no path pattern`);
    }
    // The honesty rule: a source is either verified and watched, or unverified
    // and switched off with the reason written down. Nothing in between.
    if (s.enabled) {
      assert.match(s.verified ?? '', /^\d{4}-\d{2}-\d{2}$/, `${s.id} is watched but was never verified`);
    } else {
      assert.equal(s.verified, null, `${s.id} is switched off but claims a verification date`);
      assert.ok(s.verified_note && s.verified_note.length > 20, `${s.id} is off and does not say why`);
    }
  }
});

test('the registry reports the sources nobody is watching, rather than hiding them', () => {
  const summary = registrySummary();
  assert.equal(summary.length, SOURCES.length, 'the summary must list every source, watched or not');
  const off = summary.filter((s) => !s.enabled);
  assert.ok(off.length >= 1, 'this guard is asleep unless at least one source is switched off');
  for (const s of off) assert.ok(s.verified_note, `${s.id} is off with no reason reported`);
  assert.ok(registryHosts().includes('www.oracle.com'));
});

test('no source claims My Oracle Support, which cannot be read by a machine', () => {
  for (const s of SOURCES) {
    assert.ok(
      !/support\.oracle\.com/i.test(s.url),
      `${s.id} points at My Oracle Support, which needs an authenticated session`,
    );
  }
});

/* ============================================================== extraction */

test('the alert index parser reads the real page shape, comments and all', () => {
  const now = new Date();
  const cpu = SOURCES.find((s) => s.id === 'oracle-cpu');
  const items = extractAlertIndex(oracleIndexHtml(now), cpu);
  // TWO rows match the CPU path pattern, and that is the design rather than a
  // bug: the extractor matches on PATH, and the fixture carries an off host
  // mirror with the same path. Host is enforced one layer later, by
  // normaliseItem, which is asserted in its own test below and again against
  // the database after a real run. Matching the host here as well would hide
  // which of the two layers is actually doing the work.
  assert.equal(items.length, 2, `expected two rows matching the CPU path, got ${items.length}`);
  assert.equal(items[0].revision, 'Rev 5');
  assert.equal(items[0].title, 'Critical Patch Update - July 2026', 'the em dash must be normalised at ingest');
  assert.equal(
    normaliseItem(cpu, items.find((i) => i.href.includes('not-oracle'))),
    null,
    'the off host mirror must be refused before it can become a row',
  );

  const cspu = SOURCES.find((s) => s.id === 'oracle-cspu');
  const cspuItems = extractAlertIndex(oracleIndexHtml(now), cspu);
  assert.equal(cspuItems.length, 1);
  assert.equal(cspuItems[0].revision, 'Rev 1', 'the StartFragment comment must not defeat the revision');

  // The index carries both spellings and the case sensitive version of this
  // pattern would silently drop the newest alerts.
  const alert = SOURCES.find((s) => s.id === 'oracle-security-alert');
  const alerts = extractAlertIndex(oracleIndexHtml(now), alert);
  assert.equal(alerts.length, 1, 'alert-CVE- in capitals must match as well as alert-cve-');
});

test('a revision cell yields a revision and a date, or an honest null', () => {
  assert.deepEqual(parseRevisionCell('Rev 5, 30 July 2026'), {
    revision: 'Rev 5',
    published_on: '2026-07-30',
    text: 'Rev 5, 30 July 2026',
  });
  const none = parseRevisionCell('<!--StartFragment-->coming soon<!--EndFragment-->');
  assert.equal(none.revision, null);
  assert.equal(none.published_on, null, 'an unreadable date must be null, never today');
});

test('plain text strips markup and normalises the dashes the house rule forbids', () => {
  assert.equal(plainText('<b>Alert</b> for <!--x-->CVE'), 'Alert for CVE');
  assert.equal(plainText('Patch &#8212; July'), 'Patch - July');
  assert.equal(plainText('A &amp;lt;script&amp;gt; title'), 'A &lt;script&gt; title');
  assert.ok(!plainText('Rev 1 — 2026').includes('—'));
});

test('an item that is not on a registered host, or not https, never becomes a row', () => {
  const cpu = SOURCES.find((s) => s.id === 'oracle-cpu');
  const base = { title: 'Critical Patch Update', revision: 'Rev 1', published_on: '2026-07-30' };
  assert.equal(normaliseItem(cpu, { ...base, href: 'https://not-oracle.example.com/x.html' }), null);
  assert.equal(normaliseItem(cpu, { ...base, href: 'javascript:alert(1)' }), null);
  assert.equal(normaliseItem(cpu, { ...base, href: 'http://www.oracle.com/x.html' }), null);
  assert.equal(normaliseItem(cpu, { ...base, title: '   ', href: '/security-alerts/cpujul2026.html' }), null);
  const ok = normaliseItem(cpu, { ...base, href: '/security-alerts/cpujul2026.html' });
  assert.equal(ok.url, 'https://www.oracle.com/security-alerts/cpujul2026.html');
});

test('the feed parser reads RSS and Atom, so the blog row is an unproven source and not an unwritten parser', () => {
  const blog = SOURCES.find((s) => s.id === 'oracle-database-blog');
  const items = extractFeed(feedXml(), blog);
  assert.equal(items.length, 2, `expected two feed items, got ${items.length}`);
  assert.equal(items[0].href, 'https://blogs.oracle.com/database/post/ru-26-2');
  assert.match(items[0].published_on, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(items[1].href, 'https://blogs.oracle.com/database/post/atom-one');
});

test('the cycle label and the brief title are derived, never typed', () => {
  assert.equal(patchCyclePeriod(new Date('2026-08-20T06:00:00Z')), '2026-08');
  assert.equal(patchCyclePeriod(new Date('2027-01-21T06:00:00Z')), '2027-01');
  assert.equal(briefTitleFor(new Date('2026-08-20T06:00:00Z')), 'Security Watch, August 2026');
});

test("the release day we schedule against is ORACLE'S OWN, checked against the dates Oracle published", () => {
  // THIS IS THE TEST THAT MATTERS, and it is deliberately not a restatement of
  // the arithmetic. oracle.com/security-alerts/ carried its forward calendar on
  // 9 Aug 2026: "The next four dates are: 20 October 2026, 19 January 2027,
  // 20 April 2027, 20 July 2027", the quarterly Critical Patch Updates. If
  // thirdTuesdayOf reproduces all four then "third Tuesday" is the right rule,
  // and the monthly cron derived from it lands where it is meant to.
  //
  // A test that recomputed the offset the way the function does would agree
  // with a wrong function. These four dates came from Oracle.
  const published = [
    ['2026-10-20', 2026, 9],
    ['2027-01-19', 2027, 0],
    ['2027-04-20', 2027, 3],
    ['2027-07-20', 2027, 6],
  ];
  for (const [iso, year, monthIndex] of published) {
    assert.equal(
      thirdTuesdayOf(year, monthIndex).toISOString().slice(0, 10),
      iso,
      `Oracle published ${iso} as a Critical Patch Update date and the rule did not reproduce it`,
    );
    assert.equal(thirdTuesdayOf(year, monthIndex).getUTCDay(), 2, `${iso} is not a Tuesday`);
  }

  // The brief is timed two days later, which is the third Thursday, which is
  // exactly what `0 6 * * THU#3` in wrangler.toml expresses.
  const drop = thirdTuesdayOf(2026, 9);
  const brief = new Date(drop.getTime() + 2 * 86400000);
  assert.equal(brief.getUTCDay(), 4, 'two days after the release is not a Thursday');
  assert.equal(brief.toISOString().slice(0, 10), '2026-10-22');
});

/* ================================================================ the run */

test('a scheduled run writes a DRAFT and publishes nothing', async () => {
  const env = watchEnv();
  const fetchStub = stubFetch(oracleRoutes());
  const summary = await runWatch(env, { fetcher: fetchStub });

  assert.equal(summary.sources.length, enabledSources().length);
  assert.ok(summary.items_new >= 4, `expected at least four items, got ${summary.items_new}`);

  const drafts = await env.DB.prepare("SELECT COUNT(*) AS n FROM watch_brief WHERE status = 'draft'").first();
  const live = await env.DB.prepare("SELECT COUNT(*) AS n FROM watch_brief WHERE status = 'live'").first();
  assert.equal(drafts.n, 1, 'exactly one draft is opened');
  assert.equal(live.n, 0, 'a run must never publish');

  const brief = await briefRow(env, summary.brief.slug);
  assert.equal(brief.published_at, null, 'a draft carries no publication date');
  assert.equal(brief.sent_at, null, 'a draft has been sent to nobody');
  // The slug carries the ORACLE PATCH CYCLE the brief covers, which is a month,
  // because Oracle ships security content on the third Tuesday of every month.
  // It was an ISO week until the founder's 9 Aug ruling.
  assert.match(brief.slug, /^watch-\d{4}-(0[1-9]|1[0-2])$/);

  // The 2021 bulletin is in the fixture and must have been dropped for age.
  const old = await env.DB.prepare("SELECT COUNT(*) AS n FROM watch_item WHERE published_on LIKE '2021-%'").first();
  assert.equal(old.n, 0, `items older than ${RECENT_DAYS} days must not enter a brief`);

  // And the off host mirror row must never have become an item.
  const offHost = await env.DB.prepare("SELECT COUNT(*) AS n FROM watch_item WHERE url NOT LIKE 'https://www.oracle.com/%'").first();
  assert.equal(offHost.n, 0, 'an item may only link to a host the registry declares');
});

test('A SECOND RUN OVER THE SAME SOURCE CREATES NO DUPLICATE, and changes nothing at all', async () => {
  const env = watchEnv();
  const fetchStub = stubFetch(oracleRoutes());

  const first = await runWatch(env, { fetcher: fetchStub });
  const afterFirst = await briefRow(env, first.brief.slug);
  const countFirst = await env.DB.prepare('SELECT COUNT(*) AS n FROM watch_item').first();

  const second = await runWatch(env, { fetcher: fetchStub });
  const afterSecond = await briefRow(env, first.brief.slug);
  const countSecond = await env.DB.prepare('SELECT COUNT(*) AS n FROM watch_item').first();
  const briefs = await env.DB.prepare('SELECT COUNT(*) AS n FROM watch_brief').first();

  assert.equal(second.items_new, 0, 'the second run must find nothing new');
  assert.equal(countSecond.n, countFirst.n, 'the item ledger must not grow');
  assert.equal(briefs.n, 1, 'a second run must not open a second draft');
  assert.equal(second.brief.changed, false, 'an unchanged draft must not even be rewritten');
  // Byte identical, not merely "the same number of rows".
  assert.equal(afterSecond.body_md, afterFirst.body_md);
  assert.equal(afterSecond.sources_json, afterFirst.sources_json);
  assert.equal(afterSecond.updated_at, afterFirst.updated_at, 'nothing changed, so nothing was touched');
});

test('A FAILING SOURCE IS RECORDED AS FAILED, and does not stop the sources after it', async () => {
  const env = watchEnv();
  // The one URL every enabled source reads answers 403, the way blogs.oracle.com
  // did from this machine on the day this was written.
  const fetchStub = stubFetch({ [ORACLE_ALERT_INDEX]: { status: 403, body: 'forbidden' } });

  const capture = captureConsole();
  let summary;
  try {
    summary = await runWatch(env, { fetcher: fetchStub });
  } finally {
    capture.restore();
  }

  assert.equal(summary.items_new, 0);
  assert.ok(summary.sources.every((s) => s.ok === false), 'every source on that URL must report failure');

  const { results } = await env.DB.prepare(
    'SELECT source_id, ok, http_status, error FROM watch_source_run ORDER BY source_id',
  ).all();
  assert.equal(results.length, enabledSources().length, 'every source leaves a row, ok or not');
  for (const row of results) {
    assert.equal(row.ok, 0);
    assert.equal(row.http_status, 403, 'the status code must be recorded, not just the fact of failure');
    assert.equal(row.error, 'http_403');
  }
  assert.match(capture.text(), /watch_source_not_ok/);
});

test('a source whose fetch THROWS is recorded too, and the run still finishes', async () => {
  const env = watchEnv();
  const fetchStub = stubFetch({ [ORACLE_ALERT_INDEX]: { throws: 'network unreachable' } });
  const capture = captureConsole();
  try {
    const summary = await runWatch(env, { fetcher: fetchStub });
    assert.ok(summary.sources.every((s) => s.ok === false));
    const row = await env.DB.prepare('SELECT ok, http_status, error FROM watch_source_run LIMIT 1').first();
    assert.equal(row.ok, 0);
    assert.equal(row.http_status, null);
    assert.match(row.error, /unreachable/);
  } finally {
    capture.restore();
  }
});

test('a run whose source list is half broken still ingests the half that works', async () => {
  const env = watchEnv();
  const good = { ...SOURCES.find((s) => s.id === 'oracle-cpu') };
  const bad = { ...SOURCES.find((s) => s.id === 'oracle-security-alert'), url: 'https://www.oracle.com/gone/' };
  const fetchStub = stubFetch({
    [ORACLE_ALERT_INDEX]: { body: oracleIndexHtml() },
    'https://www.oracle.com/gone/': { status: 500, body: 'boom' },
  });

  const capture = captureConsole();
  try {
    const summary = await runWatch(env, { fetcher: fetchStub, sources: [bad, good] });
    const byId = Object.fromEntries(summary.sources.map((s) => [s.id, s]));
    assert.equal(byId['oracle-security-alert'].ok, false);
    assert.equal(byId['oracle-cpu'].ok, true, 'the failure of the first source must not abort the second');
    assert.equal(byId['oracle-cpu'].items_new, 1);
  } finally {
    capture.restore();
  }
});

test('the run records itself even when the page is unreadable, so a quiet week is distinguishable', async () => {
  const env = watchEnv();
  const fetchStub = stubFetch({ [ORACLE_ALERT_INDEX]: { body: '<html><body>redesigned</body></html>' } });
  const summary = await runWatch(env, { fetcher: fetchStub });
  const { results } = await env.DB.prepare('SELECT source_id, ok, items_found FROM watch_source_run').all();
  assert.equal(results.length, enabledSources().length);
  // A page that fetched fine and yielded nothing is reported as ok with zero
  // items, which is a DIFFERENT fact from a fetch that failed, and the founder
  // can tell them apart from the table alone.
  for (const row of results) {
    assert.equal(row.ok, 1);
    assert.equal(row.items_found, 0);
  }
  assert.equal(summary.items_new, 0);
});

test('a published brief is never rewritten: new items open the NEXT draft', async () => {
  const env = sendableEnv();
  const routes = oracleRoutes();
  await runWatch(env, { fetcher: stubFetch(routes) });
  const slug = await draftSlug(env);

  await withFetch(stubFetch(routes), () => publish(env, slug));
  const published = await briefRow(env, slug);
  assert.equal(published.status, 'live');

  // A new alert appears the next day.
  await runWatch(env, { fetcher: stubFetch(oracleRoutes(new Date(), oracleIndexWithExtraAlert())) });

  const after = await briefRow(env, slug);
  assert.equal(after.body_md, published.body_md, 'a published brief must not be rewritten');
  assert.equal(after.sources_json, published.sources_json);
  assert.equal(after.item_count, published.item_count);

  const drafts = await env.DB.prepare("SELECT slug, item_count FROM watch_brief WHERE status = 'draft'").all();
  assert.equal(drafts.results.length, 1, 'a fresh draft must have opened');
  assert.notEqual(drafts.results[0].slug, slug);
  assert.equal(drafts.results[0].item_count, 1, 'only the new item belongs to the new draft');
});

test('the drafting job stores nothing that could identify a person', async () => {
  const env = watchEnv();
  const capture = captureConsole();
  try {
    await runWatch(env, { fetcher: stubFetch(oracleRoutes()) });
  } finally {
    capture.restore();
  }
  const written = everythingWritten(env, capture);
  for (const forbidden of ['@', 'email', 'ip_address', 'CF-Connecting-IP']) {
    assert.ok(
      !written.toLowerCase().includes(forbidden.toLowerCase()),
      `the pipeline wrote something containing "${forbidden}"`,
    );
  }
});

/* ============================================================ the archive */

test('A DRAFT DOES NOT APPEAR ON THE PUBLIC ARCHIVE', async () => {
  const env = watchEnv();
  await runWatch(env, { fetcher: stubFetch(oracleRoutes()) });
  const slug = await draftSlug(env);
  const draft = await briefRow(env, slug);
  assert.equal(draft.status, 'draft', 'this guard is asleep unless there is a draft to hide');

  const res = await watchIndexPage(new Request('https://oradiscuss.com/watch/'), env);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.ok(!html.includes(slug), `the draft slug ${slug} reached the public archive`);
  assert.ok(!html.includes(draft.title), 'the draft title reached the public archive');
  assert.ok(html.includes('No brief has been published yet'), 'an empty archive must say so');

  // And it is not reachable by guessing its address either.
  const direct = await watchBriefPage(new Request(`https://oradiscuss.com/watch/${slug}/`), env, slug);
  assert.equal(direct.status, 404, 'a draft must not render at its own URL');
  const directHtml = await direct.text();
  assert.ok(!directHtml.includes(draft.title), 'the 404 must not leak the draft title');

  // The public read helper is the thing both pages depend on, so it is asserted
  // directly as well.
  assert.deepEqual(await listLiveBriefs(env), []);
});

test('a published brief renders, with its citations, into the real built shell', async () => {
  const env = sendableEnv();
  await runWatch(env, { fetcher: stubFetch(oracleRoutes()) });
  const slug = await draftSlug(env);
  await withFetch(stubFetch(oracleRoutes()), () => publish(env, slug));

  const res = await watchBriefPage(new Request(`https://oradiscuss.com/watch/${slug}/`), env, slug);
  const html = await res.text();
  assert.equal(res.status, 200);

  assert.ok(html.includes('Alert for CVE-2026-35273'), 'a cited item is missing from the page');
  assert.ok(
    html.includes('href="https://www.oracle.com/security-alerts/alert-CVE-2026-35273.html"'),
    'the citation must link to Oracle',
  );
  assert.ok(html.includes('</footer>'), 'the site chrome was lost during injection');
  assert.ok(!html.includes('could not be read'), 'the fallback must be replaced when the data is there');

  // The head was rewritten for THIS brief, or every brief would share one
  // title and one canonical URL.
  assert.ok(html.includes(`<link rel="canonical" href="https://oradiscuss.com/watch/${slug}/">`), 'canonical not rewritten');
  assert.ok(!/<meta name="robots" content="noindex/.test(html), 'a published brief must not ship noindex');
  assert.ok(!html.includes('<title>Security Watch brief</title>'), 'the shell title survived');

  // And the archive now lists it.
  const index = await watchIndexPage(new Request('https://oradiscuss.com/watch/'), env);
  const indexHtml = await index.text();
  assert.ok(indexHtml.includes(`/watch/${slug}/`), 'the published brief is missing from the archive');
});

test('the RENDERED brief carries no em dash and every inline script compiles', async () => {
  // dist/ guards cannot see this page: half of it does not exist until the
  // Worker builds it, and the half that does not exist is the half that came
  // out of a database row.
  const env = sendableEnv();
  await runWatch(env, { fetcher: stubFetch(oracleRoutes()) });
  const slug = await draftSlug(env);
  await withFetch(stubFetch(oracleRoutes()), () => publish(env, slug));

  const res = await watchBriefPage(new Request(`https://oradiscuss.com/watch/${slug}/`), env, slug);
  const html = await res.text();

  const dash = html.indexOf('—');
  assert.equal(dash, -1, dash === -1 ? '' : `em dash at ${dash}: ...${html.slice(dash - 90, dash + 60)}...`);

  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0, 'no inline scripts on the rendered page, so this guard is asleep');
  for (const [tag, body] of scripts) {
    if (!body.trim()) continue;
    if (/type=["']application\/(ld\+)?json["']/.test(tag)) {
      JSON.parse(body);
      continue;
    }
    const isModule = /type=["']module["']/.test(tag);
    try {
      // eslint-disable-next-line no-new-func
      new Function(isModule ? `export {};\n${body}` : body);
    } catch (err) {
      if (isModule && /import|export/.test(String(err))) continue;
      assert.fail(`inline script failed to compile: ${err}\n---\n${body.slice(0, 300)}`);
    }
  }
});

test('a hostile snapshot cannot plant markup or a link on the page', () => {
  const html = renderCitations([
    { title: '<script>alert(1)</script>', url: 'https://www.oracle.com/security-alerts/x.html', source_id: 'oracle-cpu' },
    { title: 'A javascript link', url: 'javascript:alert(2)', source_id: 'oracle-cpu' },
    { title: 'An off host link', url: 'https://evil.example.com/x.html', source_id: 'oracle-cpu' },
  ]);
  assert.ok(!html.includes('<script'), 'a database row became a script tag');
  assert.ok(html.includes('&lt;script&gt;'), 'the text should still be readable');
  assert.ok(!html.includes('javascript:'), 'a javascript URL became an href');
  assert.ok(!html.includes('evil.example.com'), 'an off host URL became an href');
  assert.equal(citationUrl('https://www.oracle.com/a.html'), 'https://www.oracle.com/a.html');
  assert.equal(citationUrl('http://www.oracle.com/a.html'), null);
  assert.equal(citationUrl('not a url'), null);
});

test('the archive refuses to build a link out of an unusable slug', () => {
  const html = renderIndex([
    { slug: 'watch-2026-w33', title: 'Good', published_at: '2026-08-10 06:00:00', item_count: 2 },
    { slug: '../../etc/passwd', title: 'Bad', published_at: '2026-08-10 06:00:00', item_count: 1 },
  ]);
  assert.ok(html.includes('/watch/watch-2026-w33/'));
  assert.ok(!html.includes('etc/passwd'));
});

test('the head rewriter replaces the shell metadata rather than appending to it', () => {
  const shell = builtPage('watch/brief/index.html');
  const out = rewriteHead(shell, {
    title: 'Security Watch, week of 10 August 2026',
    description: 'Four cited items.',
    canonical: 'https://oradiscuss.com/watch/watch-2026-w33/',
  });
  assert.equal((out.match(/<link rel="canonical"/g) ?? []).length, 1, 'exactly one canonical must survive');
  assert.ok(out.includes('<title>Security Watch, week of 10 August 2026</title>'));
  assert.ok(out.includes('content="https://oradiscuss.com/watch/watch-2026-w33/"'));
  assert.ok(!/name="robots"/.test(out), 'the shell noindex must be removed for a real brief');
  assert.ok(shell.includes('name="robots"'), 'the shell itself must ship noindex, or this guard is asleep');
});

test('a database outage serves an honest page rather than a 404 or a broken one', async () => {
  const env = watchEnv();
  env.DB = {
    prepare() {
      throw new Error('D1_ERROR: connection lost');
    },
  };
  const capture = captureConsole();
  try {
    const index = await watchIndexPage(new Request('https://oradiscuss.com/watch/'), env);
    const indexHtml = await index.text();
    assert.equal(index.status, 200, 'an archive outage is not a broken page');
    assert.ok(indexHtml.includes('could not be read'), 'the honest fallback must survive');

    const brief = await watchBriefPage(new Request('https://oradiscuss.com/watch/watch-2026-w33/'), env, 'watch-2026-w33');
    assert.equal(brief.status, 503, 'an outage must not answer 404, which reads as withdrawn');
    assert.match(capture.text(), /watch_(index|brief)_read_failed/);
  } finally {
    capture.restore();
  }
});

test('the shell URL itself is not a page', async () => {
  const env = watchEnv();
  const res = await watchBriefPage(new Request('https://oradiscuss.com/watch/brief/'), env, 'brief');
  assert.equal(res.status, 404, 'the template must not be reachable as a brief');
});

/* ============================================================== publishing */

test('THE PUBLISH ENDPOINT REFUSES AN UNAUTHENTICATED CALLER, and changes nothing', async () => {
  const env = sendableEnv();
  await runWatch(env, { fetcher: stubFetch(oracleRoutes()) });
  const slug = await draftSlug(env);

  const sendStub = stubFetch(oracleRoutes());
  await withFetch(sendStub, async () => {
    const capture = captureConsole();
    try {
      const none = await publish(env, slug, null);
      assert.equal(none.res.status, 401, 'no Authorization header must be refused');
      assert.equal(none.body.code, 'no_token');

      const wrong = await publish(env, slug, 'a'.repeat(64));
      assert.equal(wrong.res.status, 401, 'a wrong token must be refused');
      assert.equal(wrong.body.code, 'bad_token');

      const short = await publish(env, slug, 'x');
      assert.equal(short.res.status, 401, 'a short token must be refused, not crash the compare');
    } finally {
      capture.restore();
    }
  });

  const after = await briefRow(env, slug);
  assert.equal(after.status, 'draft', 'a refused publish must leave the brief a draft');
  assert.equal(after.published_at, null);
  assert.equal(sendStub.to('beehiiv').length, 0, 'a refused publish must not mail anybody');
});

test('with no WATCH_ADMIN_TOKEN installed, publishing is impossible rather than unguarded', async () => {
  const env = sendableEnv({ WATCH_ADMIN_TOKEN: '' });
  await runWatch(env, { fetcher: stubFetch(oracleRoutes()) });
  const slug = await draftSlug(env);

  const capture = captureConsole();
  try {
    const open = await publish(env, slug, null);
    assert.equal(open.res.status, 503, 'a missing token must not mean an open door');
    assert.equal(open.body.code, 'not_configured');
    assert.match(open.body.error, /WATCH_ADMIN_TOKEN/);

    const guessed = await publish(env, slug, 'f'.repeat(64));
    assert.equal(guessed.res.status, 503, 'nor may any token work when none is installed');
  } finally {
    capture.restore();
  }
  assert.equal((await briefRow(env, slug)).status, 'draft');
});

test('a correct token publishes exactly one brief and sends exactly one notification', async () => {
  const env = sendableEnv();
  await runWatch(env, { fetcher: stubFetch(oracleRoutes()) });
  const slug = await draftSlug(env);

  const sendStub = stubFetch(oracleRoutes());
  const first = await withFetch(sendStub, () => publish(env, slug));
  assert.equal(first.res.status, 200);
  assert.equal(first.body.published, true);
  assert.equal(first.body.already_published, false);
  assert.equal(first.body.sent, true);
  assert.equal(sendStub.to('beehiiv').length, 1, 'exactly one send');

  const sent = JSON.parse(sendStub.to('beehiiv')[0].init.body);
  assert.deepEqual(sent.recipients.email.include_segment_ids, ['seg_members_test'], 'the send must be segmented to members');
  assert.ok(sent.body_content.includes(`/watch/${slug}/`), 'the email must link to the brief');
  assert.ok(!/@/.test(JSON.stringify(sent.recipients)), 'no address may appear in what we send');

  const row = await briefRow(env, slug);
  assert.equal(row.status, 'live');
  assert.ok(row.published_at, 'a published brief carries a publication time');
  assert.ok(row.sent_at, 'a sent brief records when');
  assert.equal(row.send_status, 'sent');
});

test('publishing twice does not send twice', async () => {
  const env = sendableEnv();
  await runWatch(env, { fetcher: stubFetch(oracleRoutes()) });
  const slug = await draftSlug(env);

  const sendStub = stubFetch(oracleRoutes());
  await withFetch(sendStub, () => publish(env, slug));
  const again = await withFetch(sendStub, () => publish(env, slug));

  assert.equal(again.res.status, 200);
  assert.equal(again.body.already_published, true);
  assert.equal(again.body.sent, false);
  assert.equal(sendStub.to('beehiiv').length, 1, 'the second publish must not mail the list again');
});

test('a brief that cannot be sent is still published, and says why', async () => {
  // beehiiv wired, but no segment named. Sending to beehiiv's default audience
  // would mean mailing the free kit list, so it refuses instead of widening.
  const env = sendableEnv({ BEEHIIV_MEMBERS_SEGMENT_ID: '' });
  await runWatch(env, { fetcher: stubFetch(oracleRoutes()) });
  const slug = await draftSlug(env);

  const sendStub = stubFetch(oracleRoutes());
  const capture = captureConsole();
  let out;
  try {
    out = await withFetch(sendStub, () => publish(env, slug));
  } finally {
    capture.restore();
  }

  assert.equal(out.body.published, true);
  assert.equal(out.body.sent, false);
  assert.equal(out.body.send_status, 'no_segment');
  assert.equal(sendStub.to('beehiiv').length, 0, 'an unnamed segment must mean no send at all');
  const row = await briefRow(env, slug);
  assert.equal(row.status, 'live', 'a failed notification must not unpublish the brief');
  assert.equal(row.sent_at, null);
  assert.equal(row.send_status, 'no_segment');
});

test('with beehiiv absent entirely, publishing still works and reports it', async () => {
  const env = watchEnv();
  await runWatch(env, { fetcher: stubFetch(oracleRoutes()) });
  const slug = await draftSlug(env);
  const sendStub = stubFetch(oracleRoutes());
  const capture = captureConsole();
  let out;
  try {
    out = await withFetch(sendStub, () => publish(env, slug));
  } finally {
    capture.restore();
  }
  assert.equal(out.body.published, true);
  assert.equal(out.body.send_status, 'not_configured');
  assert.equal(sendStub.to('beehiiv').length, 0);
});

test('publish refuses a slug that is not a draft, and one that does not exist', async () => {
  const env = sendableEnv();
  const missing = await publish(env, 'watch-2026-w01');
  assert.equal(missing.res.status, 404);
  assert.equal(missing.body.code, 'no_such_brief');

  const bad = await publish(env, 'NOT a slug');
  assert.equal(bad.res.status, 400);
  assert.equal(bad.body.code, 'bad_slug');
});

test('the founder status view needs the token and reports the unwatched sources', async () => {
  const env = watchEnv();
  await runWatch(env, { fetcher: stubFetch(oracleRoutes()) });

  const open = await handleApi(
    new Request('https://oradiscuss.com/api/watch/status'),
    env,
    '/api/watch/status',
  );
  assert.equal(open.status, 401, 'drafts and operational state are not public');

  const res = await handleApi(
    new Request('https://oradiscuss.com/api/watch/status', {
      headers: { Authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
    }),
    env,
    '/api/watch/status',
  );
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.drafts.length, 1);
  assert.equal(body.last_run_by_source.length, enabledSources().length);
  assert.ok(body.registry.some((s) => !s.enabled), 'the status view must show what is NOT watched');
});

/* ================================================== nothing sends on a cron */

test('NOTHING SENDS TO THE MEMBER LIST WITHOUT AN EXPLICIT PUBLISH', async () => {
  // The real scheduled handler, the real registry, beehiiv fully configured so
  // that silence cannot be explained by a missing key, and a stub that records
  // every outbound call.
  const env = sendableEnv();
  const sendStub = stubFetch(oracleRoutes());

  const capture = captureConsole();
  try {
    await withFetch(sendStub, () => worker.scheduled({ cron: '0 6 * * 1' }, env));
    await withFetch(sendStub, () => worker.scheduled({ cron: '0 6 * * 1' }, env));
  } finally {
    capture.restore();
  }

  assert.equal(sendStub.to('beehiiv').length, 0, 'the scheduled run mailed the list');
  assert.equal(sendStub.to('oracle.com').length >= 1, true, 'this guard is asleep unless the run actually ran');

  const live = await env.DB.prepare("SELECT COUNT(*) AS n FROM watch_brief WHERE status = 'live'").first();
  const sent = await env.DB.prepare('SELECT COUNT(*) AS n FROM watch_brief WHERE sent_at IS NOT NULL').first();
  assert.equal(live.n, 0, 'the scheduled run published a brief');
  assert.equal(sent.n, 0, 'the scheduled run recorded a send');
  assert.match(capture.text(), /watch_run_complete/);
});

test('the manual run endpoint takes the same path and also cannot publish', async () => {
  const env = sendableEnv();
  const sendStub = stubFetch(oracleRoutes());

  const open = await handleApi(
    new Request('https://oradiscuss.com/api/watch/run', { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.9' } }),
    env,
    '/api/watch/run',
  );
  assert.equal(open.status, 401, 'the manual run is not public');

  const res = await withFetch(sendStub, () =>
    handleApi(
      new Request('https://oradiscuss.com/api/watch/run', {
        method: 'POST',
        headers: { Authorization: `Bearer ${TEST_ADMIN_TOKEN}`, 'CF-Connecting-IP': '203.0.113.9' },
      }),
      env,
      '/api/watch/run',
    ),
  );
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(body.brief.slug);
  assert.equal(sendStub.to('beehiiv').length, 0);
  const live = await env.DB.prepare("SELECT COUNT(*) AS n FROM watch_brief WHERE status = 'live'").first();
  assert.equal(live.n, 0);
});

/* =========================================================== the structure */

function workerSources() {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.js')) files.push([full, readFileSync(full, 'utf8')]);
    }
  };
  walk(WORKER_DIR);
  const entry = new URL('../worker.js', import.meta.url).pathname;
  files.push([entry, readFileSync(entry, 'utf8')]);
  return files;
}

test('only worker/watch-publish.js can set a brief live', () => {
  const files = workerSources();
  assert.ok(files.length >= 8, `only ${files.length} worker files read, the sweep is broken`);

  const offenders = files
    .filter(([, src]) => /SET\s+status\s*=\s*'live'/i.test(src) || /published_at\s*=\s*datetime/i.test(src))
    .map(([path]) => path);

  assert.deepEqual(
    offenders.map((p) => p.split('/').pop()),
    ['watch-publish.js'],
    'publishing is a founder gate: only the token guarded endpoint may write it',
  );
});

test('only worker/watch-publish.js can reach the member list', () => {
  const files = workerSources();
  const callers = files
    .filter(([path, src]) => /beehiivSendBrief\s*\(/.test(src) && !path.endsWith('integrations.js'))
    .map(([path]) => path.split('/').pop());
  assert.deepEqual(callers, ['watch-publish.js'], 'the send must have exactly one caller');

  // And the scheduled entry point cannot even see that module. The check is on
  // the IMPORT rather than on the text: the first version searched for the
  // string and failed against a COMMENT in worker.js naming the file it must
  // not import, which is a guard measuring the wrong thing.
  const entry = readFileSync(new URL('../worker.js', import.meta.url).pathname, 'utf8');
  const imports = [...entry.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.ok(imports.length >= 4, `only ${imports.length} imports parsed, the matcher is broken`);
  assert.ok(
    !imports.some((i) => i.includes('watch-publish')),
    `the Worker entry imports the publish module: ${imports.join(', ')}`,
  );
  assert.ok(entry.includes('async scheduled('), 'the scheduled handler is missing, so this guard is asleep');

  // The pipeline itself imports nothing that can publish or send. Same rule as
  // above: the IMPORT is what matters, and both files name watch-publish.js in
  // prose precisely because the separation is worth explaining.
  const pipeline = readFileSync(new URL('../worker/watch.js', import.meta.url).pathname, 'utf8');
  const pipelineImports = [...pipeline.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.ok(pipelineImports.length >= 2, 'the import matcher is broken');
  assert.ok(!/beehiiv/i.test(pipeline), 'the drafting job must not know how to mail anybody');
  assert.ok(
    !pipelineImports.some((i) => i.includes('watch-publish')),
    `the drafting job imports the publish module: ${pipelineImports.join(', ')}`,
  );
});

test('the cron is declared, is MONTHLY on the third Thursday, and preview is explicitly given none', () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url).pathname, 'utf8');
  // Tolerates the comment block between the header and the value: the reason
  // this date was chosen is written there, and a regex that forbade it would
  // punish the file for explaining itself.
  const prod = /\[triggers\][\s\S]*?\ncrons = \["([^"]+)"\]/.exec(toml);
  assert.ok(prod, 'no production cron is declared');
  assert.equal(
    prod[1],
    '0 6 * * THU#3',
    'the schedule must be the monthly third Thursday, two days after Oracle publishes',
  );
  assert.match(toml, /third Tuesday/i, 'the config no longer records WHY this date was chosen');
  // Day of month must stay `*`. A restricted day-of-month beside a restricted
  // weekday is ORed by standard cron, so `15-21 * THU` would fire every
  // Thursday AND every day from the 15th to the 21st.
  assert.equal(
    prod[1].split(/\s+/)[2],
    '*',
    'day-of-month is restricted beside a restricted weekday, which cron ORs rather than ANDs',
  );

  assert.match(
    toml,
    /\[env\.preview\.triggers\]\s*\ncrons = \[\]/,
    'preview must be given an EMPTY cron list, or it inherits the production schedule silently',
  );
  assert.match(toml, /run_worker_first = \[[^\]]*"\/watch\/\*"/, 'production must route /watch/* to the Worker');
  assert.match(
    toml,
    /\[env\.preview\.assets\][\s\S]*?run_worker_first = \[[^\]]*"\/watch\/\*"/,
    'preview must route /watch/* to the Worker too',
  );
});

test('the migration extends watch_brief rather than replacing it', () => {
  const sql = readFileSync(new URL('../migrations/0004_watch.sql', import.meta.url).pathname, 'utf8');
  assert.ok(!/DROP\s+TABLE/i.test(sql), 'a migration in this repository never drops a table');
  assert.ok(!/CREATE\s+TABLE[^;]*watch_brief/i.test(sql), 'watch_brief already exists and must be extended');
  assert.match(sql, /ALTER TABLE watch_brief ADD COLUMN sent_at/);
  assert.ok(!/—/.test(sql), 'no em dash, including in SQL comments');
  // No column here may hold a person.
  for (const banned of ['email', 'subscriber', 'ip_address', 'name TEXT']) {
    assert.ok(!new RegExp(banned, 'i').test(sql), `0004 declares a column that could hold a person: ${banned}`);
  }
});
