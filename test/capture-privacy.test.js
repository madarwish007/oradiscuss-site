// GUARD: the capture layer must never persist or log a person.
//
// This is the test that stands behind the product's central claim. It drives
// the real /api/subscribe and /api/roadmap/vote handlers against a mock
// environment that RECORDS every D1 statement, every bound parameter and every
// console line, then asserts that the submitted address appears in none of
// them. A grep over the source cannot do that: a grep sees the statements we
// wrote, not the values that actually reach them.
//
// It is pointed at ../worker/api.js by default. Set CAPTURE_MODULE to point it
// at a deliberately broken copy and watch it fail, which is the only way to
// know a guard is a guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const MODULE_URL = process.env.CAPTURE_MODULE
  ? pathToFileURL(process.env.CAPTURE_MODULE).href
  : new URL('../worker/api.js', import.meta.url).href;

const { handleApi } = await import(MODULE_URL);

const EMAIL = 'someone.private@example.com';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const IP = '203.0.113.77';
const REAL_SECRETS = {
  BEEHIIV_API_KEY: 'beehiiv-key-that-is-long-enough-to-pass',
  BEEHIIV_PUBLICATION_ID: 'pub_11111111-2222-3333-4444-555555555555',
  TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
};

function makeHarness({ secrets = REAL_SECRETS, turnstileOk = true, beehiivOk = true } = {}) {
  const d1 = [];
  const logs = [];
  const outbound = [];

  const stmt = (record) => {
    const s = {
      bind(...params) {
        record.params = params;
        return s;
      },
      async first() {
        record.method = 'first';
        if (record.sql.includes('roadmap_interest')) {
          return record.params[0] === 'automated-dba' ? { course_slug: 'automated-dba' } : null;
        }
        return { n: 3 };
      },
      async run() {
        record.method = 'run';
        return { success: true, meta: { changes: 1 } };
      },
      async all() {
        record.method = 'all';
        return { results: [] };
      },
    };
    return s;
  };

  const env = {
    ...secrets,
    ENVIRONMENT: 'test',
    DB: {
      prepare(sql) {
        const record = { sql, params: [] };
        d1.push(record);
        return stmt(record);
      },
    },
    ENTITLEMENT: { async get() { return null; } },
    PACKS: { async head() { return null; } },
    API_RATE_LIMIT: { async limit() { return { success: true }; } },
  };

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    outbound.push({ href, body: init?.body ? String(init.body) : '' });
    if (href.includes('turnstile/v0/siteverify')) {
      return new Response(JSON.stringify({ success: turnstileOk, 'error-codes': turnstileOk ? [] : ['invalid-input-response'] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (href.includes('api.beehiiv.com')) {
      if (!beehiivOk) {
        return new Response(
          JSON.stringify({ status: 401, errors: [{ code: 'unauthorized', message: `no access for ${EMAIL}` }] }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ data: { id: 'sub_123', email: EMAIL, status: 'pending' } }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`unexpected outbound call: ${href}`);
  };

  const realConsole = { error: console.error, warn: console.warn, log: console.log, info: console.info };
  for (const level of Object.keys(realConsole)) {
    console[level] = (...args) => logs.push({ level, args });
  }

  return {
    env,
    d1,
    logs,
    outbound,
    restore() {
      globalThis.fetch = realFetch;
      Object.assign(console, realConsole);
    },
  };
}

function post(path, body) {
  return new Request(`https://oradiscuss.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': IP },
    body: JSON.stringify(body),
  });
}

// Everything that has ever been handed to D1 or to a log, as one flat string.
function everythingWritten(h) {
  const d1Text = h.d1.map((r) => `${r.sql} ${JSON.stringify(r.params)}`).join('\n');
  const logText = h.logs.map((l) => `${l.level} ${l.args.map(String).join(' ')}`).join('\n');
  return `${d1Text}\n${logText}`;
}

function assertNoPersonAnywhere(h, label) {
  const written = everythingWritten(h);
  for (const secret of [EMAIL, 'someone.private', 'example.com', TOKEN, IP]) {
    assert.ok(
      !written.includes(secret),
      `${label}: "${secret}" reached D1 or a log. Written surface was:\n${written}`,
    );
  }
}

test('roadmap vote writes ONE aggregate counter and nothing else', async () => {
  const h = makeHarness();
  try {
    const res = await handleApi(
      post('/api/roadmap/vote', { email: EMAIL, course_slug: 'automated-dba', turnstile_token: TOKEN }),
      h.env,
      '/api/roadmap/vote',
    );
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);

    const writes = h.d1.filter((r) => /INSERT|UPDATE|DELETE|REPLACE/i.test(r.sql));
    assert.equal(writes.length, 1, `expected exactly one write, got ${writes.length}`);

    const write = writes[0];
    assert.match(write.sql, /^\s*UPDATE roadmap_interest\s+SET count = count \+ 1, updated_at = datetime\('now'\)\s+WHERE course_slug = \?1\s*$/);
    assert.deepEqual(write.params, ['automated-dba']);

    // The only read is the slug existence check, also bound to the slug alone.
    const reads = h.d1.filter((r) => !/INSERT|UPDATE|DELETE|REPLACE/i.test(r.sql));
    for (const r of reads) assert.deepEqual(r.params, ['automated-dba']);

    assertNoPersonAnywhere(h, 'vote success');
  } finally {
    h.restore();
  }
});

test('the address goes to beehiiv and to no other host', async () => {
  const h = makeHarness();
  try {
    await handleApi(post('/api/subscribe', { email: EMAIL, turnstile_token: TOKEN }), h.env, '/api/subscribe');

    const carrying = h.outbound.filter((o) => o.body.includes(EMAIL));
    assert.equal(carrying.length, 1, 'exactly one outbound request may carry the address');
    assert.ok(carrying[0].href.startsWith('https://api.beehiiv.com/v2/publications/'), carrying[0].href);

    // No address in a URL or a query string, on any call.
    for (const o of h.outbound) assert.ok(!o.href.includes('@'), `address in a URL: ${o.href}`);

    // Server sets `source`; the client cannot.
    const payload = JSON.parse(carrying[0].body);
    assert.equal(payload.custom_fields[0].name, 'source');
    assert.equal(payload.custom_fields[0].value, 'kit');
    assert.equal(payload.reactivate_existing, false);

    assert.equal(h.d1.length, 0, '/api/subscribe must not touch D1 at all');
    assertNoPersonAnywhere(h, 'subscribe success');
  } finally {
    h.restore();
  }
});

test('a client-supplied source is ignored', async () => {
  const h = makeHarness();
  try {
    await handleApi(
      post('/api/subscribe', { email: EMAIL, turnstile_token: TOKEN, source: 'member' }),
      h.env,
      '/api/subscribe',
    );
    const payload = JSON.parse(h.outbound.find((o) => o.href.includes('beehiiv')).body);
    assert.equal(payload.custom_fields[0].value, 'kit');
  } finally {
    h.restore();
  }
});

test('a beehiiv failure moves no counter and leaks no internals', async () => {
  const h = makeHarness({ beehiivOk: false });
  try {
    const res = await handleApi(
      post('/api/roadmap/vote', { email: EMAIL, course_slug: 'automated-dba', turnstile_token: TOKEN }),
      h.env,
      '/api/roadmap/vote',
    );
    const body = await res.json();
    assert.equal(res.status, 502);
    assert.equal(body.code, 'list_unavailable');
    assert.ok(!/unauthorized|beehiiv|401/i.test(body.error), `internal detail leaked: ${body.error}`);

    const writes = h.d1.filter((r) => /UPDATE|INSERT/i.test(r.sql));
    assert.equal(writes.length, 0, 'a failed registration must not increment the counter');

    assertNoPersonAnywhere(h, 'beehiiv failure');
  } finally {
    h.restore();
  }
});

test('no token is 403 before any secret is even consulted', async () => {
  const h = makeHarness({ secrets: {} });
  try {
    for (const path of ['/api/subscribe', '/api/roadmap/vote']) {
      const res = await handleApi(post(path, { email: EMAIL, course_slug: 'automated-dba' }), h.env, path);
      const body = await res.json();
      assert.equal(res.status, 403, path);
      assert.equal(body.code, 'no_token', path);
    }
    assert.equal(h.outbound.length, 0, 'nothing may leave the Worker without a token');
    assert.equal(h.d1.length, 0);
    assertNoPersonAnywhere(h, 'no token');
  } finally {
    h.restore();
  }
});

test('missing secrets degrade to 503 and name what is missing', async () => {
  const h = makeHarness({ secrets: {} });
  try {
    const res = await handleApi(post('/api/subscribe', { email: EMAIL, turnstile_token: TOKEN }), h.env, '/api/subscribe');
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.code, 'not_configured');
    assert.ok(body.missing_secrets.includes('BEEHIIV_API_KEY'));
    assert.ok(body.missing_secrets.includes('TURNSTILE_SECRET'));
    assert.ok(/not open yet/i.test(body.error), body.error);
    assert.equal(h.outbound.length, 0, 'an unconfigured Worker must call nothing');
    assertNoPersonAnywhere(h, 'not configured');
  } finally {
    h.restore();
  }
});

test('a failed bot check stops everything', async () => {
  const h = makeHarness({ turnstileOk: false });
  try {
    const res = await handleApi(post('/api/subscribe', { email: EMAIL, turnstile_token: 'bad' }), h.env, '/api/subscribe');
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.code, 'turnstile_failed');
    assert.equal(h.outbound.filter((o) => o.href.includes('beehiiv')).length, 0);
    assertNoPersonAnywhere(h, 'turnstile failure');
  } finally {
    h.restore();
  }
});

test('an unknown course is refused before the address moves', async () => {
  const h = makeHarness();
  try {
    const res = await handleApi(
      post('/api/roadmap/vote', { email: EMAIL, course_slug: 'not-a-course', turnstile_token: TOKEN }),
      h.env,
      '/api/roadmap/vote',
    );
    assert.equal(res.status, 400);
    assert.equal(h.outbound.filter((o) => o.href.includes('beehiiv')).length, 0);
    assert.equal(h.d1.filter((r) => /UPDATE/i.test(r.sql)).length, 0);
  } finally {
    h.restore();
  }
});

test('a bad address never reaches the network', async () => {
  const h = makeHarness();
  try {
    for (const bad of ['nope', 'a@b', 'a b@c.com', '', 'x'.repeat(300) + '@e.com']) {
      const res = await handleApi(post('/api/subscribe', { email: bad, turnstile_token: TOKEN }), h.env, '/api/subscribe');
      assert.equal(res.status, 400, `accepted ${JSON.stringify(bad.slice(0, 24))}`);
    }
    assert.equal(h.outbound.length, 0);
  } finally {
    h.restore();
  }
});

test('the rate limiter refuses before the handler runs', async () => {
  const h = makeHarness();
  h.env.API_RATE_LIMIT = { async limit() { return { success: false }; } };
  try {
    const res = await handleApi(post('/api/subscribe', { email: EMAIL, turnstile_token: TOKEN }), h.env, '/api/subscribe');
    assert.equal(res.status, 429);
    assert.equal(h.outbound.length, 0);
    assert.equal(h.d1.length, 0);
  } finally {
    h.restore();
  }
});

test('the public roadmap endpoint does not select the count', async () => {
  const h = makeHarness();
  try {
    await handleApi(new Request('https://oradiscuss.com/api/roadmap'), h.env, '/api/roadmap');
    const sql = h.d1.map((r) => r.sql).join(' ');
    assert.ok(/SELECT course_slug, title, summary, status/.test(sql), sql);
    assert.ok(!/\bcount\b/.test(sql), `count is published: ${sql}`);
  } finally {
    h.restore();
  }
});

test('health reports what is wired without failing on what is not', async () => {
  const h = makeHarness({ secrets: {} });
  try {
    const res = await handleApi(new Request('https://oradiscuss.com/api/health'), h.env, '/api/health');
    const body = await res.json();
    assert.equal(res.status, 200, 'missing integrations must not report the site as down');
    assert.equal(body.ok, true);
    assert.equal(body.configured.capture, false);
    assert.equal(body.configured.beehiiv, false);
    assert.equal(body.configured.turnstile, false);
    assert.ok(body.missing_secrets.includes('BEEHIIV_PUBLICATION_ID'));
  } finally {
    h.restore();
  }
});

test('an empty secret does not count as a set secret', async () => {
  // `wrangler secret put` prints "Success!" for an empty pipe, so this is the
  // realistic paste failure, not a hypothetical one.
  const h = makeHarness({ secrets: { ...REAL_SECRETS, BEEHIIV_API_KEY: '   ' } });
  try {
    const res = await handleApi(new Request('https://oradiscuss.com/api/config'), h.env, '/api/config');
    const body = await res.json();
    assert.equal(body.capture_enabled, false);
    assert.equal(body.turnstile_site_key, null, 'no site key while the list is dark');
    assert.ok(body.missing_secrets.includes('BEEHIIV_API_KEY'));
  } finally {
    h.restore();
  }
});
