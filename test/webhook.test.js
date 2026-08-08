// GUARDS over the verified webhook core and the Paddle adapter.
//
// EVERY PAYLOAD AND EVERY SECRET IN THIS FILE IS SYNTHETIC. Nothing here calls
// Paddle, and the "secret" below is a test constant that has never been near an
// account. That is not a limitation of the test: the whole point of a signature
// scheme is that it can be exercised offline, and a webhook handler that needs
// a live processor to be tested is a webhook handler nobody tests.
//
// THE FOUR THAT MATTER, and each was watched failing against the source with
// its check deliberately removed. The exact breakages are in the session report.
//
//   1. A replayed event writes exactly ONE entitlement.
//   2. A bad signature is refused and writes nothing.
//   3. Nothing derived from a person reaches KV, D1, the queue, or a log.
//   4. A failure is queued and recorded, never acknowledged as done.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleApi } from '../worker/api.js';
import { handleRetryBatch } from '../worker/webhook.js';
import { PADDLE } from '../worker/adapters/paddle.js';
import { sha256Hex, hmacSha256Hex } from '../worker/crypto.js';
import {
  makeEnv,
  makeQueue,
  captureConsole,
  everythingWritten,
  TEST_WEBHOOK_SECRET,
} from './support/system-env.js';

const PATH = '/api/paddle/webhook';
const TIER1_PRICE = 'pri_01hv8synthetictier1';
const TIER2_PRICE = 'pri_01hv8synthetictier2';
const TXN = 'txn_01hv8syntheticreference0001';
const SUB = 'sub_01hv8synthetic0001';

// A payload carrying everything a real one carries, including everything we
// must never keep. The privacy sweep looks for exactly these strings.
const PERSON = {
  email: 'buyer.private@example.com',
  name: 'A Real Buyer',
  ip: '198.51.100.4',
  postcode: 'SW1A 1AA',
  card: '4242424242424242',
};

function transactionCompleted({ eventId = 'evt_01hv8synthetic0001', priceId = TIER1_PRICE } = {}) {
  return {
    event_id: eventId,
    event_type: 'transaction.completed',
    occurred_at: '2026-08-05T10:00:00.000Z',
    data: {
      id: TXN,
      status: 'completed',
      subscription_id: SUB,
      customer_id: 'ctm_01hv8synthetic0001',
      customer: { email: PERSON.email, name: PERSON.name },
      billing_details: {
        address: { postal_code: PERSON.postcode, country_code: 'GB' },
      },
      payments: [{ method_details: { card: { last4: PERSON.card.slice(-4) } } }],
      items: [{ price: { id: priceId } }],
      billing_period: { starts_at: '2026-08-05T10:00:00Z', ends_at: '2027-08-05T10:00:00Z' },
      audit: { ip_address: PERSON.ip },
    },
  };
}

