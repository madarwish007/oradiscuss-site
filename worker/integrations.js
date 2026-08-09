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
  // The Security Watch publish gate. Publishing a brief is a founder action
  // (RUNBOOK, THE STANDING GATES), so the endpoint that flips a draft live is
  // useless without this and REFUSES without it: an absent token means no
  // publish is possible, never that no token is required.
  WATCH_ADMIN_TOKEN: {
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
  const releaseSegment = releaseSegmentId(env) !== null;
  const turnstile = detail.TURNSTILE_SECRET.set && detail.TURNSTILE_SITE_KEY.set;
  const paddle = detail.PADDLE_API_KEY.set && detail.PADDLE_WEBHOOK_SECRET.set;
  // Delivery is the half of Phase 6 that needs no payment processor at all: a
  // signing key, and links. It is reported separately from `paddle` on purpose,
  // so the re-issue page can open on the day the signing key lands rather than
  // waiting on a processor decision that has nothing to do with it.
  const delivery = detail.R2_SIGNING_KEY.set;
  // Two separate answers on purpose. The founder can publish a brief to the
  // website the day the token exists; sending it to the list additionally needs
  // beehiiv AND a named segment, and waiting for the second would keep the
  // archive shut for a reason that has nothing to do with it.
  const watch_publish = detail.WATCH_ADMIN_TOKEN.set;
  const watch_send = beehiiv && memberSegmentId(env) !== null;
  // Reported SEPARATELY from watch_send, and it is not the same audience. The
  // brief goes to members; a release notification says "the kit you have was
  // updated", and who should hear that is a founder decision rather than an
  // inference this code may make. Two segments, two booleans, and a release
  // still records itself with neither of them set.
  const release_send = beehiiv && releaseSegment;

  return {
    configured: {
      // Both halves are required before any form may accept an address: the
      // bot check without the list would collect into nothing.
      capture: beehiiv && turnstile,
      beehiiv,
      turnstile,
      paddle,
      delivery,
      watch_publish,
      watch_send,
      release_send,
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

/* ------------------------------------------------- the member send (Watch) */

// The beehiiv segment the weekly brief goes to. A plain configuration value
// rather than a secret, and REQUIRED rather than defaulted, which is the point:
// with no segment named, beehiiv's own default audience is everybody, and the
// free kit list is not the member list. Sending a members-only brief to every
// address we ever collected is a mistake that cannot be taken back, so the
// absence of this value stops the send instead of widening it.
export function memberSegmentId(env) {
  const raw = typeof env?.BEEHIIV_MEMBERS_SEGMENT_ID === 'string' ? env.BEEHIIV_MEMBERS_SEGMENT_ID.trim() : '';
  return raw.length >= 4 ? raw : null;
}

// The beehiiv segment a PACK RELEASE notification goes to, and it is a second
// value rather than a reuse of the one above. Founder ruling 9 Aug 2026 asked
// for "an acknowledgement about the updated kits only", which is a different
// sentence to the members-only weekly brief and quite possibly a different
// audience: somebody holding the free kit has a kit that was updated, and is
// not a member. Which list hears about a release is a decision with no undo,
// so this code refuses to infer it from the other segment.
//
// REQUIRED rather than defaulted, exactly like memberSegmentId and for the same
// reason: with no segment named, beehiiv's own default audience is everybody.
// The absence of this value stops the send instead of widening it.
export function releaseSegmentId(env) {
  const raw = typeof env?.BEEHIIV_RELEASE_SEGMENT_ID === 'string' ? env.BEEHIIV_RELEASE_SEGMENT_ID.trim() : '';
  return raw.length >= 4 ? raw : null;
}

// THE ONLY FUNCTION IN THIS REPOSITORY THAT CAN MAIL THE LIST, and it is called
// from exactly one place: the founder's authenticated publish action in
// worker/watch-publish.js. Nothing scheduled calls it, and a test sweeps the
// source tree to keep that true.
//
// UNVERIFIED AGAINST A LIVE ACCOUNT, and this comment is the honest record of
// that. No beehiiv publication exists yet (BUILD_PLAN integration 04 status:
// "account/publication NOT yet created"), so the field names below come from
// beehiiv's published v2 schema for POST /publications/{id}/posts, read on
// 8 Aug 2026, and have never been exercised against the API. The first real
// send is a verification step, not a formality.
//
// It fails CLOSED in every direction: no key, no publication, no segment, a
// non 2xx answer or an unreachable host all return `sent: false` with a reason
// word. The brief stays published either way, because the website is the
// product and the email is the notification.
export async function beehiivSendBrief(env, { title, subject, body_html }) {
  const key = readSecret(env, 'BEEHIIV_API_KEY');
  const publication = readSecret(env, 'BEEHIIV_PUBLICATION_ID');
  if (!key.set || !publication.set) {
    return { sent: false, status: 'not_configured', detail: 'BEEHIIV_API_KEY or BEEHIIV_PUBLICATION_ID is not set' };
  }

  const segment = memberSegmentId(env);
  if (!segment) {
    return { sent: false, status: 'no_segment', detail: 'BEEHIIV_MEMBERS_SEGMENT_ID is not set' };
  }

  return postToSegment(key.value, publication.value, segment, { title, subject, body_html });
}

// THE SECOND THING IN THIS REPOSITORY THAT CAN MAIL A LIST, and like the first
// it is called from exactly one place: worker/release.js, behind the founder's
// token. test/release.test.js sweeps the source tree to keep that true, the way
// test/watch.test.js does for the brief.
//
// UNVERIFIED AGAINST A LIVE ACCOUNT, and this comment is the honest record of
// that, the same as for the brief above. No beehiiv publication exists yet, and
// no release notification has ever been sent by this code or any other.
//
// It fails CLOSED in every direction: no key, no publication, no segment, a non
// 2xx answer or an unreachable host all return `sent: false` with a reason
// word. The RELEASE IS STILL RECORDED either way, because the pack in R2 and
// the row in D1 are what a customer downloads from, and the email is a
// notification about them.
export async function beehiivSendRelease(env, { title, subject, body_html }) {
  const ready = releaseSendReadiness(env);
  if (!ready.ready) return { sent: false, status: ready.status, detail: ready.detail };
  return postToSegment(ready.key, ready.publication, ready.segment, { title, subject, body_html });
}

// CAN a release notification be sent, asked WITHOUT sending one.
//
// This exists because worker/release.js must answer that question BEFORE it
// takes the notification claim on a release row: a claim burned by a send that
// was never possible would leave a released pack permanently unannounceable.
// The first version of that code asked by calling beehiivSendRelease with an
// empty body, which on a configured Worker would have posted an empty release
// note to real subscribers. Reading the configuration is the question; calling
// the sender is the action.
//
// The two share this function rather than each testing the same three values,
// so the answer the pre-flight gives is by construction the answer the send
// would have given.
export function releaseSendReadiness(env) {
  const key = readSecret(env, 'BEEHIIV_API_KEY');
  const publication = readSecret(env, 'BEEHIIV_PUBLICATION_ID');
  if (!key.set || !publication.set) {
    return {
      ready: false,
      status: 'not_configured',
      detail: 'BEEHIIV_API_KEY or BEEHIIV_PUBLICATION_ID is not set',
    };
  }

  const segment = releaseSegmentId(env);
  if (!segment) {
    return { ready: false, status: 'no_segment', detail: 'BEEHIIV_RELEASE_SEGMENT_ID is not set' };
  }

  return { ready: true, status: 'ready', detail: null, key: key.value, publication: publication.value, segment };
}

// The one HTTP call both sends make, shared so that a change to beehiiv's post
// schema is a change in one place. Every caller has already resolved its own
// key, publication and SEGMENT before reaching here: this function cannot pick
// an audience, which is the property worth keeping. A helper that defaulted a
// missing segment to the publication's whole list is the exact accident the two
// callers above are written to make impossible.
async function postToSegment(key, publication, segment, { title, subject, body_html }) {
  let res;
  try {
    res = await fetch(`${BEEHIIV_API_ROOT}/publications/${encodeURIComponent(publication)}/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        body_content: body_html,
        status: 'confirmed',
        recipients: { email: { include_segment_ids: [segment] } },
        email_settings: { email_subject_line: subject },
      }),
    });
  } catch {
    return { sent: false, status: 'unreachable', detail: null };
  }

  if (!res.ok) {
    let code = 'http_error';
    try {
      const data = await res.json();
      const first = Array.isArray(data?.errors) ? data.errors[0] : null;
      if (first && typeof first.code === 'string') code = first.code.slice(0, 64);
    } catch {
      /* a non-JSON error body tells us nothing beyond the status */
    }
    return { sent: false, status: 'failed', detail: `${res.status}:${code}` };
  }

  return { sent: true, status: 'sent', detail: null };
}
