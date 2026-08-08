// THE VERIFIED WEBHOOK CORE. Processor neutral, and it stays that way.
//
// A processor supplies two things and nothing more: how to check its signature,
// and how to read its payload down to our own small shape. Both live in
// worker/adapters/<name>.js. Everything below is shared: the secret gate, the
// order of operations, the idempotency ledger, the tier lookup, the retry
// queue, the dead letter record, and the entitlement write.
//
// THE ORDER OF OPERATIONS IS THE DESIGN, so it is written out once here:
//
//   1. Refuse if the signing secret is not installed. An unverifiable event is
//      not processed, ever, and the refusal names the secret for the founder.
//   2. Verify the signature against the RAW body, before it is parsed.
//   3. Parse to a normalised event: identifiers, a status, a date. Nothing else.
//   4. NORMALISE TO HASHES IMMEDIATELY. This is the step that keeps the privacy
//      page true. A processor payload carries the buyer's email, name and
//      address, so the raw body is never stored, never logged, and never put on
//      the retry queue: what goes to the queue is the hash only record built in
//      `normalise`, which is already verified and already anonymous.
//   5. Claim the event id in D1 before anything is granted. A replay finds the
//      claim already processed and writes nothing.
//   6. Apply. On failure, record it in D1 and queue it. Never answer 200 for an
//      event that was neither applied nor deduplicated.

import { json, fail } from './http.js';
import { sha256Hex } from './crypto.js';
import { readSecret } from './integrations.js';
import {
  writeEntitlement,
  linkSubscription,
  resolveSubscription,
} from './entitlement.js';
import { PADDLE } from './adapters/paddle.js';

// Adding a processor is a new file plus a line here plus one literal route in
// worker/api.js. It is not a rewrite of anything below.
export const ADAPTERS = {
  paddle: PADDLE,
};

// Webhook payloads are larger than our forms and still small. Paddle's biggest
// transaction payload is a few kilobytes.
const MAX_WEBHOOK_BYTES = 64 * 1024;

// A column name is interpolated into SQL below, so it is checked against this
// before it is used. The value is a constant inside an adapter and never comes
// from a request, which makes this a guard against a careless future edit
// rather than against a caller.
const SAFE_COLUMN = /^[a-z][a-z0-9_]{2,40}$/;

/* --------------------------------------------------------------- helpers */

async function tierForPriceRefs(env, adapter, refs) {
  if (!Array.isArray(refs) || refs.length === 0) return null;
  if (!SAFE_COLUMN.test(adapter.priceColumn)) {
    throw new Error(`adapter ${adapter.name} declares an unusable price column`);
  }
  const placeholders = refs.map((_, i) => `?${i + 1}`).join(', ');
  const { results } = await env.DB.prepare(
    `SELECT tier FROM catalog WHERE ${adapter.priceColumn} IN (${placeholders})`,
  )
    .bind(...refs)
    .all();

  const tiers = (results ?? []).map((r) => r.tier).filter((t) => Number.isInteger(t) && t > 0);
  // A purchase of two things grants the higher of them. Nothing here invents a
  // tier: an unrecognised price id returns null and the event fails loudly into
  // the retry path, because the alternative is granting tier 1 to a tier 2 buyer.
  return tiers.length ? Math.max(...tiers) : null;
}

// The whole record that may be stored, queued, or written to a log. Every field
// is an identifier of an EVENT, a PRODUCT, or a DIGEST of a reference. There is
// no field here that could hold a person, and that is checked by a test that
// runs a payload full of personal data through the handler and sweeps every
// store afterwards.
//
// The tier is deliberately NOT resolved here. It is resolved at apply time, so
// a retry re-reads the catalog instead of replaying a stale answer. The first
// version of this froze the lookup into the queued record, which meant an event
// that failed because the price ids were not recorded yet could never succeed
// on retry, however many times it ran. A test caught it; the shape below is the
// fix, and it is why `price_refs` travels rather than `tier`.
async function normalise(adapter, event) {
  return {
    v: 1,
    processor: adapter.name,
    event_hash: await sha256Hex(`${adapter.name}:${event.event_id}`),
    event_type: event.type,
    reference_hash: event.reference ? await sha256Hex(event.reference) : null,
    subscription_hash: event.subscription_reference
      ? await sha256Hex(event.subscription_reference)
      : null,
    price_refs: Array.isArray(event.price_refs) ? event.price_refs : [],
    status: event.status,
    expires_at: event.expires_at ?? null,
  };
}

/* ------------------------------------------------------- the D1 ledgers */