async function signed(payload, { secret = TEST_WEBHOOK_SECRET, ts, h1 } = {}) {
  const raw = JSON.stringify(payload);
  const stamp = ts ?? Math.floor(Date.now() / 1000);
  const signature = h1 ?? (await hmacSha256Hex(secret, `${stamp}:${raw}`));
  return new Request(`https://oradiscuss.com${PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Paddle-Signature': `ts=${stamp};h1=${signature}`,
      'CF-Connecting-IP': '203.0.113.9',
    },
    body: raw,
  });
}

async function catalogEnv(overrides = {}) {
  const env = makeEnv(overrides);
  await env.DB.prepare('UPDATE catalog SET paddle_price_id = ?1 WHERE sku = ?2')
    .bind(TIER1_PRICE, 'toolkit')
    .run();
  await env.DB.prepare('UPDATE catalog SET paddle_price_id = ?1 WHERE sku = ?2')
    .bind(TIER2_PRICE, 'toolkit-academy')
    .run();
  return env;
}

const post = (env, request) => handleApi(request, env, PATH);

/* --------------------------------------------------------------- granting */

test('a verified purchase grants the tier the catalog says the price maps to', async () => {
  const env = await catalogEnv();
  const res = await post(env, await signed(transactionCompleted()));
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.applied, true);

  const record = JSON.parse(env.ENTITLEMENT.store.get(`ent:${await sha256Hex(TXN)}`));
  assert.equal(record.tier, 1);
  assert.equal(record.status, 'active');
  assert.equal(record.expires_at, '2027-08-05T10:00:00.000Z');
  assert.equal(record.processor, 'paddle');
});

test('the tier 2 price grants tier 2, so the mapping is read and not assumed', async () => {
  const env = await catalogEnv();
  await post(env, await signed(transactionCompleted({ priceId: TIER2_PRICE })));
  const record = JSON.parse(env.ENTITLEMENT.store.get(`ent:${await sha256Hex(TXN)}`));
  assert.equal(record.tier, 2);
});

/* ------------------------------------------------------------ idempotency */

test('A REPLAYED EVENT WRITES EXACTLY ONE ENTITLEMENT', async () => {
  const env = await catalogEnv();
  const payload = transactionCompleted();

  const first = await post(env, await signed(payload));
  const second = await post(env, await signed(payload));

  assert.equal(first.status, 200);
  assert.equal((await first.json()).applied, true);

  assert.equal(second.status, 200, 'a redelivery must be acknowledged, not refused');
  const secondBody = await second.json();
  assert.equal(secondBody.deduped, true);
  assert.equal(secondBody.applied, undefined);

  assert.equal(
    env.ENTITLEMENT.entitlementWrites().length,
    1,
    `expected one entitlement write, got ${env.ENTITLEMENT.entitlementWrites().length}`,
  );
});

test('a replay signed at a different timestamp is still one write', async () => {
  // The signature covers the timestamp, so a genuine redelivery arrives with a
  // NEW signature. Idempotency therefore cannot be a property of the signature
  // and has to be the ledger's job, which is what this proves.
  const env = await catalogEnv();
  const payload = transactionCompleted();
  const now = Math.floor(Date.now() / 1000);

  await post(env, await signed(payload, { ts: now - 120 }));
  await post(env, await signed(payload, { ts: now }));

  assert.equal(env.ENTITLEMENT.entitlementWrites().length, 1);
});

test('two different events both apply, so the ledger is not just refusing everything', async () => {
  // The companion to every dedupe test. A guard that answers "already seen" to
  // everything would pass the replay test and lose every purchase.
  const env = await catalogEnv();
  await post(env, await signed(transactionCompleted({ eventId: 'evt_synthetic_a' })));
  await post(env, await signed(transactionCompleted({ eventId: 'evt_synthetic_b' })));
  assert.equal(env.ENTITLEMENT.entitlementWrites().length, 2);
});

/* -------------------------------------------------------------- signature */

test('A WEBHOOK WITH A BAD SIGNATURE IS REFUSED AND WRITES NOTHING', async () => {
  const env = await catalogEnv();
  const capture = captureConsole();
  try {
    const res = await post(
      env,
      await signed(transactionCompleted(), { secret: 'a-different-secret-entirely-000000' }),
    );
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'bad_signature');
    assert.equal(env.ENTITLEMENT.writes.length, 0, 'nothing may be written on a bad signature');
    assert.equal(
      env.DB.log.filter((r) => /webhook_event|webhook_failure/.test(r.sql)).length,
      0,
      'no ledger row may be claimed on a bad signature',
    );
    assert.match(capture.text(), /webhook_signature_rejected paddle signature_mismatch/);
  } finally {
    capture.restore();
  }
});

test('a malformed signature header is refused before any hashing', async () => {
  const env = await catalogEnv();
  const capture = captureConsole();
  try {
    for (const header of ['', 'nonsense', 'ts=abc;h1=zz', `ts=${Math.floor(Date.now() / 1000)}`, 'h1=' + 'f'.repeat(64)]) {
      const raw = JSON.stringify(transactionCompleted());
      const request = new Request(`https://oradiscuss.com${PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Paddle-Signature': header },
        body: raw,
      });
      const res = await post(env, request);
      assert.equal(res.status, 403, `header ${JSON.stringify(header)} answered ${res.status}`);
    }
    assert.equal(env.ENTITLEMENT.writes.length, 0);
  } finally {
    capture.restore();
  }
});

test('a signature from outside the skew window is refused', async () => {
  const env = await catalogEnv();
  const stale = Math.floor(Date.now() / 1000) - (PADDLE.maxSkewSeconds + 60);
  const capture = captureConsole();
  try {
    const res = await post(env, await signed(transactionCompleted(), { ts: stale }));
    assert.equal(res.status, 403);
    assert.match(capture.text(), /signature_timestamp_stale/);
  } finally {
    capture.restore();
  }
});

