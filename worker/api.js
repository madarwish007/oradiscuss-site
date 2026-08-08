// The OraDiscuss system layer: /api/*
//
// Phase 1 shipped the read-only endpoints. Phase 3 adds the capture layer:
// /api/subscribe and /api/roadmap/vote, each gated by Turnstile and each
// sending the address to beehiiv and to nothing else.
//
// DATA LAW, and it is the product's central claim, not a preference: no
// endpoint in this file may store anything that identifies a person. Emails
// live at beehiiv. Payment identity lives at Paddle. The single write this
// phase makes to D1 binds one value, a course slug, and it is an aggregate
// counter. There is no table here that could hold a customer.

import { json, problem, fail, clientKey, readJsonBody } from './http.js';
import {
  integrationStatus,
  turnstileSiteKey,
  verifyTurnstile,
  beehiivSubscribe,
} from './integrations.js';
import { postDownload, getDownload, postReissue, postDelete } from './delivery.js';
import { handleWebhook } from './webhook.js';
import { changelogJson } from './changelog.js';

/* ------------------------------------------------------------------ read */

async function health(env) {
  // A health check that only says "the Worker booted" is theatre. Probe every
  // binding the system actually depends on, and report each one.
  const checks = {};

  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM catalog').first();
    checks.d1 = { ok: true, catalog_rows: row?.n ?? 0 };
  } catch (err) {
    checks.d1 = { ok: false, error: String(err?.message ?? err) };
  }

  try {
    await env.ENTITLEMENT.get('__healthcheck__');
    checks.kv = { ok: true };
  } catch (err) {
    checks.kv = { ok: false, error: String(err?.message ?? err) };
  }

  try {
    await env.PACKS.head('__healthcheck__');
    checks.r2 = { ok: true };
  } catch (err) {
    checks.r2 = { ok: false, error: String(err?.message ?? err) };
  }

  // The rate limiter is a security control, so its presence is reported the
  // same as any other binding. A missing limiter must be visible, not silent.
  try {
    if (!env.API_RATE_LIMIT) {
      checks.ratelimit = { ok: false, error: 'binding absent' };
    } else {
      const probe = await env.API_RATE_LIMIT.limit({ key: '__healthcheck__' });
      checks.ratelimit = { ok: true, probe_success: probe?.success ?? null };
    }
  } catch (err) {
    checks.ratelimit = { ok: false, error: String(err?.message ?? err) };
  }

  // `ok` stays a statement about the BINDINGS only. An integration that has no
  // key yet is a planned state of the build, not an outage, and folding it into
  // `ok` would put the uptime monitor into permanent alarm and train the
  // founder to ignore it. What is wired is reported beside the health, never
  // inside it.
  const { configured, detail, missing } = integrationStatus(env);
  const ok = Object.values(checks).every((c) => c.ok);

  // Reported BESIDE the health rather than inside it, for the same reason the
  // integrations are: none of these is an outage before Phase 6 is deployed,
  // and folding a planned absence into `ok` trains the founder to ignore the
  // uptime alarm. All three must read true before checkout may be enabled.
  const delivery = {
    signing_key_set: configured.delivery,
    reissue_limiter_bound: Boolean(env.REISSUE_RATE_LIMIT),
    retry_queue_bound: Boolean(env.WEBHOOK_RETRY),
  };

  return json(
    {
      ok,
      environment: env.ENVIRONMENT ?? 'unknown',
      time: new Date().toISOString(),
      checks,
      configured,
      delivery,
      // `shape_expected: false` beside `set: true` means a key is present but
      // does not look like the kind of key it should be, which is what a
      // truncated paste or a swapped pair looks like from here.
      configured_detail: detail,
      missing_secrets: missing,
    },
    { status: ok ? 200 : 503 },
  );
}

// What the browser needs in order to decide whether a form may be enabled.
// Deliberately separate from /api/health: health probes D1, KV, R2 and the
// limiter on every call, and every page view firing four binding probes would
// both cost money and pollute the uptime signal this endpoint is measured by.
function config(env) {
  const { configured, missing } = integrationStatus(env);
  return json(
    {
      capture_enabled: configured.capture,
      // Public by design, and served rather than baked into the build so the
      // forms come alive on the deploy that sets the secret. Gated on the WHOLE
      // capture layer rather than on Turnstile alone: handing out a site key
      // while the list is dark invites a future consumer to mount a live widget
      // on a form that cannot deliver anything.
      turnstile_site_key: configured.capture ? turnstileSiteKey(env) : null,
      // The re-issue form asks this the way the capture form asks about the
      // list: a form that could only ever answer 503 must ship shut and say so.
      // Deliberately separate from `capture_enabled`, because delivery needs no
      // bot check and no newsletter, and waiting on either would keep a working
      // download counter closed for no reason.
      delivery_enabled: configured.delivery,
      // Names only, so the page can say precisely what is not connected yet.
      missing_secrets: missing,
    },
    { cache: 'public, max-age=60' },
  );
}

