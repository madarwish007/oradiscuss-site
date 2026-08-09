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
      'awr_triage.sh',
      'lib/odc_briefing.sh',
      'schema/briefing.schema.json',
      'prompts/triage.md',
      'sql/health_check.sql',
      'sql/awr_triage_collect.sql',
    ],
    allowlist: ['sql/create_history_table.sql'],
  },
  {
    id: 'daily-ops',
    expects: [
      'daily_analysis.sh',
      'env_collector.sh',
      'tbs_manager.sh',
      'lib/odc_briefing.sh',
      'schema/briefing.schema.json',
      'prompts/morning-triage.md',
      'prompts/environment-review.md',
      'prompts/tablespace-capacity.md',
      'sql/daily_analysis.sql',
      'sql/tbs_report.sql',
    ],
    // Empty on purpose, and it is asserted as empty. The v0.9 daily-ops set
    // contained the pack's only two real mutation surfaces (tbs_manager's
    // generated statements and redef_assistant's CREATE TABLE), and neither
    // ships here. tbs_manager ships REPORT-ONLY: the generator paths are held
    // in held/, out of the product, rather than allowlisted into it.
    allowlist: [],
  },
  {
    id: 'rca',
    expects: [
      'rca_generator.sh',
      'lib/odc_briefing.sh',
      'schema/briefing.schema.json',
      'prompts/incident-review.md',
      'sql/rca_alertlog.sql',
      'sql/rca_awr_evidence.sql',
    ],
    // RCA reads dictionary views and log files. It has no writer to allowlist,
    // and an incident is the worst possible moment to be holding an exception.
    allowlist: [],
  },
  {
    id: 'audit-governance',
    expects: [
      'audit_governance.sh',
      'lib/odc_briefing.sh',
      'schema/briefing.schema.json',
      'prompts/audit-review.md',
      'sql/audit_mode_check.sql',
      'sql/audit_trail_activity.sql',
      'sql/audit_trail_hygiene.sql',
      'sql/privilege_review.sql',
      'sql/sensitive_grants_check.sql',
      'sql/profile_policy_check.sql',
      'sql/change_inventory.sql',
      'sql/db_links_inventory.sql',
      'sql/tde_encryption_check.sql',
      'sql/feature_usage_check.sql',
    ],
    // Empty, and it is the pack where that matters most. An audit tool holding
    // a write exception has no answer to the only question a customer will ask
    // about it. Every tier here is a dictionary read.
    allowlist: [],
  },
];

// ---------------------------------------------------------------------------
// EVERY CONFIG VARIABLE A SHIPPED SCRIPT REFUSES TO RUN WITHOUT.
//
// Read out of the scripts themselves below, never hand-listed here, because a
// hand-list is the thing that goes stale. The pack's documented primary path is
// "run env_collector.sh, it writes you a config", so a script that starts
// requiring a new variable while the generator does not write it produces a
// config that makes that script exit 2 on the very first run.
//
// That is the fan-out-by-name trap this repo has now hit three times in
// orchestrate.sh and once here. The guard is the fix; remembering is not.
// ---------------------------------------------------------------------------
function requiredConfigVars(src) {
  // Matches the house idiom: for v in A B C ...; do ... required ... done
  const m = /\bfor\s+v\s+in\s+([\s\S]*?);?\s*do\b/.exec(src);
  if (!m) return [];
  return m[1].split(/[\s\\]+/).filter((t) => /^[A-Z][A-Z0-9_]*$/.test(t));
}

// Files that are deliberately IDENTICAL in every pack that ships them. Each
// pack is sold and downloaded on its own, so it has to be self-contained, but
// two copies of a file is two copies that can drift. Asserted byte for byte
// rather than trusted, because a divergence would show up as one pack's
// briefings quietly failing another pack's schema.
const SHARED_FILES = ['lib/odc_briefing.sh', 'schema/briefing.schema.json'];

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

// ---------------------------------------------------------------------------
// A SQL*Plus DIRECTIVE LINE IS A STATEMENT BOUNDARY, AND THE GATE DID NOT KNOW.
//
// FOUND 8 Aug while self-testing the tbs_manager conversion, and it is the most
// serious defect this file has carried. The gate checked the FIRST token after
// each semicolon. SQL*Plus directives (PROMPT, SET, SPOOL, DEFINE, WHENEVER,
// EXIT) are not semicolon terminated, so any mutation written after one sat in
// the SAME chunk, behind a first token of PROMPT or SET, and was invisible:
//
//   PROMPT SEC|Usage
//   ALTER TABLESPACE users ADD DATAFILE '/tmp/x.dbf' SIZE 1G;   <- reported clean
//
// Every collector .sql in this product is built out of PROMPT lines, so the
// blind spot sat directly over the files the gate exists to protect. It was not
// caught earlier because the gate's own self-tests all used BARE statements,
// which is the one shape it did handle. A self-test that only feeds a guard the
// input it was written for proves nothing about the input it will meet.
//
// THE FIX ADDS BOUNDARIES, IT NEVER DELETES TEXT. Deleting the directive line
// would have been simpler and would have opened a second hole, because
// `PROMPT starting; DROP TABLE x;` carries a real statement on a directive
// line. Appending a semicolon to the end of the line creates the boundary and
// keeps every byte, so nothing can hide in what was removed.
// ---------------------------------------------------------------------------

const SQLPLUS_DIRECTIVES = [
  'SET', 'DEFINE', 'UNDEFINE', 'SPOOL', 'PROMPT', 'WHENEVER', 'EXIT', 'QUIT',
  'REM', 'REMARK', 'COLUMN', 'COL', 'VARIABLE', 'VAR', 'ACCEPT', 'TTITLE',
  'BTITLE', 'CONNECT', 'DISCONNECT', 'HOST', 'START', 'PAUSE', 'CLEAR',
];

function markStatementBoundaries(src) {
  const directive = new RegExp(`^([ \\t]*(?:${SQLPLUS_DIRECTIVES.join('|')})\\b[^\\n]*)$`, 'gim');
  return src
    .replace(directive, '$1;')
    // A lone / runs the buffered block, and @ or @@ calls another script. Both
    // end whatever came before them.
    .replace(/^([ \t]*(?:@{1,2}|\/)[^\n]*)$/gm, '$1;');
}