test('a missing webhook secret refuses and names the secret', async () => {
  const env = await catalogEnv({ PADDLE_WEBHOOK_SECRET: undefined });
  const capture = captureConsole();
  try {
    const res = await post(env, await signed(transactionCompleted()));
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.match(body.error, /PADDLE_WEBHOOK_SECRET is not set/);
    assert.equal(env.ENTITLEMENT.writes.length, 0);
  } finally {
    capture.restore();
  }
});

test('an empty secret is not a set secret', async () => {
  const env = await catalogEnv({ PADDLE_WEBHOOK_SECRET: '   ' });
  const res = await post(env, await signed(transactionCompleted()));
  assert.equal(res.status, 503, 'a whitespace secret must not be used to verify anything');
});

/* ----------------------------------------------------------------- privacy */

test('NOTHING DERIVED FROM A PERSON REACHES KV, D1, THE QUEUE, OR A LOG', async () => {
  const env = await catalogEnv();
  const capture = captureConsole();
  try {
    const res = await post(env, await signed(transactionCompleted()));
    assert.equal(res.status, 200);

    const written = everythingWritten(env, capture);
    for (const leak of [PERSON.email, 'buyer.private', 'A Real Buyer', PERSON.ip, PERSON.postcode, '4242']) {
      assert.ok(!written.includes(leak), `"${leak}" reached a store or a log. Written surface:\n${written}`);
    }

    // The reference itself is not stored either. Only its digest is.
    assert.ok(!written.includes(TXN), 'the raw transaction reference was stored, only its hash may be');
    assert.ok(!written.includes(SUB), 'the raw subscription reference was stored');
    assert.ok(written.includes(await sha256Hex(TXN)), 'the hash of the reference should be what is stored');
  } finally {
    capture.restore();
  }
});

test('the normalised event has an exact key set, so nothing can ride along', async () => {
  const env = await catalogEnv({ WEBHOOK_RETRY: makeQueue() });
  // Force the failure path so the normalised record reaches the queue, which is
  // the one place it leaves the Worker.
  await env.DB.prepare('UPDATE catalog SET paddle_price_id = NULL').run();
  const capture = captureConsole();
  try {
    await post(env, await signed(transactionCompleted()));
    assert.equal(env.WEBHOOK_RETRY.sent.length, 1);
    assert.deepEqual(
      Object.keys(env.WEBHOOK_RETRY.sent[0]).sort(),
      [
        'event_hash',
        'event_type',
        'expires_at',
        'price_refs',
        'processor',
        'reference_hash',
        'retry_reason',
        'status',
        'subscription_hash',
        'v',
      ],
    );
  } finally {
    capture.restore();
  }
});

test('the adapter parse output carries identifiers and nothing else', async () => {
  const parsed = PADDLE.parse(JSON.stringify(transactionCompleted()));
  assert.equal(parsed.ok, true);
  assert.deepEqual(
    Object.keys(parsed.event).sort(),
    ['event_id', 'expires_at', 'price_refs', 'reference', 'status', 'subscription_reference', 'type'],
  );
  const flat = JSON.stringify(parsed.event);
  for (const leak of [PERSON.email, PERSON.name, PERSON.ip, PERSON.postcode]) {
    assert.ok(!flat.includes(leak), `the adapter carried "${leak}" out of the payload`);
  }
});

/* ---------------------------------------------------------- failure paths */

test('an unrecognised price id does not grant, it queues and is recorded', async () => {
  const env = await catalogEnv();
  await env.DB.prepare('UPDATE catalog SET paddle_price_id = NULL').run();
  const capture = captureConsole();
  try {
    const res = await post(env, await signed(transactionCompleted()));
    const body = await res.json();

    assert.equal(res.status, 202, 'a queued event is acknowledged, not lost and not granted');
    assert.equal(body.queued, true);
    assert.equal(body.reason, 'unknown_tier');
    assert.equal(env.ENTITLEMENT.entitlementWrites().length, 0, 'an unknown tier must never be granted');

    const failure = await env.DB.prepare('SELECT * FROM webhook_failure').first();
    assert.equal(failure.reason, 'unknown_tier');
    assert.equal(failure.attempts, 1);

    const claim = await env.DB.prepare('SELECT processed_at FROM webhook_event').first();
    assert.equal(claim.processed_at, null, 'a failed event must stay unprocessed so a retry can run');
    assert.equal(env.WEBHOOK_RETRY.sent.length, 1);
  } finally {
    capture.restore();
  }
});

