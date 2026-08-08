// GUARDS over signed delivery: the download link, the re-issue counter, and the
// deletion path.
//
// These drive the real handleApi against a synthetic environment. Nothing here
// contacts a payment processor, and the signing key below is a test constant
// that has never been near an account.
//
// EVERY ONE OF THESE WAS WATCHED FAILING before it was trusted, against the
// source with the check it guards deliberately removed. The exact breakages and
// the exact failure text are in the session report. A guard nobody has seen
// fire is not a guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleApi } from '../worker/api.js';
import { sha256Hex, hmacSha256Hex } from '../worker/crypto.js';
import { DOWNLOAD_TTL_SECONDS, MAX_TTL_SECONDS } from '../worker/delivery.js';
import { writeEntitlement } from '../worker/entitlement.js';
import {
  makeEnv,
  makeLimiter,
  makeR2,
  jsonRequest,
  seedRelease,
  seedEntitlement,
  captureConsole,
  TEST_SIGNING_KEY,
} from './support/system-env.js';

const REFERENCE = 'txn_01hv8syntheticreference0001';
const OTHER_REFERENCE = 'txn_01hv8syntheticreference0002';
const PACK_BODY = 'PK synthetic health check pack';

async function refHash(reference = REFERENCE) {
  return sha256Hex(reference);
}

async function readyEnv(overrides = {}) {
  const env = makeEnv(overrides);
  env.PACKS = makeR2({ 'packs/health-check/v1.0.0.zip': PACK_BODY });
  await seedRelease(env, {
    pack: 'health-check',
    version: 'v1.0.0',
    r2_key: 'packs/health-check/v1.0.0.zip',
    sha256: 'f'.repeat(64),
    min_tier: 1,
    released_at: '2026-08-02 09:00:00',
  });
  await seedEntitlement(env, await refHash(), { tier: 1 });
  return env;
}

function get(url) {
  return new Request(url, { headers: { 'CF-Connecting-IP': '203.0.113.9' } });
}

async function mintLink(env, { reference = REFERENCE, pack = 'health-check' } = {}) {
  const res = await handleApi(jsonRequest('/api/download', { reference, pack }), env, '/api/download');
  const body = await res.json();
  return { res, body };
}

// Signs a URL with the REAL key and arbitrary parameters. This is how a forged
// but correctly signed link is built, which is the only way to test the
// verifier's own clamps rather than the signature check standing in front of
// them.
async function forgeLink({ pack, version, hash, expires }) {
  const signature = await hmacSha256Hex(
    TEST_SIGNING_KEY,
    ['v1', pack, version, hash, String(expires)].join('\n'),
  );
  const query = new URLSearchParams({ p: pack, v: version, h: hash, e: String(expires), s: signature });
  return `https://oradiscuss.com/api/download?${query.toString()}`;
}

/* ------------------------------------------------------------- happy path */

test('a reference exchanges for a signed link, and the link serves the file', async () => {
  const env = await readyEnv();
  const { res, body } = await mintLink(env);
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.links.length, 1);

  const link = body.links[0];
  assert.equal(link.pack, 'health-check');
  assert.equal(link.version, 'v1.0.0');
  assert.equal(link.expires_in, DOWNLOAD_TTL_SECONDS);
  assert.match(link.url, /^https:\/\/oradiscuss\.com\/api\/download\?/);

  // The URL names a pack and a version. It must NEVER name an R2 object key,
  // because a URL that carries a key is a URL somebody will try to edit.
  assert.ok(!link.url.includes('packs/'), `the signed URL names an R2 key: ${link.url}`);

  const file = await handleApi(get(link.url), env, '/api/download');
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('Content-Type'), 'application/zip');
  assert.equal(
    file.headers.get('Content-Disposition'),
    'attachment; filename="health-check-v1.0.0.zip"',
  );
  assert.equal(file.headers.get('X-Artifact-SHA256'), 'f'.repeat(64));
  assert.equal(file.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(await file.text(), PACK_BODY);
});

test('a download increments the counter and stores nothing else', async () => {
  const env = await readyEnv();
  const { body } = await mintLink(env);
  await handleApi(get(body.links[0].url), env, '/api/download');

  const stored = JSON.parse(env.ENTITLEMENT.store.get(`ent:${await refHash()}`));
  assert.equal(stored.downloads, 1);
  assert.deepEqual(
    Object.keys(stored).sort(),
    ['downloads', 'expires_at', 'granted_at', 'processor', 'status', 'tier', 'updated_at', 'v'],
  );
});

/* ------------------------------------------------------------- refusals */

