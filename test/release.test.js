// GUARDS over the release pipeline.
//
// The chain this file covers, link by link, because until 9 Aug 2026 it did not
// exist and every link was individually plausible while the whole was dead:
//
//   1. scripts/release-pack.sh builds a DETERMINISTIC customer zip from HEAD
//      and refuses anything it cannot vouch for
//   2. it emits SQL that is idempotent on a database carrying only migrations
//      0001 and 0002, which is what both environments actually have
//   3. /changelog/ renders that release with no page edit anywhere
//   4. POST /api/release/announce mails subscribers ONCE, or holds and says so
//   5. POST /api/release/link shows the founder what a customer receives, over
//      the customer path rather than around it
//
// NOTHING HERE REACHES THE NETWORK, and nothing here writes to a real bucket, a
// real database or a real mailing list. Every fetch goes through a stub that
// RECORDS its calls, so "it did not send" is a count rather than a reading of
// the code. The shell script tests build a throwaway git repository in a temp
// directory and run the script against that, so the refusals can be watched
// firing against genuinely broken input without dirtying this checkout.
//
// SELF-TESTS ARE NOT OPTIONAL HERE. The single caller sweep at the bottom is
// repointable through RELEASE_SWEEP_DIR precisely so it can be watched failing
// against a planted second caller. A guard nobody has seen fire is not a guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

import { handleApi } from '../worker/api.js';
import { getDownload } from '../worker/delivery.js';
import { changelogPage } from '../worker/changelog.js';
import { releaseSendReadiness, releaseSegmentId } from '../worker/integrations.js';
import { REVIEW_ENTITLEMENT_TTL_SECONDS } from '../worker/release.js';
import { makeEnv, makeD1, makeR2, captureConsole, everythingWritten } from './support/system-env.js';

const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SCRIPT = join(REPO, 'scripts', 'release-pack.sh');
const MANIFEST = join(REPO, 'scripts', 'pack-tiers.tsv');
const PACKS_DIR = join(REPO, 'packs');
const WORKER_DIR = process.env.RELEASE_SWEEP_DIR ?? join(REPO, 'worker');

const TEST_ADMIN_TOKEN = 'f'.repeat(32) + '0'.repeat(32);
const BEEHIIV_POSTS = 'https://api.beehiiv.com/v2/publications/pub_test/posts';

const PACK = 'healthcheck';
const VERSION = '9.9.9';
const R2_KEY = `packs/${PACK}/${PACK}-v${VERSION}.zip`;
const SHA = 'c'.repeat(64);

/* ------------------------------------------------------------- the harness */

function releaseEnv(overrides = {}) {
  return makeEnv({
    WATCH_ADMIN_TOKEN: TEST_ADMIN_TOKEN,
    PACKS: makeR2({ [R2_KEY]: 'PK pretend zip bytes' }),
    ...overrides,
  });
}

// beehiiv fully wired AND a release segment named, so that "it did not send" is
// never explained away by a missing key. Every test expecting silence from a
// configured Worker uses this.
function sendableEnv(overrides = {}) {
  return releaseEnv({
    BEEHIIV_API_KEY: 'bh_synthetic_key_for_tests_only_0000000',
    BEEHIIV_PUBLICATION_ID: 'pub_test',
    BEEHIIV_RELEASE_SEGMENT_ID: 'seg_release_test',
    ...overrides,
  });
}

function stubFetch(routes = {}) {
  const calls = [];
  const impl = async (url, init) => {
    const href = typeof url === 'string' ? url : url.url;
    calls.push({ url: href, init });
    const route = routes[href] ?? routes.default;
    if (!route) return new Response('not found', { status: 404 });
    if (route.throws) throw new Error(route.throws);
    return new Response(route.body ?? '', {
      status: route.status ?? 200,
      headers: { 'Content-Type': route.type ?? 'application/json' },
    });
  };
  impl.calls = calls;
  impl.to = (needle) => calls.filter((c) => c.url.includes(needle));
  return impl;
}

const beehiivOk = () => stubFetch({ [BEEHIIV_POSTS]: { body: JSON.stringify({ data: { id: 'post_1' } }) } });

async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

