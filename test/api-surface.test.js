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

function routeTableBody() {
  const src = readFileSync(SOURCE_PATH, 'utf8');
  const table = src.match(/const ROUTES = \{([\s\S]*?)\n\};/);
  assert.ok(table, 'could not find the ROUTES table in worker/api.js. If it was renamed, this guard must be repointed, not deleted.');
  return table[1];
}

// Comments inside the table are prose and must not be read as code by the two
// structural guards below.
function withoutComments(body) {
  return body.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

function routePaths(body) {
  return [...body.matchAll(/'(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+([^']+)'/g)].map((m) => m[1]);
}

// Splits an object literal body into its top level entries, ignoring commas
// that sit inside brackets or inside a string. A line based split cannot do
// this: a handler body wraps across lines and brings its own commas and colons
// with it.
function topLevelEntries(body) {
  const entries = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quote) {
      current += c;
      if (c === '\\') {
        current += body[i + 1] ?? '';
        i += 1;
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      current += c;
      continue;
    }
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
    if (c === ',' && depth === 0) {
      entries.push(current.trim());
      current = '';
      continue;
    }
    current += c;
  }
  if (current.trim()) entries.push(current.trim());
  return entries.filter(Boolean);
}

test('the route table declares no path under /api/_', () => {
  const paths = routePaths(routeTableBody());
  assert.ok(paths.length >= 4, `parsed only ${paths.length} routes, the matcher is broken`);

  const debug = paths.filter((p) => p.startsWith('/api/_'));
  assert.deepEqual(
    debug,
    [],
    `debug routes must never ship: ${debug.join(', ')}. Delete them before promoting, do not comment them out.`,
  );
});

// The guard above reads the table as TEXT, so it can only see routes written as
// literals. A route registered in a loop, spread in from another object, or
// keyed by an expression would be invisible to it, and the next debug endpoint
// would ship past a green suite. These two keep that door shut.
test('every route is a LITERAL entry, never a computed or spread one', () => {
  const body = withoutComments(routeTableBody());

  const computed = /\[[^\]]*\]\s*:/.exec(body);
  assert.equal(
    computed,
    null,
    `a computed key hides a route from the guard above: ${computed?.[0]}. Write the path out.`,
  );

  const spread = /\.\.\./.exec(body);
  assert.equal(spread, null, 'a spread hides routes from the guard above. Write each path out.');

  // Every top level entry must OPEN with a quoted method and /api/ path.
  // Splitting on depth zero commas rather than on lines, because a handler body
  // wraps across lines and carries its own colons and commas.
  const entries = topLevelEntries(body);
  assert.ok(entries.length >= 10, `only ${entries.length} route entries parsed, the matcher is broken`);
  for (const entry of entries) {
    assert.match(
      entry,
      /^'(GET|POST|PUT|PATCH|DELETE|HEAD) \/api\/[^']*'\s*:/,
      `this route entry does not begin with a quoted method and /api/ path: ${entry.slice(0, 80)}`,
    );
  }
});

test('no method and path pair is registered twice, because the second would win silently', () => {
  // Keyed on the PAIR, not the path: /api/download is deliberately registered
  // for both GET and POST, one to mint a link and one to serve the file.
  const keys = [
    ...withoutComments(routeTableBody()).matchAll(/'((?:GET|POST|PUT|PATCH|DELETE|HEAD) [^']+)'/g),
  ].map((m) => m[1]);
  assert.ok(keys.length >= 10, `only ${keys.length} route keys parsed, the matcher is broken`);

  const seen = new Set();
  const duplicates = [];
  for (const key of keys) {
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }
  assert.deepEqual(duplicates, [], `duplicate route keys: ${duplicates.join(', ')}`);
});
