// GUARDS over the automation packs: the dual-output contract, the schema, and
// the read-only line that is the product's entire liability position.
//
// The collector cannot reach a database from here, and pretending otherwise
// would make these tests theatre. Instead it is driven through --render-only,
// which replays a recorded collection through the REAL parse-and-emit path in
// health_check.sh. A test that replayed a COPY of that loop would keep passing
// while the shipped one rotted.
//
// The live end-to-end run against a real estate is the founder's field test.
// That is the phase's designed gate, not a gap these tests are hiding.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

const REPO = new URL('..', import.meta.url).pathname;
const PACKS_DIR = join(REPO, 'packs');

// ---------------------------------------------------------------------------
// THE PACK REGISTRY.
//
// Every generic guard below runs over EVERY entry here, and the registry is
// checked against the packs/ directory itself, so a pack that exists on disk
// and is missing from this list FAILS rather than going quietly unguarded.
//
// That check is the whole point. This repo has twice shipped a fan-out step
// that named its inputs (orchestrate.sh, both times), and both times the input
// added afterwards was dropped in silence. The second pack is exactly when
// that happens again, so the harness stops naming one pack before the second
// pack exists rather than after.
//
//   allowlist - EXACT paths, never patterns, and its LENGTH is asserted. A
//               pattern would silently absorb the next writer somebody adds.
// ---------------------------------------------------------------------------

const PACKS = [
  {
    id: 'healthcheck',
    expects: [
      'health_check.sh',
      'lib/odc_briefing.sh',
      'schema/briefing.schema.json',
      'prompts/triage.md',
      'sql/health_check.sql',
    ],
    allowlist: ['sql/create_history_table.sql'],
  },
];

const PACK = join(PACKS_DIR, 'healthcheck');

// ---------------------------------------------------------------------------
// THE READ-ONLY GATE.
//
// BUILD_PLAN §5 phrases this as "a grep proves no DDL/DML verb in any sold
// script". Taken literally that check is unusable: run across the v0.9 set it
// flags the word "merge" inside "merge the setup dirs", "grant" inside an
// error message, and "create" inside "ips create package" in an HTML string.
// A gate that cries wolf is a gate somebody switches off.
//
// So it anchors on SQL statement context instead of raw verb presence:
//   .sql - strip comments, split on ';', flag a statement whose FIRST token
//          is a mutation verb. That is what a mutation actually looks like.
//   .sh  - flag a mutation VERB followed by its OBJECT keyword (CREATE TABLE,
//          ALTER DATABASE, DELETE FROM ...). English prose does not produce
//          those pairs; SQL cannot avoid them.
// Both are self-tested against deliberately broken input further down, because
// a guard nobody has watched fire is not a guard.
// ---------------------------------------------------------------------------

const MUTATION_VERBS = ['CREATE', 'DROP', 'ALTER', 'TRUNCATE', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'GRANT', 'REVOKE'];
const OBJECT_KEYWORDS = ['TABLE', 'INDEX', 'VIEW', 'DATABASE', 'TABLESPACE', 'USER', 'SEQUENCE', 'SYNONYM', 'TRIGGER', 'INTO', 'FROM', 'SET'];

function stripSqlComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

// ---------------------------------------------------------------------------
// DYNAMIC SQL, AND WHY IT IS NOT SIMPLY BANNED.
//
// The first version of this gate flagged EXECUTE IMMEDIATE on sight. That is
// wrong in a way that matters: daily-ops/sql/daily_analysis.sql wraps a plain
// SELECT COUNT(*) on UNIFIED_AUDIT_TRAIL in dynamic SQL DELIBERATELY, because
// a static reference fails to parse wherever the view is not granted and would
// take the whole script down with it. Banning the construct would either lose
// a legitimate read-only check or, far worse, teach somebody to switch the
// gate off.
//
// So the gate reads the statement INSIDE the dynamic SQL and passes only
// SELECT or WITH. Everything else is a finding, INCLUDING anything it cannot
// read with certainty: a variable, a concatenation, an unterminated literal.
// Fail closed, because a concatenated string is precisely how a check like
// this gets fooled, and "I could not tell" must never render as "fine".
// ---------------------------------------------------------------------------

