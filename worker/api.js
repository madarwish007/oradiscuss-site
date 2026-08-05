// The OraDiscuss system layer: /api/*
//
// Everything here is read-only in Phase 1. Write endpoints (subscribe, roadmap
// vote, checkout, webhook, download) arrive in Phases 3 and 6 and each carries
// its own Turnstile or signature check.
//
// Data law: no endpoint in this file may store anything that identifies a
// person. Emails go to beehiiv; payment identity stays at Paddle.

import { json, problem, clientKey } from './http.js';

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

  const ok = Object.values(checks).every((c) => c.ok);
  return json(
    {
      ok,
      environment: env.ENVIRONMENT ?? 'unknown',
      time: new Date().toISOString(),
      checks,
    },
    { status: ok ? 200 : 503 },
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
  const { results } = await env.DB.prepare(
    `SELECT course_slug, title, summary, count, status
       FROM roadmap_interest
      ORDER BY count DESC, title`,
  ).all();
  return json({ courses: results }, { cache: 'public, max-age=60' });
}

function formatMoney(minor, currency) {
  if (minor === 0) return 'Free';
  const major = minor / 100;
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  return `${symbol}${Number.isInteger(major) ? major : major.toFixed(2)}`;
}

export async function handleApi(request, env, pathname) {
  // Rate limit every API route before any work happens.
  if (env.API_RATE_LIMIT) {
    const { success } = await env.API_RATE_LIMIT.limit({ key: clientKey(request) });
    if (!success) return problem(429, 'Too many requests. Slow down and try again shortly.');
  }

  // HEAD is allowed because uptime monitors default to it; a health endpoint
  // that 405s a HEAD probe reports itself down for the wrong reason.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return problem(405, 'Method not allowed. Phase 1 exposes read-only endpoints.');
  }

  switch (pathname) {
    case '/api/health':
      return health(env);
    case '/api/catalog':
      return catalog(env);
    case '/api/roadmap':
      return roadmap(env);
    case '/api/_limiter-selftest': {
      // Proves the limiter actually DENIES, not merely that it is bound.
      // A guard never seen to fire is not a guard. Temporary, Phase 1 only.
      const key = `selftest-${Date.now()}`;
      let allowed = 0;
      let denied = 0;
      for (let i = 0; i < 100; i++) {
        const r = await env.API_RATE_LIMIT.limit({ key });
        if (r.success) allowed++;
        else denied++;
      }
      return json({ key, allowed, denied, limit_config: '60 per 60s' });
    }
    default:
      return problem(404, 'No such endpoint.');
  }
}