function adminRequest(path, body, token = TEST_ADMIN_TOKEN) {
  return new Request(`https://oradiscuss.com${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.9',
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}

async function call(path, env, body, token = TEST_ADMIN_TOKEN) {
  const res = await handleApi(adminRequest(path, body, token), env, path);
  return { res, body: await res.json() };
}

const announce = (env, body = { pack: PACK, version: VERSION }, token = TEST_ADMIN_TOKEN) =>
  call('/api/release/announce', env, body, token);

const reviewLink = (env, body = { pack: PACK, version: VERSION }, token = TEST_ADMIN_TOKEN) =>
  call('/api/release/link', env, body, token);

async function seed(env, { pack = PACK, version = VERSION, min_tier = 1, notes = 'What changed.' } = {}) {
  await env.DB.prepare(
    `INSERT INTO pack_release (pack, version, r2_key, sha256, min_tier, released_at)
     VALUES (?1, ?2, ?3, ?4, ?5, '2026-08-09T00:00:00Z')`,
  )
    .bind(pack, version, `packs/${pack}/${pack}-v${version}.zip`, SHA, min_tier)
    .run();
  await env.DB.prepare(
    `INSERT INTO changelog (pack, version, body_md, released_at)
     VALUES (?1, ?2, ?3, '2026-08-09T00:00:00Z')`,
  )
    .bind(pack, version, notes)
    .run();
}

const releaseRow = (env, pack = PACK, version = VERSION) =>
  env.DB.prepare(
    'SELECT pack, version, notified_at, notify_status FROM pack_release WHERE pack = ?1 AND version = ?2',
  )
    .bind(pack, version)
    .first();

/* ======================================================= the announce gate */

test('with no WATCH_ADMIN_TOKEN installed, announcing REFUSES and sends nothing', async () => {
  const env = sendableEnv({ WATCH_ADMIN_TOKEN: undefined });
  await seed(env);
  const fetchStub = beehiivOk();

  const { res, body } = await withFetch(fetchStub, () => announce(env));

  assert.equal(res.status, 503);
  assert.equal(body.code, 'not_configured');
  assert.match(body.error, /WATCH_ADMIN_TOKEN is not set/);
  assert.equal(fetchStub.calls.length, 0, 'an unauthorised call reached the network');
  const row = await releaseRow(env);
  assert.equal(row.notified_at, null, 'an unauthorised call claimed the notification');
});

test('a wrong token is refused, and it cannot be told from a right one by length', async () => {
  const env = sendableEnv();
  await seed(env);
  const fetchStub = beehiivOk();

  const short = await withFetch(fetchStub, () => announce(env, { pack: PACK, version: VERSION }, 'nope'));
  assert.equal(short.res.status, 401);
  assert.equal(short.body.code, 'bad_token');

  const sameLength = await withFetch(fetchStub, () =>
    announce(env, { pack: PACK, version: VERSION }, 'e'.repeat(64)),
  );
  assert.equal(sameLength.res.status, 401);
  assert.equal(sameLength.body.code, 'bad_token');

  const none = await withFetch(fetchStub, () => announce(env, { pack: PACK, version: VERSION }, null));
  assert.equal(none.res.status, 401);
  assert.equal(none.body.code, 'no_token');

  assert.equal(fetchStub.calls.length, 0, 'a refused call reached the network');
});

test('announcing something that is not recorded is a 404, not a send', async () => {
  const env = sendableEnv();
  const fetchStub = beehiivOk();
  const { res, body } = await withFetch(fetchStub, () => announce(env));
  assert.equal(res.status, 404);
  assert.equal(body.code, 'no_release');
  assert.match(body.error, /scripts\/release-pack\.sh/);
  assert.equal(fetchStub.calls.length, 0);
});

test('announcing "the latest" is refused: the version has to be named', async () => {
  const env = sendableEnv();
  await seed(env);
  const fetchStub = beehiivOk();
  const { res, body } = await withFetch(fetchStub, () => announce(env, { pack: PACK }));
  assert.equal(res.status, 400);
  assert.equal(body.code, 'bad_version');
  assert.equal(fetchStub.calls.length, 0);
});

// The state BOTH environments are actually in today. Every other test in this
// file runs against the full schema, which no deployed database has, so without
// this one the first real call either route ever received would have been a 500
// carrying a raw SQLite message and nobody would have known why.
test('against a database without migration 0005, both routes refuse and name the migration', async () => {
  for (const path of ['/api/release/announce', '/api/release/link']) {
    const env = sendableEnv({ DB: makeD1({ only: /^000[12]_/ }) });
    await env.DB.prepare(
      `INSERT INTO pack_release (pack, version, r2_key, sha256, min_tier, released_at)
       VALUES (?1, ?2, ?3, ?4, 1, '2026-08-09T00:00:00Z')`,
    )
      .bind(PACK, VERSION, R2_KEY, SHA)
      .run();

    const fetchStub = beehiivOk();
    const log = captureConsole();
    let res;
    let body;
    try {
      ({ res, body } = await withFetch(fetchStub, () => call(path, env, { pack: PACK, version: VERSION })));
    } finally {
      log.restore();
    }

    assert.equal(res.status, 503, `${path} answered ${res.status} instead of refusing`);
    assert.equal(body.code, 'not_configured');
    assert.match(body.error, /0005_release_notify\.sql is not applied/);
    assert.equal(fetchStub.calls.length, 0, `${path} reached the network on an unmigrated database`);
    assert.match(log.text(), /release_migration_missing/);
    assert.equal(env.ENTITLEMENT.writes.length, 0, `${path} granted an entitlement on an unmigrated database`);
  }
});

/* ============================================== the send, and sending ONCE */

test('a configured announce sends exactly one notification and records it', async () => {
  const env = sendableEnv();
  await seed(env);
  const fetchStub = beehiivOk();

  const { res, body } = await withFetch(fetchStub, () => announce(env));

  assert.equal(res.status, 200);
  assert.equal(body.sent, true);
  assert.equal(body.notify_status, 'sent');
  assert.equal(fetchStub.to('beehiiv').length, 1);

  const row = await releaseRow(env);
  assert.ok(row.notified_at, 'a successful send left no claim on the release row');
  assert.equal(row.notify_status, 'sent');
});

// THE idempotency guard the work order names. It runs the same release twice
// and COUNTS the sends, because "it is idempotent" read off the code is exactly
// the claim that has been wrong here before.
test('announcing the same release twice sends ONCE, counted', async () => {
  const env = sendableEnv();
  await seed(env);
  const fetchStub = beehiivOk();

  const first = await withFetch(fetchStub, () => announce(env));
  const second = await withFetch(fetchStub, () => announce(env));

  assert.equal(first.body.sent, true);
  assert.equal(first.body.already_announced, false);
  assert.equal(second.body.sent, true, 'the second answer should still report the release as announced');
  assert.equal(second.body.already_announced, true);
  assert.equal(
    fetchStub.to('beehiiv').length,
    1,
    'the list was mailed twice for one release, which cannot be taken back',
  );
});

test('ten simultaneous announces of one release still send once', async () => {
  const env = sendableEnv();
  await seed(env);
  const fetchStub = beehiivOk();

  await withFetch(fetchStub, () => Promise.all(Array.from({ length: 10 }, () => announce(env))));

  assert.equal(fetchStub.to('beehiiv').length, 1, 'the atomic claim did not hold under concurrency');
});

/* ================================================ holding rather than half firing */

test('with no segment named, the release is RECORDED, nothing is sent, and it says so', async () => {
  // beehiiv itself is fully wired. The only thing missing is the audience, and
  // that is the state this build ships in.
  const env = releaseEnv({
    BEEHIIV_API_KEY: 'bh_synthetic_key_for_tests_only_0000000',
    BEEHIIV_PUBLICATION_ID: 'pub_test',
  });
  await seed(env);
  const fetchStub = beehiivOk();

  const { res, body } = await withFetch(fetchStub, () => announce(env));

  assert.equal(res.status, 200);
  assert.equal(body.sent, false);
  assert.equal(body.notify_status, 'no_segment');
  assert.match(body.message, /NOTHING was sent/);
  assert.equal(fetchStub.to('beehiiv').length, 0, 'a send went out with no audience named');

  const row = await releaseRow(env);
  assert.equal(row.notify_status, 'no_segment');
  assert.equal(
    row.notified_at,
    null,
    'a pre-flight refusal burned the claim, so this release could never be announced later',
  );
});

test('a held release becomes announceable the moment the segment is configured', async () => {
  const held = releaseEnv({ BEEHIIV_API_KEY: 'bh_synthetic_key_for_tests_only_0000000', BEEHIIV_PUBLICATION_ID: 'pub_test' });
  await seed(held);
  const fetchStub = beehiivOk();
  await withFetch(fetchStub, () => announce(held));
  assert.equal(fetchStub.to('beehiiv').length, 0);

  // Same database, now with the segment named, exactly as configuring the
  // variable and calling again would look.
  held.BEEHIIV_RELEASE_SEGMENT_ID = 'seg_release_test';
  const after = await withFetch(fetchStub, () => announce(held));

  assert.equal(after.body.sent, true);
  assert.equal(fetchStub.to('beehiiv').length, 1);
});

test('with beehiiv unconfigured entirely, the release still records and holds', async () => {
  const env = releaseEnv();
  await seed(env);
  const fetchStub = beehiivOk();

  const { body } = await withFetch(fetchStub, () => announce(env));

  assert.equal(body.sent, false);
  assert.equal(body.notify_status, 'not_configured');
  assert.equal(fetchStub.to('beehiiv').length, 0);
  assert.equal((await releaseRow(env)).notified_at, null);
});

test('a beehiiv failure keeps the claim, reports NOT sent, and leaves the release recorded', async () => {
  const env = sendableEnv();
  await seed(env);
  const fetchStub = stubFetch({
    [BEEHIIV_POSTS]: { status: 500, body: JSON.stringify({ errors: [{ code: 'internal' }] }) },
  });
  const log = captureConsole();

  let body;
  try {
    ({ body } = await withFetch(fetchStub, () => announce(env)));
  } finally {
    log.restore();
  }

  assert.equal(body.sent, false);
  assert.equal(body.notify_status, 'failed');
  assert.match(log.text(), /release_announce_not_sent/);

  const row = await releaseRow(env);
  assert.equal(row.notify_status, 'failed');
  assert.ok(
    row.notified_at,
    'an IN FLIGHT failure released the claim, so a request beehiiv may have accepted could be sent again',
  );

  // And the release itself is untouched: the website half does not depend on
  // the email half.
  const release = await env.DB.prepare('SELECT r2_key, sha256 FROM pack_release WHERE pack = ?1').bind(PACK).first();
  assert.equal(release.sha256, SHA);
});

test('an unreachable beehiiv is the same story, and never a thrown error', async () => {
  const env = sendableEnv();
  await seed(env);
  const fetchStub = stubFetch({ [BEEHIIV_POSTS]: { throws: 'network down' } });
  const log = captureConsole();
  let res;
  let body;
  try {
    ({ res, body } = await withFetch(fetchStub, () => announce(env)));
  } finally {
    log.restore();
  }
  assert.equal(res.status, 200);
  assert.equal(body.sent, false);
  assert.equal(body.notify_status, 'unreachable');
});

test('retry re-opens a FAILED notification and never a successful one', async () => {
  const env = sendableEnv();
  await seed(env);
  const failing = stubFetch({ [BEEHIIV_POSTS]: { status: 500 } });
  const log = captureConsole();
  try {
    await withFetch(failing, () => announce(env));
  } finally {
    log.restore();
  }
  assert.equal((await releaseRow(env)).notify_status, 'failed');

  const ok = beehiivOk();
  const retried = await withFetch(ok, () => announce(env, { pack: PACK, version: VERSION, retry: true }));
  assert.equal(retried.body.sent, true);
  assert.equal(ok.to('beehiiv').length, 1);

  // And now that it HAS sent, retry is refused rather than honoured.
  const again = await withFetch(ok, () => announce(env, { pack: PACK, version: VERSION, retry: true }));
  assert.equal(again.body.already_announced, true);
  assert.equal(ok.to('beehiiv').length, 1, 'retry re-sent a notification that had already gone out');
});

/* ============================================================ what it says */

test('the notification is a POINTER: no pack contents, no credentials, no download link', async () => {
  const env = sendableEnv();
  await seed(env, { notes: 'Adds the RAC instance census.\n\nFixes the tablespace dual output.' });
  const fetchStub = beehiivOk();

  await withFetch(fetchStub, () => announce(env));

  const sent = fetchStub.to('beehiiv')[0];
  const payload = JSON.parse(sent.init.body);
  const html = payload.body_content;

  assert.match(payload.title, /healthcheck 9\.9\.9/);
  assert.match(html, /Adds the RAC instance census\./);
  assert.match(html, /oradiscuss\.com\/changelog\//);
  assert.match(html, /oradiscuss\.com\/reissue\//);

  // The things it must NOT carry, each for its own reason.
  assert.ok(!html.includes('/api/download'), 'the email carries a download link, which bypasses the signed path');
  assert.ok(!html.includes(R2_KEY), 'the email names an R2 object key');
  assert.ok(!html.includes(SHA), 'the email carries the artifact digest, which belongs beside the file');
  assert.ok(!/Bearer|token|secret/i.test(html), 'the email carries something credential shaped');

  // And it goes to the named segment, never to the publication default.
  assert.deepEqual(payload.recipients.email.include_segment_ids, ['seg_release_test']);
});

test('release notes reach the email as TEXT, never as markup', async () => {
  const env = sendableEnv();
  await seed(env, { notes: 'Fixes <script>alert(1)</script> and the "quoted" case.' });
  const fetchStub = beehiivOk();
  await withFetch(fetchStub, () => announce(env));

  const html = JSON.parse(fetchStub.to('beehiiv')[0].init.body).body_content;
  assert.ok(!html.includes('<script>'), 'a changelog row reached the email as live markup');
  assert.match(html, /&lt;script&gt;/);
});

test('the release segment is a SEPARATE audience from the members segment', () => {
  // The members segment must not stand in for the release segment. Which list
  // hears that a kit was updated is a founder decision with no undo.
  const membersOnly = { BEEHIIV_MEMBERS_SEGMENT_ID: 'seg_members_test' };
  assert.equal(releaseSegmentId(membersOnly), null);
  assert.equal(
    releaseSendReadiness({
      BEEHIIV_API_KEY: 'bh_synthetic_key_for_tests_only_0000000',
      BEEHIIV_PUBLICATION_ID: 'pub_test',
      ...membersOnly,
    }).status,
    'no_segment',
  );
});

test('a segment id too short to be real is treated as absent, not passed through', () => {
  assert.equal(releaseSegmentId({ BEEHIIV_RELEASE_SEGMENT_ID: 'x' }), null);
  assert.equal(releaseSegmentId({ BEEHIIV_RELEASE_SEGMENT_ID: '   ' }), null);
  assert.equal(releaseSegmentId({ BEEHIIV_RELEASE_SEGMENT_ID: 'seg_ok' }), 'seg_ok');
});

test('asking whether a release CAN be sent never sends one', async () => {
  // The first version of the announce pre-flight asked this question by calling
  // the sender with an empty body, which on a configured Worker would have
  // posted an empty release note to real subscribers.
  const env = sendableEnv();
  const fetchStub = beehiivOk();
  await withFetch(fetchStub, async () => {
    const verdict = releaseSendReadiness(env);
    assert.equal(verdict.ready, true);
  });
  assert.equal(fetchStub.calls.length, 0, 'the readiness check reached the network');
});

/* ================================================== the founder review link */

test('with no WATCH_ADMIN_TOKEN, the review link REFUSES and grants nothing', async () => {
  const env = releaseEnv({ WATCH_ADMIN_TOKEN: undefined });
  await seed(env);
  const { res, body } = await reviewLink(env);
  assert.equal(res.status, 503);
  assert.equal(body.code, 'not_configured');
  assert.equal(env.ENTITLEMENT.writes.length, 0, 'a refused review call still wrote an entitlement');
});

test('a wrong token gets no review link', async () => {
  const env = releaseEnv();
  await seed(env);
  for (const token of ['nope', 'e'.repeat(64), null]) {
    const { res, body } = await reviewLink(env, { pack: PACK, version: VERSION }, token);
    assert.equal(res.status, 401, `token ${String(token).slice(0, 8)} was not refused`);
    assert.ok(!body.url, 'a refused caller received a link');
  }
  assert.equal(env.ENTITLEMENT.writes.length, 0);
});

test('a review link for something unreleased is a 404', async () => {
  const env = releaseEnv();
  const { res, body } = await reviewLink(env);
  assert.equal(res.status, 404);
  assert.equal(body.code, 'no_release');
  assert.equal(env.ENTITLEMENT.writes.length, 0);
});

test('with no R2_SIGNING_KEY the review link refuses BEFORE granting anything', async () => {
  const env = releaseEnv({ R2_SIGNING_KEY: undefined });
  await seed(env);
  const { res, body } = await reviewLink(env);
  assert.equal(res.status, 503);
  assert.equal(body.code, 'not_configured');
  assert.match(body.error, /R2_SIGNING_KEY/);
  assert.equal(
    env.ENTITLEMENT.writes.length,
    0,
    'a Worker that cannot sign still left a live entitlement lying in KV',
  );
});

// The whole point of the review path: it is the customer path, driven end to
// end. A privileged shortcut could pass this suite while the route a paying
// member takes was broken.
test('the review link is a REAL customer download, end to end', async () => {
  const env = releaseEnv();
  await seed(env);

  const { res, body } = await reviewLink(env);
  assert.equal(res.status, 200);
  assert.match(body.url, /\/api\/download\?/);
  assert.equal(body.sha256, SHA);

  const download = await getDownload(new Request(body.url), env);
  assert.equal(download.status, 200, 'the link the founder was handed does not actually download');
  assert.equal(download.headers.get('Content-Type'), 'application/zip');
  assert.equal(download.headers.get('X-Artifact-SHA256'), SHA);
  assert.match(download.headers.get('Content-Disposition'), /healthcheck-9\.9\.9\.zip/);
});

test('the review link names no R2 key and hands back no reusable reference', async () => {
  const env = releaseEnv();
  await seed(env);
  const { body } = await reviewLink(env);

  const flat = JSON.stringify(body);
  assert.ok(!flat.includes(R2_KEY), 'the response names the object key it was designed never to name');
  assert.equal(body.reference, undefined, 'the response hands back the reference, which unlocks every pack');

  // The grant is short lived, and it is the entitlement rather than the link
  // that has to expire: a link is already dead in five minutes.
  const record = JSON.parse([...env.ENTITLEMENT.store.values()][0]);
  assert.equal(record.processor, 'founder-review');
  const life = Date.parse(record.expires_at) - Date.now();
  assert.ok(life > 0 && life <= REVIEW_ENTITLEMENT_TTL_SECONDS * 1000 + 5000, `grant life was ${life}ms`);
});

test('the review grant dies with its clock, so a leaked link stops working', async () => {
  const env = releaseEnv();
  await seed(env);
  const { body } = await reviewLink(env);

  // Age the grant past its expiry, leaving everything else alone.
  const [key, raw] = [...env.ENTITLEMENT.store.entries()][0];
  const record = JSON.parse(raw);
  record.expires_at = new Date(Date.now() - 1000).toISOString();
  env.ENTITLEMENT.store.set(key, JSON.stringify(record));

  const download = await getDownload(new Request(body.url), env);
  assert.equal(download.status, 403);
  assert.equal((await download.json()).code, 'no_entitlement');
});

test('the review link reaches a pack released to the TOP tier', async () => {
  // The grant sits at tier 2 so the founder can review a pack released to a
  // membership he does not personally hold. Driven through the real handler,
  // which is where the min_tier comparison actually lives.
  const env = releaseEnv();
  await seed(env, { min_tier: 2 });
  const { body } = await reviewLink(env);
  const download = await getDownload(new Request(body.url), env);
  assert.equal(download.status, 200);
});

test('the review link holds no personal data anywhere', async () => {
  const env = releaseEnv();
  await seed(env);
  const log = captureConsole();
  try {
    await reviewLink(env);
  } finally {
    log.restore();
  }
  const written = everythingWritten(env, log);
  assert.ok(!/@/.test(written), `something address shaped was stored:\n${written}`);
  // The synthetic reference must not be stored either. Only its hash is.
  const record = JSON.parse([...env.ENTITLEMENT.store.values()][0]);
  assert.deepEqual(Object.keys(record).sort(), [
    'downloads',
    'expires_at',
    'granted_at',
    'processor',
    'status',
    'tier',
    'updated_at',
    'v',
  ]);
});

/* ================================================ the site updates itself */

test('a release applied to D1 appears on /changelog/ with no page edit', async () => {
  const DIST = process.env.DIST_DIR ?? join(REPO, 'dist');
  const page = join(DIST, 'changelog', 'index.html');
  assert.ok(existsSync(page), `${page} does not exist. Run npm run build first.`);
  const html = readFileSync(page, 'utf8');

  const env = releaseEnv({
    ASSETS: {
      async fetch() {
        return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      },
    },
  });

  // Seeded through the EXACT statements scripts/release-pack.sh emits, so this
  // is a test of the pipeline's own SQL rather than of a convenient shortcut.
  const sql = emittedSql({ pack: PACK, version: VERSION, sha: SHA, minTier: 1, notes: 'Adds the RAC instance census.' });
  applySql(env, sql);

  const rendered = await (await changelogPage(new Request('https://oradiscuss.com/changelog/'), env)).text();
  const flat = rendered.replace(/\s+/g, ' ');
  assert.match(flat, /healthcheck 9\.9\.9/);
  assert.match(flat, /Adds the RAC instance census\./);
  assert.match(flat, new RegExp(SHA));
  assert.match(flat, /Toolkit and above/);
});

/* ============================================ the emitted SQL is idempotent */

// The statements the script writes, reproduced here in one place so the two
// idempotency tests below and the changelog test above all exercise the same
// text. The script itself is executed against them in the shell section, so a
// drift between this and the script is caught rather than assumed away.
function emittedSql({ pack, version, sha, minTier, notes }) {
  const q = (s) => String(s).replace(/'/g, "''");
  return [
    `INSERT OR IGNORE INTO pack_release (pack, version, r2_key, sha256, min_tier, released_at)`,
    `VALUES ('${q(pack)}', '${q(version)}', 'packs/${q(pack)}/${q(pack)}-v${q(version)}.zip', '${q(sha)}', ${minTier}, '2026-08-09T00:00:00Z');`,
    `INSERT INTO changelog (pack, version, body_md, released_at)`,
    `SELECT '${q(pack)}', '${q(version)}', '${q(notes)}', '2026-08-09T00:00:00Z'`,
    ` WHERE NOT EXISTS (SELECT 1 FROM changelog WHERE pack = '${q(pack)}' AND version = '${q(version)}');`,
  ].join('\n');
}

function applySql(env, sql) {
  env.DB.db.exec(sql);
}

test('applying a release twice inserts one release row and one changelog entry', async () => {
  const env = releaseEnv();
  const sql = emittedSql({ pack: PACK, version: VERSION, sha: SHA, minTier: 1, notes: 'One entry.' });
  applySql(env, sql);
  applySql(env, sql);

  const releases = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM pack_release WHERE pack = ?1 AND version = ?2',
  )
    .bind(PACK, VERSION)
    .first();
  const entries = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM changelog WHERE pack = ?1 AND version = ?2',
  )
    .bind(PACK, VERSION)
    .first();

  assert.equal(releases.n, 1, 'a second application created a second release row');
  assert.equal(entries.n, 1, 'a second application created a second changelog entry');
});

test('the emitted SQL is idempotent on a database carrying ONLY 0001 and 0002', () => {
  // Which is what preview and production actually have today: migrations 0003
  // and 0004 are not applied on either, and 0005 is new in this branch. An
  // insert that relied on a unique index from a later migration would pass the
  // test above, which uses the full schema, and then duplicate on the real
  // database. This one deliberately builds the schema those databases have.
  const db = new DatabaseSync(':memory:');
  const dir = join(REPO, 'migrations');
  for (const file of readdirSync(dir).filter((f) => /^000[12]_/.test(f)).sort()) {
    db.exec(readFileSync(join(dir, file), 'utf8'));
  }
  const sql = emittedSql({ pack: PACK, version: VERSION, sha: SHA, minTier: 1, notes: "It's fine." });
  db.exec(sql);
  db.exec(sql);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pack_release').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM changelog').get().n, 1);
  assert.equal(db.prepare('SELECT body_md FROM changelog').get().body_md, "It's fine.");
});

/* =============================================== the migration and schema */

test('migration 0005 EXTENDS pack_release rather than replacing it', () => {
  const sql = readFileSync(join(REPO, 'migrations', '0005_release_notify.sql'), 'utf8');
  assert.match(sql, /ALTER TABLE pack_release ADD COLUMN notified_at/);
  assert.match(sql, /ALTER TABLE pack_release ADD COLUMN notify_status/);
  assert.ok(!/DROP TABLE|CREATE TABLE pack_release/i.test(sql), 'the migration replaces the release table');
  assert.match(sql, /APPLY ONCE/, 'the migration no longer warns that it is not re-runnable');
});

/* ============================================== the structure of the send */

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
  return files;
}

// Repointable through RELEASE_SWEEP_DIR so it can be watched failing against a
// copy of worker/ with a second caller planted in it. Same mechanism
// test/api-surface.test.js uses, and for the same reason.
test('only worker/release.js can mail subscribers about a release', () => {
  const files = workerSources();
  assert.ok(files.length >= 8, `only ${files.length} worker files read, the sweep is broken`);

  const callers = files
    .filter(([path, src]) => /beehiivSendRelease\s*\(/.test(src) && !path.endsWith('integrations.js'))
    .map(([path]) => path.split('/').pop())
    .sort();
  assert.deepEqual(callers, ['release.js'], 'the release send must have exactly one caller');
});

test('only worker/integrations.js knows beehiiv exists at all', () => {
  const offenders = workerSources()
    .filter(([path, src]) => /api\.beehiiv\.com/.test(src) && !path.endsWith('integrations.js'))
    .map(([path]) => path.split('/').pop());
  assert.deepEqual(offenders, [], 'a second file reaches beehiiv directly, around the two guarded senders');
});

test('the release routes never read the pack store, so they cannot serve a file', () => {
  const src = readFileSync(join(REPO, 'worker', 'release.js'), 'utf8');
  assert.ok(!/env\.PACKS/.test(src), 'worker/release.js touches R2. The signed path is the only way to a file.');
  assert.ok(!/new Response\(\s*object/.test(src), 'worker/release.js streams a body');
});

test('both release routes are registered as literals and both refuse without a token', async () => {
  const api = readFileSync(join(REPO, 'worker', 'api.js'), 'utf8');
  for (const path of ['/api/release/announce', '/api/release/link']) {
    assert.ok(api.includes(`'POST ${path}'`), `${path} is not registered as a literal route`);
  }

  // Behavioural, not structural: drive the real router with the token absent.
  const env = releaseEnv({ WATCH_ADMIN_TOKEN: undefined });
  for (const path of ['/api/release/announce', '/api/release/link']) {
    const res = await handleApi(adminRequest(path, { pack: PACK, version: VERSION }), env, path);
    assert.equal(res.status, 503, `${path} answered ${res.status} with no token installed`);
  }
});

test('there is ONE admin token, and the release gate uses the same one publishing does', () => {
  const src = readFileSync(join(REPO, 'worker', 'release.js'), 'utf8');
  assert.ok(!/RELEASE_ADMIN_TOKEN|readSecret\(env, '(?!WATCH_ADMIN_TOKEN)/.test(src), 'a second admin secret appeared');
  assert.match(src, /admin-auth\.js/, 'the release gate no longer shares the publish gate implementation');

  const auth = readFileSync(join(REPO, 'worker', 'admin-auth.js'), 'utf8');
  assert.match(auth, /timingSafeEqualHex/, 'the shared gate no longer compares in constant time');
  assert.match(auth, /WATCH_ADMIN_TOKEN/);
});

/* ================================================== the manifest and packs */

test('packs/ and scripts/pack-tiers.tsv agree, in both directions', () => {
  const onDisk = readdirSync(PACKS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const declared = readFileSync(MANIFEST, 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => line.trim().split(/\s+/)[0])
    .sort();

  assert.deepEqual(
    declared,
    onDisk,
    'a pack can be released without anybody deciding which membership it belongs to, or the manifest names a pack that is gone',
  );
});

test('every declared tier is a real catalogue tier', () => {
  const rows = readFileSync(MANIFEST, 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => line.trim().split(/\s+/));
  assert.ok(rows.length >= 4, `only ${rows.length} manifest rows parsed, the matcher is broken`);
  for (const [pack, tier] of rows) {
    assert.match(tier, /^[012]$/, `${pack} is declared at tier ${tier}, which is not in the catalogue`);
  }
});

/* ====================================================== the release script */

// A throwaway git repository with the real script in it. Everything the script
// refuses is watched refusing HERE, against input broken on purpose, rather
// than asserted from a reading of the source.
function scratchRepo({ version = 'VERSION="1.0.0"', second = null, manifest = 'demo 1 test' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'od-release-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'packs', 'demo', 'test-fixtures'), { recursive: true });
  mkdirSync(join(dir, 'packs', 'demo', 'held'), { recursive: true });

  writeFileSync(join(dir, 'scripts', 'release-pack.sh'), readFileSync(SCRIPT, 'utf8'));
  chmodSync(join(dir, 'scripts', 'release-pack.sh'), 0o755);
  writeFileSync(join(dir, 'scripts', 'pack-tiers.tsv'), `# pack tier source\n${manifest}\n`);
  writeFileSync(join(dir, 'packs', 'demo', 'demo.sh'), `#!/usr/bin/env bash\n${version}\necho demo\n`);
  if (second) writeFileSync(join(dir, 'packs', 'demo', 'other.sh'), `#!/usr/bin/env bash\n${second}\n`);
  writeFileSync(join(dir, 'packs', 'demo', 'test-fixtures', 'fixture.txt'), 'not for customers\n');
  writeFileSync(join(dir, 'packs', 'demo', 'held', 'disabled.sh.held'), 'ruled disabled not deleted\n');

  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'release test');
  git('add', '-A');
  git('commit', '-q', '-m', 'scratch');
  return dir;
}