test('AN EXPIRED SIGNED URL IS REFUSED', async () => {
  const env = await readyEnv();
  const hash = await refHash();
  // Signed with the real key, so only the expiry can refuse it.
  const url = await forgeLink({
    pack: 'health-check',
    version: 'v1.0.0',
    hash,
    expires: Math.floor(Date.now() / 1000) - 1,
  });

  const capture = captureConsole();
  try {
    const res = await handleApi(get(url), env, '/api/download');
    assert.equal(res.status, 403, 'an expired link must not serve a file');
    const body = await res.json();
    assert.equal(body.code, 'bad_link');
    assert.match(capture.text(), /download_link_rejected expired/);
  } finally {
    capture.restore();
  }
});

test('A TAMPERED SIGNATURE IS REFUSED', async () => {
  const env = await readyEnv();
  const { body } = await mintLink(env);
  const url = new URL(body.links[0].url);

  const original = url.searchParams.get('s');
  // One character, at the end, so a compare that stops early would still have
  // matched 63 of the 64.
  const tampered = original.slice(0, -1) + (original.endsWith('0') ? '1' : '0');
  url.searchParams.set('s', tampered);

  const res = await handleApi(get(url.toString()), env, '/api/download');
  assert.equal(res.status, 403, 'a tampered signature must not serve a file');
  assert.equal((await res.json()).code, 'bad_link');
});

test('every other field is covered by the signature too', async () => {
  const env = await readyEnv();
  await seedRelease(env, {
    pack: 'health-check',
    version: 'v0.9.0',
    r2_key: 'packs/health-check/v0.9.0.zip',
    sha256: 'e'.repeat(64),
    min_tier: 1,
    released_at: '2026-07-01 09:00:00',
  });
  await seedEntitlement(env, await refHash(OTHER_REFERENCE), { tier: 2 });

  const { body } = await mintLink(env);
  const base = new URL(body.links[0].url);

  for (const [field, value] of [
    ['p', 'other-pack'],
    ['v', 'v0.9.0'],
    ['h', await refHash(OTHER_REFERENCE)],
    ['e', String(Math.floor(Date.now() / 1000) + 600)],
  ]) {
    const url = new URL(base.toString());
    url.searchParams.set(field, value);
    const res = await handleApi(get(url.toString()), env, '/api/download');
    assert.equal(res.status, 403, `editing ${field} produced ${res.status}, it must be refused`);
  }
});

test('a correctly signed link with an absurd TTL is still refused', async () => {
  // The clamp exists so that a future edit setting a silly TTL, or a leaked key
  // used to mint a year long link, is caught by the verifier rather than by a
  // code review.
  const env = await readyEnv();
  const url = await forgeLink({
    pack: 'health-check',
    version: 'v1.0.0',
    hash: await refHash(),
    expires: Math.floor(Date.now() / 1000) + MAX_TTL_SECONDS + 60,
  });

  const capture = captureConsole();
  try {
    const res = await handleApi(get(url), env, '/api/download');
    assert.equal(res.status, 403);
    assert.match(capture.text(), /download_link_rejected ttl_too_long/);
  } finally {
    capture.restore();
  }
});

test('a refund between minting and downloading stops the download', async () => {
  const env = await readyEnv();
  const { body } = await mintLink(env);

  await writeEntitlement(env, await refHash(), { status: 'refunded', tier: 1, processor: 'paddle' });

  const res = await handleApi(get(body.links[0].url), env, '/api/download');
  assert.equal(res.status, 403, 'entitlement must be rechecked when the file is served');
  assert.equal((await res.json()).code, 'no_entitlement');
});

test('an expired membership cannot mint a link', async () => {
  const env = await readyEnv();
  await seedEntitlement(env, await refHash(), { tier: 1, expires_at: '2020-01-01T00:00:00.000Z' });
  const { res, body } = await mintLink(env);
  assert.equal(res.status, 403);
  assert.equal(body.code, 'no_entitlement');
});

test('an unknown reference is refused in the same words as a lapsed one', async () => {
  const env = await readyEnv();
  const unknown = await handleApi(
    jsonRequest('/api/download', { reference: 'txn_notarealreference00000', pack: 'health-check' }),
    env,
    '/api/download',
  );
  await seedEntitlement(env, await refHash(), { tier: 1, status: 'canceled' });
  const lapsed = await mintLink(env);

  const a = await unknown.json();
  assert.equal(unknown.status, lapsed.res.status);
  assert.equal(a.error, lapsed.body.error, 'the two must be indistinguishable to a prober');
});

/* ---------------------------------------------------- configuration gates */

test('a missing signing key refuses instead of serving anything', async () => {
  const env = await readyEnv({ R2_SIGNING_KEY: undefined });
  const { res, body } = await mintLink(env);
  assert.equal(res.status, 503);
  assert.equal(body.code, 'not_configured');
  assert.match(body.error, /signing key is not set/);
});

