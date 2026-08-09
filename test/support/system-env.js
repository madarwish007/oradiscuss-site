// A synthetic Worker environment for the Phase 6 tests.
//
// The D1 shim is a REAL SQLite database with the repository's own migrations
// applied, not a hand written fake that answers whatever the test expects. That
// matters more than it sounds: the idempotency claim depends on INSERT OR
// IGNORE reporting zero changes on a conflict, and on the primary key in
// migrations/0003_delivery.sql actually existing. A mock would have happily
// agreed with a schema that was never written.
//
// Everything else here is a small shim over a Map, and each one RECORDS what it
// was asked to store, because the privacy guard is a sweep over those records
// rather than a reading of the code.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = new URL('../../migrations', import.meta.url).pathname;

// `only` restricts which migrations are applied, and it exists for one reason:
// the deployed databases are BEHIND this repository. Preview and production
// carry 0001 and 0002 today, so a test that wants to know how the Worker
// behaves against the schema that actually exists has to be able to build it.
// Every existing caller passes nothing and gets the full schema, as before.
export function makeD1({ only = null } = {}) {
  const db = new DatabaseSync(':memory:');
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => (only ? only.test(f) : true))
    .sort();
  if (files.length === 0) throw new Error('no migrations matched, the harness would build an empty database');
  for (const file of files) {
    db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }

  const log = [];

  const binding = {
    db,
    log,
    prepare(sql) {
      const record = { sql, params: [] };
      log.push(record);
      let statement;
      try {
        statement = db.prepare(sql);
      } catch (err) {
        // A syntax error must surface as a failed query rather than at prepare
        // time, because that is how D1 behaves and how the Worker's try/catch
        // paths are written.
        const boom = () => {
          throw err;
        };
        return { bind: () => ({ first: boom, run: boom, all: boom }), first: boom, run: boom, all: boom };
      }

      const api = {
        bind(...params) {
          record.params = params;
          return api;
        },
        async first() {
          return statement.get(...record.params) ?? null;
        },
        async run() {
          const result = statement.run(...record.params);
          return {
            success: true,
            meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
          };
        },
        async all() {
          return { success: true, results: statement.all(...record.params) };
        },
      };
      return api;
    },
  };

  return binding;
}

export function makeKV() {
  const store = new Map();
  const writes = [];
  const deletes = [];
  return {
    store,
    writes,
    deletes,
    entitlementWrites() {
      return writes.filter((w) => w.key.startsWith('ent:'));
    },
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
      writes.push({ key, value });
    },
    async delete(key) {
      store.delete(key);
      deletes.push(key);
    },
  };
}

export function makeR2(objects = {}) {
  return {
    objects,
    async get(key) {
      const body = objects[key];
      if (body === undefined) return null;
      return { key, body, size: body.length };
    },
    async head(key) {
      return objects[key] === undefined ? null : { key, size: objects[key].length };
    },
  };
}

export function makeQueue({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    async send(message) {
      if (fail) throw new Error('queue unavailable');
      sent.push(message);
    },
  };
}

export function makeLimiter(success = true) {
  const calls = [];
  return {
    calls,
    async limit(args) {
      calls.push(args);
      return { success };
    },
  };
}

// 64 hex characters, the shape `openssl rand -hex 32` produces. Synthetic, and
// it has never been anywhere near a real account.
export const TEST_SIGNING_KEY = 'a'.repeat(32) + 'b'.repeat(32);
export const TEST_WEBHOOK_SECRET = 'pdl_ntfset_synthetic_secret_for_tests_only_0000';

export function makeEnv(overrides = {}) {
  return {
    ENVIRONMENT: 'test',
    R2_SIGNING_KEY: TEST_SIGNING_KEY,
    PADDLE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    DB: makeD1(),
    ENTITLEMENT: makeKV(),
    PACKS: makeR2(),
    API_RATE_LIMIT: makeLimiter(true),
    REISSUE_RATE_LIMIT: makeLimiter(true),
    WEBHOOK_RETRY: makeQueue(),
    ...overrides,
  };
}

export function captureConsole() {
  const lines = [];
  const real = { error: console.error, warn: console.warn, log: console.log, info: console.info };
  for (const level of Object.keys(real)) {
    console[level] = (...args) => lines.push({ level, args });
  }
  return {
    lines,
    text() {
      return lines.map((l) => `${l.level} ${l.args.map(String).join(' ')}`).join('\n');
    },
    restore() {
      Object.assign(console, real);
    },
  };
}

// Everything the system was asked to store or say, as one flat string. The
// privacy guard sweeps this rather than reading the source, because a source
// read sees the statements we wrote and not the values that reached them.
export function everythingWritten(env, consoleCapture) {
  const d1 = env.DB.log.map((r) => `${r.sql} ${JSON.stringify(r.params)}`).join('\n');
  const kv = [...env.ENTITLEMENT.store.entries()].map(([k, v]) => `${k} ${v}`).join('\n');
  const queue = JSON.stringify(env.WEBHOOK_RETRY?.sent ?? []);
  const logs = consoleCapture ? consoleCapture.text() : '';
  return [d1, kv, queue, logs].join('\n');
}

export function jsonRequest(path, body, headers = {}) {
  return new Request(`https://oradiscuss.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9', ...headers },
    body: JSON.stringify(body),
  });
}

export async function seedRelease(env, { pack, version, r2_key, sha256, min_tier = 1, released_at }) {
  await env.DB.prepare(
    `INSERT INTO pack_release (pack, version, r2_key, sha256, min_tier, released_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(pack, version, r2_key, sha256, min_tier, released_at ?? '2026-08-01 00:00:00')
    .run();
}

export async function seedEntitlement(env, hash, record) {
  env.ENTITLEMENT.store.set(
    `ent:${hash}`,
    JSON.stringify({
      v: 1,
      tier: 1,
      status: 'active',
      expires_at: null,
      processor: 'paddle',
      granted_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
      downloads: 0,
      ...record,
    }),
  );
}