test('with no queue bound the failure is still recorded and answered 500', async () => {
  const env = await catalogEnv({ WEBHOOK_RETRY: undefined });
  await env.DB.prepare('UPDATE catalog SET paddle_price_id = NULL').run();
  const capture = captureConsole();
  try {
    const res = await post(env, await signed(transactionCompleted()));
    const body = await res.json();
    assert.equal(res.status, 500, 'an unqueued failure must NOT be acknowledged');
    assert.equal(body.recorded, true);
    const failure = await env.DB.prepare('SELECT * FROM webhook_failure').first();
    assert.equal(failure.reason, 'unknown_tier');
  } finally {
    capture.restore();
  }
});

test('a queue that throws does not turn into a 200', async () => {
  const env = await catalogEnv({ WEBHOOK_RETRY: makeQueue({ fail: true }) });
  await env.DB.prepare('UPDATE catalog SET paddle_price_id = NULL').run();
  const capture = captureConsole();
  try {
    const res = await post(env, await signed(transactionCompleted()));
    assert.equal(res.status, 500);
    assert.match(capture.text(), /webhook_enqueue_failed/);
  } finally {
    capture.restore();
  }
});

test('the retry consumer applies a queued event, once, and acks it', async () => {
  const env = await catalogEnv();
  await env.DB.prepare('UPDATE catalog SET paddle_price_id = NULL').run();
  const capture = captureConsole();
  try {
    await post(env, await signed(transactionCompleted()));
    assert.equal(env.WEBHOOK_RETRY.sent.length, 1);

    // The founder records the price ids, and the queued event now resolves.
    await env.DB.prepare('UPDATE catalog SET paddle_price_id = ?1 WHERE sku = ?2')
      .bind(TIER1_PRICE, 'toolkit')
      .run();

    const acked = [];
    const retried = [];
    await handleRetryBatch(
      {
        messages: env.WEBHOOK_RETRY.sent.map((body) => ({
          body,
          ack: () => acked.push(body.event_hash),
          retry: () => retried.push(body.event_hash),
        })),
      },
      env,
    );

    assert.deepEqual(retried, [], 'a message that applied must not be handed back');
    assert.equal(acked.length, 1);
    assert.equal(env.ENTITLEMENT.entitlementWrites().length, 1);

    const claim = await env.DB.prepare('SELECT processed_at FROM webhook_event').first();
    assert.ok(claim.processed_at, 'the retry must stamp the ledger');

    // The dead letter table is a list of open questions. An event that later
    // succeeded is not one, so its row must be gone rather than left for a
    // founder to join against the ledger to find out it is stale.
    const stillFailing = await env.DB.prepare('SELECT COUNT(*) AS n FROM webhook_failure').first();
    assert.equal(stillFailing.n, 0, 'a resolved failure must not stay in the dead letter table');
  } finally {
    capture.restore();
  }
});

test('a retry that still fails is handed back to the queue, not acknowledged', async () => {
  const env = await catalogEnv();
  await env.DB.prepare('UPDATE catalog SET paddle_price_id = NULL').run();
  const capture = captureConsole();
  try {
    await post(env, await signed(transactionCompleted()));
    const acked = [];
    const retried = [];
    await handleRetryBatch(
      {
        messages: env.WEBHOOK_RETRY.sent.map((body) => ({
          body,
          ack: () => acked.push(body.event_hash),
          retry: () => retried.push(body.event_hash),
        })),
      },
      env,
    );
    assert.deepEqual(acked, []);
    assert.equal(retried.length, 1);

    const failure = await env.DB.prepare('SELECT attempts FROM webhook_failure').first();
    assert.equal(failure.attempts, 2, 'the dead letter record counts the attempts');
  } finally {
    capture.restore();
  }
});

/* ------------------------------------------------------------- lifecycle */

