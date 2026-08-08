// External integrations for the capture layer: Turnstile and beehiiv.
//
// Two rules govern this file and nothing in it may break them.
//
// 1. THE ADDRESS GOES TO BEEHIIV AND NOWHERE ELSE. It is never written to D1
//    or KV, never passed to console.*, never placed in a URL or a query
//    string, and no hash or other derivative of it is stored either. A hashed
//    email is still a derived personal identifier; storing one would buy a
//    dedupe key at the cost of the product's central privacy claim.
//
// 2. DEGRADE HONESTLY. When a key is missing the caller is told exactly that,
//    so the form can disable itself and say so. Accepting an address we cannot
//    deliver, or reporting a success that did not happen, is the one failure
//    mode this layer must not have.

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const BEEHIIV_API_ROOT = 'https://api.beehiiv.com/v2';

// `wrangler secret put` prints "Success!" even when the piped input was empty,
// so "the binding exists" proves nothing. Every secret is gated on a minimum
// length, and its expected SHAPE is reported beside it so that a paste error is
// visible in /api/health rather than discovered by the first visitor. The shape
// is reported, never gated on: if Cloudflare or beehiiv ever changes a key
// format, a shape gate would silently take the forms offline while a correct
// key sat in place.
const SECRETS = {
  BEEHIIV_API_KEY: { min: 20, shape: /^[A-Za-z0-9._-]{20,}$/, expect: 'a long opaque token' },
  BEEHIIV_PUBLICATION_ID: { min: 8, shape: /^pub_[A-Za-z0-9-]{8,}$/, expect: 'starts with pub_' },
  TURNSTILE_SECRET: { min: 20, shape: /^\dx[A-Za-z0-9_-]{18,}$/, expect: 'starts with 0x' },
  TURNSTILE_SITE_KEY: { min: 12, shape: /^\dx[A-Za-z0-9]{10,}$/, expect: 'starts with 0x' },
  PADDLE_API_KEY: { min: 20, shape: /^[A-Za-z0-9._-]{20,}$/, expect: 'a long opaque token' },
  PADDLE_WEBHOOK_SECRET: { min: 20, shape: /^[A-Za-z0-9._-]{20,}$/, expect: 'a long opaque token' },
  // Signs the short lived download links. Rotating it invalidates every link in
  // flight and nothing else, which is why nothing else is signed with it and why
  // the entitlement hash deliberately does not use a key at all.
  R2_SIGNING_KEY: {
    min: 32,
    shape: /^[0-9a-f]{64}$/,
    expect: '64 hex characters, from openssl rand -hex 32',
  },
};

export function readSecret(env, name) {
  const raw = env?.[name];
  const value = typeof raw === 'string' ? raw.trim() : '';
  const spec = SECRETS[name];
  const set = value.length >= spec.min;
  return { value, set, shape_expected: set ? spec.shape.test(value) : false, expect: spec.expect };
}

// One place that answers "what is actually wired". /api/health reports the
// detail for the founder; /api/config reports only the booleans the page needs.
export function integrationStatus(env) {
  const detail = {};
  for (const name of Object.keys(SECRETS)) {
    const s = readSecret(env, name);
    detail[name] = { set: s.set, shape_expected: s.shape_expected, expect: s.expect };
  }

  const beehiiv = detail.BEEHIIV_API_KEY.set && detail.BEEHIIV_PUBLICATION_ID.set;
  const turnstile = detail.TURNSTILE_SECRET.set && detail.TURNSTILE_SITE_KEY.set;
  const paddle = detail.PADDLE_API_KEY.set && detail.PADDLE_WEBHOOK_SECRET.set;
  // Delivery is the half of Phase 6 that needs no payment processor at all: a
  // signing key, and links. It is reported separately from `paddle` on purpose,
  // so the re-issue page can open on the day the signing key lands rather than
  // waiting on a processor decision that has nothing to do with it.
  const delivery = detail.R2_SIGNING_KEY.set;

  return {
    configured: {
      // Both halves are required before any form may accept an address: the
      // bot check without the list would collect into nothing.
      capture: beehiiv && turnstile,
      beehiiv,
      turnstile,
      paddle,
      delivery,
    },
    detail,
    // Names only. A secret name is configuration state, never a credential.
    missing: Object.keys(SECRETS).filter((n) => !detail[n].set),
  };
}