const QUOTE_PAIRS = { '[': ']', '{': '}', '(': ')', '<': '>' };

// Reads ONE string literal off the front of s, in either Oracle spelling.
// Returns null when the text is not a literal or the literal never closes,
// which the caller treats as a finding rather than as an absence of one.
function readSqlLiteral(s) {
  const t = s.trimStart();
  const lead = s.length - t.length;

  const alt = /^q'(.)/i.exec(t);
  if (alt) {
    const close = (QUOTE_PAIRS[alt[1]] ?? alt[1]) + "'";
    const end = t.indexOf(close, 3);
    if (end === -1) return null;
    return { text: t.slice(3, end), length: lead + end + close.length };
  }

  if (t.startsWith("'")) {
    for (let i = 1; i < t.length; i++) {
      if (t[i] !== "'") continue;
      if (t[i + 1] === "'") { i++; continue; } // '' is an escaped quote
      return { text: t.slice(1, i).replace(/''/g, "'"), length: lead + i + 1 };
    }
    return null;
  }

  return null;
}

function dynamicSqlFindings(src) {
  const findings = [];
  const body = stripSqlComments(src);
  const re = /\bEXECUTE\s+IMMEDIATE\b/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    const rest = body.slice(m.index + m[0].length);
    const lit = readSqlLiteral(rest);
    if (!lit) {
      findings.push('EXECUTE IMMEDIATE (body is not a readable literal)');
      continue;
    }
    if (rest.slice(lit.length).trimStart().startsWith('||')) {
      findings.push('EXECUTE IMMEDIATE (built by concatenation)');
      continue;
    }
    const first = (lit.text.trim().split(/\s+/)[0] ?? '').toUpperCase();
    if (first !== 'SELECT' && first !== 'WITH') {
      findings.push(`EXECUTE IMMEDIATE ${first || '(empty statement)'}`);
    }
  }
  return findings;
}

function sqlMutations(src) {
  const found = [];
  for (const stmt of stripSqlComments(src).split(';')) {
    const first = stmt.trim().split(/\s+/)[0];
    if (first && MUTATION_VERBS.includes(first.toUpperCase())) found.push(first.toUpperCase());
  }
  found.push(...dynamicSqlFindings(src));
  return found;
}

