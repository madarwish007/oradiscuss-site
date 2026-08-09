// GUARDS over the Security Watch pipeline.
//
// THE INVARIANT CHANGED ON 9 Aug 2026, AND SO DID THESE GUARDS. Founder ruling,
// verbatim: "Monthly is okay, and that should be automated workflow without any
// human intervention, as a Founder, i need to get an aknowledgement about the
// updated kits only." That reverses his own 5 Aug standing gate, under which
// publishing the brief and sending it to the member list were founder-only.
//
// THE OLD INVARIANT, which several guards below used to assert:
//   nothing publishes without the token.
//
// THE NEW ONE, which they assert now:
//   nothing publishes without passing the CIRCUIT BREAKER, and nothing sends
//   without a live, non empty brief and a named member segment.
//
// The guards that changed were REWRITTEN to assert the new invariant, never
// deleted to make something pass, and the ones that still hold were left exactly
// as they were:
//
//   1. a draft does not appear on the public archive            unchanged
//   2. a second run over the same source creates no duplicate   unchanged
//   3. a failing source is RECORDED as failed, not skipped      unchanged
//   4. the publish endpoint refuses an unauthenticated caller   unchanged, it is
//      now the MANUAL OVERRIDE rather than the only door
//   5. nothing sends to the member list without an explicit publish
//                                                               REWRITTEN: the
//      scheduled cycle publishes and sends, and the thing that stands between a
//      broken run and the founder's name is the breaker, so the guard now
//      measures the breaker instead of the absence of a caller
//
// Plus the ones the shape of this feature earns: a published brief is never
// rewritten by the job, a hostile feed cannot plant a link or markup on a page
// that carries our name, and no code outside worker/watch-publish.js can set a
// brief live or call the list. Those three are structural and survive the
// ruling untouched.
//
// NOTHING HERE REACHES THE NETWORK. Every fetch goes through the stub in
// test/support/watch-fixtures.js, which records what it was asked for, so "the
// cycle sent exactly one notification" is a measurement of calls rather than a
// reading of the code.

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
import { runWatchCycle } from '../worker/watch-cycle.js';
import { publishBrief } from '../worker/watch-publish.js';
import { watchConfig, evaluateBreaker, checkStaleness } from '../worker/watch-breaker.js';
import { memberSendReadiness } from '../worker/integrations.js';
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

// A synthetic acknowledgement endpoint. Nothing in this suite reaches it: the
// stub answers for it and records the call, which is how "he was told" and "he
// was not told" become measurements rather than readings of the code.
const NOTIFY_HOOK = 'https://hooks.example.com/oradiscuss-watch';

function notifiableEnv(overrides = {}) {
  return sendableEnv({ WATCH_NOTIFY_WEBHOOK: NOTIFY_HOOK, ...overrides });
}

function oracleRoutes(now = new Date(), html = null) {
  return {
    [ORACLE_ALERT_INDEX]: { body: html ?? oracleIndexHtml(now) },
    [BEEHIIV_POSTS]: { body: JSON.stringify({ data: { id: 'post_1' } }), type: 'application/json' },
    [NOTIFY_HOOK]: { body: JSON.stringify({ ok: true }), type: 'application/json' },
  };
}

async function cycleRows(env) {
  const { results } = await env.DB.prepare('SELECT * FROM watch_cycle ORDER BY id').all();
  return results ?? [];
}

async function lastCycle(env) {
  const rows = await cycleRows(env);
  return rows[rows.length - 1] ?? null;
}