// The public site key, or null. Public by design: it is rendered into the page
// so the widget can mount. Serving it from the API rather than baking it into
// the build is what lets the forms come alive on the deploy that sets the
// secret, with no code edit and no rebuild.
export function turnstileSiteKey(env) {
  const s = readSecret(env, 'TURNSTILE_SITE_KEY');
  return s.set ? s.value : null;
}

// Server-side token verification. The visitor IP is deliberately NOT sent:
// Cloudflare already terminates the connection so `remoteip` buys almost
// nothing here, and "we send the token and nothing else" is a sentence the
// privacy page can carry without a footnote.
export async function verifyTurnstile(env, token) {
  const body = new URLSearchParams();
  body.set('secret', readSecret(env, 'TURNSTILE_SECRET').value);
  body.set('response', token);

  let res;
  try {
    res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (!res.ok) return { ok: false, reason: `http_${res.status}` };

  const data = await res.json().catch(() => null);
  if (!data) return { ok: false, reason: 'unparseable' };
  if (data.success === true) return { ok: true };

  const codes = Array.isArray(data['error-codes']) ? data['error-codes'].join(',') : 'rejected';
  return { ok: false, reason: codes || 'rejected' };
}

// The only place an address leaves this Worker, and it leaves to the service
// that owns it.
//
// Idempotency: beehiiv treats a repeat subscribe of the same address as the
// same subscriber, so a double submit cannot create a second record. Turnstile
// tokens are single use, so a replayed request fails the bot check before it
// ever reaches here.
export async function beehiivSubscribe(env, { email, source, courseSlug }) {
  const key = readSecret(env, 'BEEHIIV_API_KEY').value;
  const publication = readSecret(env, 'BEEHIIV_PUBLICATION_ID').value;

  // Custom fields per BUILD_PLAN integration 04. These must already exist on
  // the publication: beehiiv rejects a subscribe that names a field it does not
  // know, and the founder creating them is a listed setup step. A rejection
  // there surfaces as a clear error and stores nothing, which is the correct
  // failure: the alternative, quietly dropping the tagging, would corrupt the
  // one signal this whole phase exists to collect.
  const custom_fields = [{ name: 'source', value: source }];
  if (courseSlug) custom_fields.push({ name: 'roadmap_courses', value: courseSlug });

  let res;
  try {
    res = await fetch(
      `${BEEHIIV_API_ROOT}/publications/${encodeURIComponent(publication)}/subscriptions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          // Someone who unsubscribed stays unsubscribed. Their decision
          // outranks our list growth.
          reactivate_existing: false,
          utm_source: 'oradiscuss.com',
          utm_medium: source,
          custom_fields,
          // send_welcome_email and double_opt_override are deliberately absent.
          // Both are publication settings the founder owns at beehiiv, and
          // hard-coding either here would mean a code change to alter a
          // marketing decision.
        }),
      },
    );
  } catch {
    return { ok: false, status: 0, code: 'unreachable' };
  }

  if (!res.ok) {
    // The body may quote the submitted address back at us, so it is read for a
    // short machine-readable code and then discarded. It is never logged and
    // never returned to the caller.
    let code = 'http_error';
    try {
      const data = await res.json();
      const first = Array.isArray(data?.errors) ? data.errors[0] : null;
      if (first && typeof first.code === 'string') code = first.code.slice(0, 64);
    } catch {
      /* a non-JSON error body tells us nothing beyond the status */
    }
    return { ok: false, status: res.status, code };
  }

  // Only the subscription STATE is read back, and only as a closed set of
  // words. The id, the address and everything else beehiiv returns is dropped
  // here rather than travelling any further into our system.
  const data = await res.json().catch(() => null);
  // beehiiv reports validating / pending / active / inactive / invalid. Only
  // "active" means the address is on the list right now; every other state
  // means the visitor still has something to do, so they collapse to pending
  // and the page tells them to check their inbox.
  const raw = typeof data?.data?.status === 'string' ? data.data.status : '';
  return { ok: true, status: raw === 'active' ? 'active' : 'pending' };
}