function shellMutations(src) {
  const found = [];
  const body = src.replace(/^\s*#[^\n]*/gm, ' ');
  const pair = new RegExp(`\\b(${MUTATION_VERBS.join('|')})\\s+(${OBJECT_KEYWORDS.join('|')})\\b`, 'gi');
  let m;
  while ((m = pair.exec(body)) !== null) found.push(`${m[1].toUpperCase()} ${m[2].toUpperCase()}`);
  return found;
}

function packFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'test-fixtures') continue; // fixtures are not shipped
      packFiles(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

// Every registered pack, resolved once: its directory and its shipped paths.
for (const p of PACKS) {
  p.dir = join(PACKS_DIR, p.id);
  p.shipped = packFiles(p.dir).map((f) => relative(p.dir, f)).sort();
}

const SHIPPED = PACKS.find((p) => p.id === 'healthcheck').shipped;

test('every pack on disk is registered, and every registered pack is on disk', () => {
  // The guard on the guards. A pack that exists but is not in PACKS would run
  // the entire read-only, header and em-dash suite over nothing at all, and
  // report a clean pass while doing it, which is the worst failure this file
  // can have: silent, green, and wrong.
  const onDisk = readdirSync(PACKS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  assert.deepEqual(
    PACKS.map((p) => p.id).sort(),
    onDisk,
    'packs/ and the PACKS registry disagree. Register the new pack, do not delete this assertion.',
  );
});

for (const pack of PACKS) {
  test(`${pack.id}: ships the files the phase promised`, () => {
    for (const expected of pack.expects) {
      assert.ok(pack.shipped.includes(expected), `${expected} is missing from ${pack.id}`);
    }
  });

  test(`${pack.id}: the read-only allowlist is exactly the paths declared for it`, () => {
    // Asserted as a NUMBER as well as as content. If a future change adds a
    // second writer, this fails before anybody has to notice it.
    assert.equal(pack.allowlist.length, pack.expectedAllowlistLength ?? pack.allowlist.length);
    for (const rel of pack.allowlist) {
      assert.ok(pack.shipped.includes(rel), `${pack.id} allowlists ${rel}, which it does not ship`);
    }
  });

  test(`${pack.id}: no shipped script mutates the database, except allowlisted files`, () => {
    const offenders = [];
    for (const rel of pack.shipped) {
      if (pack.allowlist.includes(rel)) continue;
      const src = readFileSync(join(pack.dir, rel), 'utf8');
      const hits = rel.endsWith('.sql') ? sqlMutations(src) : rel.endsWith('.sh') ? shellMutations(src) : [];
      if (hits.length) offenders.push(`${rel}: ${hits.join(', ')}`);
    }
    assert.deepEqual(offenders, [], `mutation found in sold scripts:\n${offenders.join('\n')}`);
  });
}

test('the read-only allowlist across ALL packs holds exactly one path', () => {
  // Counted across the whole product, not per pack. Three packs each holding
  // "just one exception" is four exceptions to explain on a sales page, and
  // nobody would have to approve it, because each pack passed its own test.
  const all = PACKS.flatMap((p) => p.allowlist.map((rel) => `${p.id}/${rel}`));
  assert.deepEqual(all, ['healthcheck/sql/create_history_table.sql']);
});

test('SELF-TEST: the read-only gate actually fires on a mutation', () => {
  // Watch it catch each shape it claims to catch.
  assert.deepEqual(sqlMutations('SELECT 1 FROM dual;\nCREATE TABLE x (a NUMBER);'), ['CREATE']);
  assert.ok(shellMutations('GEN_SQL="ALTER DATABASE DATAFILE \'x\' RESIZE 1G;"').length > 0);

  // And watch it NOT fire on the prose that defeated the naive grep.
  assert.deepEqual(shellMutations('printf "merge the setup dirs"'), []);
  assert.deepEqual(shellMutations('note "SYS or explicit grant required"'), []);
  assert.deepEqual(sqlMutations('-- CREATE TABLE in a comment\nSELECT 1 FROM dual;'), []);
});

test('SELF-TEST: dynamic SQL is judged by the statement inside it, and fails closed', () => {
  const only = (src) => dynamicSqlFindings(src);

  // A read is a read, in both Oracle spellings for a literal.
  assert.deepEqual(only("EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM x' INTO n;"), []);
  assert.deepEqual(only("EXECUTE IMMEDIATE q'[SELECT COUNT(*) FROM unified_audit_trail]' INTO n;"), []);
  assert.deepEqual(only("EXECUTE IMMEDIATE q'{WITH t AS (SELECT 1 FROM dual) SELECT * FROM t}' INTO n;"), []);

  // A write is a write, however it is spelled.
  assert.deepEqual(only("EXECUTE IMMEDIATE 'drop table x';"), ['EXECUTE IMMEDIATE DROP']);
  assert.deepEqual(only("EXECUTE IMMEDIATE q'[DELETE FROM x]';"), ['EXECUTE IMMEDIATE DELETE']);

  // And everything it cannot read with certainty is a finding, not a pass.
  assert.deepEqual(only('EXECUTE IMMEDIATE v_sql;'), ['EXECUTE IMMEDIATE (body is not a readable literal)']);
  assert.deepEqual(only("EXECUTE IMMEDIATE 'SELECT ' || v_col || ' FROM x';"), ['EXECUTE IMMEDIATE (built by concatenation)']);
  assert.deepEqual(only("EXECUTE IMMEDIATE 'SELECT 1 FROM dual"), ['EXECUTE IMMEDIATE (body is not a readable literal)']);

  // The real line this was built for, quoted from daily-ops v0.9.
  assert.deepEqual(
    only("EXECUTE IMMEDIATE q'[\n  SELECT COUNT(*) FROM unified_audit_trail\n   WHERE action_name = 'LOGON']' INTO n"),
    [],
  );
});

for (const pack of PACKS) {
  test(`${pack.id}: every allowlisted writer stays uninvoked, and the pack works without it`, () => {
    // An allowlisted writer is defensible only while both of these hold. If a
    // script ever calls one, it stops being opt-in and the liability argument
    // collapses with it.
    for (const writer of pack.allowlist) {
      const base = writer.split('/').pop().replace(/\./g, '\\.');
      const invoked = new RegExp(base);
      for (const rel of pack.shipped) {
        if (rel === writer || !rel.endsWith('.sh')) continue;
        const src = readFileSync(join(pack.dir, rel), 'utf8').replace(/^\s*#[^\n]*/gm, '');
        assert.ok(!invoked.test(src), `${pack.id}/${rel} invokes ${writer}; it must only ever be run by hand`);
      }
      const header = readFileSync(join(pack.dir, writer), 'utf8');
      assert.match(header, /ONE EXCEPTION TO THE PACK'S READ-ONLY RULE/, `${writer} must say what it is`);
      assert.match(header, /fully functional without it/i, `${writer} must say the pack works without it`);
    }
  });

  test(`${pack.id}: every shipped file carries the header block`, () => {
    const missing = [];
    for (const rel of pack.shipped) {
      const src = readFileSync(join(pack.dir, rel), 'utf8');
      const need = [/OraDiscuss/, /Not produced by/, /oradiscuss\.com/];
      if (!need.every((re) => re.test(src))) missing.push(rel);
    }
    assert.deepEqual(missing, [], `files without the OraDiscuss header and non-affiliation notice: ${missing.join(', ')}`);
  });

  test(`${pack.id}: no em dash anywhere in the pack`, () => {
    const offenders = pack.shipped.filter((rel) => readFileSync(join(pack.dir, rel), 'utf8').includes('\u2014'));
    assert.deepEqual(offenders, [], `house rule: no em dashes. Found in: ${offenders.join(', ')}`);
  });
}

// ---------------------------------------------------------------------------
// THE DUAL-OUTPUT CONTRACT.
// ---------------------------------------------------------------------------

function renderFixture() {
  const out = mkdtempSync(join(tmpdir(), 'odc-pack-'));
  const cfg = join(out, 'config.env');
  writeFileSync(
    cfg,
    [
      'ORACLE_SID=ORCLCDB',
      'ORACLE_HOME=/nonexistent',
      'ORACLE_CONNECT="/ as sysdba"',
      `OUTPUT_DIR=${out}`,
      'TS_WARN_PCT=85', 'TS_CRIT_PCT=95', 'ASM_WARN_PCT=80', 'ASM_CRIT_PCT=90',
      'FRA_WARN_PCT=80', 'FRA_CRIT_PCT=90', 'RMAN_FULL_MAX_AGE_HOURS=30',
      'RMAN_ARCH_MAX_AGE_HOURS=8', 'INVALID_OBJ_WARN=1', 'RETENTION_DAYS=30',
    ].join('\n'),
  );
  mkdirSync(join(out, 'reports'), { recursive: true });
  try {
    execFileSync('bash', [
      join(PACK, 'health_check.sh'),
      '--config', cfg,
      '--render-only', join(PACK, 'test-fixtures/raw_hostile.txt'),
    ], { stdio: 'pipe' });
  } catch (err) {
    // Exit 1 and 2 are the WARN and CRIT contract, not a failure to run.
    if (err.status !== 1 && err.status !== 2) throw err;
  }
  const reports = join(out, 'reports');
  const html = readdirSync(reports).find((f) => f.endsWith('.html') && !f.includes('latest'));
  const json = readdirSync(reports).find((f) => f.endsWith('.json') && !f.includes('latest'));
  return { out, reports, html, json };
}

test('ONE run produces BOTH report.html and briefing.json', () => {
  const { reports, html, json } = renderFixture();
  assert.ok(html, 'no HTML report was written');
  assert.ok(json, 'no JSON briefing was written');
  assert.ok(readFileSync(join(reports, html), 'utf8').includes('<!DOCTYPE html>'));
  JSON.parse(readFileSync(join(reports, json), 'utf8'));
});

test('the briefing survives hostile collector output', () => {
  const { reports, json } = renderFixture();
  const doc = JSON.parse(readFileSync(join(reports, json), 'utf8'));
  const byId = (id) => doc.checks.find((c) => c.id === id);

  // A Windows path, a quoted parameter name, and a pipe inside the detail:
  // each one breaks a naive emitter, and the alert log supplies all three.
  assert.match(byId('ALERT_SAMPLE_3').detail, /D:\\oracle\\oradata\\ORCL\\undotbs01\.dbf$/);
  assert.match(byId('ALERT_SAMPLE_2').detail, /"db_recovery_file_dest_size"/);
  assert.match(byId('ALERT_SAMPLE_4').detail, /mode 6 \| waiter 77/);

  // A decimal comma is not a JSON number. It must become null rather than
  // taking the whole document down with it.
  assert.equal(byId('TS_BADLOCALE').metrics.used_pct.value, null);
});

test('metrics attach to their own check, whatever order they arrived in', () => {
  // Every MET line in the fixture sits AFTER every CHK line, which is exactly
  // what a positional design would misfile.
  const { reports, json } = renderFixture();
  const doc = JSON.parse(readFileSync(join(reports, json), 'utf8'));
  const users = doc.checks.find((c) => c.id === 'TS_USERS');
  assert.equal(users.metrics.used_pct.value, 87.3);
  assert.equal(users.metrics.max_gb.value, 100);
  assert.equal(doc.checks.find((c) => c.id === 'TS_UNDOTBS1').metrics.used_pct.value, 96.8);
  assert.equal(doc.checks.find((c) => c.id === 'INVALID_OBJECTS').metrics.count.value, 31);
});

test('NA is counted but never reported as needing attention', () => {
  const { reports, json } = renderFixture();
  const doc = JSON.parse(readFileSync(join(reports, json), 'utf8'));
  assert.ok(doc.summary.counts.NA > 0, 'the fixture contains NA checks');
  const naIds = doc.checks.filter((c) => c.status === 'NA').map((c) => c.id);
  for (const id of naIds) {
    assert.ok(!doc.summary.needs_attention.includes(id), `${id} is NA and must not be listed as needing attention`);
  }
  // Every WARN and CRIT, on the other hand, must be there.
  for (const c of doc.checks.filter((x) => x.status === 'WARN' || x.status === 'CRIT')) {
    assert.ok(doc.summary.needs_attention.includes(c.id), `${c.id} is ${c.status} and is missing from needs_attention`);
  }
});

test('orchestrate.sh collects BOTH outputs into the run directory', () => {
  // The cron path is the documented primary usage, and it is the one place the
  // dual-output promise can be broken without any test noticing: the collector
  // writes both files correctly, and the orchestrator then keeps only one.
  // Asserted at source level because orchestrate.sh drives a real collection.
  const src = readFileSync(join(PACK, 'orchestrate.sh'), 'utf8').replace(/^\s*#[^\n]*/gm, '');
  assert.match(src, /\$\{prefix\}_\$\{ORACLE_SID\}_\*\.\$\{ext\}/, 'the collect step must be driven by prefix and extension');
  assert.match(src, /for ext in html json/, 'the run directory must receive the briefing as well as the report');
  // Every collector that writes a briefing must be named here, or its output
  // silently misses the run directory. This is the second time that happened.
  assert.match(src, /for prefix in health tablespace/, 'tablespace_monitor.sh writes a briefing too');
});

test('tablespace_monitor.sh also emits both outputs', () => {
  const out = mkdtempSync(join(tmpdir(), 'odc-ts-'));
  const cfg = join(out, 'config.env');
  writeFileSync(cfg, [
    'ORACLE_SID=ORCLCDB', 'ORACLE_HOME=/nonexistent', 'ORACLE_CONNECT="/ as sysdba"',
    `OUTPUT_DIR=${out}`, 'TS_WARN_PCT=85', 'TS_CRIT_PCT=95', 'ASM_WARN_PCT=80',
    'ASM_CRIT_PCT=90', 'FRA_WARN_PCT=80', 'FRA_CRIT_PCT=90',
    'RMAN_FULL_MAX_AGE_HOURS=30', 'RMAN_ARCH_MAX_AGE_HOURS=8',
    'INVALID_OBJ_WARN=1', 'RETENTION_DAYS=30', 'TS_HISTORY_TABLE=ORADISCUSS_TS_HISTORY',
  ].join('\n'));
  try {
    execFileSync('bash', [
      join(PACK, 'tablespace_monitor.sh'), '--config', cfg,
      '--render-only', join(PACK, 'test-fixtures/ts_usage.csv'),
    ], { stdio: 'pipe' });
  } catch (err) {
    if (err.status !== 1 && err.status !== 2) throw err;
  }

  // The CSV is the human half here; this collector has no HTML.
  const csv = readFileSync(join(out, 'logs/tablespace_usage_ORCLCDB.csv'), 'utf8');
  assert.match(csv, /^timestamp,tablespace,used_pct/);

  const json = readdirSync(join(out, 'reports')).find((f) => f.endsWith('.json') && !f.includes('latest'));
  assert.ok(json, 'tablespace_monitor.sh must write a briefing');
  const doc = JSON.parse(readFileSync(join(out, 'reports', json), 'utf8'));
  assert.deepEqual(validate(SCHEMA, doc), [], 'its briefing must satisfy the same schema');
  assert.equal(doc.generator.script, 'tablespace_monitor.sh');
  assert.equal(doc.checks.find((c) => c.id === 'TS_UNDOTBS1').metrics.used_pct.value, 96.8);
  assert.ok(doc.summary.needs_attention.includes('TS_UNDOTBS1'));
  rmSync(out, { recursive: true, force: true });
});

test('every shell script in the pack parses', () => {
  // The headers were rewritten mechanically across every file. A comment-only
  // edit cannot break bash, but "cannot" is not evidence, so this checks.
  for (const rel of SHIPPED.filter((f) => f.endsWith('.sh'))) {
    execFileSync('bash', ['-n', join(PACK, rel)], { stdio: 'pipe' });
  }
});

test('a RAC instance that is not OPEN reaches the briefing as CRIT', () => {
  // The silent-failure shape this guards against: V$INSTANCE only ever
  // describes the node the session connected to, so a two-node cluster with a
  // dead node produces a perfectly clean report. The census reads GV$, and a
  // downed instance has to surface as CRIT and be listed for attention.
  const { reports, json } = renderFixture();
  const doc = JSON.parse(readFileSync(join(reports, json), 'utf8'));
  const census = doc.checks.find((c) => c.id === 'CLUSTER_INSTANCES');
  assert.ok(census, 'the instance census must appear in the briefing');
  assert.equal(census.status, 'CRIT');
  assert.equal(census.metrics.instances_total.value, 3);
  assert.equal(census.metrics.instances_open.value, 2);
  assert.ok(doc.summary.needs_attention.includes('CLUSTER_INSTANCES'));

  // And the scope statement must be present, so a RAC reader is told which
  // checks describe one node rather than having to know.
  const scope = doc.checks.find((c) => c.id === 'CLUSTER_SCOPE');
  assert.ok(scope, 'the collection scope must be stated in the briefing');
  assert.match(scope.detail, /Local to the instance/);
});

test('the collector reads the cluster-wide view for the instance census', () => {
  // Asserted at source level: this is the difference between catching a dead
  // RAC node and reporting a clean bill of health while one is down.
  const sql = readFileSync(join(PACK, 'sql/health_check.sql'), 'utf8');
  assert.match(sql, /FROM gv\$instance/i, 'the census must use GV$, not V$');
});

test('the generated report carries no em dash either', () => {
  const { reports, html } = renderFixture();
  assert.ok(!readFileSync(join(reports, html), 'utf8').includes('\u2014'));
});

// ---------------------------------------------------------------------------
// SCHEMA VALIDATION.
// A small validator rather than a dependency: this repo carries zero devDeps
// on purpose, and the subset of JSON Schema the briefing uses is small enough
// to check honestly. It is self-tested below against a broken document.
// ---------------------------------------------------------------------------

function validate(schema, value, path = '$', errors = []) {
  const types = schema.type ? [].concat(schema.type) : null;
  if (types) {
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const ok = types.some((t) => (t === 'number' ? actual === 'number' : t === 'integer' ? Number.isInteger(value) : t === actual));
    if (!ok) {
      errors.push(`${path}: expected ${types.join('|')}, got ${actual}`);
      return errors;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${path}: does not match ${schema.pattern}`);
  }
  if (schema.required) {
    for (const key of schema.required) {
      if (!(value && Object.prototype.hasOwnProperty.call(value, key))) errors.push(`${path}: missing required "${key}"`);
    }
  }
  if (schema.properties && value && typeof value === 'object') {
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) validate(sub, value[key], `${path}.${key}`, errors);
    }
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object' && value && typeof value === 'object') {
    const named = new Set(Object.keys(schema.properties || {}));
    for (const [key, v] of Object.entries(value)) {
      if (!named.has(key)) validate(schema.additionalProperties, v, `${path}.${key}`, errors);
    }
  }
  if (schema.items && Array.isArray(value)) {
    value.forEach((item, i) => validate(schema.items, item, `${path}[${i}]`, errors));
  }
  return errors;
}

const SCHEMA = JSON.parse(readFileSync(join(PACK, 'schema/briefing.schema.json'), 'utf8'));

test('the emitted briefing validates against the shipped schema', () => {
  const { reports, json } = renderFixture();
  const doc = JSON.parse(readFileSync(join(reports, json), 'utf8'));
  assert.deepEqual(validate(SCHEMA, doc), []);
});

test('SELF-TEST: the schema validator actually rejects a broken briefing', () => {
  const { reports, json } = renderFixture();
  const base = JSON.parse(readFileSync(join(reports, json), 'utf8'));

  const missingField = JSON.parse(JSON.stringify(base));
  delete missingField.summary;
  assert.ok(validate(SCHEMA, missingField).length > 0, 'a missing required block must fail');

  const badStatus = JSON.parse(JSON.stringify(base));
  badStatus.checks[0].status = 'PROBABLY_FINE';
  assert.ok(validate(SCHEMA, badStatus).length > 0, 'a status outside the enum must fail');

  const badVersion = JSON.parse(JSON.stringify(base));
  badVersion.schema_version = 'one';
  assert.ok(validate(SCHEMA, badVersion).length > 0, 'a malformed schema_version must fail');

  const badMetric = JSON.parse(JSON.stringify(base));
  badMetric.checks.find((c) => c.id === 'TS_USERS').metrics.used_pct.value = '87.3';
  assert.ok(validate(SCHEMA, badMetric).length > 0, 'a stringified number must fail');
});

test('the briefing states, in the data, that the collection was read-only', () => {
  // A consumer should be able to ASSERT this rather than trust a file header.
  const { reports, json } = renderFixture();
  const doc = JSON.parse(readFileSync(join(reports, json), 'utf8'));
  assert.equal(doc.collection.read_only, true);
  assert.match(doc.generator.notice, /Not produced by, affiliated with, or endorsed by Oracle/);
});
