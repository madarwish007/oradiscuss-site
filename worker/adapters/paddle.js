// PADDLE ADAPTER. One of two things a processor needs from us: how to check its
// signature, and how to read its payload. Everything after that is in
// worker/webhook.js and is shared.
//
// The legal pages were deliberately rewritten to name a processor exactly twice
// and to say "the Merchant of Record shown at checkout" everywhere else, so a
// second processor is a one line edit rather than a rewrite. This file is the
// code side of that decision: adding Lemon Squeezy means a sibling file here, a
// line in the ADAPTERS registry, one literal route, and a migration adding its
// price id column. It means no change to the verification core, the idempotency
// ledger, the retry queue, or the entitlement store.
//
// NOTHING HERE CALLS PADDLE. There is no API client in this file and there must
// not be one: everything the webhook needs is inside the payload we were sent,
// and a webhook that phones home cannot be tested without a live account.

import { hmacSha256Hex, timingSafeEqualHex } from '../crypto.js';

// Paddle Billing signs `${ts}:${rawBody}` with the notification secret and
// sends `Paddle-Signature: ts=<unix>;h1=<hex>`. The version prefix is read
// rather than assumed, so a future h2 arrives as an unknown version instead of
// being silently compared against the wrong algorithm.
function parseSignatureHeader(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return null;
  const parts = {};
  for (const chunk of value.split(';')) {
    const index = chunk.indexOf('=');
    if (index <= 0) continue;
    const key = chunk.slice(0, index).trim();
    const val = chunk.slice(index + 1).trim();
    if (key && val && !(key in parts)) parts[key] = val;
  }
  if (!/^\d{1,12}$/.test(parts.ts ?? '')) return null;
  if (!/^[0-9a-f]{64}$/.test(parts.h1 ?? '')) return null;
  return { ts: Number(parts.ts), h1: parts.h1 };
}

const SUBSCRIPTION_STATUS = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  paused: 'canceled',
  canceled: 'canceled',
};

// Adjustment actions that take access away. The reversing actions are
// deliberately absent: restoring an entitlement on a reversal is a money
// decision, and guessing at one silently is worse than leaving it for a human.
const REVOKING_ADJUSTMENTS = new Set(['refund', 'chargeback']);

function priceRefs(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const refs = [];
  for (const item of items) {
    const id = item?.price?.id ?? item?.price_id;
    if (typeof id === 'string' && id.length > 0 && id.length <= 64) refs.push(id);
  }
  return [...new Set(refs)];
}

function isoOrNull(value) {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function reference(value) {
  return typeof value === 'string' && value.length >= 6 && value.length <= 128 ? value : null;
}

export const PADDLE = {
  name: 'paddle',
  secretName: 'PADDLE_WEBHOOK_SECRET',
  signatureHeader: 'Paddle-Signature',

  // The catalog column holding this processor's price identifiers. The core
  // interpolates it into a SELECT, so it is validated there against a strict
  // pattern before it is used; it is a constant in this file and never comes
  // from a request.
  priceColumn: 'paddle_price_id',

  // How far the signed timestamp may sit from our clock. This bounds replay of
  // a captured request; it does NOT make a redelivery safe, because Paddle
  // legitimately redelivers inside this window. Refusing a genuine redelivery
  // would drop a purchase, so exactly-once is the idempotency ledger's job and
  // this window is only about a captured payload replayed later.
  maxSkewSeconds: 300,

  async verify({ rawBody, headers, secret, now = Date.now() }) {
    const parsed = parseSignatureHeader(headers.get(this.signatureHeader));
    if (!parsed) return { ok: false, reason: 'signature_header_malformed' };

    const skew = Math.abs(Math.floor(now / 1000) - parsed.ts);
    if (skew > this.maxSkewSeconds) return { ok: false, reason: 'signature_timestamp_stale' };

    const expected = await hmacSha256Hex(secret, `${parsed.ts}:${rawBody}`);
    if (!timingSafeEqualHex(expected, parsed.h1)) return { ok: false, reason: 'signature_mismatch' };

    return { ok: true };
  },

  // Reads the payload down to the fields below and NOTHING else. A Paddle
  // payload carries the buyer's email, name and address; none of them appear in
  // the returned object, so nothing downstream, including the retry queue, can
  // ever be handed one. test/webhook.test.js asserts the exact key set.
  parse(rawBody) {
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return { ok: false, reason: 'body_not_json' };
    }
    if (!payload || typeof payload !== 'object') return { ok: false, reason: 'body_not_object' };

    const eventId = reference(payload.event_id);
    const type = typeof payload.event_type === 'string' ? payload.event_type.slice(0, 64) : '';
    if (!eventId || !type) return { ok: false, reason: 'event_unidentified' };

    const data = payload.data ?? {};
    const base = {
      event_id: eventId,
      type,
      reference: null,
      subscription_reference: null,
      price_refs: [],
      status: null,
      expires_at: null,
    };

    if (type === 'transaction.completed') {
      return {
        ok: true,
        event: {
          ...base,
          reference: reference(data.id),
          subscription_reference: reference(data.subscription_id),
          price_refs: priceRefs(data),
          status: 'active',
          expires_at: isoOrNull(data.billing_period?.ends_at),
        },
      };
    }

    if (type === 'subscription.created' || type === 'subscription.updated') {
      return {
        ok: true,
        event: {
          ...base,
          reference: reference(data.transaction_id),
          subscription_reference: reference(data.id),
          price_refs: priceRefs(data),
          status: SUBSCRIPTION_STATUS[data.status] ?? 'canceled',
          expires_at: isoOrNull(data.current_billing_period?.ends_at),
        },
      };
    }

    if (type === 'subscription.canceled') {
      return {
        ok: true,
        event: { ...base, subscription_reference: reference(data.id), status: 'canceled' },
      };
    }

    if (type === 'adjustment.created') {
      if (!REVOKING_ADJUSTMENTS.has(data.action)) {
        return { ok: true, event: { ...base, ignored: true } };
      }
      return {
        ok: true,
        event: { ...base, reference: reference(data.transaction_id), status: 'refunded' },
      };
    }

    // An event type we do not act on is acknowledged and dropped. Answering
    // anything but 200 would make the processor retry a message forever.
    return { ok: true, event: { ...base, ignored: true } };
  },
};