test('a short signing key does not count as a set signing key', async () => {
  // The realistic failure: `wrangler secret put` prints "Success!" for a
  // truncated or empty paste, so the length gate lives in code.
  const env = await readyEnv({ R2_SIGNING_KEY: 'a'.repeat(31) });
  const { res } = await mintLink(env);
  assert.equal(res.status, 503, 'a 31 character key must not sign anything');
});

test('the tight limiter fails CLOSED when its binding is absent', async () => {
  const env = await readyEnv({ REISSUE_RATE_LIMIT: undefined });
  for (const path of ['/api/download', '/api/reissue', '/api/entitlement/delete']) {
    const res = await handleApi(jsonRequest(path, { reference: REFERENCE, pack: 'health-check' }), env, path);
    assert.equal(res.status, 503, `${path} answered ${res.status} with no limiter bound`);
  }
});

test('the tight limiter refuses before the reference is looked up', async () => {
  const env = await readyEnv({ REISSUE_RATE_LIMIT: makeLimiter(false) });
  const { res, body } = await mintLink(env);
  assert.equal(res.status, 429);
  assert.equal(body.code, 'rate_limited');
  // Nothing was read from D1 by the handler beyond what the harness seeded.
  const reads = env.DB.log.filter((r) => /pack_release/.test(r.sql) && !/INSERT/.test(r.sql));
  assert.equal(reads.length, 0, 'a rate limited request must not query the release table');
});

/* -------------------------------------------------------------- re-issue */

test('re-issue returns the newest version of every pack the tier allows', async () => {
  const env = await readyEnv();
  await seedRelease(env, {
    pack: 'health-check',
    version: 'v0.9.0',
    r2_key: 'packs/health-check/v0.9.0.zip',
    sha256: 'e'.repeat(64),
    min_tier: 1,
    released_at: '2026-07-01 09:00:00',
  });
  await seedRelease(env, {
    pack: 'rca-generator',
    version: 'v1.0.0',
    r2_key: 'packs/rca-generator/v1.0.0.zip',
    sha256: 'd'.repeat(64),
    min_tier: 2,
    released_at: '2026-08-03 09:00:00',
  });
  await seedRelease(env, {
    pack: 'daily-ops',
    version: 'v1.0.0',
    r2_key: 'packs/daily-ops/v1.0.0.zip',
    sha256: 'c'.repeat(64),
    min_tier: 0,
    released_at: '2026-08-04 09:00:00',
  });

  const res = await handleApi(jsonRequest('/api/reissue', { reference: REFERENCE }), env, '/api/reissue');
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));

  const packs = body.links.map((l) => `${l.pack}@${l.version}`).sort();
  assert.deepEqual(packs, ['daily-ops@v1.0.0', 'health-check@v1.0.0'], JSON.stringify(packs));
  assert.ok(
    !packs.some((p) => p.startsWith('rca-generator')),
    'a tier 1 membership must not be handed a tier 2 pack',
  );
});

test('re-issue on a membership with nothing released yet answers plainly', async () => {
  const env = makeEnv();
  await seedEntitlement(env, await refHash(), { tier: 1 });
  const res = await handleApi(jsonRequest('/api/reissue', { reference: REFERENCE }), env, '/api/reissue');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.links, []);
});

/* -------------------------------------------------------------- deletion */

test('deletion removes the hash and ends access', async () => {
  const env = await readyEnv();
  const hash = await refHash();
  assert.ok(env.ENTITLEMENT.store.has(`ent:${hash}`));

  const res = await handleApi(
    jsonRequest('/api/entitlement/delete', { reference: REFERENCE, confirm: true }),
    env,
    '/api/entitlement/delete',
  );
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.deleted, true);
  assert.ok(!env.ENTITLEMENT.store.has(`ent:${hash}`), 'the hash must be gone from KV');
  assert.match(body.note, /recreates this hash/, 'the re-grant edge must be stated, not hidden');

  const after = await mintLink(env);
  assert.equal(after.res.status, 403, 'deleting the hash must end member access');
});

test('deletion without confirmation deletes nothing', async () => {
  const env = await readyEnv();
  const res = await handleApi(
    jsonRequest('/api/entitlement/delete', { reference: REFERENCE }),
    env,
    '/api/entitlement/delete',
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'not_confirmed');
  assert.ok(env.ENTITLEMENT.store.has(`ent:${await refHash()}`));
});