// Claim first, apply second. `INSERT OR IGNORE` is atomic in SQLite and D1, so
// two simultaneous deliveries cannot both win the claim.
//
// `processed_at` is what makes this correct rather than merely present. A claim
// that exists but was never marked processed is an attempt that died halfway,
// and it must be allowed to run again; only a claim carrying a processed
// timestamp is a true replay.
async function claimEvent(env, record) {
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO webhook_event (event_hash, processor, event_type, received_at)
     VALUES (?1, ?2, ?3, datetime('now'))`,
  )
    .bind(record.event_hash, record.processor, record.event_type)
    .run();

  if ((inserted?.meta?.changes ?? 0) > 0) return { duplicate: false };

  const existing = await env.DB.prepare(
    'SELECT processed_at FROM webhook_event WHERE event_hash = ?1',
  )
    .bind(record.event_hash)
    .first();

  return { duplicate: Boolean(existing?.processed_at) };
}

async function markProcessed(env, record) {
  await env.DB.prepare(
    `UPDATE webhook_event SET processed_at = datetime('now') WHERE event_hash = ?1`,
  )
    .bind(record.event_hash)
    .run();
}

// The durable record of anything that did not apply. It exists so that a
// failure is visible in a query rather than only in a log line that ages out,
// and so that a queue outage cannot make an event disappear.
async function recordFailure(env, record, reason) {
  try {
    await env.DB.prepare(
      `INSERT INTO webhook_failure (event_hash, processor, event_type, reason)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(event_hash) DO UPDATE
          SET attempts = attempts + 1,
              reason = excluded.reason,
              last_seen_at = datetime('now')`,
    )
      .bind(record.event_hash, record.processor, record.event_type, String(reason).slice(0, 120))
      .run();
    return true;
  } catch (err) {
    console.error('webhook_failure_unrecorded', record.processor, String(err?.message ?? err));
    return false;
  }
}

// A dead letter row is a question for a human, so it must stop being one the
// moment a retry answers it. Without this, the failure table accumulates every
// event that ever failed once, including all the ones that later succeeded, and
// a founder reading it cannot tell which are still open without joining the
// ledger to find out.
async function clearFailure(env, record) {
  try {
    await env.DB.prepare('DELETE FROM webhook_failure WHERE event_hash = ?1')
      .bind(record.event_hash)
      .run();
  } catch (err) {
    // Cosmetic. The entitlement is already written, so a stale failure row is
    // noise rather than a wrong permission, and it must not become a refusal.
    console.error('webhook_failure_unclearable', record.processor, String(err?.message ?? err));
  }
}

async function enqueueRetry(env, record, reason) {
  if (!env.WEBHOOK_RETRY) return false;
  try {
    await env.WEBHOOK_RETRY.send({ ...record, retry_reason: String(reason).slice(0, 120) });
    return true;
  } catch (err) {
    console.error('webhook_enqueue_failed', record.processor, String(err?.message ?? err));
    return false;
  }
}

/* ------------------------------------------------------- applying an event */

// Turns a normalised record into a permission. Shared by the HTTP path and the
// queue consumer, so a retry takes exactly the same route as a first delivery.
export async function applyEntitlement(env, record) {
  let hash = record.reference_hash;

  // Later lifecycle events arrive naming only the subscription, so the link
  // written at purchase time is how they find the entitlement they belong to.
  if (!hash && record.subscription_hash) {
    hash = await resolveSubscription(env, record.subscription_hash);
  }
  if (!hash) return { ok: false, reason: 'unresolved_reference' };

  // The tier is read from the catalog HERE, on every attempt, so a retry after
  // the founder records the price ids resolves where the first attempt could
  // not. A grant with no tier is refused rather than guessed: the alternative
  // is handing a tier 2 buyer a tier 1 membership and never finding out.
  let tier;
  if (record.status === 'active') {
    const adapter = ADAPTERS[record.processor];
    if (!adapter) return { ok: false, reason: 'unknown_processor' };
    const resolved = await tierForPriceRefs(env, adapter, record.price_refs);
    if (!Number.isInteger(resolved)) return { ok: false, reason: 'unknown_tier' };
    tier = resolved;
  }

  await writeEntitlement(env, hash, {
    tier,
    status: record.status,
    expires_at: record.expires_at ?? undefined,
    processor: record.processor,
  });

  if (record.subscription_hash && record.reference_hash) {
    await linkSubscription(env, record.subscription_hash, record.reference_hash);
  }

  return { ok: true, hash };
}

// claim, apply, mark. The one path an event takes, whether it arrived over HTTP
// or off the retry queue.
export async function processEvent(env, record) {
  let claim;
  try {
    claim = await claimEvent(env, record);
  } catch (err) {
    console.error('webhook_ledger_unavailable', record.processor, String(err?.message ?? err));
    return { status: 'failed', reason: 'ledger_unavailable' };
  }
  if (claim.duplicate) return { status: 'deduped' };

  let applied;
  try {
    applied = await applyEntitlement(env, record);
  } catch (err) {
    console.error('webhook_apply_threw', record.processor, String(err?.message ?? err));
    applied = { ok: false, reason: 'apply_threw' };
  }
  if (!applied.ok) return { status: 'failed', reason: applied.reason };

  try {
    await markProcessed(env, record);
  } catch (err) {
    // The permission is already written. Failing to stamp the ledger means a
    // redelivery would apply the same value again, which is harmless, so this
    // is recorded and not turned into a refusal.
    console.error('webhook_mark_failed', record.processor, String(err?.message ?? err));
  }
  await clearFailure(env, record);
  return { status: 'applied' };
}

/* --------------------------------------------------------------- the route */

export async function handleWebhook(request, env, processorName) {
  const adapter = ADAPTERS[processorName];
  if (!adapter) return fail(404, 'unknown_processor', 'No such webhook endpoint.');

  const secret = readSecret(env, adapter.secretName);
  if (!secret.set) {
    console.error('webhook_not_configured', adapter.name, adapter.secretName);
    return fail(
      503,
      'not_configured',
      `${adapter.secretName} is not set on this Worker, so the signature cannot be checked. The event was not processed and nothing was stored.`,
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_WEBHOOK_BYTES) {
    return fail(413, 'too_large', 'That payload is larger than any event we accept.');
  }

  const verdict = await adapter.verify({
    rawBody: raw,
    headers: request.headers,
    secret: secret.value,
    now: Date.now(),
  });
  if (!verdict.ok) {
    // The reason is ours; the sender gets one sentence. The raw body is not
    // logged here or anywhere: it carries the buyer's address.
    console.warn('webhook_signature_rejected', adapter.name, verdict.reason);
    return fail(403, 'bad_signature', 'That request did not carry a valid signature.');
  }

  const parsed = adapter.parse(raw);
  if (!parsed.ok) {
    console.warn('webhook_unparseable', adapter.name, parsed.reason);
    return fail(400, 'bad_payload', 'That payload could not be read.');
  }
  if (parsed.event.ignored) {
    return json({ ok: true, ignored: true, event_type: parsed.event.type });
  }

  let record;
  try {
    record = await normalise(adapter, parsed.event);
  } catch (err) {
    console.error('webhook_normalise_failed', adapter.name, String(err?.message ?? err));
    return fail(500, 'not_processed', 'The event was verified but could not be prepared. Nothing was stored.');
  }

  const result = await processEvent(env, record);
  if (result.status === 'deduped') {
    return json({ ok: true, deduped: true, event_type: record.event_type });
  }
  if (result.status === 'applied') {
    return json({ ok: true, applied: true, status: record.status });
  }

  // Failed. Record it durably, then try the queue. A 202 is only returned once
  // the event is somewhere it will be picked up again; otherwise the answer is
  // a 500 so the processor's own retry schedule keeps the event alive.
  const recorded = await recordFailure(env, record, result.reason);
  const queued = await enqueueRetry(env, record, result.reason);
  console.warn('webhook_not_applied', adapter.name, record.event_type, result.reason, `queued=${queued}`, `recorded=${recorded}`);

  if (queued) {
    return json({ ok: true, queued: true, reason: result.reason }, { status: 202 });
  }
  return fail(
    500,
    'not_processed',
    'The event was verified but not applied. It is recorded here and has not been acknowledged, so please redeliver it.',
    { recorded },
  );
}

// The queue consumer. Same path, same ledger, so a retried event cannot double
// grant and cannot be silently dropped: a message that still fails is handed
// back to the queue rather than acknowledged.
export async function handleRetryBatch(batch, env) {
  for (const message of batch.messages) {
    const record = message.body;
    if (!record || typeof record !== 'object' || typeof record.event_hash !== 'string') {
      console.error('webhook_retry_unreadable');
      message.ack();
      continue;
    }
    try {
      const result = await processEvent(env, record);
      if (result.status === 'failed') {
        console.warn('webhook_retry_still_failing', record.processor, result.reason);
        await recordFailure(env, record, result.reason);
        message.retry();
        continue;
      }
      message.ack();
    } catch (err) {
      console.error('webhook_retry_threw', String(err?.message ?? err));
      message.retry();
    }
  }
}
