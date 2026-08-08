// THE ENTITLEMENT STORE. Hash in, permission out, and nothing else.
//
// The privacy page carries this sentence, live: "To recognise a paying member
// without holding a customer record, we store a one-way hash of the transaction
// reference from the Merchant of Record. It is not derived from your email or
// name, it cannot be reversed to them, and we delete it on request; deleting it
// ends member access."
//
// This file is where that sentence is either true or false, so it is written to
// make it structurally true rather than true by good behaviour:
//
//   1. The KV key is sha256 of a reference issued by the Merchant of Record.
//      Nothing derived from a person is ever hashed here.
//   2. The stored value is BUILT FIELD BY FIELD from a fixed list. A caller
//      cannot spread an extra property into it. Passing a whole processor
//      payload in would store the five fields below and drop everything else,
//      including the buyer's address, which is exactly the accident worth
//      designing out rather than reviewing for.
//   3. Deletion is a real code path with a route in front of it, because a
//      promise nobody implemented is a promise we would have to keep by hand.
//
// test/delivery.test.js drives a full purchase with a payload full of personal
// data and then sweeps KV, D1 and every console line for it.

import { sha256Hex } from './crypto.js';

// A reference is what the buyer reads off the receipt from the Merchant of
// Record. Whitespace is stripped because people paste, and the character set is
// closed because the value is about to become a storage key.
const REFERENCE_RE = /^[A-Za-z0-9._#-]{6,128}$/;

export const STATUSES = ['active', 'past_due', 'canceled', 'refunded'];

export function normaliseReference(value) {
  if (typeof value !== 'string') return null;
  const ref = value.replace(/\s+/g, '');
  return REFERENCE_RE.test(ref) ? ref : null;
}

export async function referenceHash(reference) {
  return sha256Hex(reference);
}

const entKey = (hash) => `ent:${hash}`;
const subKey = (hash) => `sub:${hash}`;

export async function readEntitlement(env, hash) {
  const raw = await env.ENTITLEMENT.get(entKey(hash));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    // An unparseable record is not a permission. Fail closed and say so in the
    // log, without the key, which is the hash of somebody's receipt.
    console.error('entitlement_unparseable');
    return null;
  }
}

// The ONLY writer. Every field is named here; there is no spread and no merge
// of caller-supplied objects.
export async function writeEntitlement(env, hash, fields) {
  const existing = await readEntitlement(env, hash);
  const now = new Date().toISOString();

  const record = {
    v: 1,
    tier: Number.isInteger(fields.tier) ? fields.tier : (existing?.tier ?? 0),
    status: STATUSES.includes(fields.status) ? fields.status : (existing?.status ?? 'canceled'),
    expires_at: typeof fields.expires_at === 'string' ? fields.expires_at : (existing?.expires_at ?? null),
    processor: typeof fields.processor === 'string' ? fields.processor.slice(0, 32) : (existing?.processor ?? null),
    granted_at: existing?.granted_at ?? now,
    updated_at: now,
    downloads: Number.isInteger(existing?.downloads) ? existing.downloads : 0,
  };

  await env.ENTITLEMENT.put(entKey(hash), JSON.stringify(record));
  return record;
}

// The deletion path the privacy page promises. It answers whether anything was
// held, because a person exercising a deletion right is entitled to know.
export async function deleteEntitlement(env, hash) {
  const held = (await env.ENTITLEMENT.get(entKey(hash))) !== null;
  await env.ENTITLEMENT.delete(entKey(hash));
  return held;
}

// A subscription reference and a transaction reference are different strings
// from the same processor, and later lifecycle events arrive carrying only the
// first. This maps hash to hash so those events can find the entitlement the
// purchase created. Both sides are digests; neither is derived from a person.
export async function linkSubscription(env, subscriptionHash, entitlementHash) {
  await env.ENTITLEMENT.put(subKey(subscriptionHash), entitlementHash);
}

export async function resolveSubscription(env, subscriptionHash) {
  const value = await env.ENTITLEMENT.get(subKey(subscriptionHash));
  return typeof value === 'string' && value.length === 64 ? value : null;
}

// Fail closed on anything unreadable: a record with a date we cannot parse is
// not a record we can honour.
export function isActive(record, now = Date.now()) {
  if (!record || record.status !== 'active') return false;
  if (!Number.isInteger(record.tier) || record.tier < 1) return false;
  if (record.expires_at === null || record.expires_at === undefined) return true;
  const ends = Date.parse(record.expires_at);
  return Number.isFinite(ends) && ends > now;
}

// Best effort, and deliberately not awaited into the download's success path:
// a failed counter must never turn a paid download into an error.
export async function bumpDownloads(env, hash) {
  try {
    const record = await readEntitlement(env, hash);
    if (!record) return;
    record.downloads = (Number.isInteger(record.downloads) ? record.downloads : 0) + 1;
    record.updated_at = new Date().toISOString();
    await env.ENTITLEMENT.put(entKey(hash), JSON.stringify(record));
  } catch (err) {
    console.error('download_counter_failed', String(err?.message ?? err));
  }
}