async function catalog(env) {
  const { results } = await env.DB.prepare(
    `SELECT sku, tier, name, blurb, launch_price, regular_price, currency,
            billing_period, sort_order
       FROM catalog
      WHERE active = 1
      ORDER BY sort_order`,
  ).all();

  // Money crosses the wire as minor units plus a preformatted display string,
  // so no consumer ever has to divide by 100 and guess at rounding.
  const items = results.map((r) => ({
    ...r,
    launch_display: formatMoney(r.launch_price, r.currency),
    regular_display: formatMoney(r.regular_price, r.currency),
  }));

  return json({ items }, { cache: 'public, max-age=300' });
}

async function roadmap(env) {
  // `count` is deliberately NOT selected. Spec section 2.2 holds registration
  // counts back until they persuade rather than discourage, and an endpoint
  // that publishes three zeros at a public URL has already broken that
  // whatever the page chooses to render. The founder reads the counts straight
  // from D1; see the Phase 3 note in BUILD_PLAN section 5.
  const { results } = await env.DB.prepare(
    `SELECT course_slug, title, summary, status
       FROM roadmap_interest
      ORDER BY title`,
  ).all();
  return json({ courses: results }, { cache: 'public, max-age=60' });
}

function formatMoney(minor, currency) {
  if (minor === 0) return 'Free';
  const major = minor / 100;
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  return `${symbol}${Number.isInteger(major) ? major : major.toFixed(2)}`;
}

/* ----------------------------------------------------------------- write */

// Deliberately strict rather than clever. It requires a dot-bearing domain and
// forbids the characters that turn an address into a header injection or a
// second recipient. A rare valid address refused here is a support email; an
// invalid one accepted is a bounce inside beehiiv's sending reputation.
const EMAIL_RE =
  /^[^\s@,;:<>()[\]\\"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normaliseEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  if (email.length < 6 || email.length > 254) return null;
  return EMAIL_RE.test(email) ? email : null;
}

function normaliseSlug(value) {
  if (typeof value !== 'string') return null;
  const slug = value.trim().toLowerCase();
  if (slug.length < 2 || slug.length > 64) return null;
  return SLUG_RE.test(slug) ? slug : null;
}

function notConfiguredMessage(missing) {
  const list = missing.filter((n) => n.startsWith('BEEHIIV') || n.startsWith('TURNSTILE'));
  const what = list.length
    ? `${list.join(', ')} ${list.length === 1 ? 'is' : 'are'} not set on this Worker`
    : 'the capture layer is not connected';
  return `Sign-ups are not open yet: ${what}. Nothing was stored, and nothing was sent.`;
}

// One handler serves both capture endpoints, because they differ only in the
// value of `source` and whether a course comes with the address. `source` is
// set HERE and never read from the request: a client-supplied source would let
// anyone mislabel the list segmentation this whole phase exists to build.
async function capture(request, env, { source, wantsCourse }) {
  const parsed = await readJsonBody(request);
  if (parsed.error) return fail(400, 'bad_request', parsed.error);
  const body = parsed.value;

  const email = normaliseEmail(body.email);
  if (!email) {
    return fail(400, 'bad_email', 'That does not look like an email address.');
  }

  let course = null;
  if (wantsCourse) {
    course = normaliseSlug(body.course_slug);
    if (!course) return fail(400, 'bad_course', 'Choose one of the listed courses first.');
  }

  // A request with no token is malformed however the Worker is configured, so
  // it is refused before anything else is considered. BUILD_PLAN integration 06
  // states the contract: a POST without a valid token is rejected with 403.
  const token = typeof body.turnstile_token === 'string' ? body.turnstile_token.trim() : '';
  if (!token) {
    return fail(403, 'no_token', 'The bot check did not complete. Reload the page and try again.');
  }

  // Only now does server state matter. A missing key is OUR problem, so it
  // answers 503 and says which one, rather than blaming the request.
  const { configured, missing } = integrationStatus(env);
  if (!configured.capture) {
    return fail(503, 'not_configured', notConfiguredMessage(missing), { missing_secrets: missing });
  }

  const check = await verifyTurnstile(env, token);
  if (!check.ok) {
    // The reason is recorded for us and generalised for them: telling a bot
    // exactly which check it failed is free tuning advice.
    console.warn('turnstile_rejected', source, check.reason);
    return fail(403, 'turnstile_failed', 'The bot check did not pass. Reload the page and try again.');
  }

  // The slug is checked against the real course list before the address goes
  // anywhere, so a made-up slug can never be written into a beehiiv custom
  // field. This SELECT binds the slug and nothing else.
  if (course) {
    const known = await env.DB.prepare(
      'SELECT course_slug FROM roadmap_interest WHERE course_slug = ?1',
    )
      .bind(course)
      .first();
    if (!known) return fail(400, 'bad_course', 'Choose one of the listed courses first.');
  }

  // beehiiv FIRST. If it refuses, nothing has happened anywhere, and the
  // counter below must not move: an interest count inflated by failed
  // registrations is worse than no count, because it would route build order.
  const sub = await beehiivSubscribe(env, { email, source, courseSlug: course });
  if (!sub.ok) {
    // No address, no token, no IP on this line. Observability is a datastore
    // like any other, and an address in a log breaks the same claim as an
    // address in a table.
    console.error('beehiiv_subscribe_failed', source, sub.status, sub.code);
    return fail(
      502,
      'list_unavailable',
      'The list did not accept that just now. Nothing was stored. Please try again in a few minutes.',
    );
  }

  if (course) await bumpCourseInterest(env, course);

  return json({ ok: true, status: sub.status });
}