// Runs the script and returns everything about the attempt, never throwing, so
// a refusal can be asserted on rather than crashing the test.
function runScript(dir, args = [], env = {}) {
  try {
    const stdout = execFileSync('bash', [join(dir, 'scripts', 'release-pack.sh'), ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
}

test('the script builds a deterministic zip and emits idempotent SQL', () => {
  const dir = scratchRepo();
  try {
    const first = runScript(dir, ['--dry-run']);
    assert.equal(first.code, 0, first.stderr);
    const second = runScript(dir, ['--dry-run', '--out', join(dir, 'again')]);

    const sha = (out) => /sha256   ([0-9a-f]{64})/.exec(out)?.[1];
    assert.ok(sha(first.stdout), `no sha256 in the output:\n${first.stdout}`);
    assert.equal(
      sha(first.stdout),
      sha(second.stdout),
      'two builds of the same commit produced different bytes, so "already released with these bytes" can never be true',
    );

    assert.match(first.stdout, /INSERT OR IGNORE INTO pack_release/);
    assert.match(first.stdout, /WHERE NOT EXISTS \(SELECT 1 FROM changelog/);
    // Preview by default, and it says which environment every statement is for.
    assert.match(first.stdout, /ENVIRONMENT: preview/);
    assert.match(first.stdout, /oradiscuss-assets-preview/);
    assert.ok(
      !/oradiscuss-assets(?!-preview)/.test(first.stdout),
      'a preview run named the production bucket',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The one that closes the gap between what this file THINKS the script emits
// and what it actually emits. Everything above tests the shape of the SQL; this
// runs the real script, takes the file it wrote, and applies it twice to a
// database carrying only the migrations preview and production actually have.
test('the SQL the script really writes is idempotent against the real schema', () => {
  const dir = scratchRepo();
  try {
    const run = runScript(dir, ['--dry-run']);
    assert.equal(run.code, 0, run.stderr);

    const sqlFile = join(dir, '.release-out', 'preview-demo-v1.0.0.sql');
    assert.ok(existsSync(sqlFile), `the script wrote no SQL file at ${sqlFile}`);
    const sql = readFileSync(sqlFile, 'utf8');

    const db = new DatabaseSync(':memory:');
    const migrations = join(REPO, 'migrations');
    for (const file of readdirSync(migrations).filter((f) => /^000[12]_/.test(f)).sort()) {
      db.exec(readFileSync(join(migrations, file), 'utf8'));
    }

    db.exec(sql);
    db.exec(sql);

    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pack_release').get().n, 1, 'a second apply created a second release row');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM changelog').get().n, 1, 'a second apply created a second changelog entry');

    // And what it recorded is what it built, not a placeholder.
    const row = db.prepare('SELECT pack, version, r2_key, sha256, min_tier FROM pack_release').get();
    assert.equal(row.pack, 'demo');
    assert.equal(row.version, '1.0.0');
    assert.equal(row.r2_key, 'packs/demo/demo-v1.0.0.zip');
    assert.equal(row.min_tier, 1);
    assert.match(row.sha256, /^[0-9a-f]{64}$/);
    assert.equal(row.sha256, /sha256   ([0-9a-f]{64})/.exec(run.stdout)[1], 'the SQL records a different digest to the one printed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a release note carrying a quote survives the emitted SQL intact', () => {
  const dir = scratchRepo();
  try {
    const notes = join(dir, 'notes.md');
    writeFileSync(notes, "It's fixed, and it's O'Brien who found it.\n");
    const run = runScript(dir, ['--dry-run', '--pack', 'demo', '--notes-file', notes]);
    assert.equal(run.code, 0, run.stderr);

    const db = new DatabaseSync(':memory:');
    const migrations = join(REPO, 'migrations');
    for (const file of readdirSync(migrations).filter((f) => /^000[12]_/.test(f)).sort()) {
      db.exec(readFileSync(join(migrations, file), 'utf8'));
    }
    db.exec(readFileSync(join(dir, '.release-out', 'preview-demo-v1.0.0.sql'), 'utf8'));

    assert.equal(
      db.prepare('SELECT body_md FROM changelog').get().body_md.trim(),
      "It's fixed, and it's O'Brien who found it.",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the script REFUSES a dirty tree', () => {
  const dir = scratchRepo();
  try {
    // The break, asserted as landed before the guard is asked about it.
    writeFileSync(join(dir, 'packs', 'demo', 'demo.sh'), '#!/usr/bin/env bash\nVERSION="1.0.0"\necho edited\n');
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'packs'], { cwd: dir, encoding: 'utf8' });
    assert.match(dirty, /demo\.sh/, 'the break did not land, so this guard would pass for the wrong reason');

    const run = runScript(dir, ['--dry-run']);
    assert.equal(run.code, 2);
    assert.match(run.stderr, /uncommitted changes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the script REFUSES a pack whose scripts disagree about the version', () => {
  const dir = scratchRepo({ second: 'VERSION="2.0.0"' });
  try {
    const run = runScript(dir, ['--dry-run']);
    assert.equal(run.code, 2);
    assert.match(run.stderr, /disagree about the version/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the script REFUSES a pack that declares no version', () => {
  const dir = scratchRepo({ version: '# no version here' });
  try {
    const run = runScript(dir, ['--dry-run']);
    assert.equal(run.code, 2);
    assert.match(run.stderr, /declares no VERSION=/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the script REFUSES a pack with no membership declared, rather than guessing one', () => {
  const dir = scratchRepo({ manifest: 'somethingelse 1 test' });
  try {
    const run = runScript(dir, ['--dry-run']);
    assert.equal(run.code, 2);
    assert.match(run.stderr, /no row in scripts\/pack-tiers\.tsv/);
    assert.match(run.stderr, /will not guess it/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the script REFUSES a membership that is not a catalogue tier', () => {
  const dir = scratchRepo({ manifest: 'demo 7 test' });
  try {
    const run = runScript(dir, ['--dry-run']);
    assert.equal(run.code, 2);
    assert.match(run.stderr, /not one of the catalogue tiers/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the customer zip carries no test-fixtures and no held code', () => {
  const dir = scratchRepo();
  try {
    const run = runScript(dir, ['--dry-run']);
    assert.equal(run.code, 0, run.stderr);
    const zip = join(dir, '.release-out', 'oradiscuss-demo-v1.0.0.zip');
    assert.ok(existsSync(zip), `the zip was not written to ${zip}`);
    // Only the ENTRY lines, never the archive path printed in the header: the
    // temp directory name is not part of what a customer receives.
    const entries = execFileSync('unzip', ['-l', zip], { encoding: 'utf8' })
      .split('\n')
      .filter((l) => /\bdemo\//.test(l));
    assert.ok(entries.length >= 1, `the zip is empty:\n${entries.join('\n')}`);
    assert.ok(entries.some((l) => l.includes('demo/demo.sh')), `the zip is missing the pack itself:\n${entries.join('\n')}`);
    assert.ok(!entries.some((l) => l.includes('test-fixtures')), `test-fixtures shipped to a customer:\n${entries.join('\n')}`);
    assert.ok(!entries.some((l) => l.includes('held')), `held code shipped to a customer:\n${entries.join('\n')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('production is never the default and has to be spelled out', () => {
  const dir = scratchRepo();
  try {
    const preview = runScript(dir, ['--dry-run']);
    assert.match(preview.stdout, /bucket: oradiscuss-assets-preview/);
    assert.match(preview.stdout, /database: oradiscuss-preview/);

    const production = runScript(dir, ['--dry-run', '--production', '--out', join(dir, 'prod')]);
    assert.match(production.stdout, /bucket: oradiscuss-assets\b/);
    assert.match(production.stdout, /database: oradiscuss\b/);
    assert.match(production.stdout, /THIS WAS PRODUCTION/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The refusal that protects every member who already downloaded a version: the
// same version number must never come to mean two different sets of bytes. The
// remote calls go to a stub wrangler on PATH, so this is watched firing without
// a single byte reaching anybody's account.
function stubWrangler(dir, { returns = null } = {}) {
  const bin = join(dir, 'stub-wrangler');
  const canned = join(dir, 'canned.bin');
  if (returns !== null) writeFileSync(canned, returns);
  // Invoked exactly as the real one is: `<bin> r2 object <get|put> <bucket/key> ...`
  writeFileSync(
    bin,
    [
      '#!/usr/bin/env bash',
      'set -e',
      'VERB="$3"',
      'DEST=""',
      'for a in "$@"; do case "$a" in --file=*) DEST="${a#--file=}";; esac; done',
      'if [ "$VERB" = "get" ]; then',
      `  [ -f "${canned}" ] || exit 1`,
      `  cp "${canned}" "$DEST"`,
      '  exit 0',
      'fi',
      'echo "stub wrangler: pretended to upload, nothing left this machine" >&2',
      'exit 0',
    ].join('\n'),
  );
  chmodSync(bin, 0o755);
  return bin;
}

test('re-releasing a version whose BYTES changed is refused, not overwritten', () => {
  const dir = scratchRepo();
  try {
    // The bucket already holds something else under this key. Different bytes,
    // same version, which is the exact accident this refusal exists for.
    const bin = stubWrangler(dir, { returns: 'these are not the bytes you built' });
    const run = runScript(dir, [], { RELEASE_WRANGLER: bin });
    assert.equal(run.code, 3, `expected the different-bytes refusal:\n${run.stdout}\n${run.stderr}`);
    assert.match(run.stderr, /ALREADY RELEASED .* with DIFFERENT bytes/);
    assert.match(run.stderr, /Bump VERSION=/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('re-releasing a version whose bytes are IDENTICAL skips the upload and still emits its SQL', () => {
  const dir = scratchRepo();
  try {
    // Build once to learn the exact bytes, then pretend the bucket holds them.
    const built = runScript(dir, ['--dry-run']);
    assert.equal(built.code, 0, built.stderr);
    const zip = join(dir, '.release-out', 'oradiscuss-demo-v1.0.0.zip');
    const bin = stubWrangler(dir, { returns: readFileSync(zip) });

    const run = runScript(dir, ['--out', join(dir, 'second')], { RELEASE_WRANGLER: bin });
    assert.equal(run.code, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /already in .* with these exact bytes/);
    assert.match(run.stdout, /INSERT OR IGNORE INTO pack_release/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the script prints its next commands ONE PER LINE, never joined', () => {
  const dir = scratchRepo();
  try {
    const run = runScript(dir, ['--dry-run']);
    const lines = run.stdout.split('\n').filter((l) => l.includes('wrangler d1 execute') || l.includes('curl'));
    assert.ok(lines.length >= 3, `only ${lines.length} command lines printed:\n${run.stdout}`);
    for (const line of lines) {
      assert.ok(
        !/\bthen\b/.test(line),
        `two commands joined on one line, which pastes as one broken command: ${line}`,
      );
      assert.ok(!/&&/.test(line), `two commands joined on one line: ${line}`);
    }
    assert.match(run.stdout, /wrangler d1 execute oradiscuss-preview --remote --file=/);
    assert.match(run.stdout, /api\/release\/announce/);
    assert.match(run.stdout, /api\/release\/link/);

    // The prerequisite the endpoints actually have. Without it the founder
    // follows these instructions verbatim and the announce answers 503.
    assert.match(
      run.stdout,
      /--file=migrations\/0005_release_notify\.sql/,
      'the runbook does not tell the founder to apply the migration the release endpoints need',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ prose */

test('nothing this branch adds carries an em dash', () => {
  const files = [
    join(REPO, 'scripts', 'release-pack.sh'),
    join(REPO, 'scripts', 'pack-tiers.tsv'),
    join(REPO, 'worker', 'release.js'),
    join(REPO, 'worker', 'admin-auth.js'),
    join(REPO, 'migrations', '0005_release_notify.sql'),
  ];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    // The needle is an ESCAPE rather than the character. The rule is "no em
    // dashes anywhere", and a guard that carries one to search for it puts the
    // character in the repository, which is the thing being forbidden.
    assert.ok(!src.includes('\u2014'), `${relative(REPO, file)} contains an em dash`);
  }
});
