// GUARD: no debug endpoint may reach production.
//
// BUILD_PLAN section 8 item 0 says /api/_limiter-selftest must never exist in
// production. It was unauthenticated and burned 100 rate-limiter calls per hit,
// so anyone who found it had a free amplifier pointed at our own budget.
//
// Two assertions, on purpose, because they fail for different reasons:
//
//   1. BEHAVIOURAL. Drive the real handleApi and prove the path 404s. This is
//      the one that cannot be fooled by a route that is defined somewhere else.
//   2. STRUCTURAL. Read the ROUTES table and prove NO path under /api/_ is
//      routed. The first assertion only knows the name of the endpoint we
//      already removed; this one catches the NEXT debug endpoint somebody adds
//      while working, which is how this one got here. A check that enumerates
//      its inputs by name silently misses every input added after it was
//      written, and this repo has already been bitten by that twice in
//      orchestrate.sh.
//
// SELF-TEST: set API_SURFACE_MODULE and API_SURFACE_SOURCE at a copy of
// worker/api.js with the route put back, and watch both fail. A guard nobody
// has seen fire is not a guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SOURCE_PATH =
  process.env.API_SURFACE_SOURCE ?? new URL('../worker/api.js', import.meta.url).pathname;

const MODULE_URL = process.env.API_SURFACE_MODULE
  ? pathToFileURL(process.env.API_SURFACE_MODULE).href
  : new URL('../worker/api.js', import.meta.url).href;

const { handleApi } = await import(MODULE_URL);

// Paths a debug endpoint has historically used, plus the underscore convention
// this repo adopted for them.
const KNOWN_DEBUG_PATHS = [
  '/api/_limiter-selftest',
  '/api/_debug',
  '/api/_selftest',
];

test('no debug endpoint answers, they all 404', async () => {
  for (const path of KNOWN_DEBUG_PATHS) {
    const res = await handleApi(new Request(`https://oradiscuss.com${path}`), {}, path);
    assert.equal(res.status, 404, `${path} answered ${res.status}, it must be 404`);
  }
});

test('the route table declares no path under /api/_', () => {
  const src = readFileSync(SOURCE_PATH, 'utf8');

  const table = src.match(/const ROUTES = \{([\s\S]*?)\n\};/);
  assert.ok(table, 'could not find the ROUTES table in worker/api.js. If it was renamed, this guard must be repointed, not deleted.');

  const paths = [...table[1].matchAll(/'(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+([^']+)'/g)].map(
    (m) => m[1],
  );
  assert.ok(paths.length >= 4, `parsed only ${paths.length} routes, the matcher is broken`);

  const debug = paths.filter((p) => p.startsWith('/api/_'));
  assert.deepEqual(
    debug,
    [],
    `debug routes must never ship: ${debug.join(', ')}. Delete them before promoting, do not comment them out.`,
  );
});