// The ONLY write this phase makes to D1, and it binds one value: the course
// slug. No address, no name, no IP, and no hash of any of them, because a hash
// of an email is still a derived personal identifier. That means there is
// deliberately no dedupe key here and the counter is an INTEREST SIGNAL rather
// than a count of unique people. Replay is bounded by Turnstile, whose tokens
// are single use. Do not "fix" this by hashing the address.
async function bumpCourseInterest(env, slug) {
  try {
    await env.DB.prepare(
      `UPDATE roadmap_interest
          SET count = count + 1, updated_at = datetime('now')
        WHERE course_slug = ?1`,
    )
      .bind(slug)
      .run();
  } catch (err) {
    // The registration already succeeded at beehiiv, which is the part the
    // visitor asked for. A lost increment is an internal signal problem and
    // must never surface to them as a failure.
    console.error('roadmap_counter_failed', slug, String(err?.message ?? err));
  }
}

/* --------------------------------------------------------------- routing */

const ROUTES = {
  'GET /api/health': (request, env) => health(env),
  'GET /api/config': (request, env) => config(env),
  'GET /api/catalog': (request, env) => catalog(env),
  'GET /api/roadmap': (request, env) => roadmap(env),
  'GET /api/changelog': (request, env) => changelogJson(env),
  'POST /api/subscribe': (request, env) => capture(request, env, { source: 'kit', wantsCourse: false }),
  'POST /api/roadmap/vote': (request, env) =>
    capture(request, env, { source: 'roadmap', wantsCourse: true }),

  /* Phase 6 delivery. Every path is written out as a literal string, and one
     more thing depends on that than is obvious: test/api-surface.test.js reads
     this table as TEXT to prove no debug path ships. Routes registered in a
     loop would be invisible to it, so the guard also asserts that the number of
     literal paths equals the number of entries. Registering a route any other
     way now fails the build, which is the point. */
  'POST /api/download': (request, env) => postDownload(request, env),
  'GET /api/download': (request, env) => getDownload(request, env),
  'POST /api/reissue': (request, env) => postReissue(request, env),
  'POST /api/entitlement/delete': (request, env) => postDelete(request, env),

  /* One line per Merchant of Record. The verification core and everything after
     it is shared; only worker/adapters/<name>.js differs. */
  'POST /api/paddle/webhook': (request, env) => handleWebhook(request, env, 'paddle'),
};

/* The limiter self-test route lived here until Stage A cutover prep. It proved
   the limiter DENIES rather than merely being bound, which was worth having
   once. It is gone because BUILD_PLAN section 8 item 0 says it must never
   reach production: it is unauthenticated and burns 100 rate-limiter calls per
   hit, so it is a free amplifier for anyone who finds it. test/api-surface.test.js
   now fails the build if that path, or any other /api/_ debug path, comes back. */

export async function handleApi(request, env, pathname) {
  // Rate limit every API route before any work happens. This binding counts per
  // isolate, so it is a cheap backstop and not HTTP abuse protection; the
  // zone-level WAF rule (BUILD_PLAN integration 05b) is the real control and it
  // is a founder dashboard action.
  if (env.API_RATE_LIMIT) {
    const { success } = await env.API_RATE_LIMIT.limit({ key: clientKey(request) });
    if (!success) return problem(429, 'Too many requests. Slow down and try again shortly.');
  }

  // HEAD is allowed because uptime monitors default to it; a health endpoint
  // that 405s a HEAD probe reports itself down for the wrong reason.
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  const handler = ROUTES[`${method} ${pathname}`];
  if (handler) return handler(request, env);

  // A known path reached by the wrong verb is a 405 that names the right one,
  // not a 404 that sends the caller looking for a typo.
  const allowed = ['GET', 'POST']
    .filter((m) => ROUTES[`${m} ${pathname}`])
    .flatMap((m) => (m === 'GET' ? ['GET', 'HEAD'] : [m]));
  if (allowed.length) {
    return json(
      { ok: false, error: `Method not allowed. Use ${allowed.join(' or ')}.` },
      { status: 405, headers: { Allow: allowed.join(', ') } },
    );
  }

  return problem(404, 'No such endpoint.');
}