function sqlMutations(src) {
  const found = [];
  for (const stmt of markStatementBoundaries(stripSqlComments(src)).split(';')) {
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

const NOT_SHIPPED_DIRS = [
  'test-fixtures', // drives this repo's tests, not part of the product
  'held', // code the founder ruled DISABLED NOT DELETED; see any pack's held/README.md
];

function packFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (NOT_SHIPPED_DIRS.includes(name)) continue;
      packFiles(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

// Held files, enumerated separately BECAUSE they are excluded above. An
// exclusion with nothing checking it is how a directory quietly rejoins the
// product: somebody moves a file, the shipped-set guards never look at it, and
// the read-only gate reports green over code it was never shown.
function heldFiles(packDir) {
  const dir = join(packDir, 'held');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n !== 'README.md');
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

for (const pack of PACKS) {
  test(`${pack.id}: the shipped SQL actually emits metrics, and every one lands on a real check`, () => {
    // THE FIXTURE CANNOT CATCH THIS. A test fixture full of MET lines proves
    // the PARSER handles them and says nothing about whether the collector
    // ever writes one. daily-ops was converted with a metric-aware parser, a
    // metric-rich fixture and a shipped .sql that emitted ZERO metrics, so
    // every real run would have produced a briefing whose every check carried
    // an empty "metrics": {} while the whole suite stayed green.
    //
    // Ids are compared by PREFIX because they are built by concatenation
    // ('MET|TS_' || tablespace_name). A metric whose prefix matches no check
    // prefix in the same file is a metric that will attach to nothing.
    const ids = (src, kind) =>
      new Set([...src.matchAll(new RegExp(`${kind}\\|([A-Z_0-9]*)`, 'g'))].map((m) => m[1]).filter(Boolean));

    const sqlFiles = pack.shipped.filter((rel) => rel.endsWith('.sql') && !pack.allowlist.includes(rel));
    assert.ok(sqlFiles.length > 0, `${pack.id} ships no collector SQL, so this guard is asleep`);

    let metricsAnywhere = 0;
    for (const rel of sqlFiles) {
      const src = readFileSync(join(pack.dir, rel), 'utf8');
      const checks = ids(src, 'CHK');
      const metrics = ids(src, 'MET');
      if (checks.size === 0) continue; // not a collector, nothing to pair
      metricsAnywhere += metrics.size;
      const orphans = [...metrics].filter((m) => !checks.has(m));
      assert.deepEqual(orphans, [], `${pack.id}/${rel} emits metrics for ids it never checks: ${orphans.join(', ')}`);
    }
    assert.ok(
      metricsAnywhere > 0,
      `${pack.id} emits CHK lines but no MET lines, so every briefing it writes will have empty metrics`,
    );
  });
}

// ---------------------------------------------------------------------------
// A DRY RUN PRINTS A PLAN AND LEAVES THE FILESYSTEM EXACTLY AS IT FOUND IT.
//
// Every one of these scripts created its output directory BEFORE reaching the
// dry-run branch, while rca_generator's own dry-run text said, in words a
// customer reads, "Nothing here writes to the database or to the OS". Creating
// a directory is writing to the OS, so that sentence was false.
//
// It is a small untruth and that is exactly why it earns a guard: this product
// is sold on its claims being literally checkable, and a reader who verifies
// the smallest claim and finds it wrong has no reason to trust the large one
// about read-only access.
//
// Asserted by MEASURING the directory before and after rather than by reading
// the source for a mkdir, because the next way this breaks will not be a mkdir.
// ---------------------------------------------------------------------------

test('every --dry-run leaves the output directory untouched', () => {
  const plausible = (name) => {
    if (name === 'ORACLE_CONNECT') return '"/ as sysdba"';
    if (name === 'ORACLE_SID') return 'ODCDEMO';
    if (name === 'ORACLE_HOME') return '/nonexistent';
    if (name.endsWith('_TABLE')) return 'ORADISCUSS_TS_HISTORY';
    return '1';
  };

  let checked = 0;
  for (const pack of PACKS) {
    for (const rel of pack.shipped) {
      if (!rel.endsWith('.sh') || rel.includes('/')) continue;
      const src = readFileSync(join(pack.dir, rel), 'utf8');
      if (!/--dry-run\)/.test(src)) continue;

      const out = mkdtempSync(join(tmpdir(), 'odc-dry-'));
      const cfg = join(out, 'config.env');
      const vars = new Set(requiredConfigVars(src));
      vars.add('OUTPUT_DIR');
      writeFileSync(
        cfg,
        [...vars].map((v) => (v === 'OUTPUT_DIR' ? `OUTPUT_DIR=${out}` : `${v}=${plausible(v)}`)).join('\n'),
      );

      const before = readdirSync(out).sort();
      try {
        execFileSync('bash', [join(pack.dir, rel), '--config', cfg, '--dry-run'], { stdio: 'pipe' });
      } catch {
        // A dry run that REFUSES to run is a different defect, caught by that
        // pack's own tests. What must never happen here is a WRITE.
      }
      const after = readdirSync(out).sort();
      assert.deepEqual(
        after,
        before,
        `${pack.id}/${rel} --dry-run created ${after.filter((f) => !before.includes(f)).join(', ')}. ` +
          'A dry run prints a plan and writes nothing.',
      );
      checked += 1;
      rmSync(out, { recursive: true, force: true });
    }
  }
  assert.ok(checked >= 5, `only ${checked} scripts with a --dry-run were exercised, so this guard is nearly asleep`);
});

test('the shared dual-output layer is byte-identical in every pack that ships it', () => {
  for (const rel of SHARED_FILES) {
    const carriers = PACKS.filter((p) => p.shipped.includes(rel));
    assert.ok(carriers.length >= 2, `only ${carriers.length} pack ships ${rel}, so this guard is asleep`);
    const [first, ...rest] = carriers;
    const want = readFileSync(join(first.dir, rel), 'utf8');
    for (const p of rest) {
      assert.equal(
        readFileSync(join(p.dir, rel), 'utf8'),
        want,
        `${p.id}/${rel} has drifted from ${first.id}/${rel}. Change one and copy it, never edit one in place.`,
      );
    }
  }
});

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

test('SELF-TEST: a mutation hiding behind a SQL*Plus directive line is caught', () => {
  // EVERY ONE OF THESE WAS MISSED before 8 Aug, and every collector .sql in
  // this product is built out of PROMPT lines, so the hole sat directly over
  // the files the gate exists to protect. The old self-test passed throughout,
  // because it only ever fed the gate a bare statement.
  //
  // Nothing was actually hiding: the strengthened gate was run across both
  // packs before this test was written and reported them clean. The defect was
  // a latent one, which is the only kind worth fixing before it is used.
  const cases = [
    ['after PROMPT',   "PROMPT SEC|Usage\nALTER TABLESPACE users ADD DATAFILE '/tmp/x.dbf' SIZE 1G;", ['ALTER']],
    ['after SPOOL/EXIT', 'SELECT 1 FROM dual;\nSPOOL OFF\nEXIT\nDROP TABLE victim;', ['DROP']],
    ['after SET',      'SET PAGES 0\nDROP TABLE victim;', ['DROP']],
    ['after WHENEVER', 'WHENEVER SQLERROR EXIT SQL.SQLCODE\nCREATE TABLE t (a NUMBER);', ['CREATE']],
    ['after DEFINE',   'DEFINE x = 1\nDELETE FROM audit_trail;', ['DELETE']],
    ['after a lone /', 'BEGIN NULL; END;\n/\nTRUNCATE TABLE t;', ['TRUNCATE']],
  ];
  for (const [label, src, want] of cases) {
    assert.deepEqual(sqlMutations(src), want, `a mutation ${label} was not caught`);
  }

  // The boundary is ADDED, never substituted for the line, so a real statement
  // sharing a line with a directive is still read. Deleting the line instead
  // would have closed one hole and opened this one.
  assert.deepEqual(sqlMutations('PROMPT starting; DROP TABLE x;'), ['DROP']);

  // And the added boundaries must not invent findings in ordinary collector
  // shape, or the gate becomes one somebody switches off.
  assert.deepEqual(
    sqlMutations("PROMPT SEC|Usage\nSELECT 'CHK|A|OK|t|d' FROM dual;\nSPOOL OFF\nEXIT"),
    [],
  );
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
// HELD CODE: in git, out of the product.
//
// The operating plan says DISABLE, DO NOT DELETE. A removed script stays in git
// so it can be reviewed and revived, and must never reach a customer. Those two
// requirements pull in opposite directions, and the only thing holding them
// apart is an exclusion in two places: NOT_SHIPPED_DIRS above and one rm in
// scripts/publish-pack-to-project.sh. Either one being lost is silent.
// ---------------------------------------------------------------------------

for (const pack of PACKS) {
  const held = heldFiles(pack.dir);
  if (held.length === 0) continue;

  test(`${pack.id}: held code is documented, inert, and outside the shipped set`, () => {
    assert.ok(
      existsSync(join(pack.dir, 'held', 'README.md')),
      `${pack.id}/held exists with no README saying what is held and why`,
    );

    for (const name of held) {
      // The suffix is what makes these inert. A file still named like the
      // script it came from is a file somebody eventually runs by accident.
      assert.match(name, /\.held$/, `${pack.id}/held/${name} must end in .held so it cannot be run`);

      const rel = join('held', name);
      assert.ok(
        !pack.shipped.includes(rel),
        `${pack.id} ships ${rel}. Held code must never reach a customer.`,
      );
    }
  });

  test(`${pack.id}: nothing shipped invokes anything held`, () => {
    // A shipped script that calls into held/ would make the exclusion above a
    // lie in the only way that matters: the customer would not have the file.
    for (const rel of pack.shipped) {
      if (!rel.endsWith('.sh')) continue;
      const src = readFileSync(join(pack.dir, rel), 'utf8').replace(/^\s*#[^\n]*/gm, '');
      assert.ok(!/\bheld\//.test(src), `${pack.id}/${rel} references held/, which does not ship`);
    }
  });
}

test('SELF-TEST: the publish script strips held code from the customer package', () => {
  // Asserted against the PUBLISHER, not against the source tree, because the
  // artefact that matters is the one the customer keeps. This repo has already
  // shipped a defect where the collector wrote both outputs correctly and the
  // ORCHESTRATOR then discarded one, with the whole suite green throughout.
  const src = readFileSync(join(REPO, 'scripts/publish-pack-to-project.sh'), 'utf8');
  assert.match(
    src,
    /rm -rf "\$SRC\/held"/,
    'publish-pack-to-project.sh no longer strips held/. Held code would ship inside the customer zip.',
  );
  // It must be stripped BEFORE the zip is built, or the mirror is clean and the
  // zip is not, which is the harder of the two to notice.
  assert.ok(
    src.indexOf('rm -rf "$SRC/held"') < src.indexOf('zip -r -q'),
    'held/ is stripped after the zip is built, so the customer zip still contains it',
  );
});

// ---------------------------------------------------------------------------
// THE GENERATED CONFIG MUST SATISFY EVERY SHIPPED SCRIPT.
// ---------------------------------------------------------------------------

test('daily-ops: env_collector generates a config every shipped script can run from', () => {
  const pack = PACKS.find((p) => p.id === 'daily-ops');
  const generator = readFileSync(join(pack.dir, 'env_collector.sh'), 'utf8');

  const required = new Set();
  for (const rel of pack.shipped) {
    if (!rel.endsWith('.sh') || rel === 'env_collector.sh') continue;
    for (const v of requiredConfigVars(readFileSync(join(pack.dir, rel), 'utf8'))) required.add(v);
  }
  assert.ok(required.size > 0, 'no required config variables were parsed, so this guard is asleep');

  // Read the heredoc the generator writes, not the whole file, so a variable
  // merely MENTIONED in a comment cannot pass for one that is written.
  const heredoc = /cat > "\$CFG" <<CFG\n([\s\S]*?)\nCFG\n/.exec(generator);
  assert.ok(heredoc, 'could not find the config heredoc in env_collector.sh');
  const emitted = new Set(
    [...heredoc[1].matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
  );

  const missing = [...required].filter((v) => !emitted.has(v)).sort();
  assert.deepEqual(
    missing,
    [],
    `env_collector.sh writes a config missing ${missing.join(', ')}. ` +
      'The pack tells the customer to generate the config with it, so those scripts would exit 2 on a first run.',
  );
});

test('daily-ops: config.env itself carries every required variable', () => {
  // The other documented path. A customer who copies config.env by hand must
  // land somewhere runnable too.
  const pack = PACKS.find((p) => p.id === 'daily-ops');
  const shipped = readFileSync(join(pack.dir, 'config.env'), 'utf8');
  const declared = new Set([...shipped.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));

  const required = new Set();
  for (const rel of pack.shipped) {
    if (!rel.endsWith('.sh')) continue;
    for (const v of requiredConfigVars(readFileSync(join(pack.dir, rel), 'utf8'))) required.add(v);
  }
  const missing = [...required].filter((v) => !declared.has(v)).sort();
  assert.deepEqual(missing, [], `config.env is missing ${missing.join(', ')}`);
});

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

// ---------------------------------------------------------------------------
// DAILY-OPS: the same dual-output contract, driven through the REAL parser.
// ---------------------------------------------------------------------------

function renderDailyOps() {
  const pack = PACKS.find((p) => p.id === 'daily-ops');
  const out = mkdtempSync(join(tmpdir(), 'odc-dops-'));
  const cfg = join(out, 'config.env');
  writeFileSync(
    cfg,
    [
      'ORACLE_SID=ORCLCDB',
      'ORACLE_HOME=/nonexistent',
      'ORACLE_CONNECT="/ as sysdba"',
      `OUTPUT_DIR=${out}`,
      'TS_WARN_PCT=80', 'TS_CRIT_PCT=90',
      'RMAN_FULL_MAX_AGE_HOURS=36', 'RMAN_ARCH_MAX_AGE_HOURS=6',
      'STANDBY_LAG_WARN_MIN=15', 'STALE_STATS_WARN=25',
    ].join('\n'),
  );
  mkdirSync(join(out, 'briefings'), { recursive: true });
  mkdirSync(join(out, 'state'), { recursive: true });
  const raw = join(pack.dir, 'test-fixtures/raw_hostile.txt');
  const before = readFileSync(raw, 'utf8');
  try {
    execFileSync('bash', [
      join(pack.dir, 'daily_analysis.sh'), '--config', cfg, '--render-only', raw,
    ], { stdio: 'pipe' });
  } catch (err) {
    if (err.status !== 1 && err.status !== 2) throw err;
  }
  const dir = join(out, 'briefings');
  return {
    dir,
    html: readdirSync(dir).find((f) => f.endsWith('.html') && !f.includes('latest')),
    json: readdirSync(dir).find((f) => f.endsWith('.json') && !f.includes('latest')),
    rawUnchanged: readFileSync(raw, 'utf8') === before,
  };
}

test('daily-ops: ONE collection produces BOTH the morning briefing and the JSON', () => {
  const r = renderDailyOps();
  assert.ok(r.html, 'no HTML morning briefing was written');
  assert.ok(r.json, 'the HTML was written but the briefing was not, which is half a run');
  assert.ok(readFileSync(join(r.dir, r.html), 'utf8').includes('<!DOCTYPE html>'));
  JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
});

test('daily-ops: --render-only leaves the collection it read exactly as it found it', () => {
  // The collect-time steps APPEND to the raw file (patch inventory, invalid
  // delta). If they ran on a replay, every re-render would differ from the last
  // and a read-only archived collection would fail outright.
  assert.ok(renderDailyOps().rawUnchanged, '--render-only modified the raw collection it was given');
});

test('daily-ops: the briefing survives hostile collector output', () => {
  const r = renderDailyOps();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const tbs = doc.checks.find((c) => c.id === 'TBS');
  assert.match(tbs.detail, /D:\\oracle\\oradata/, 'a Windows path did not survive JSON escaping');
  assert.match(tbs.detail, /"db_file_name_convert"/, 'a quoted name did not survive');
  assert.match(tbs.detail, /pipe \| inside/, 'a pipe inside a detail truncated the field');

  // A decimal comma is what a German-locale session emits. It must become null
  // rather than invalidate the whole document.
  const invalid = doc.checks.find((c) => c.id === 'INVALID');
  assert.equal(invalid.metrics.locale_decimal_comma.value, null);
  assert.equal(invalid.metrics.invalid_objects.value, 3);
});

test('daily-ops: the trend metrics are carried, and NA is not counted as healthy', () => {
  // ONE call. Two calls render into two different temp directories, and
  // pairing a directory from one with a filename from the other is a test
  // that fails for a reason the product had nothing to do with.
  const r = renderDailyOps();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const tbs = doc.checks.find((c) => c.id === 'TBS');
  assert.equal(tbs.metrics.gb_per_day.value, 1.4);
  assert.equal(tbs.metrics.days_to_90pct.value, 6);
  assert.equal(doc.summary.counts.NA, 1);
  assert.ok(!doc.summary.needs_attention.includes('STALE'), 'NA must not be reported as needing attention');
  assert.ok(doc.summary.needs_attention.includes('RMAN_FULL'), 'a CRIT must reach needs_attention');
  assert.equal(doc.summary.overall_status, 'CRIT');
});

// ---------------------------------------------------------------------------
// tbs_manager, the tablespace deep read. Report-only in v1.0.
// ---------------------------------------------------------------------------

function renderTbsManager() {
  const pack = PACKS.find((p) => p.id === 'daily-ops');
  const out = mkdtempSync(join(tmpdir(), 'odc-tbs-'));
  const cfg = join(out, 'config.env');
  writeFileSync(
    cfg,
    [
      'ORACLE_SID=ORCLCDB',
      'ORACLE_HOME=/nonexistent',
      'ORACLE_CONNECT="/ as sysdba"',
      `OUTPUT_DIR=${out}`,
      'TS_WARN_PCT=80', 'TS_CRIT_PCT=90',
      'TS_SHRINK_FREE_PCT=30', 'TS_FRAG_EXTENTS=1000',
    ].join('\n'),
  );
  const raw = join(pack.dir, 'test-fixtures/tbs_raw_hostile.txt');
  const before = readFileSync(raw, 'utf8');
  try {
    execFileSync('bash', [
      join(pack.dir, 'tbs_manager.sh'), '--config', cfg, '--render-only', raw,
    ], { stdio: 'pipe' });
  } catch (err) {
    if (err.status !== 1 && err.status !== 2) throw err;
  }
  const dir = join(out, 'tbs');
  return {
    dir,
    html: readdirSync(dir).find((f) => f.endsWith('.html') && !f.includes('latest')),
    json: readdirSync(dir).find((f) => f.endsWith('.json') && !f.includes('latest')),
    rawUnchanged: readFileSync(raw, 'utf8') === before,
  };
}

test('tbs_manager: ONE collection produces BOTH the report and the briefing', () => {
  const r = renderTbsManager();
  assert.ok(r.html, 'no HTML report was written');
  assert.ok(r.json, 'the HTML was written but the briefing was not, which is half a run');
  assert.ok(readFileSync(join(r.dir, r.html), 'utf8').includes('<!DOCTYPE html>'));
  JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
});

test('tbs_manager: --render-only leaves the collection it read exactly as it found it', () => {
  assert.ok(renderTbsManager().rawUnchanged, '--render-only modified the raw collection it was given');
});

test('tbs_manager: the briefing validates against the shipped schema', () => {
  const pack = PACKS.find((p) => p.id === 'daily-ops');
  const schema = JSON.parse(readFileSync(join(pack.dir, 'schema/briefing.schema.json'), 'utf8'));
  const r = renderTbsManager();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  assert.deepEqual(validate(schema, doc), []);
});

test('tbs_manager: the briefing survives hostile collector output', () => {
  const r = renderTbsManager();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const weird = doc.checks.find((c) => c.id === 'TSU_TS_WEIRD');
  assert.ok(weird, 'the hostile check is missing, so this guard proved nothing');
  assert.match(weird.detail, /D:\\oracle\\oradata/, 'a Windows path did not survive JSON escaping');
  assert.match(weird.detail, /"db_file_name_convert"/, 'a quoted name did not survive');
  assert.match(weird.detail, /pipe \| inside/, 'a pipe inside a detail truncated the field');
  // A decimal comma is what a German-locale session emits. It must become null
  // rather than invalidate the whole document.
  assert.equal(weird.metrics.used_pct.value, null);
});

test('tbs_manager: metrics are keyed by check id, never by position', () => {
  // The fixture puts every MET line in a block AFTER every CHK line in its
  // section, and interleaves sections. Position-keyed pooling would misfile
  // every one of them.
  const r = renderTbsManager();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const byId = (id) => doc.checks.find((c) => c.id === id);
  assert.equal(byId('TSU_USERS').metrics.used_pct.value, 87.3);
  assert.equal(byId('TSU_SYSAUX').metrics.used_pct.value, 94.8);
  assert.equal(byId('AE_STATIC').metrics.headroom_gb.value, 0);
  assert.equal(byId('AE_USERS').metrics.headroom_gb.value, 46);
  assert.equal(byId('SHRINK_7').metrics.free_pct.value, 47);
  assert.equal(byId('FRAG_APP.ORDER_LINES').metrics.extents.value, 4210);
});

test('tbs_manager: the shrink and extent rows carry NO verdict', () => {
  // The product's position is ranked facts, never verdicts. Free space inside a
  // datafile is not automatically reclaimable, and a high extent count is not a
  // defect, so neither may be coloured as a finding. Enforced by a guard rather
  // than by anybody's intention, in the same way awr_triage's efficiency ratios
  // are.
  const r = renderTbsManager();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const observations = doc.checks.filter((c) => c.id.startsWith('SHRINK_') || c.id.startsWith('FRAG_'));
  assert.ok(observations.length > 0, 'no observation rows in the fixture, so this guard is asleep');
  for (const c of observations) {
    assert.equal(c.status, 'OK', `${c.id} carries status ${c.status}; an observation must not read as a finding`);
    assert.ok(
      !doc.summary.needs_attention.includes(c.id),
      `${c.id} reached needs_attention, which turns an observation into a verdict`,
    );
  }
});

test('tbs_manager: the report states its container scope on its own face', () => {
  // An unstated scope is indistinguishable from a bug: a clean report from a
  // CDB root says nothing about the pluggable database that is actually full.
  const r = renderTbsManager();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const scope = doc.checks.find((c) => c.id === 'SCOPE');
  assert.ok(scope, 'the briefing carries no SCOPE check');
  assert.match(scope.detail, /container/i);

  const html = readFileSync(join(r.dir, r.html), 'utf8');
  assert.match(html, /Report scope/, 'the HTML report does not show the scope section');
});

test('tbs_manager: v1.0 ships no path that writes to the database', () => {
  // The whole point of the conversion. Asserted on the shipped source rather
  // than inferred from the absence of a flag in the docs.
  const pack = PACKS.find((p) => p.id === 'daily-ops');
  const src = readFileSync(join(pack.dir, 'tbs_manager.sh'), 'utf8');
  for (const flag of ['--add-datafile', '--resize', '--set-autoextend', '--execute']) {
    const live = src.replace(/^\s*#[^\n]*/gm, '');
    assert.ok(!live.includes(flag), `tbs_manager.sh still accepts ${flag}`);
  }
  assert.deepEqual(shellMutations(src), [], 'tbs_manager.sh contains a mutation pair');
});

// ---------------------------------------------------------------------------
// RCA: the second document KIND. Evidence, a timeline, ordering facts.
// ---------------------------------------------------------------------------

function renderRca() {
  const pack = PACKS.find((p) => p.id === 'rca');
  const out = mkdtempSync(join(tmpdir(), 'odc-rca-'));
  const cfg = join(out, 'config.env');
  writeFileSync(
    cfg,
    [
      'ORACLE_SID=LABDB',
      'ORACLE_HOME=/nonexistent',
      'ORACLE_CONNECT="/ as sysdba"',
      `OUTPUT_DIR=${out}`,
      'RCA_MAX_EVENTS=500',
      'RCA_CORRELATION_WINDOW_SEC=600',
    ].join('\n'),
  );
  const raw = join(pack.dir, 'test-fixtures/rca_raw_hostile.txt');
  const before = readFileSync(raw, 'utf8');
  try {
    execFileSync('bash', [
      join(pack.dir, 'rca_generator.sh'), '--config', cfg, '--render-only', raw,
    ], { stdio: 'pipe' });
  } catch (err) {
    if (err.status !== 1 && err.status !== 2) throw err;
  }
  const dir = join(out, 'rca');
  return {
    dir,
    html: readdirSync(dir).find((f) => f.endsWith('.html') && !f.includes('latest')),
    json: readdirSync(dir).find((f) => f.endsWith('.json') && !f.includes('latest')),
    rawUnchanged: readFileSync(raw, 'utf8') === before,
  };
}

test('rca: ONE collection produces BOTH the report and the briefing', () => {
  const r = renderRca();
  assert.ok(r.html, 'no HTML incident report was written');
  assert.ok(r.json, 'the HTML was written but the briefing was not, which is half a run');
  assert.ok(readFileSync(join(r.dir, r.html), 'utf8').includes('<!DOCTYPE html>'));
  JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
});

test('rca: --render-only leaves the collection it read exactly as it found it', () => {
  assert.ok(renderRca().rawUnchanged, '--render-only modified the raw collection it was given');
});

test('rca: the incident briefing validates against the shipped schema', () => {
  const pack = PACKS.find((p) => p.id === 'rca');
  const schema = JSON.parse(readFileSync(join(pack.dir, 'schema/briefing.schema.json'), 'utf8'));
  // ONE call. Two calls render into two different temp directories, and pairing
  // one directory with the other's filename is a test that fails for a reason
  // the product had nothing to do with. This file already carried that warning
  // and this test was written ignoring it.
  const r = renderRca();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  assert.deepEqual(validate(schema, doc), []);
});

test('rca: the document declares which KIND it is', () => {
  const r = renderRca();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  assert.equal(doc.kind, 'incident');
  assert.equal(doc.schema_version, '1.1');
  assert.ok(doc.incident, 'kind is incident but there is no incident block');
});

test('SELF-TEST: a state collector still emits a valid document with NO incident block', () => {
  // THE UNEXERCISED PATH IS THE TRAP, and this library has already shipped one:
  // the inline thresholds default that expanded to three literal characters and
  // emitted invalid JSON for the first caller that omitted the argument.
  // Injecting the incident block is the new path; OMITTING it is the old one,
  // and both are asserted rather than assumed.
  const pack = PACKS.find((p) => p.id === 'daily-ops');
  const schema = JSON.parse(readFileSync(join(pack.dir, 'schema/briefing.schema.json'), 'utf8'));
  const r = renderTbsManager();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  assert.equal(doc.kind, 'state');
  assert.ok(!('incident' in doc), 'a state collector emitted an incident block');
  assert.deepEqual(validate(schema, doc), []);
});

test('rca: the timeline sorts by epoch AND by the collected sequence number', () => {
  // The fixture is deliberately shuffled and carries TWO events in the same
  // second. Sorting on the epoch alone leaves those two in an order chosen by
  // whichever sort implementation is installed, which is how one collection
  // tells two different stories on two machines.
  const r = renderRca();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const ev = doc.incident.events;
  assert.ok(ev.length >= 7, `expected the whole fixture timeline, got ${ev.length}`);
  for (let i = 1; i < ev.length; i++) {
    const prev = ev[i - 1];
    const cur = ev[i];
    assert.ok(
      prev.epoch < cur.epoch || (prev.epoch === cur.epoch && prev.seq < cur.seq),
      `timeline is out of order at index ${i}: (${prev.epoch},${prev.seq}) then (${cur.epoch},${cur.seq})`,
    );
  }
  const tied = ev.filter((e) => e.epoch === 1754640042);
  assert.equal(tied.length, 2, 'the tied-second pair is missing, so this guard proved nothing');
  assert.deepEqual(tied.map((e) => e.seq), [4, 7]);
});

test('rca: timestamps are carried from collection, never recomputed', () => {
  // A renderer that formatted the epoch itself would rewrite the incident
  // machine's clock whenever an archived collection was read in another
  // timezone. The string in the fixture must survive verbatim.
  const r = renderRca();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const first = doc.incident.events.find((e) => e.seq === 1);
  assert.equal(first.timestamp, '2026-08-08 03:20:00');
  assert.equal(first.epoch, 1754640000);
});

test('rca: ordering facts separate what was MEASURED from what was READ into it', () => {
  const r = renderRca();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const facts = doc.incident.ordering_facts;
  assert.ok(facts.length > 0, 'no ordering facts, so this guard is asleep');

  const os = facts.find((f) => f.id === 'os_precedes_ora');
  assert.ok(os, 'the fixture puts an OS error 42s before an ORA- error and no fact was drawn');
  assert.match(os.statement, /42 seconds/);
  assert.ok(os.reading, 'the correlation carries no labelled reading');
  assert.ok(os.would_distinguish, 'a reading with a competing explanation must say what would separate them');

  for (const f of facts) {
    assert.ok(f.statement, `${f.id} has no measured statement`);
  }
});

test('rca: the report contains NO verdicts and NO commands', () => {
  // The locked decision is evidence, timeline and ranked probable causes,
  // NEVER verdicts or commands. v0.9 shipped a "recommended next steps" section
  // and cause entries phrased as instructions ("investigate the storage layer
  // first"). Enforced by a guard rather than by anybody remembering.
  const r = renderRca();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const html = readFileSync(join(r.dir, r.html), 'utf8');

  const imperatives = [
    /recommended next steps/i,
    /\binvestigate the\b/i,
    /\byou should\b/i,
    /\brun the following\b/i,
    /\bexecute\b/i,
  ];
  const prose = [
    ...doc.incident.ordering_facts.flatMap((f) => [f.statement, f.reading ?? '', f.would_distinguish ?? '']),
    html,
  ].join('\n');
  for (const re of imperatives) {
    assert.ok(!re.test(prose), `the incident report reads as an instruction: ${re}`);
  }
});

test('rca: a tier that could not run is recorded as NA, never as absent', () => {
  // A silently missing tier looks exactly like a tier that found nothing, and
  // during an incident those are completely different answers.
  const r = renderRca();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const os = doc.checks.find((c) => c.id === 'OSTIER');
  const awr = doc.checks.find((c) => c.id === 'AWR');
  assert.equal(os.status, 'NA');
  assert.equal(awr.status, 'NA');
  assert.ok(doc.summary.counts.NA >= 2, 'NA checks are not being counted');
  assert.ok(!doc.summary.needs_attention.includes('OSTIER'), 'NA must not be reported as needing attention');
  // Each NA must say what would make it runnable, or it is just a shrug.
  assert.match(awr.detail, /Diagnostics Pack/);
  assert.match(os.detail, /sudo|root/i);
});

test('rca: an INCOMPLETE collection never reports itself as OK', () => {
  // Found by LOOKING at the rendered output rather than by a failing assertion.
  // The document said overall_status OK over two tiers that were never read,
  // while the exit code said 1, because the degradation flag was applied after
  // the summary was computed and was never set at all under --render-only.
  // Two outputs of one run disagreeing about whether the run succeeded is the
  // exact class of defect this pack exists to expose in other people's tools.
  //
  // For a STATE briefing an NA among thirty OK checks should not move the
  // summary, and it does not. For an INCIDENT collection it must, because the
  // pack's whole thesis is that a tier nobody read is not a tier that was clean.
  const r = renderRca();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  assert.ok(doc.summary.counts.NA > 0, 'the fixture has no NA checks, so this guard is asleep');
  assert.equal(doc.summary.overall_status, 'WARN');
  assert.equal(doc.collection.collector_exit_code, 1, 'the summary and the exit code disagree');

  // Derived from the document rather than hardcoded, so adding a check to the
  // fixture cannot fail this test for a reason the product had nothing to do
  // with. The first version asserted "2 of 6" and broke the moment a tier was
  // added, which says nothing about whether the report is honest.
  const c = doc.summary.counts;
  const total = c.OK + c.WARN + c.CRIT + c.NA;
  const html = readFileSync(join(r.dir, r.html), 'utf8');
  assert.match(
    html,
    new RegExp(`${c.NA} of ${total} checks could not be read`),
    'the report does not state its own incompleteness in the words the document supports',
  );
});

test('rca: a count of one does not read as "1 times"', () => {
  // Customer-facing prose in a paid product. Caught by reading the output.
  const r = renderRca();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const top = doc.incident.ordering_facts.find((f) => f.id === 'top_ora_codes');
  assert.ok(top, 'no top-codes fact, so this guard is asleep');
  assert.doesNotMatch(top.statement, /\b1 times\b/);
  assert.match(top.statement, /ORA-01578 x3/);
  assert.match(top.statement, /ORA-00600 x1/);
});

test('rca: the window and how it was resolved are both recorded', () => {
  // A triage that examined a different window than the operator meant is the
  // failure that matters most here, so the window is carried in the data.
  const r = renderRca();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  assert.equal(doc.incident.window.from, '2026-08-08 02:00:00');
  assert.equal(doc.incident.window.to, '2026-08-08 06:00:00');
  assert.match(doc.incident.window.resolved_from, /--at/);
  assert.match(readFileSync(join(r.dir, r.html), 'utf8'), /2026-08-08 02:00:00/);
});

test('rca: the briefing survives hostile collector output', () => {
  const r = renderRca();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const adr = doc.checks.find((c) => c.id === 'ADR');
  assert.match(adr.detail, /D:\\oracle\\diag/, 'a Windows path did not survive JSON escaping');
  const awr = doc.checks.find((c) => c.id === 'AWR');
  assert.match(awr.detail, /"NONE"/, 'a quoted value did not survive');
  const trace = doc.incident.events.find((e) => e.seq === 3);
  assert.match(trace.message, /D:\\oracle\\diag/, 'a Windows path in an event did not survive');
  assert.match(trace.message, /"block corruption"/, 'a quoted phrase in an event did not survive');
  // A decimal comma is what a German-locale session emits. It must become null
  // rather than invalidate the whole document.
  assert.equal(doc.checks.find((c) => c.id === 'IDENT').metrics.uptime_hours.value, null);
});

// ---------------------------------------------------------------------------
// THE WINDOW. This is collect-time logic, which --render-only never reaches,
// and it is the code where a silent mistake costs the most: it decides which
// hours of an incident anybody ever looks at. It is testable here only because
// the date helpers were written to work on BSD date as well as GNU date.
// ---------------------------------------------------------------------------

function runRca(args, opts = {}) {
  const pack = PACKS.find((p) => p.id === 'rca');
  const out = mkdtempSync(join(tmpdir(), 'odc-rcaw-'));
  const cfg = join(out, 'config.env');
  writeFileSync(
    cfg,
    [
      'ORACLE_SID=LABDB', 'ORACLE_HOME=/nonexistent', 'ORACLE_CONNECT="/ as sysdba"',
      `OUTPUT_DIR=${out}`, 'RCA_MAX_EVENTS=500', 'RCA_CORRELATION_WINDOW_SEC=600',
    ].join('\n'),
  );
  try {
    const stdout = execFileSync('bash', [join(pack.dir, 'rca_generator.sh'), '--config', cfg, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts,
    });
    return { status: 0, out: stdout };
  } catch (err) {
    return { status: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

test('rca: --at widens to a window and says so, and --since resolves against now', () => {
  const at = runRca(['--dry-run', '--at', '2026-08-08 04:00']);
  assert.equal(at.status, 0);
  assert.match(at.out, /window {10}: 2026-08-08 02:00:00 to 2026-08-08 06:00:00/);
  assert.match(at.out, /resolved from {3}: --at 2026-08-08 04:00, widened/);

  const since = runRca(['--dry-run', '--since', '2h']);
  assert.equal(since.status, 0);
  assert.match(since.out, /resolved from {3}: --since 2h/);
  // Proves the window is real rather than a passed-through string: two
  // timestamps four hours apart cannot both be the literal argument.
  const [, from, to] = /window {10}: (\S+ \S+) to (\S+ \S+)/.exec(since.out);
  assert.equal((Date.parse(to.replace(' ', 'T')) - Date.parse(from.replace(' ', 'T'))) / 3600000, 2);
});

test('rca: it REFUSES rather than guessing, and each refusal exits non-zero', () => {
  // A triage that silently picked one of two windows is worse than one that
  // refused to start, so every one of these is an error and not a precedence
  // rule. The exit code is asserted too: a script that prints ERROR and exits 0
  // is a script cron treats as a success.
  const cases = [
    [['--since', '2h', '--at', '2026-08-08 04:00'], /give ONE window shape/],
    [[], /no window given and no terminal/],
    [['--from', '2026-08-08 06:00', '--to', '2026-08-08 02:00'], /--to must be later than --from/],
    [['--from', '2026-08-08 06:00'], /--from and --to are given together/],
    [['--since', 'yesterday'], /--since takes a number followed by/],
    [['--at', 'not a time'], /could not read --at/],
  ];
  for (const [args, re] of cases) {
    const r = runRca(args);
    assert.equal(r.status, 2, `${args.join(' ') || '(no args)'} should exit 2, exited ${r.status}`);
    assert.match(r.out, re);
  }
});

test('rca: the README, the dry-run plan and the collector agree about the tiers', () => {
  // THE DEFECT THIS EXISTS FOR SHIPPED IN THIS PACK'S FIRST DRAFT. The header,
  // the dry-run plan and the README all described an ADR incident tier via
  // adrci and a clusterware tier, and the collector had neither. A customer
  // reading --dry-run would have been told a tier would run that never ran.
  //
  // That is the same family as "every catalog blurb must be true the day a buy
  // button appears", one level down. Documentation is a claim; a claim needs a
  // guard, not a good intention.
  const pack = PACKS.find((p) => p.id === 'rca');
  const script = readFileSync(join(pack.dir, 'rca_generator.sh'), 'utf8');
  const readme = readFileSync(join(pack.dir, 'README.md'), 'utf8');

  // Ids the README's tier table promises, read out of the table itself.
  const promised = [...readme.matchAll(/^\|[^|]+\|\s*`([A-Z_]+)`\s*\|/gm)].map((m) => m[1]);
  assert.ok(promised.length >= 5, `only ${promised.length} tier ids found in the README table`);

  // Ids the collector can actually emit.
  const emitted = new Set([...script.matchAll(/emit "CHK\|([A-Z_]+)\|/g)].map((m) => m[1]));
  assert.ok(emitted.size > 0, 'no CHK ids found in the collector, so this guard is asleep');

  const missing = promised.filter((id) => !emitted.has(id));
  assert.deepEqual(missing, [], `the README promises tiers the collector never emits: ${missing.join(', ')}`);

  // And the reverse: nothing the collector emits as a TIER may be undocumented.
  // Scoped to the tier table's ids rather than every check, because identity
  // and scope checks are not tiers.
  for (const id of ['ALERT', 'ADRINC', 'AWR', 'LSNR', 'OSTIER']) {
    assert.ok(emitted.has(id), `the collector cannot emit ${id}, which the README documents`);
    assert.ok(readme.includes(`\`${id}\``), `${id} is emitted but absent from the README tier table`);
  }

  // The clusterware claim was removed rather than left to rot. If somebody
  // reinstates SSH fan-out they must reinstate the words too, deliberately.
  assert.ok(
    !/clusterware/i.test(script),
    'the collector mentions clusterware again. Either it collects it, or the claim goes.',
  );
});

test('rca: the report states which NODE it describes', () => {
  // On RAC an incident that evicted a different node leaves its evidence on
  // that node. A single-node picture mistaken for a cluster-wide one is the
  // same failure the Health Check pack already fixed with its cluster scope.
  const r = renderRca();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const scope = doc.checks.find((c) => c.id === 'NODESCOPE');
  assert.ok(scope, 'the briefing carries no NODESCOPE check');
  assert.match(scope.detail, /LOCAL TO THIS NODE/);
  assert.match(scope.detail, /each node/i);
});

test('rca: the appendix is listed rather than embedded', () => {
  const r = renderRca();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  assert.equal(doc.incident.appendix.length, 2);
  assert.equal(doc.incident.appendix[0].name, 'alertlog_window.txt');
  assert.equal(doc.incident.appendix[0].bytes, 18422);
});

function renderEnvCollector() {
  const pack = PACKS.find((p) => p.id === 'daily-ops');
  const out = mkdtempSync(join(tmpdir(), 'odc-env-'));
  for (const f of readdirSync(join(pack.dir, 'test-fixtures/env-setup'))) {
    writeFileSync(join(out, f), readFileSync(join(pack.dir, 'test-fixtures/env-setup', f)));
  }
  try {
    execFileSync('bash', [
      join(pack.dir, 'env_collector.sh'), '--render-only', out,
      '--primary-home', '/u01/app/oracle/product/19c/dbhome_1',
    ], { stdio: 'pipe' });
  } catch (err) {
    if (err.status !== 1 && err.status !== 2) throw err;
  }
  const json = readdirSync(out).find((f) => f.startsWith('env_briefing_') && f.endsWith('.json') && !f.includes('latest'));
  return { out, json, doc: json ? JSON.parse(readFileSync(join(out, json), 'utf8')) : null };
}

test('env_collector: runs to completion on bash 3.2', () => {
  // NOT a style test. v0.9 used `declare -A NODE_STATUS`, which `bash -n`
  // reports as perfectly fine and which then dies at RUNTIME on bash 3.2,
  // the default bash on macOS and still present on older database hosts.
  // Under `set -e` it aborted before a single node was probed. This test runs
  // the script through /bin/bash, which IS 3.2 here, so the whole suite is a
  // de facto compatibility gate rather than a parse check.
  const r = renderEnvCollector();
  assert.ok(r.json, 'env_collector produced no briefing, so it did not finish');
  assert.ok(r.doc.checks.length >= 3);
});

test('env_collector: a 2-node RAC with one unreachable node reports the gap, not silence', () => {
  const { doc } = renderEnvCollector();
  const topo = doc.checks.find((c) => c.id === 'TOPOLOGY');
  assert.match(topo.detail, /RAC/, 'two probe files must be read as a cluster');
  assert.equal(topo.metrics.node_count.value, 2);

  const down = doc.checks.find((c) => c.id === 'NODE_racnode2');
  // WARN not NA: the check WAS evaluated, and the answer is that a node of
  // this cluster went undescribed and no config was generated for it.
  assert.equal(down.status, 'WARN');
  assert.match(down.detail, /ssh keys/, 'an unreachable node must carry its remedy');
  assert.ok(doc.summary.needs_attention.includes('NODE_racnode2'));
  assert.equal(doc.summary.overall_status, 'WARN');
});

test('env_collector: --primary-home settles a multi-home host with nobody to ask', () => {
  // The fixture host carries a 19c and a 21c home. Under cron there is no TTY
  // and no one to interview, so the flag is the only shape that is both
  // unattended and deliberate.
  const { out, doc } = renderEnvCollector();
  const cfg = readFileSync(join(out, 'config-racnode1.env'), 'utf8');
  assert.match(cfg, /ORACLE_HOME="\/u01\/app\/oracle\/product\/19c\/dbhome_1"/);
  assert.match(cfg, /ORACLE_SID="PRODDB1"/);
  const node = doc.checks.find((c) => c.id === 'NODE_racnode1');
  assert.equal(node.metrics.oracle_home_count.value, 2);
  assert.equal(node.metrics.mem_total_kb.value, 263852032);
});

test('env_collector: the briefing validates against the shipped schema', () => {
  const pack = PACKS.find((p) => p.id === 'daily-ops');
  const schema = JSON.parse(readFileSync(join(pack.dir, 'schema/briefing.schema.json'), 'utf8'));
  const errors = validate(schema, renderEnvCollector().doc);
  assert.deepEqual(errors, [], `env briefing does not validate:\n${errors.join('\n')}`);
});

test('daily-ops: the briefing validates against the shipped schema', () => {
  const pack = PACKS.find((p) => p.id === 'daily-ops');
  const schema = JSON.parse(readFileSync(join(pack.dir, 'schema/briefing.schema.json'), 'utf8'));
  const r = renderDailyOps();
  const errors = validate(schema, JSON.parse(readFileSync(join(r.dir, r.json), 'utf8')));
  assert.deepEqual(errors, [], `briefing does not validate:\n${errors.join('\n')}`);
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

// ---------------------------------------------------------------------------
// awr_triage.sh - the last single-output script in the Health Check pack,
// converted to the dual-output contract.
//
// Driven through --render-only against a recorded collection, like every other
// collector here, so these exercise the REAL parse loop in the shipped script.
// ---------------------------------------------------------------------------

function renderAwrTriage() {
  const pack = PACKS.find((p) => p.id === 'healthcheck');
  const out = mkdtempSync(join(tmpdir(), 'odc-awr-'));
  // The config file is sourced AFTER the environment inside the script, so an
  // OUTPUT_DIR passed as an env var loses to the shipped config.env and the
  // run writes into the operator's real home directory. Pass a config, the
  // same way the daily-ops harness does.
  const cfg = join(out, 'config.env');
  writeFileSync(cfg, ['ORACLE_SID=FIXTURE', `OUTPUT_DIR=${out}`].join('\n'));
  const raw = join(pack.dir, 'test-fixtures/awr_raw_hostile.txt');
  const before = readFileSync(raw, 'utf8');
  try {
    execFileSync('bash', [
      join(pack.dir, 'awr_triage.sh'), '--config', cfg, '--render-only', raw,
    ], { stdio: 'pipe' });
  } catch (err) {
    if (err.status !== 1 && err.status !== 2) throw err;
  }
  const dir = join(out, 'reports');
  const files = existsSync(dir) ? readdirSync(dir) : [];
  return {
    dir,
    html: files.find((f) => f.endsWith('.html')),
    json: files.find((f) => f.endsWith('.json')),
    rawUnchanged: readFileSync(raw, 'utf8') === before,
  };
}

test('awr_triage: ONE collection produces BOTH the report and the briefing', () => {
  const r = renderAwrTriage();
  assert.ok(r.html, 'no HTML report was written');
  assert.ok(r.json, 'the HTML was written but the briefing was not, which is half a run');
  JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
});

test('awr_triage: --render-only leaves the collection it read exactly as it found it', () => {
  assert.ok(renderAwrTriage().rawUnchanged, '--render-only modified the raw collection it was given');
});

test('awr_triage: the briefing validates against the shipped schema', () => {
  const r = renderAwrTriage();
  const pack = PACKS.find((p) => p.id === 'healthcheck');
  const schema = JSON.parse(readFileSync(join(pack.dir, 'schema/briefing.schema.json'), 'utf8'));
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const errors = [];
  validate(schema, doc, '$', errors);
  assert.deepEqual(errors, [], `briefing does not validate: ${errors.join('; ')}`);
});

test('awr_triage: the briefing survives hostile collector output', () => {
  const r = renderAwrTriage();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const by = Object.fromEntries(doc.checks.map((c) => [c.id, c]));
  assert.match(by.awr_sql_2.detail, /D:\\odd\\name/, 'a Windows path did not survive JSON escaping');
  assert.match(by.awr_sql_1.detail, /\/\*\+ FULL \*\//, 'SQL text did not survive');
  // A German-locale session emits 87,3. It must become null rather than
  // invalidating the whole document, which is what an unquoted 87,3 would do.
  assert.equal(by.awr_eff_soft_parse.metrics['Soft Parse'].value, null,
    'a decimal comma must degrade to null, never corrupt the briefing');
});

test('awr_triage: metrics are keyed by check id, never by position', () => {
  const r = renderAwrTriage();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const by = Object.fromEntries(doc.checks.map((c) => [c.id, c]));
  // In the fixture every MET line sits AFTER every CHK line for its section,
  // so a parser that attached each metric to whichever check it saw last would
  // misfile all of them and this assertion is what catches it.
  assert.equal(by.awr_window.metrics.window_minutes.value, 240);
  assert.equal(by.awr_event_1.metrics.time_waited.value, 18422.7);
  assert.equal(by.awr_sql_1.metrics.elapsed.value, 9911.4);
});

test('awr_triage: the efficiency ratios carry NO pass or fail verdict', () => {
  // The product reports what the database recorded and never a verdict. The
  // prose version of this script has always told the reader to compare against
  // their OWN baseline, so emitting WARN at a fixed percentage would contradict
  // its own guidance in the same document.
  const r = renderAwrTriage();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const ratios = doc.checks.filter((c) => c.id.startsWith('awr_eff_'));
  assert.ok(ratios.length > 0, 'the fixture carries no efficiency ratios to check');
  for (const c of ratios) {
    assert.equal(c.status, 'NA', `${c.id} must not carry a verdict, got ${c.status}`);
  }
});

test('awr_triage: the report states the Diagnostics Pack requirement on its face', () => {
  // A report outlives the README it came with. The licence requirement has to
  // travel with the artefact, stated as a fact rather than as advice.
  const r = renderAwrTriage();
  const html = readFileSync(join(r.dir, r.html), 'utf8');
  assert.match(html, /Diagnostics Pack license/i);
});

// ---------------------------------------------------------------------------
// AUDIT AND GOVERNANCE: the pack whose entire design is "report what is, never
// what it means".
//
// Its guards are unlike the other packs' because its risk is unlike theirs. A
// tablespace at 96% is a threshold the customer configured, so calling it CRIT
// is arithmetic. There is no configured threshold for how many accounts should
// hold a privilege that reaches every schema, and inventing one would be this
// product issuing a judgement it has no standing to issue. So the guards below
// assert the ABSENCE of judgement: no status above OK about the database, an
// empty needs_attention, and a banned vocabulary that must not appear in the
// source or in the rendered output.
// ---------------------------------------------------------------------------

const AG = PACKS.find((p) => p.id === 'audit-governance');

function renderAuditGovernance() {
  const out = mkdtempSync(join(tmpdir(), 'odc-ag-'));
  const cfg = join(out, 'config.env');
  writeFileSync(
    cfg,
    [
      'ORACLE_SID=ORCLCDB',
      'ORACLE_HOME=/nonexistent',
      'ORACLE_CONNECT="/ as sysdba"',
      `OUTPUT_DIR=${out}`,
      'AUDIT_WINDOW_DAYS=30',
      'AUDIT_TOP_N=25',
    ].join('\n'),
  );
  const raw = join(AG.dir, 'test-fixtures/audit_raw_hostile.txt');
  const before = readFileSync(raw, 'utf8');
  try {
    execFileSync('bash', [
      join(AG.dir, 'audit_governance.sh'), '--config', cfg, '--render-only', raw,
    ], { stdio: 'pipe' });
  } catch (err) {
    if (err.status !== 1 && err.status !== 2) throw err;
  }
  const dir = join(out, 'audit');
  return {
    dir,
    html: readdirSync(dir).find((f) => f.endsWith('.html') && !f.includes('latest')),
    json: readdirSync(dir).find((f) => f.endsWith('.json') && !f.includes('latest')),
    rawUnchanged: readFileSync(raw, 'utf8') === before,
  };
}

test('audit-governance: ONE collection produces BOTH the report and the briefing', () => {
  const r = renderAuditGovernance();
  assert.ok(r.html, 'no HTML report was written');
  assert.ok(r.json, 'the HTML was written but the briefing was not, which is half a run');
  assert.ok(readFileSync(join(r.dir, r.html), 'utf8').includes('<!DOCTYPE html>'));
  JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
});

test('audit-governance: --render-only leaves the collection it read exactly as it found it', () => {
  assert.ok(renderAuditGovernance().rawUnchanged, '--render-only modified the raw collection it was given');
});

test('audit-governance: the briefing validates against the shipped schema', () => {
  const schema = JSON.parse(readFileSync(join(AG.dir, 'schema/briefing.schema.json'), 'utf8'));
  const r = renderAuditGovernance();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  assert.deepEqual(validate(schema, doc), []);
  assert.equal(doc.kind, 'state');
  assert.ok(!('incident' in doc), 'a state collector emitted an incident block');
});

test('audit-governance: the briefing survives hostile collector output', () => {
  const r = renderAuditGovernance();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const byId = (id) => doc.checks.find((c) => c.id === id);

  const link = byId('DBLINK_APP.WEIRD_LINK');
  assert.ok(link, 'the hostile link row is missing, so this guard proved nothing');
  assert.match(link.detail, /D:\\oracle\\network/, 'a Windows path did not survive JSON escaping');
  assert.match(link.detail, /"PROD_DW"/, 'a quoted name did not survive');
  assert.match(link.detail, /pipe \| inside/, 'a pipe inside a detail truncated the field');
  assert.match(byId('AUD_DEST').detail, /"audit_syslog_level"/, 'a quoted parameter name did not survive');

  // A German-locale session emits 13940,8. It must degrade to null rather than
  // taking the whole document down, and the original text stays in the detail.
  assert.equal(byId('HYG_RATE').metrics.records_per_day.value, null);
  assert.equal(byId('HYG_RATE').metrics.records_in_window.value, 418223);
  assert.match(byId('HYG_RATE').detail, /13940,8/);
});

test('audit-governance: metrics are keyed by check id, never by position', () => {
  // Every MET line in the fixture sits in a block AFTER every CHK line of its
  // section, and the sections interleave. A parser attaching each metric to
  // whichever check it saw last would misfile all of them.
  const r = renderAuditGovernance();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const byId = (id) => doc.checks.find((c) => c.id === id);
  assert.equal(byId('TRAILACT_LOGON').metrics.records.value, 291044);
  assert.equal(byId('TRAILACT_CREATE_TABLE').metrics.records.value, 37);
  assert.equal(byId('PRIV_PUBLIC_OBJ').metrics.grants_not_owned_by_sys.value, 241);
  assert.equal(byId('FEAT_PARTITIONING_USER').metrics.detected_usages.value, 14);
  assert.equal(byId('FEAT_REALTIME_SQL_MONITORING').metrics.detected_usages.value, 9);
  assert.equal(byId('PKG_UTL_TCP').metrics.public_execute_grants.value, 0);
});

test('audit-governance: NOTHING in the document is a verdict about the database', () => {
  // The signature of this pack's design, asserted as one shape: only OK and NA
  // ever appear on a check, needs_attention is empty, and the only reason the
  // summary rises above OK is that the COLLECTION was incomplete. If a future
  // change starts colouring an observation as a finding, this is what stops it.
  const r = renderAuditGovernance();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));

  const statuses = [...new Set(doc.checks.map((c) => c.status))].sort();
  assert.deepEqual(statuses, ['NA', 'OK'], `a check carries a verdict status: ${statuses.join(', ')}`);
  assert.equal(doc.summary.counts.WARN, 0);
  assert.equal(doc.summary.counts.CRIT, 0);
  assert.deepEqual(doc.summary.needs_attention, [], 'needs_attention must stay empty in this pack');

  // And the summary still tells the truth about the collection itself.
  assert.ok(doc.summary.counts.NA > 0, 'the fixture has no NA checks, so this guard is asleep');
  assert.equal(doc.summary.overall_status, 'WARN');
  assert.equal(doc.collection.collector_exit_code, 1, 'the summary and the exit code disagree');
});

// The vocabulary a verdict is written in. Scoped to THIS pack on purpose: the
// other three use one or two of these words in design commentary about their
// own behaviour ("the dangerous version of a health check is the one that..."),
// which is not a judgement about a customer's database. Here the subject matter
// makes every one of them a live hazard in customer-facing prose.
const VERDICT_WORDS = [
  /\bnon-?compliant\b/i, /\bcomplian(?:ce|t)\b/i, /\bout of compliance\b/i,
  /\bviolat(?:e|es|ed|ion|ions)\b/i,
  /\bPCI\b/, /\bSOX\b/, /\bHIPAA\b/, /\bGDPR\b/, /\bCIS\b/,
  /\binsecure\b/i, /\bvulnerabilit(?:y|ies)\b/i, /\bvulnerable\b/i,
  /\bunsafe\b/i, /\bdangerous\b/i, /\brisk(?:y|s)?\b/i, /\bweak(?:ness|nesses)?\b/i,
  /\byou should\b/i, /\byou must\b/i, /\bbest practice/i, /\bremediat/i,
  /\bunlicensed\b/i, /\bexcessive\b/i, /\bover-?privileged\b/i,
  /\bleast privilege\b/i, /\bharden(?:ing|ed)?\b/i,
];

test('audit-governance: no verdict vocabulary anywhere in the shipped pack', () => {
  // Asserted against the SOURCE, not only against one rendered fixture. The
  // fixture exercises the rows somebody chose to put in it; the source is every
  // row the pack can ever emit, and a sentence written into a .sql detail string
  // reaches every customer who runs it.
  const offenders = [];
  for (const rel of AG.shipped) {
    const src = readFileSync(join(AG.dir, rel), 'utf8');
    for (const re of VERDICT_WORDS) {
      const m = re.exec(src);
      if (m) offenders.push(`${rel}: ${m[0]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `this pack reports facts and never verdicts, including in its own prose:\n${offenders.join('\n')}`,
  );
});

test('audit-governance: no verdict vocabulary in either rendered output', () => {
  const r = renderAuditGovernance();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const prose = [
    readFileSync(join(r.dir, r.html), 'utf8'),
    ...doc.checks.flatMap((c) => [c.title, c.detail]),
  ].join('\n');
  for (const re of VERDICT_WORDS) {
    assert.ok(!re.test(prose), `the rendered report reads as a verdict: ${re}`);
  }
});

test('audit-governance: the option and feature section reports facts and refuses the conclusion', () => {
  // The section the founder's own registered scope singled out. Two things are
  // asserted: the usage FACTS are present and machine-readable, and the report
  // says in its own words that it draws no licence conclusion. The second has to
  // be in the artefact rather than in the README, because a report outlives the
  // README it shipped with.
  const r = renderAuditGovernance();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const html = readFileSync(join(r.dir, r.html), 'utf8');

  const feats = doc.checks.filter((c) => c.id.startsWith('FEAT_') && c.metrics.detected_usages);
  assert.ok(feats.length > 0, 'no feature usage rows in the fixture, so this guard is asleep');
  for (const c of feats) {
    assert.equal(c.status, 'OK', `${c.id} carries status ${c.status}; a usage fact is not a finding`);
    assert.equal(typeof c.metrics.detected_usages.value, 'number', `${c.id} carries no usage count`);
    assert.match(c.detail, /first recorded \d{4}-\d{2}-\d{2}/, `${c.id} does not carry the date the database recorded`);
  }

  const notice = doc.checks.find((c) => c.id === 'FEAT_NOTICE');
  assert.ok(notice, 'the section does not state what it is');
  assert.match(notice.detail, /reaches no conclusion about any licence/i);
  assert.match(html, /reaches no conclusion about any licence/i, 'the HTML report must carry the notice too');

  // The arithmetic trap the two counts invite, stated in the document.
  const naming = doc.checks.find((c) => c.id === 'FEAT_NAMING');
  assert.ok(naming, 'the document does not warn that the two counts cannot be subtracted');
  assert.match(naming.detail, /not a quantity that means anything/i);
});

test('audit-governance: a tier that could not run is NA and names what would make it run', () => {
  // A silently absent tier looks exactly like a tier that found nothing, and in
  // an access review those are opposite answers.
  const r = renderAuditGovernance();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const nas = doc.checks.filter((c) => c.status === 'NA');
  assert.ok(nas.length >= 2, `expected the fixture's unreadable tiers, got ${nas.length}`);
  for (const c of nas) {
    assert.match(
      c.detail,
      /\b(grant|role|SELECT on)\b/i,
      `${c.id} is NA without naming what would make it readable, which is just a shrug`,
    );
    assert.ok(!doc.summary.needs_attention.includes(c.id), `${c.id} is NA and must not be listed for attention`);
  }

  // And the report states its own incompleteness in words the document supports,
  // rather than leaving a reader to count NA rows by eye.
  const c = doc.summary.counts;
  const total = c.OK + c.WARN + c.CRIT + c.NA;
  assert.match(
    readFileSync(join(r.dir, r.html), 'utf8'),
    new RegExp(`${c.NA} of ${total} checks could not be read`),
    'the report does not state its own incompleteness',
  );
});

test('audit-governance: the report states its container scope and its window', () => {
  // An unstated scope is indistinguishable from a complete one: a clean access
  // review from a CDB root says nothing about the pluggable database the
  // accounts actually live in. Same family as tbs_manager's SCOPE and rca's
  // NODESCOPE.
  const r = renderAuditGovernance();
  const doc = JSON.parse(readFileSync(join(r.dir, r.json), 'utf8'));
  const html = readFileSync(join(r.dir, r.html), 'utf8');

  const scope = doc.checks.find((c) => c.id === 'SCOPE');
  assert.ok(scope, 'the briefing carries no SCOPE check');
  assert.match(scope.detail, /container/i);
  assert.match(html, /Report scope/, 'the HTML report does not show the scope section');

  // The window is bounded by config, carried in the data, and restated on the
  // report's face. A reader must never have to open config.env to know which
  // period they are looking at.
  const win = doc.checks.find((c) => c.id === 'WINDOW');
  assert.ok(win, 'the briefing carries no WINDOW check');
  assert.equal(win.metrics.window_days.value, 30);
  assert.equal(doc.thresholds.audit_window_days, 30);
  assert.match(win.detail, /AUDIT_WINDOW_DAYS/);
  assert.match(html, /last 30 days/);
});

// ---------------------------------------------------------------------------
// Structural guards over the pack's SQL. These read the source rather than one
// rendered fixture, because the fixture only ever exercises the rows somebody
// chose to write into it.
// ---------------------------------------------------------------------------

// Reads every ORDER BY clause and counts its TOP-LEVEL sort keys. Paren aware
// on purpose, and this is the second version: the first was a regex that
// stopped at the first ')', which truncated "COUNT(*) DESC, grantee" to
// "COUNT(*" and reported a tiebreaker that was there as missing, while counting
// the comma inside NVL(g.n, 0) as a tiebreaker that was not.
function orderByClauses(src) {
  const body = stripSqlComments(src);
  const out = [];
  const re = /\bORDER\s+BY\b/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    let depth = 0, keys = 1, text = '';
    for (let i = m.index + m[0].length; i < body.length; i++) {
      const c = body[i];
      if (c === "'") { const j = body.indexOf("'", i + 1); i = j === -1 ? body.length : j; continue; }
      if (c === '(') depth++;
      else if (c === ')') { if (depth === 0) break; depth--; }
      else if (c === ';' && depth === 0) break;
      else if (c === ',' && depth === 0) keys++;
      else if (depth === 0 && /[A-Za-z]/.test(c) && /^FETCH\b/i.test(body.slice(i))) break;
      text += c;
    }
    out.push({ keys, text: text.replace(/\s+/g, ' ').trim() });
  }
  return out;
}

test('audit-governance: every ranked query carries an explicit ORDER BY tiebreaker', () => {
  // Load bearing rather than tidiness. A check row and its metric rows are
  // SEPARATE executions of the same ranked query. With ties in the ranking
  // column and no tiebreaker, Oracle may return a different set of rows to
  // each, and the result is a measurement recorded against a check id that is
  // not in the document. The briefing stays valid JSON and still passes its
  // schema, which is exactly why it has to be caught here.
  const offenders = [];
  let total = 0;
  for (const rel of AG.shipped.filter((f) => f.endsWith('.sql'))) {
    for (const [i, c] of orderByClauses(readFileSync(join(AG.dir, rel), 'utf8')).entries()) {
      total++;
      if (c.keys < 2) offenders.push(`${rel} ORDER BY #${i + 1}: ${c.text}`);
    }
  }
  assert.ok(total > 20, `only ${total} ORDER BY clauses were parsed, so this guard is asleep`);
  assert.deepEqual(offenders, [], `single-key ORDER BY, so ties are resolved by the optimiser:\n${offenders.join('\n')}`);
});

test('audit-governance: the audit trail is only ever reached through dynamic SQL', () => {
  // UNIFIED_AUDIT_TRAIL needs AUDIT_VIEWER, which SELECT_CATALOG_ROLE does not
  // imply, so a STATIC reference fails when the statement is compiled and takes
  // the whole tier down over one view. Every read of it is a plain literal
  // inside EXECUTE IMMEDIATE, which the read-only gate can still read and pass.
  // Asserted structurally: a future edit that adds a static reference would run
  // fine on the author's SYS connection and fail on every customer without it.
  const spansOf = (body) => {
    const spans = [];
    const re = /\bEXECUTE\s+IMMEDIATE\b/gi;
    let m;
    while ((m = re.exec(body)) !== null) {
      const start = m.index + m[0].length;
      const lit = readSqlLiteral(body.slice(start));
      if (lit) spans.push([start, start + lit.length]);
    }
    return spans;
  };

  const offenders = [];
  let seen = 0;
  for (const rel of AG.shipped.filter((f) => f.endsWith('.sql'))) {
    const body = stripSqlComments(readFileSync(join(AG.dir, rel), 'utf8'));
    const spans = spansOf(body);
    for (const m of body.matchAll(/\b(?:unified_audit_trail|dba_audit_trail)\b/gi)) {
      seen++;
      if (!spans.some(([a, b]) => m.index >= a && m.index < b)) {
        offenders.push(`${rel}: static reference to ${m[0]}`);
      }
    }
  }
  assert.ok(seen > 4, `only ${seen} trail references were examined, so this guard is asleep`);
  assert.deepEqual(offenders, [], `a trail view is referenced statically:\n${offenders.join('\n')}`);
});

test('audit-governance: the README tier table and the collector agree', () => {
  // The defect this exists for shipped in the RCA pack's first draft: the
  // header, the dry-run plan and the README all described tiers the collector
  // did not have. Here the dry-run plan is PRINTED from the collector's tier
  // table so it cannot drift at all, and this closes the remaining gap between
  // that table and the README.
  const script = readFileSync(join(AG.dir, 'audit_governance.sh'), 'utf8');
  const readme = readFileSync(join(AG.dir, 'README.md'), 'utf8');

  const heredoc = /cat <<'TIERS'\n([\s\S]*?)\nTIERS\n/.exec(script);
  assert.ok(heredoc, 'could not find the tier table in audit_governance.sh');
  const collector = heredoc[1].split('\n').filter(Boolean).map((l) => {
    const [id, sql] = l.split('|');
    return { id, sql };
  });
  assert.equal(collector.length, 10, `expected ten tiers, the collector declares ${collector.length}`);

  const documented = [...readme.matchAll(/^\|[^|]+\|\s*`([A-Z_]+)`\s*\|\s*`sql\/([a-z_]+\.sql)`\s*\|/gm)]
    .map((m) => ({ id: m[1], sql: m[2] }));
  assert.ok(documented.length >= 10, `only ${documented.length} tier rows found in the README table`);

  assert.deepEqual(
    documented.map((t) => `${t.id}:${t.sql}`).sort(),
    collector.map((t) => `${t.id}:${t.sql}`).sort(),
    'the README tier table and the collector disagree about which tiers exist',
  );

  // And every tier's collector actually ships, so neither list can promise a
  // file that is not in the customer package.
  for (const t of collector) {
    assert.ok(AG.shipped.includes(`sql/${t.sql}`), `tier ${t.id} names sql/${t.sql}, which the pack does not ship`);
    assert.ok(AG.expects.includes(`sql/${t.sql}`), `sql/${t.sql} is not in the pack's expects list`);
  }
});

test('audit-governance: --dry-run prints every tier and promises nothing else', () => {
  const out = mkdtempSync(join(tmpdir(), 'odc-agdry-'));
  const cfg = join(out, 'config.env');
  writeFileSync(cfg, [
    'ORACLE_SID=ORCLCDB', 'ORACLE_HOME=/nonexistent', 'ORACLE_CONNECT="/ as sysdba"',
    `OUTPUT_DIR=${out}`, 'AUDIT_WINDOW_DAYS=45', 'AUDIT_TOP_N=25',
  ].join('\n'));
  const plan = execFileSync('bash', [
    join(AG.dir, 'audit_governance.sh'), '--config', cfg, '--dry-run',
  ], { encoding: 'utf8' });

  const heredoc = /cat <<'TIERS'\n([\s\S]*?)\nTIERS\n/.exec(readFileSync(join(AG.dir, 'audit_governance.sh'), 'utf8'));
  for (const line of heredoc[1].split('\n').filter(Boolean)) {
    const [id, sql] = line.split('|');
    assert.ok(plan.includes(id), `the dry-run plan does not name tier ${id}`);
    assert.ok(plan.includes(`sql/${sql}`), `the dry-run plan does not name sql/${sql}`);
  }
  assert.match(plan, /the last 45 days/, 'the plan must state the window it would use');
  assert.match(plan, /issue any statement that changes anything/);
  assert.match(plan, /draw a conclusion about any licence agreement/);
  rmSync(out, { recursive: true, force: true });
});

test('audit-governance: config.env carries every variable the collector refuses to run without', () => {
  // Same guard as daily-ops, for the same reason: the documented path is "copy
  // config.env and edit it", so a script that starts requiring a variable the
  // shipped config does not declare exits 2 on a customer's very first run.
  const declared = new Set(
    [...readFileSync(join(AG.dir, 'config.env'), 'utf8').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
  );
  const required = requiredConfigVars(readFileSync(join(AG.dir, 'audit_governance.sh'), 'utf8'));
  assert.ok(required.length > 0, 'no required config variables were parsed, so this guard is asleep');
  assert.ok(required.includes('AUDIT_WINDOW_DAYS'), 'the window must be a required variable, not an optional one');
  const missing = required.filter((v) => !declared.has(v)).sort();
  assert.deepEqual(missing, [], `config.env is missing ${missing.join(', ')}`);
});

test('audit-governance: the README says the pack has never run against a real database', () => {
  // The standing rule for this project: state what has NOT been proven rather
  // than implying coverage the work does not have. The field test is the
  // founder's gate and the README has to say so in its own words.
  const readme = readFileSync(join(AG.dir, 'README.md'), 'utf8');
  assert.match(readme, /has never run against a real Oracle database/i);
  assert.match(readme, /field test/i);
});

for (const pack of PACKS) {
  test(`${pack.id}: every shipped shell script parses`, () => {
    // NOT a formality. A `//` comment inside a shell script, or an unclosed
    // heredoc, produces a file that looks perfect and dies at the first line.
    // The healthcheck pack has had this guard since Phase 4; every pack needs
    // it, and the tier table in audit_governance.sh is a quoted heredoc, which
    // is exactly the construct that fails this way.
    const scripts = pack.shipped.filter((f) => f.endsWith('.sh'));
    assert.ok(scripts.length > 0, `${pack.id} ships no shell script, so this guard is asleep`);
    for (const rel of scripts) {
      execFileSync('bash', ['-n', join(pack.dir, rel)], { stdio: 'pipe' });
    }
  });
}

test('SELF-TEST: odc_br_document emits valid JSON when thresholds is omitted', () => {
  // REGRESSION GUARD. The default used to be written inline as ${8:-{\}},
  // which expands to the literal characters {\} and produced a briefing that
  // would not parse. Every collector shipped so far passed the argument, so
  // the broken default was never reached until awr_triage.sh omitted it.
  // A default nobody exercises is not a default, it is a trap for the next
  // caller, so it is exercised here on purpose.
  for (const pack of PACKS) {
    const lib = join(pack.dir, 'lib/odc_briefing.sh');
    const out = execFileSync('bash', ['-c',
      `. "${lib}"; odc_br_reset; odc_br_document p 1.0.0 s SID 2026-01-01T00:00:00Z OK 0`,
    ], { encoding: 'utf8' });
    const doc = JSON.parse(out); // throws if the default is broken again
    assert.deepEqual(doc.thresholds, {}, `${pack.id}: omitted thresholds must default to an empty object`);
  }
});