test('a cancellation finds the entitlement through the subscription link', async () => {
  const env = await catalogEnv();
  await post(env, await signed(transactionCompleted()));

  const cancel = {
    event_id: 'evt_01hv8synthetic_cancel',
    event_type: 'subscription.canceled',
    data: { id: SUB, status: 'canceled', customer: { email: PERSON.email } },
  };
  const res = await post(env, await signed(cancel));
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));

  const record = JSON.parse(env.ENTITLEMENT.store.get(`ent:${await sha256Hex(TXN)}`));
  assert.equal(record.status, 'canceled');
  assert.equal(record.tier, 1, 'a cancellation must not wipe the tier it never carried');
});

test('a refund adjustment revokes the purchase it names', async () => {
  const env = await catalogEnv();
  await post(env, await signed(transactionCompleted()));

  const refund = {
    event_id: 'evt_01hv8synthetic_refund',
    event_type: 'adjustment.created',
    data: { id: 'adj_01', action: 'refund', transaction_id: TXN, status: 'approved' },
  };
  await post(env, await signed(refund));

  const record = JSON.parse(env.ENTITLEMENT.store.get(`ent:${await sha256Hex(TXN)}`));
  assert.equal(record.status, 'refunded');
});

test('a lifecycle event for a purchase we never saw is queued, not granted', async () => {
  const env = await catalogEnv();
  const capture = captureConsole();
  try {
    const orphan = {
      event_id: 'evt_01hv8synthetic_orphan',
      event_type: 'subscription.canceled',
      data: { id: 'sub_never_seen_here_0001', status: 'canceled' },
    };
    const res = await post(env, await signed(orphan));
    assert.equal(res.status, 202);
    assert.equal((await res.json()).reason, 'unresolved_reference');
    assert.equal(env.ENTITLEMENT.entitlementWrites().length, 0);
  } finally {
    capture.restore();
  }
});

test('an event type we do not act on is acknowledged and stored nowhere', async () => {
  const env = await catalogEnv();
  const res = await post(
    env,
    await signed({
      event_id: 'evt_01hv8synthetic_report',
      event_type: 'report.created',
      data: { id: 'rep_01', customer: { email: PERSON.email } },
    }),
  );
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ignored, true);
  assert.equal(env.ENTITLEMENT.writes.length, 0);
  assert.equal(env.DB.log.filter((r) => /webhook_event/.test(r.sql)).length, 0);
});

test('an adjustment that is not a refund does not revoke anything', async () => {
  const env = await catalogEnv();
  await post(env, await signed(transactionCompleted()));
  await post(
    env,
    await signed({
      event_id: 'evt_01hv8synthetic_credit_reverse',
      event_type: 'adjustment.created',
      data: { id: 'adj_02', action: 'credit_reverse', transaction_id: TXN },
    }),
  );
  const record = JSON.parse(env.ENTITLEMENT.store.get(`ent:${await sha256Hex(TXN)}`));
  assert.equal(record.status, 'active', 'only a refund or a chargeback revokes');
});

/* ------------------------------------------------------------- structure */

test('the registry can carry a second processor without touching the core', async () => {
  // The processor neutrality claim, asserted rather than described. Every field
  // the core reads off an adapter is checked here, so a new adapter that omits
  // one fails this test rather than failing in production.
  const { ADAPTERS } = await import('../worker/webhook.js');
  for (const [key, adapter] of Object.entries(ADAPTERS)) {
    assert.equal(adapter.name, key, 'an adapter must be registered under its own name');
    assert.match(adapter.secretName, /^[A-Z][A-Z0-9_]+$/);
    assert.match(adapter.priceColumn, /^[a-z][a-z0-9_]{2,40}$/, 'the price column is interpolated into SQL');
    assert.equal(typeof adapter.verify, 'function');
    assert.equal(typeof adapter.parse, 'function');
    assert.ok(Number.isInteger(adapter.maxSkewSeconds) && adapter.maxSkewSeconds > 0);
  }
});

test('an unknown processor path is a 404, not a silent accept', async () => {
  const env = await catalogEnv();
  const res = await handleApi(
    new Request('https://oradiscuss.com/api/lemonsqueezy/webhook', { method: 'POST', body: '{}' }),
    env,
    '/api/lemonsqueezy/webhook',
  );
  assert.equal(res.status, 404);
});