test('deleting a reference we never held says so rather than pretending', async () => {
  const env = await readyEnv();
  const res = await handleApi(
    jsonRequest('/api/entitlement/delete', { reference: 'txn_neverheardofthisone01', confirm: true }),
    env,
    '/api/entitlement/delete',
  );
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.deleted, false);
});

/* ------------------------------------------------------- the browser's gate */

test('/api/config answers delivery_enabled, which is what opens the form', async () => {
  // The re-issue form's entire open state hangs on this one field name. A
  // rename would leave the form permanently shut behind a green suite, which is
  // the same silent failure as a click that matches no selector: it looks
  // identical to working.
  const on = await handleApi(new Request('https://oradiscuss.com/api/config'), await readyEnv(), '/api/config');
  const onBody = await on.json();
  assert.equal(onBody.delivery_enabled, true, 'a set signing key must open the form');

  const off = await handleApi(
    new Request('https://oradiscuss.com/api/config'),
    await readyEnv({ R2_SIGNING_KEY: undefined }),
    '/api/config',
  );
  const offBody = await off.json();
  assert.equal(offBody.delivery_enabled, false, 'no signing key must leave the form shut');
  assert.ok(offBody.missing_secrets.includes('R2_SIGNING_KEY'), 'the page must be able to name it');

  // Capture and delivery are deliberately independent: delivery needs no bot
  // check and no newsletter, so a dark list must not close the download counter.
  assert.equal(onBody.capture_enabled, false, 'this environment has no capture secrets');
  assert.equal(onBody.delivery_enabled, true, 'and delivery is open anyway');
});

test('/api/health reports the three things delivery needs, without calling them an outage', async () => {
  const env = await readyEnv({ WEBHOOK_RETRY: undefined });
  const res = await handleApi(new Request('https://oradiscuss.com/api/health'), env, '/api/health');
  const body = await res.json();
  assert.deepEqual(Object.keys(body.delivery).sort(), [
    'reissue_limiter_bound',
    'retry_queue_bound',
    'signing_key_set',
  ]);
  assert.equal(body.delivery.signing_key_set, true);
  assert.equal(body.delivery.reissue_limiter_bound, true);
  assert.equal(body.delivery.retry_queue_bound, false, 'an unbound queue must be visible');
  assert.equal(res.status, 200, 'a planned absence is not an outage and must not page anyone');
});

/* ------------------------------------------------------------ input gates */

test('a malformed reference never becomes a storage key', async () => {
  const env = await readyEnv();
  for (const bad of ['', 'short', 'x'.repeat(200), '../../etc/passwd', 'a/b/c/d/e/f', 42, null]) {
    const res = await handleApi(
      jsonRequest('/api/reissue', { reference: bad }),
      env,
      '/api/reissue',
    );
    assert.equal(res.status, 400, `accepted ${JSON.stringify(String(bad).slice(0, 20))}`);
  }
});

test('whitespace inside a pasted reference is stripped, not refused', async () => {
  // Deliberate, and worth a test of its own because it looks like leniency. A
  // reference never contains whitespace, so stripping it cannot collide two
  // real references; it only rescues somebody whose copy from a PDF invoice
  // picked up a line break. Everything else about the shape stays strict.
  const env = await readyEnv();
  const spaced = `${REFERENCE.slice(0, 8)} ${REFERENCE.slice(8)}`;
  const res = await handleApi(jsonRequest('/api/reissue', { reference: spaced }), env, '/api/reissue');
  assert.equal(res.status, 200, 'a reference with a stray space must still find its membership');
  assert.equal((await res.json()).links.length, 1);
});

test('a release registered with no file in the store is a 404, not a 500', async () => {
  const env = await readyEnv();
  env.PACKS = makeR2({});
  const { body } = await mintLink(env);
  const capture = captureConsole();
  try {
    const res = await handleApi(get(body.links[0].url), env, '/api/download');
    assert.equal(res.status, 404);
    assert.match(capture.text(), /pack_object_missing/);
  } finally {
    capture.restore();
  }
});

test('the entitlement writer stores its own fields and drops everything else', async () => {
  // Structural companion to the webhook privacy sweep: even a caller that hands
  // this function a whole customer cannot get one into KV.
  const env = makeEnv();
  const hash = await refHash();
  await writeEntitlement(env, hash, {
    tier: 2,
    status: 'active',
    processor: 'paddle',
    email: 'buyer@example.com',
    name: 'A Buyer',
    address: { city: 'Riyadh' },
    ip: '203.0.113.9',
  });

  const stored = env.ENTITLEMENT.store.get(`ent:${hash}`);
  for (const leak of ['buyer@example.com', 'A Buyer', 'Riyadh', '203.0.113.9']) {
    assert.ok(!stored.includes(leak), `"${leak}" reached the entitlement record: ${stored}`);
  }
});