// One scheduled cycle, driven with the stub and a fixed clock. It takes exactly
// the same path worker.scheduled takes; the tests that need to prove THAT use
// worker.scheduled itself.
async function cycle(env, stub, now = new Date()) {
  const capture = captureConsole();
  let out;
  try {
    out = await withFetch(stub, () => runWatchCycle(env, { fetcher: stub, now }));
  } finally {
    capture.restore();
  }
  out.log = capture.text();
  return out;
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

// REWRITTEN NAME, SAME ASSERTION. This used to be called "a scheduled run
// writes a DRAFT and publishes nothing", which is no longer what a scheduled run
// does. What it measures is still exactly right and still worth having: the
// DRAFTING JOB is a layer that cannot publish, which is why the breaker can sit
// between it and publication at all.
test('THE DRAFTING JOB writes a draft and publishes nothing, whatever the schedule then does', async () => {
  const env = watchEnv();
  const fetchStub = stubFetch(oracleRoutes());
  const summary = await runWatch(env, { fetcher: fetchStub });

  assert.equal(summary.sources.length, enabledSources().length);
  assert.ok(summary.items_new >= 4, `expected at least four items, got ${summary.items_new}`);

  const drafts = await env.DB.prepare("SELECT COUNT(*) AS n FROM watch_brief WHERE status = 'draft'").first();
  const live = await env.DB.prepare("SELECT COUNT(*) AS n FROM watch_brief WHERE status = 'live'").first();
  assert.equal(drafts.n, 1, 'exactly one draft is opened');
  assert.equal(live.n, 0, 'the drafting job must never publish');

  const brief = await briefRow(env, summary.brief.slug);
  assert.equal(brief.published_at, null, 'a draft carries no publication date');
  assert.equal(brief.published_by, null, 'a draft was published by nobody');
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

// EXTENDED to the WHOLE CYCLE rather than the drafting half. The cycle now
// publishes, mails a list and writes an acknowledgement ledger, so the sweep has
// to cover the three writes the 9 Aug ruling added or it would be checking the
// only part of the pipeline that never touched a person in the first place.
test('the whole cycle stores nothing that could identify a person', async () => {
  const draftOnly = watchEnv();
  const first = captureConsole();
  try {
    await runWatch(draftOnly, { fetcher: stubFetch(oracleRoutes()) });
  } finally {
    first.restore();
  }

  const full = notifiableEnv();
  const stub = stubFetch(oracleRoutes());
  const second = captureConsole();
  try {
    await withFetch(stub, () => runWatchCycle(full, { fetcher: stub }));
  } finally {
    second.restore();
  }
  // The guard is asleep unless the cycle actually got as far as the send and the
  // acknowledgement, which are the two stages that touch a mailing list at all.
  assert.equal(stub.to('beehiiv').length, 1, 'the cycle did not send, so this sweep proves nothing');
  assert.equal(stub.to('hooks.example.com').length, 1, 'the cycle did not acknowledge, so this sweep proves nothing');

  for (const [label, env, capture] of [['drafting', draftOnly, first], ['cycle', full, second]]) {
    const written = everythingWritten(env, capture);
    for (const forbidden of ['@', 'email', 'ip_address', 'CF-Connecting-IP']) {
      assert.ok(
        !written.toLowerCase().includes(forbidden.toLowerCase()),
        `the ${label} path wrote something containing "${forbidden}"`,
      );
    }
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
  assert.equal(row.published_by, 'manual', 'who published a brief is recorded, and this one was a person');
  assert.ok(row.sent_at, 'a sent brief records when');
  assert.equal(row.send_status, 'sent');
});

// REWRITTEN. The old version asserted that a second publish sends nothing, full
// stop, which was right while a person was the only caller and a failed send
// could be retried by hand. It is wrong now: a brief that publishes and cannot
// send would be a dead end, because the only route that can send refuses to look
// at a live brief. So the guard splits the two cases and asserts both.
test('publishing twice does not send twice, and a send that FAILED can still be retried', async () => {
  const env = sendableEnv();
  await runWatch(env, { fetcher: stubFetch(oracleRoutes()) });
  const slug = await draftSlug(env);

  const sendStub = stubFetch(oracleRoutes());
  await withFetch(sendStub, () => publish(env, slug));
  const again = await withFetch(sendStub, () => publish(env, slug));

  assert.equal(again.res.status, 200);
  assert.equal(again.body.already_published, true);
  assert.equal(again.body.sent, false);
  assert.equal(again.body.send_status, 'sent', 'the second call reports the send that already happened');
  assert.equal(sendStub.to('beehiiv').length, 1, 'the second publish must not mail the list again');

  // The other half: a brief whose FIRST send was refused. The segment is absent
  // at publication and appears afterwards, which is exactly the shape of "the
  // founder wired beehiiv the day after the cycle ran".
  const held = sendableEnv({ BEEHIIV_MEMBERS_SEGMENT_ID: '' });
  await runWatch(held, { fetcher: stubFetch(oracleRoutes()) });
  const heldSlug = await draftSlug(held);
  const retryStub = stubFetch(oracleRoutes());

  const capture = captureConsole();
  try {
    const first = await withFetch(retryStub, () => publish(held, heldSlug));
    assert.equal(first.body.published, true);
    assert.equal(first.body.sent, false);
    assert.equal(first.body.send_status, 'no_segment');
    assert.equal(retryStub.to('beehiiv').length, 0, 'an unnamed segment must mean no send at all');
    assert.equal((await briefRow(held, heldSlug)).sent_at, null);

    held.BEEHIIV_MEMBERS_SEGMENT_ID = 'seg_members_test';
    const retry = await withFetch(retryStub, () => publish(held, heldSlug));
    assert.equal(retry.body.already_published, true);
    assert.equal(retry.body.sent, true, 'a published brief whose send failed must be sendable');
    assert.equal(retryStub.to('beehiiv').length, 1, 'exactly one send, on the retry');
  } finally {
    capture.restore();
  }

  const after = await briefRow(held, heldSlug);
  assert.ok(after.sent_at, 'the retried send is recorded');
  assert.equal(after.send_status, 'sent');
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

/* ============================================== the cycle and the breaker */

/* THE GUARD THIS SECTION REPLACED asserted "NOTHING SENDS TO THE MEMBER LIST
   WITHOUT AN EXPLICIT PUBLISH", which was the 5 Aug gate written as a test. The
   founder reversed that gate on 9 Aug. What stands between a broken run and his
   name is now the CIRCUIT BREAKER, so these guards measure the breaker: they
   assert that a healthy cycle publishes and sends exactly once, and that every
   named failure HOLDS the brief as a draft and mails nobody.

   Every one of the five failure guards below was watched failing with the break
   ASSERTED PRESENT in the database or the fixture first, because a break that
   did not land is indistinguishable from a guard that passed. */

test('THE SCHEDULED CYCLE PUBLISHES ONE BRIEF AND SENDS ONE NOTIFICATION, and a second cycle does neither again', async () => {
  // The real scheduled handler, the real registry, beehiiv fully configured, and
  // a stub that records every outbound call.
  const env = sendableEnv();
  const sendStub = stubFetch(oracleRoutes());

  const capture = captureConsole();
  try {
    await withFetch(sendStub, () => worker.scheduled({ cron: '0 6 * * THU#3' }, env));
  } finally {
    capture.restore();
  }

  assert.ok(sendStub.to('oracle.com').length >= 1, 'this guard is asleep unless the run actually ran');
  assert.equal(sendStub.to('beehiiv').length, 1, 'a verified cycle mails the member list exactly once');

  const live = await env.DB.prepare("SELECT slug, published_by, item_count, sent_at, send_status FROM watch_brief WHERE status = 'live'").all();
  assert.equal(live.results.length, 1, 'the cycle published exactly one brief');
  assert.equal(live.results[0].published_by, 'auto', 'a scheduled publication is recorded as automatic');
  assert.ok(live.results[0].item_count >= 4);
  assert.ok(live.results[0].sent_at, 'a sent brief records when');
  assert.equal(live.results[0].send_status, 'sent');
  assert.match(capture.text(), /watch_run_complete/);

  const first = await lastCycle(env);
  assert.equal(first.verdict, 'published');
  assert.equal(first.send_status, 'sent');

  // A SECOND CYCLE. Nothing new on the page, a brief already out for this Oracle
  // patch cycle, so there is nothing to publish and nothing wrong with that.
  const secondStub = stubFetch(oracleRoutes());
  const again = captureConsole();
  try {
    await withFetch(secondStub, () => worker.scheduled({ cron: '0 6 * * THU#3' }, env));
  } finally {
    again.restore();
  }

  assert.equal(secondStub.to('beehiiv').length, 0, 'the second cycle must not mail the list again');
  const liveAfter = await env.DB.prepare("SELECT COUNT(*) AS n FROM watch_brief WHERE status = 'live'").first();
  assert.equal(liveAfter.n, 1, 'the second cycle published a second brief');
  const second = await lastCycle(env);
  assert.equal(second.verdict, 'quiet', 'an empty cycle after a publication in the same period is quiet, not a fault');
  assert.equal(second.notify_status, 'suppressed_quiet', 'a quiet cycle must not become a founder chore');
});

test('A 403 ON ANY ENABLED SOURCE HOLDS THE BRIEF: nothing is published and nothing is sent', async () => {
  const env = notifiableEnv();
  const routes = { ...oracleRoutes(), [ORACLE_ALERT_INDEX]: { status: 403, body: 'forbidden' } };
  const stub = stubFetch(routes);

  // THE BREAK, ASSERTED PRESENT BEFORE THE CYCLE RUNS. A stub that quietly
  // answered 200 would make this guard pass by proving nothing.
  const probe = await stub(ORACLE_ALERT_INDEX, {});
  assert.equal(probe.status, 403, 'the fixture is not returning 403, so this guard is asleep');

  const out = await cycle(env, stub);

  assert.equal(out.cycle.verdict, 'held');
  const row = await lastCycle(env);
  assert.equal(row.verdict, 'held');
  assert.match(
    row.reasons,
    /source oracle-cpu did not return ok: http_403 \(http 403\)/,
    `the hold reason must name the source and the status, got: ${row.reasons}`,
  );
  for (const id of enabledSources().map((s) => s.id)) {
    assert.ok(row.reasons.includes(id), `${id} also failed and is missing from the reason`);
  }

  const live = await env.DB.prepare("SELECT COUNT(*) AS n FROM watch_brief WHERE status = 'live'").first();
  assert.equal(live.n, 0, 'a held cycle must publish nothing');
  assert.equal(stub.to('beehiiv').length, 0, 'a held cycle must mail nobody');
  assert.equal(stub.to('hooks.example.com').length, 1, 'a HELD cycle must always reach the founder');
  assert.equal(row.notify_status, 'delivered');

  // And the break is still there afterwards, so the pass was not bought by the
  // fixture quietly repairing itself.
  const after = await stub(ORACLE_ALERT_INDEX, {});
  assert.equal(after.status, 403);
});

test('A ZERO ITEM CYCLE IN A MONTH WHOSE PATCH ALREADY DROPPED IS PARSE ROT, not a quiet month', async () => {
  // The page fetches perfectly and yields nothing, which is what an Oracle
  // redesign looks like from here: every source ok, every status 200, and a
  // matcher that has silently stopped matching.
  const redesigned = '<html><body><h1>Security Alerts</h1><p>redesigned</p></body></html>';
  const cpu = SOURCES.find((s) => s.id === 'oracle-cpu');

  // THE BREAK, ASSERTED PRESENT: the fixture really does parse to nothing.
  assert.equal(extractAlertIndex(redesigned, cpu).length, 0, 'the fixture still parses, so this guard is asleep');

  // Two days after Oracle's own release day for that month, which is exactly
  // when the cron fires.
  const drop = thirdTuesdayOf(2026, 7);
  const now = new Date(drop.getTime() + 2 * 86400000);
  assert.ok(now.getTime() >= drop.getTime(), 'the clock is before the release day, so the tripwire cannot fire');
  assert.equal(now.toISOString().slice(0, 10), '2026-08-20', 'the third Thursday of August 2026 moved');

  const env = notifiableEnv();
  const stub = stubFetch({ ...oracleRoutes(), [ORACLE_ALERT_INDEX]: { body: redesigned } });
  const out = await cycle(env, stub, now);

  assert.equal(out.cycle.verdict, 'held', 'an unexplained empty cycle must HOLD, not pass as quiet');
  const row = await lastCycle(env);
  assert.match(
    row.reasons,
    /every source returned ok and the draft is empty, but Oracle's release day for 2026-08 was 2026-08-18/,
    `the tripwire must say what it expected, got: ${row.reasons}`,
  );
  assert.match(row.reasons, /parser that stopped matching, not a quiet month/);
  assert.equal(stub.to('hooks.example.com').length, 1, 'parse rot must reach the founder');

  // THE CONTROL, which is what makes this a tripwire rather than an alarm that
  // fires on every empty month: the same empty page BEFORE the release day is a
  // quiet cycle, and quiet is silent.
  const early = notifiableEnv();
  const earlyStub = stubFetch({ ...oracleRoutes(), [ORACLE_ALERT_INDEX]: { body: redesigned } });
  const before = new Date(drop.getTime() - 3 * 86400000);
  const quiet = await cycle(early, earlyStub, before);
  assert.equal(quiet.cycle.verdict, 'quiet', 'an empty cycle before the release day is not evidence of anything');
  assert.equal(earlyStub.to('hooks.example.com').length, 0, 'a quiet cycle must say nothing');
});

test('A MISSING SEGMENT ID HOLDS THE SEND AND NOT THE PUBLISH, and the split is visible in the record', async () => {
  const env = notifiableEnv({ BEEHIIV_MEMBERS_SEGMENT_ID: '' });

  // THE BREAK, ASSERTED PRESENT before anything runs.
  assert.equal(memberSendReadiness(env).status, 'no_segment', 'the segment is set, so this guard is asleep');

  const stub = stubFetch(oracleRoutes());
  const out = await cycle(env, stub);

  assert.equal(out.cycle.verdict, 'published', 'the site is the product: a send that cannot happen must not block it');
  assert.equal(stub.to('beehiiv').length, 0, 'an unnamed segment must mean no send at all, never a widened one');

  const brief = await briefRow(env, out.cycle.brief_slug);
  assert.equal(brief.status, 'live');
  assert.equal(brief.published_by, 'auto');
  assert.equal(brief.sent_at, null, 'nothing was sent, so nothing is timestamped');
  assert.equal(brief.send_status, 'no_segment', 'published but not sent must be a state with a name');

  const row = await lastCycle(env);
  assert.equal(row.verdict, 'published');
  assert.equal(row.send_status, 'no_segment');
  assert.equal(stub.to('hooks.example.com').length, 1, 'he is told the brief went out and the mail did not');

  // And the founder view carries the same fact, so it is visible without a log.
  const status = await handleApi(
    new Request('https://oradiscuss.com/api/watch/status', { headers: { Authorization: `Bearer ${TEST_ADMIN_TOKEN}` } }),
    env,
    '/api/watch/status',
  );
  const body = await status.json();
  assert.equal(body.published[0].send_status, 'no_segment');
  assert.equal(body.published[0].sent_at, null);
  assert.equal(body.cycles[0].send_status, 'no_segment');
});

test('AN EM DASH IN A DRAFTED TITLE HOLDS THE BRIEF, because the rendered page is swept and not assumed', async () => {
  const env = notifiableEnv();
  await runWatch(env, { fetcher: stubFetch(oracleRoutes()) });

  // Straight into the ledger, because every path INTO it normalises the dash
  // away: worker/watch.js plainText is what makes the ingest side safe, and this
  // guard exists for the day something else writes a row.
  const poisoned = 'Critical Patch Update — July 2026';
  await env.DB.prepare(
    "UPDATE watch_item SET title = ?1 WHERE url LIKE '%cpujul2026%'",
  )
    .bind(poisoned)
    .run();

  // THE BREAK, ASSERTED PRESENT IN THE DATABASE.
  const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM watch_item WHERE title LIKE '%—%'").first();
  assert.equal(before.n, 1, 'the em dash did not land, so this guard is asleep');

  const stub = stubFetch(oracleRoutes());
  const out = await cycle(env, stub);

  assert.equal(out.cycle.verdict, 'held');
  const row = await lastCycle(env);
  assert.match(row.reasons, /the rendered brief carries an em dash at offset \d+/, `got: ${row.reasons}`);
  assert.match(row.reasons, /Critical Patch Update/, 'the reason must quote the offending text');

  const live = await env.DB.prepare("SELECT COUNT(*) AS n FROM watch_brief WHERE status = 'live'").first();
  assert.equal(live.n, 0, 'an em dash reached a published page');
  assert.equal(stub.to('beehiiv').length, 0);

  // Re-read: the break is still in the database, so the hold was caused by it.
  const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM watch_item WHERE title LIKE '%—%'").first();
  assert.equal(after.n, 1);
});

test('AN ITEM URL ON A HOST THE REGISTRY DOES NOT DECLARE HOLDS THE BRIEF', async () => {
  const env = notifiableEnv();
  await runWatch(env, { fetcher: stubFetch(oracleRoutes()) });

  // normaliseItem refuses this at ingest, which is the first of the two layers
  // and is asserted elsewhere. This row is written straight into the ledger to
  // prove the SECOND layer exists: the breaker reads what is in the draft, not
  // what the ingest rules would have allowed.
  await env.DB.prepare(
    `INSERT INTO watch_item (item_key, source_id, brief_id, title, url, revision, published_on, first_seen_at)
     VALUES ('planted', 'oracle-cpu', NULL, 'Critical Patch Update mirror', 'https://evil.example.com/x.html', 'Rev 1', NULL, datetime('now'))`,
  ).run();

  // THE BREAK, ASSERTED PRESENT IN THE DATABASE.
  const before = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM watch_item WHERE url NOT LIKE 'https://www.oracle.com/%'",
  ).first();
  assert.equal(before.n, 1, 'the off host row did not land, so this guard is asleep');

  const stub = stubFetch(oracleRoutes());
  const out = await cycle(env, stub);

  assert.equal(out.cycle.verdict, 'held');
  const row = await lastCycle(env);
  assert.match(
    row.reasons,
    /links to https:\/\/evil\.example\.com\/x\.html, which is not https on a host the registry declares/,
    `got: ${row.reasons}`,
  );

  const live = await env.DB.prepare("SELECT COUNT(*) AS n FROM watch_brief WHERE status = 'live'").first();
  assert.equal(live.n, 0);
  assert.equal(stub.to('beehiiv').length, 0);

  const after = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM watch_item WHERE url NOT LIKE 'https://www.oracle.com/%'",
  ).first();
  assert.equal(after.n, 1);
});

test('the item ceiling holds a cycle that suddenly matches far too much', async () => {
  const env = notifiableEnv({ WATCH_MAX_ITEMS: '3' });
  assert.equal(watchConfig(env).maxItems, 3, 'the ceiling did not take, so this guard is asleep');

  const stub = stubFetch(oracleRoutes());
  const out = await cycle(env, stub);

  assert.equal(out.cycle.verdict, 'held');
  const row = await lastCycle(env);
  assert.match(row.reasons, /the draft carries 4 items, above the configured ceiling of 3/, `got: ${row.reasons}`);
  assert.equal(stub.to('beehiiv').length, 0);
});

test('the breaker refuses to speak about an empty draft when a source failed, because it cannot know', () => {
  // A source that failed means we do not know what the cycle SHOULD have found,
  // so the tripwire must not add "and the draft is empty" to a fault it cannot
  // attribute. The hold is real either way; the REASON has to be the true one.
  const now = new Date('2026-08-20T06:00:00Z');
  const verdict = evaluateBreaker({
    summary: { sources: [{ id: 'oracle-cpu', ok: false, http_status: 403, error: 'http_403' }] },
    brief: { title: 'Security Watch, August 2026', body_md: '', published_at: null },
    snapshot: [],
    now,
    config: watchConfig({}),
    expectedIds: ['oracle-cpu'],
    publishedThisPeriod: false,
  });
  assert.equal(verdict.verdict, 'hold');
  assert.ok(!/parser that stopped matching/.test(verdict.reasons), 'a failed fetch must not be reported as parse rot');

  // And the tripwire itself, asserted directly in both directions so neither
  // branch is taken on trust.
  assert.equal(checkStaleness([], { now, publishedThisPeriod: true }), null, 'already published this cycle');
  assert.ok(checkStaleness([], { now, publishedThisPeriod: false }), 'nothing published and the drop has passed');
  assert.equal(
    checkStaleness([{ url: 'https://www.oracle.com/a.html' }], { now, publishedThisPeriod: false }),
    null,
    'a draft with items is not empty',
  );
});

test('A SUMMARY THAT REPORTS NO SOURCES AT ALL IS A FAULT, because [].every(ok) is true', () => {
  // The asleep-guard failure this whole file is written against. A source sweep
  // built only on `every` passes an empty list, so coverage is checked first.
  const verdict = evaluateBreaker({
    summary: { sources: [] },
    brief: { title: 'Security Watch', body_md: '', published_at: null },
    snapshot: [{ source_id: 'oracle-cpu', title: 'x', url: 'https://www.oracle.com/a.html', published_on: null }],
    now: new Date('2026-08-20T06:00:00Z'),
    config: watchConfig({}),
    expectedIds: ['oracle-cpu', 'oracle-cspu'],
    publishedThisPeriod: false,
  });
  assert.equal(verdict.verdict, 'hold');
  assert.match(verdict.reasons, /source oracle-cpu reported no run this cycle/);
  assert.match(verdict.reasons, /source oracle-cspu reported no run this cycle/);
});

/* ============================================== the acknowledgement */

test('THE ACKNOWLEDGEMENT IS ABOUT SOMETHING: a quiet cycle is silent and NOTIFY_EMPTY_CYCLES defaults to off', async () => {
  // Founder ruling: "i need to get an aknowledgement about the updated kits
  // only". An acknowledgement of nothing is the recurring chore his
  // automation-first ruling bans, so quiet is silent by default.
  const off = notifiableEnv();
  assert.equal(watchConfig(off).notifyEmptyCycles, false, 'NOTIFY_EMPTY_CYCLES must default to OFF');

  const redesigned = '<html><body>nothing here</body></html>';
  const early = new Date(thirdTuesdayOf(2026, 7).getTime() - 3 * 86400000);
  const quietStub = stubFetch({ ...oracleRoutes(), [ORACLE_ALERT_INDEX]: { body: redesigned } });
  const quiet = await cycle(off, quietStub, early);
  assert.equal(quiet.cycle.verdict, 'quiet');
  assert.equal(quietStub.to('hooks.example.com').length, 0, 'a healthy quiet month must not become an inbox item');
  assert.equal((await lastCycle(off)).notify_status, 'suppressed_quiet');
  assert.match(quiet.log, /watch_ack_suppressed_quiet/, 'a suppressed acknowledgement is still logged');

  // The flag is in his hands and it works.
  const on = notifiableEnv({ NOTIFY_EMPTY_CYCLES: '1' });
  assert.equal(watchConfig(on).notifyEmptyCycles, true);
  const onStub = stubFetch({ ...oracleRoutes(), [ORACLE_ALERT_INDEX]: { body: redesigned } });
  const told = await cycle(on, onStub, early);
  assert.equal(told.cycle.verdict, 'quiet');
  assert.equal(onStub.to('hooks.example.com').length, 1, 'NOTIFY_EMPTY_CYCLES on must report a quiet cycle');
});

test('the acknowledgement carries the cycle and nobody, and degrades honestly with no webhook', async () => {
  const env = notifiableEnv();
  const stub = stubFetch(oracleRoutes());
  await cycle(env, stub);

  const calls = stub.to('hooks.example.com');
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.event, 'oradiscuss.watch.cycle');
  assert.equal(payload.verdict, 'published');
  assert.ok(payload.brief.slug);
  assert.equal(payload.brief.url, `https://oradiscuss.com/watch/${payload.brief.slug}/`);
  assert.ok(payload.item_count >= 4);
  assert.equal(payload.send_status, 'sent');
  // No person, checked as a sweep over the whole payload rather than field by
  // field, because a field added later would escape a field by field check.
  const flat = JSON.stringify(payload).toLowerCase();
  for (const forbidden of ['@', 'email', 'subscriber', 'segment']) {
    assert.ok(!flat.includes(forbidden), `the acknowledgement carries "${forbidden}"`);
  }

  // With no webhook configured the cycle still runs, still records, and says
  // plainly that nobody was told.
  const dark = sendableEnv();
  assert.equal(watchConfig(dark).notifyWebhook, null);
  const darkStub = stubFetch(oracleRoutes());
  const out = await cycle(dark, darkStub);
  assert.equal(out.cycle.verdict, 'published');
  assert.equal(out.cycle.notify_status, 'not_configured', 'an undelivered acknowledgement must not report success');
  assert.equal((await lastCycle(dark)).notified, 0);
  assert.match(out.log, /watch_ack /, 'the log line is the record of last resort and must always be written');
});

test('an acknowledgement that cannot be delivered does not undo the cycle', async () => {
  const env = notifiableEnv();
  const stub = stubFetch({ ...oracleRoutes(), [NOTIFY_HOOK]: { throws: 'hook unreachable' } });
  const out = await cycle(env, stub);

  assert.equal(out.cycle.verdict, 'published', 'a dead webhook must not unpublish a brief');
  assert.equal(out.cycle.notify_status, 'unreachable');
  const row = await lastCycle(env);
  assert.equal(row.verdict, 'published');
  assert.equal(row.notified, 0, 'a notification that did not land is recorded as not landed');
  assert.match(out.log, /watch_ack_unreachable/);
});

test('a non https acknowledgement URL is refused rather than used', () => {
  assert.equal(watchConfig({ WATCH_NOTIFY_WEBHOOK: 'http://hooks.example.com/x' }).notifyWebhook, null);
  assert.equal(watchConfig({ WATCH_NOTIFY_WEBHOOK: 'not a url' }).notifyWebhook, null);
  assert.equal(watchConfig({ WATCH_NOTIFY_WEBHOOK: '  ' }).notifyWebhook, null);
  assert.equal(watchConfig({ WATCH_NOTIFY_WEBHOOK: NOTIFY_HOOK }).notifyWebhook, NOTIFY_HOOK);
  // And the same rule on the origin the member email links to, because a link
  // to the wrong host cannot be taken back once it is mailed.
  assert.equal(watchConfig({ SITE_ORIGIN: 'http://oradiscuss.com' }).siteOrigin, 'https://oradiscuss.com');
  assert.equal(watchConfig({}).siteOrigin, 'https://oradiscuss.com');
});

/* ================================================ the manual override */

test('THE MANUAL PUBLISH REFUSES A BRIEF THE BREAKER HELD, and force is recorded as force', async () => {
  const env = sendableEnv();
  await runWatch(env, { fetcher: stubFetch(oracleRoutes()) });
  await env.DB.prepare(
    `INSERT INTO watch_item (item_key, source_id, brief_id, title, url, revision, published_on, first_seen_at)
     VALUES ('planted-manual', 'oracle-cpu', NULL, 'A mirror', 'https://evil.example.com/x.html', NULL, NULL, datetime('now'))`,
  ).run();
  await rollUpDraft(env, new Date());
  const slug = await draftSlug(env);

  // THE BREAK, ASSERTED PRESENT.
  const draft = await briefRow(env, slug);
  assert.ok(draft.sources_json.includes('evil.example.com'), 'the poisoned row is not in the draft, guard asleep');

  const stub = stubFetch(oracleRoutes());
  const capture = captureConsole();
  let refused;
  let forced;
  try {
    refused = await withFetch(stub, () => publish(env, slug));
    assert.equal(refused.res.status, 409, 'the breaker must refuse the manual path too');
    assert.equal(refused.body.code, 'breaker_held');
    assert.match(refused.body.error, /evil\.example\.com/, 'he must be shown what it refused on');
    assert.match(refused.body.error, /"force":true/, 'and how to override it');
    assert.equal((await briefRow(env, slug)).status, 'draft', 'a refused publish leaves the brief a draft');
    assert.equal(stub.to('beehiiv').length, 0);

    // The founder overrides, knowingly.
    forced = await withFetch(stub, () =>
      handleApi(publishRequest({ slug, force: true }), env, '/api/watch/publish'),
    );
  } finally {
    capture.restore();
  }

  const body = await forced.json();
  assert.equal(forced.status, 200);
  assert.equal(body.published, true);
  assert.equal(body.forced, true);
  const after = await briefRow(env, slug);
  assert.equal(after.status, 'live');
  assert.equal(after.published_by, 'manual-force', 'an override that leaves no trace is not an override');
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

function importsOf(path) {
  const src = readFileSync(path, 'utf8');
  return [...src.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
}

// UNCHANGED BY THE RULING, and deliberately so. The founder lifted the gate on
// WHO may publish. He did not ask for publication to become something any file
// can do, and this sweep is what keeps the breaker unskippable: the breaker
// lives inside publishBrief, so as long as one file can write status = 'live',
// there is exactly one door and the breaker is behind it.
test('only worker/watch-publish.js can set a brief live', () => {
  const files = workerSources();
  assert.ok(files.length >= 8, `only ${files.length} worker files read, the sweep is broken`);

  const offenders = files
    .filter(([, src]) => /SET\s+status\s*=\s*'live'/i.test(src) || /published_at\s*=\s*datetime/i.test(src))
    .map(([path]) => path);

  assert.deepEqual(
    offenders.map((p) => p.split('/').pop()),
    ['watch-publish.js'],
    'publication has exactly one door, and the circuit breaker is behind it',
  );
});

// UNCHANGED. One caller for the member list, whoever the ruling lets pull the
// lever.
test('only worker/watch-publish.js can reach the member list', () => {
  const files = workerSources();
  const callers = files
    .filter(([path, src]) => /beehiivSendBrief\s*\(/.test(src) && !path.endsWith('integrations.js'))
    .map(([path]) => path.split('/').pop());
  assert.deepEqual(callers, ['watch-publish.js'], 'the send must have exactly one caller');

  // The pipeline itself imports nothing that can publish or send, which is what
  // lets the breaker sit between drafting and publication at all. The check is
  // on the IMPORT rather than on the text: an earlier version searched for the
  // string and failed against a COMMENT naming the file it must not import,
  // which is a guard measuring the wrong thing.
  const pipeline = readFileSync(new URL('../worker/watch.js', import.meta.url).pathname, 'utf8');
  const pipelineImports = importsOf(new URL('../worker/watch.js', import.meta.url).pathname);
  assert.ok(pipelineImports.length >= 2, 'the import matcher is broken');
  assert.ok(!/beehiiv/i.test(pipeline), 'the drafting job must not know how to mail anybody');
  assert.ok(
    !pipelineImports.some((i) => i.includes('watch-publish')),
    `the drafting job imports the publish module: ${pipelineImports.join(', ')}`,
  );
});

// REWRITTEN. This used to assert that worker.js CANNOT SEE the publish module,
// which was the 5 Aug gate expressed as a module graph. The founder reversed
// that on 9 Aug, so the entry point now reaches publication: what this guard
// asserts instead is the SHAPE of that reach, which is the thing that keeps the
// breaker unskippable.
//
//   worker.js       imports the CYCLE, never the publish module directly
//   watch-cycle.js  is the only file besides the API router that imports it
//   watch-cycle.js  never publishes by itself, it calls publishBrief, and
//                   publishBrief is where the breaker runs
test('the scheduled entry reaches publication ONLY through the cycle, and the cycle only through the breaker', () => {
  const entryPath = new URL('../worker.js', import.meta.url).pathname;
  const entry = readFileSync(entryPath, 'utf8');
  const entryImports = importsOf(entryPath);
  assert.ok(entryImports.length >= 4, `only ${entryImports.length} imports parsed, the matcher is broken`);
  assert.ok(entry.includes('async scheduled('), 'the scheduled handler is missing, so this guard is asleep');
  assert.ok(
    !entryImports.some((i) => i.includes('watch-publish')),
    `the Worker entry imports the publish module directly: ${entryImports.join(', ')}`,
  );
  assert.ok(
    entryImports.some((i) => i.includes('watch-cycle')),
    'the Worker entry must reach publication through the cycle',
  );

  // Exactly two files may import the publish module: the router that serves the
  // manual override, and the cycle the cron runs. A third would be a second
  // path to publication that nobody reviewed.
  const importers = workerSources()
    .filter(([path, src]) => /from\s+['"]\.\/watch-publish\.js['"]/.test(src) && !path.endsWith('watch-publish.js'))
    .map(([path]) => path.split('/').pop())
    .sort();
  assert.deepEqual(importers, ['api.js', 'watch-cycle.js'], `the publish module has unexpected importers: ${importers}`);

  // And the breaker is wired INSIDE the publish module rather than by its
  // callers, because a check a caller has to remember is a check that gets
  // forgotten.
  const publishSrc = readFileSync(new URL('../worker/watch-publish.js', import.meta.url).pathname, 'utf8');
  assert.match(publishSrc, /evaluateBreaker\s*\(/, 'the publish module does not run the breaker');
  const cycleSrc = readFileSync(new URL('../worker/watch-cycle.js', import.meta.url).pathname, 'utf8');
  assert.ok(
    !/SET\s+status\s*=\s*'live'/i.test(cycleSrc),
    'the cycle publishes by itself instead of going through publishBrief',
  );
  assert.match(cycleSrc, /publishBrief\s*\(/, 'the cycle must publish through publishBrief');
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

test('both watch migrations extend watch_brief rather than replacing it, and neither can hold a person', () => {
  const files = ['0004_watch.sql', '0005_watch_autopublish.sql'];
  for (const file of files) {
    const sql = readFileSync(new URL(`../migrations/${file}`, import.meta.url).pathname, 'utf8');
    assert.ok(!/DROP\s+TABLE/i.test(sql), `${file}: a migration in this repository never drops a table`);
    assert.ok(!/CREATE\s+TABLE[^;]*watch_brief/i.test(sql), `${file}: watch_brief already exists and must be extended`);
    assert.ok(!/—/.test(sql), `${file}: no em dash, including in SQL comments`);
    // No column in either may hold a person.
    for (const banned of ['email', 'subscriber', 'ip_address', 'name TEXT']) {
      assert.ok(!new RegExp(banned, 'i').test(sql), `${file} declares a column that could hold a person: ${banned}`);
    }
  }

  const m4 = readFileSync(new URL('../migrations/0004_watch.sql', import.meta.url).pathname, 'utf8');
  assert.match(m4, /ALTER TABLE watch_brief ADD COLUMN sent_at/);

  // 0005 is what the 9 Aug ruling needed: who published a brief, and the cycle
  // ledger that is the founder's acknowledgement record.
  const m5 = readFileSync(new URL('../migrations/0005_watch_autopublish.sql', import.meta.url).pathname, 'utf8');
  assert.match(m5, /ALTER TABLE watch_brief ADD COLUMN published_by/);
  assert.match(m5, /CREATE TABLE IF NOT EXISTS watch_cycle/);
  assert.match(m5, /verdict/, 'the ledger must record what the breaker decided');
});
