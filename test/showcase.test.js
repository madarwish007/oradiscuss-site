// GUARDS over Showcase/, the assets that go on a sales page.
//
// Three things can go wrong with a showcase asset, and all three are silent:
//
//   1. THE REGISTRY DRIFTS. A file appears in Showcase/samples/ that no
//      manifest names, or the manifest names one that no longer exists. This
//      repository has twice shipped a fan-out step that named its inputs and
//      silently dropped the one added afterwards, so the registry is checked
//      against the DIRECTORY in both directions, never trusted as a list.
//   2. THE PROVENANCE SOFTENS. The Health Check pack has never been run
//      against a real Oracle database. Every asset must say so, and the
//      sentence is asserted verbatim rather than approximately.
//   3. SOMETHING REAL LEAKS IN. The sanitization checks are POSITIVE
//      signatures: the allowed SIDs, the allowed host names, the documentation
//      IP ranges. A denylist of real identifiers checked into a repository is
//      itself the leak it claims to prevent, so there is not one here.
//   4. A DROPPED COLOUR STAYS IN THE PIXELS. Oracle red #C74634 is dropped
//      entirely, a closed founder decision. A stylesheet can be corrected
//      while a red PNG sits on disk, so the frame chrome is measured in the
//      DELIVERED IMAGE, not in the CSS that produced it.
//
// SHOWCASE_DIR and SHOWCASE_SCRIPTS point the suite at a deliberately broken
// copy. That is the only way to know a guard is a guard:
//
//   cp -R Showcase /tmp/broken && rm /tmp/broken/samples/healthcheck/run.log
//   SHOWCASE_DIR=/tmp/broken node --test test/showcase.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, extname } from 'node:path';

const REPO = new URL('..', import.meta.url).pathname;
const SHOWCASE = process.env.SHOWCASE_DIR || join(REPO, 'Showcase');
const SCRIPTS = process.env.SHOWCASE_SCRIPTS || join(REPO, 'scripts', 'showcase');
const SAMPLES = join(SHOWCASE, 'samples');
const STANDARDS_PATH = join(SHOWCASE, 'STANDARDS.md');
const MANIFEST_PATH = join(SHOWCASE, 'MANIFEST.json');

// ---------------------------------------------------------------------------
// THE STANDARD, restated here on purpose.
//
// These numbers also live in Showcase/STANDARDS.md and in scripts/showcase/
// build.mjs. Three copies is deliberate: the test asserts all three agree, so
// changing the standard in one place fails the build instead of leaving two
// documents quietly disagreeing about what the standard is.
// ---------------------------------------------------------------------------
const STD = {
  dsf: 2,
  canvasCssWidth: 1280,
  framePadCss: 64,
  shotCssWidth: 1152,
  tileMaxCss: 2400,
  deviceWidth: 2560, // canvasCssWidth * dsf, and every shipped PNG must be this
};

const PROVENANCE =
  'Sample rendered from a synthetic lab collection. Not output from a real Oracle database.';

// Sanitization, as positive signatures.
const ALLOWED_SIDS = ['ODCDEMO', 'ODCDEMO1', 'ODCDEMO2'];
// EXACT tokens, never a pattern. A pattern absorbs the next host somebody adds.
const ALLOWED_HOST_SHAPED_TOKENS = [
  'badge.crit', 'badge.na', 'badge.ok', 'badge.warn',   // CSS selectors in the report
  'collection.txt', 'config.env', 'health_check.sh', 'health_check.sql',
  'render-sample.sh',
  'dbnode1.odclab.example',                              // the only host name
  'odcdemo1_ora_48211.trc',                              // the only trace file
  'oradiscuss.com',                                      // our own domain
];
// RFC 5737 documentation ranges. Routable nowhere.
const DOC_IP_PREFIXES = ['192.0.2.', '198.51.100.', '203.0.113.'];

const TEXT_EXT = new Set(['.html', '.json', '.txt', '.log', '.md', '.env', '.sh', '.mjs', '.py', '.css', '.js']);
// Written as an escape, never as the character. The house rule is no em dashes
// anywhere, and a guard that has to contain one to look for one would be the
// only file in the repository breaking the rule it enforces.
const EM_DASH = '\u2014';

function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

const isText = (rel) => TEXT_EXT.has(extname(rel)) || !extname(rel);

function pngSize(path) {
  const buf = readFileSync(path);
  assert.equal(buf.readUInt32BE(0), 0x89504e47, `${path} is not a PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// Every read of the manifest goes through here so a missing or malformed
// manifest fails as ONE clear failure rather than as fifteen confusing ones.
function manifest() {
  assert.ok(existsSync(MANIFEST_PATH), `no manifest at ${MANIFEST_PATH}. Run npm run build:showcase.`);
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

// A manifest path is repo relative. Under SHOWCASE_DIR it has to be resolved
// against the copy under test, so everything is keyed on the tail.
const tail = (p) => {
  const at = p.indexOf('samples/');
  assert.notEqual(at, -1, `manifest path is not under samples/: ${p}`);
  return p.slice(at + 'samples/'.length);
};

// ===========================================================================
// 1. THE REGISTRY, CHECKED AGAINST THE DIRECTORY IN BOTH DIRECTIONS
// ===========================================================================
test('every file in Showcase/samples is registered in the manifest', () => {
  const declared = new Set(manifest().assets.map((a) => tail(a.path)));
  const onDisk = walk(SAMPLES);
  const unregistered = onDisk.filter((p) => !declared.has(p));
  assert.deepEqual(
    unregistered, [],
    'these files exist under Showcase/samples/ and no manifest entry names them. '
    + 'A file nobody registered is a file nobody captions, and the caption is where the '
    + 'provenance lives. Re-run npm run build:showcase.',
  );
});

test('every manifest entry exists on disk with the recorded size', () => {
  const onDisk = new Set(walk(SAMPLES));
  for (const a of manifest().assets) {
    const rel = tail(a.path);
    assert.ok(onDisk.has(rel), `manifest names ${a.path} and it is not on disk`);
    assert.equal(
      statSync(join(SAMPLES, rel)).size, a.bytes,
      `${a.path}: the manifest records ${a.bytes} bytes and the file is a different size. `
      + 'Something regenerated the asset without regenerating the manifest.',
    );
  }
});

test('the samples directory is not empty and every entry is fully described', () => {
  const m = manifest();
  assert.ok(m.assets.length >= 5, 'a showcase with almost nothing in it is a build that half ran');
  for (const a of m.assets) {
    for (const field of ['path', 'kind', 'pack', 'bytes', 'produced_by', 'provenance', 'caption']) {
      assert.ok(a[field] !== undefined && a[field] !== '', `${a.path}: manifest entry has no ${field}`);
    }
  }
});

// ===========================================================================
// 2. THE PROVENANCE SENTENCE
// ===========================================================================
test('the provenance sentence is verbatim in STANDARDS.md', () => {
  assert.ok(
    readFileSync(STANDARDS_PATH, 'utf8').includes(PROVENANCE),
    `Showcase/STANDARDS.md no longer carries the provenance sentence verbatim:\n  ${PROVENANCE}`,
  );
});

test('the provenance sentence is verbatim on every manifest entry', () => {
  const m = manifest();
  assert.equal(m.provenance, PROVENANCE, 'the manifest header provenance was changed');
  const wrong = m.assets.filter((a) => a.provenance !== PROVENANCE).map((a) => a.path);
  assert.deepEqual(wrong, [], 'these assets carry a different provenance line than the standard');
});

test('the manifest still says the pack has not been run against a real database', () => {
  const m = manifest();
  assert.match(
    m.field_test_status,
    /has not been run against a real Oracle database/,
    'field_test_status no longer states that the pack is untested against a real database. '
    + 'If the founder field test HAS happened, that is a deliberate three place edit, '
    + 'described in section 7 of Showcase/STANDARDS.md, not a quiet string change.',
  );
});

test('the frame template still burns the provenance into the pixels', () => {
  const frame = join(SCRIPTS, 'templates', 'frame.html');
  assert.ok(existsSync(frame), `no frame template at ${frame}`);
  const src = readFileSync(frame, 'utf8');
  assert.ok(src.includes('{{PROVENANCE}}'), 'the frame template no longer renders the provenance line');
  const build = readFileSync(join(SCRIPTS, 'build.mjs'), 'utf8');
  assert.ok(build.includes(PROVENANCE), 'the PROVENANCE constant in build.mjs was changed');
  for (const a of manifest().assets.filter((x) => x.kind === 'image')) {
    assert.equal(a.caption_burned_in, true, `${a.path}: an image without a burned in caption`);
  }
});

// ===========================================================================
// 3. NO EM DASH, ANYWHERE
// ===========================================================================
test('no em dash in any showcase text asset', () => {
  const offenders = walk(SAMPLES)
    .filter(isText)
    .filter((rel) => readFileSync(join(SAMPLES, rel), 'utf8').includes(EM_DASH));
  assert.deepEqual(offenders, [], 'house rule: no em dashes. Found in these shipped assets');
});

test('no em dash in STANDARDS.md, the manifest, or any caption', () => {
  assert.ok(!readFileSync(STANDARDS_PATH, 'utf8').includes(EM_DASH), 'em dash in Showcase/STANDARDS.md');
  assert.ok(!readFileSync(MANIFEST_PATH, 'utf8').includes(EM_DASH), 'em dash in Showcase/MANIFEST.json');
  const bad = manifest().assets
    .filter((a) => `${a.caption} ${a.provenance}`.includes(EM_DASH))
    .map((a) => a.path);
  assert.deepEqual(bad, [], 'em dash in a caption');
});

test('no em dash in the showcase rig or its templates', () => {
  const offenders = walk(SCRIPTS)
    .filter(isText)
    .filter((rel) => readFileSync(join(SCRIPTS, rel), 'utf8').includes(EM_DASH));
  assert.deepEqual(
    offenders, [],
    'house rule: no em dashes, and it covers CSS and JS comments too. A comment inside an '
    + 'inlined style block renders into the page HTML.',
  );
});

// ===========================================================================
// 4. THE CAPTURE STANDARD
// ===========================================================================
test('the manifest capture settings match the standard', () => {
  const c = manifest().capture;
  assert.equal(c.device_scale_factor, STD.dsf);
  assert.equal(c.canvas_css_width, STD.canvasCssWidth);
  assert.equal(c.frame_padding_css, STD.framePadCss);
  assert.equal(c.shot_css_width, STD.shotCssWidth);
  assert.equal(c.tile_max_css, STD.tileMaxCss);
  assert.equal(
    c.canvas_css_width, c.shot_css_width + 2 * c.frame_padding_css,
    'the frame no longer closes: canvas width must be the shot width plus both paddings',
  );
});

test('STANDARDS.md states the same numbers the build used', () => {
  const doc = readFileSync(STANDARDS_PATH, 'utf8');
  for (const row of [
    '| Device scale factor | **2** |',
    '| Screenshot viewport width | **1152 CSS px** |',
    '| Frame canvas width | **1280 CSS px** |',
    '| Frame padding | **64 CSS px** on all four sides |',
    '| Tile limit | **2400 CSS px** viewport |',
  ]) {
    assert.ok(doc.includes(row), `Showcase/STANDARDS.md no longer states: ${row}`);
  }
});

test('every shipped image is 2560 device px wide, even in both axes, and matches the manifest', () => {
  for (const a of manifest().assets.filter((x) => x.kind === 'image')) {
    const path = join(SAMPLES, tail(a.path));
    const size = pngSize(path);
    assert.equal(size.width, a.width, `${a.path}: width on disk differs from the manifest`);
    assert.equal(size.height, a.height, `${a.path}: height on disk differs from the manifest`);
    assert.equal(a.dsf, STD.dsf, `${a.path}: not captured at device scale factor ${STD.dsf}`);
    assert.equal(
      size.width, STD.deviceWidth,
      `${a.path}: every showcase image is captured on the same ${STD.canvasCssWidth} CSS px canvas at `
      + `${STD.dsf}x, so it must be exactly ${STD.deviceWidth} device px wide`,
    );
    assert.equal(size.width % 2, 0, `${a.path}: odd width`);
    assert.equal(size.height % 2, 0, `${a.path}: odd height, which H.264 refuses`);
  }
});

test('a video is only registered when it was actually encoded', () => {
  const m = manifest();
  const videos = m.assets.filter((a) => a.kind === 'video');
  if (!m.capture.video_encoded) {
    assert.deepEqual(
      videos.map((v) => v.path), [],
      'the manifest registers a video while recording that the encode did not run. '
      + 'An unencoded video is reported, never listed.',
    );
    return;
  }
  assert.ok(videos.length >= 1, 'video_encoded is true and no video is registered');
  for (const v of videos) {
    assert.equal(v.width % 2, 0, `${v.path}: odd width, which H.264 refuses`);
    assert.equal(v.height % 2, 0, `${v.path}: odd height, which H.264 refuses`);
    assert.ok(v.bytes > 50000, `${v.path}: ${v.bytes} bytes is too small to be a real encode`);
  }
});

// ===========================================================================
// 5. THE FRAME CHROME, MEASURED IN THE PIXELS
//
// Oracle red #C74634 is dropped entirely. CLOSED founder decision, re-confirmed
// 8 Aug 2026: PRODUCT.md names Oracle's own marketing as an anti-reference and
// the Terms disclaim affiliation. DESIGN.md still carries the old red and is
// stale against that decision, which is exactly how the red reached shipped
// PNGs once already.
//
// The pixel check is the one that matters, because a corrected template does
// not un-render an asset. The source check beside it is not redundant: the
// terminal frames the video is cut from never become a framed PNG, so the
// template is the only place that dot can be caught.
// ===========================================================================
test('no Oracle red in the chrome of any shipped showcase image', () => {
  const script = join(SCRIPTS, 'check-chrome-colour.py');
  assert.ok(existsSync(script), `no chrome colour guard at ${script}`);
  const images = manifest().assets
    .filter((a) => a.kind === 'image')
    .map((a) => join(SAMPLES, tail(a.path)));
  assert.ok(images.length >= 1, 'no shipped image to check, so this guard is measuring nothing');
  const r = spawnSync('python3', [script, ...images], { encoding: 'utf8' });
  assert.equal(
    r.status, 0,
    'the frame chrome of a shipped image carries a dropped colour, or the guard could not '
    + `locate the chrome bands to measure them.\n${r.stderr || ''}${r.stdout || ''}`,
  );
});

test('no showcase template carries the dropped Oracle red', () => {
  const dir = join(SCRIPTS, 'templates');
  assert.ok(existsSync(dir), `no templates directory at ${dir}`);
  const files = readdirSync(dir).sort();
  assert.ok(files.length >= 1, 'no templates found, so this guard is measuring nothing');
  const offenders = files.filter((f) => /#c74634/i.test(readFileSync(join(dir, f), 'utf8')));
  assert.deepEqual(
    offenders, [],
    'Oracle red is dropped entirely and that is a closed founder decision, re-confirmed '
    + '8 Aug 2026. The showcase accent is #8A4B12. Do not re-derive it from DESIGN.md, which '
    + 'is stale against that decision: see section 4 of Showcase/STANDARDS.md.',
  );
});

// ===========================================================================
// 6. SANITIZATION, AS POSITIVE SIGNATURES
// ===========================================================================
function sampleTextFiles() {
  const files = walk(SAMPLES).filter(isText).map((rel) => [`samples/${rel}`, join(SAMPLES, rel)]);
  const labDir = join(SCRIPTS, 'lab');
  for (const rel of walk(labDir).filter(isText)) files.push([`lab/${rel}`, join(labDir, rel)]);
  return files;
}

test('the only Oracle SID anywhere in the samples is the declared fictional one', () => {
  const found = new Set();
  for (const [, path] of sampleTextFiles()) {
    for (const m of readFileSync(path, 'utf8').matchAll(/\bODC[A-Z][A-Z0-9]*\b/g)) found.add(m[0]);
  }
  assert.ok(found.size > 0, 'no SID found at all, which means this check is measuring nothing');
  const strays = [...found].filter((s) => !ALLOWED_SIDS.includes(s));
  assert.deepEqual(strays, [], `only ${ALLOWED_SIDS.join(', ')} may appear as a SID`);
});

test('every host shaped token in the samples is on the declared allowlist', () => {
  // A token whose FIRST label is all digits is not a host name, it is a
  // timestamp in a generated filename, so it is not considered here.
  const pattern = /\b[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)*\.[a-z]{2,}\b/g;
  const offenders = [];
  for (const [label, path] of sampleTextFiles()) {
    for (const m of readFileSync(path, 'utf8').matchAll(pattern)) {
      if (!ALLOWED_HOST_SHAPED_TOKENS.includes(m[0])) offenders.push(`${label}: ${m[0]}`);
    }
  }
  assert.deepEqual(
    [...new Set(offenders)], [],
    'an identifier appeared that the standard does not allow. Host names must end .odclab.example. '
    + 'If this is a real collection, it has to be sanitized BEFORE it is rendered: see section 7 '
    + 'of Showcase/STANDARDS.md.',
  );
});

test('every IPv4 literal in the samples is in a documentation range', () => {
  // Anchored so an Oracle version like 19.26.0.0.0 is not read as an address.
  const pattern = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/g;
  const offenders = [];
  for (const [label, path] of sampleTextFiles()) {
    for (const m of readFileSync(path, 'utf8').matchAll(pattern)) {
      if (!DOC_IP_PREFIXES.some((p) => m[0].startsWith(p))) offenders.push(`${label}: ${m[0]}`);
    }
  }
  assert.deepEqual(
    [...new Set(offenders)], [],
    `only the RFC 5737 documentation ranges may appear: ${DOC_IP_PREFIXES.join(', ')}`,
  );
});

test('the lab collection declares itself synthetic on its own face', () => {
  const collection = join(SCRIPTS, 'lab', 'healthcheck', 'collection.txt');
  assert.ok(existsSync(collection), `no lab collection at ${collection}`);
  const src = readFileSync(collection, 'utf8');
  assert.match(src, /SYNTHETIC LAB COLLECTION\. NOT A REAL DATABASE\./,
    'the lab collection no longer says what it is in its own header');
  assert.match(src, /never been run against a real Oracle database/,
    'the lab collection no longer records that the pack is untested against a real database');
});

test('every synthetic input is declared in the manifest and exists', () => {
  const inputs = manifest().synthetic_inputs;
  assert.ok(Array.isArray(inputs) && inputs.length >= 3, 'the manifest declares no synthetic inputs');
  for (const i of inputs) {
    assert.ok(i.why && i.why.length > 20, `${i.path}: a synthetic input with no explanation`);
    assert.ok(existsSync(join(REPO, i.path)), `${i.path}: declared as a synthetic input and not on disk`);
  }
});

// ===========================================================================
// 7. THE SAMPLES ARE THE PACK'S OWN OUTPUT, NOT A RETOUCHED COPY
// ===========================================================================
test('the shipped report is the pack template, unedited', () => {
  const html = readFileSync(join(SAMPLES, 'healthcheck', 'report.html'), 'utf8');
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /OraDiscuss Health Check Pack v/);
  assert.match(html, /Field-test release - validate in non-production first\./,
    'the report footer no longer carries the field-test warning the pack writes');
  const doc = JSON.parse(readFileSync(join(SAMPLES, 'healthcheck', 'briefing.json'), 'utf8'));
  assert.equal(doc.collection.read_only, true, 'the briefing no longer states the collection was read only');
  assert.ok(ALLOWED_SIDS.includes(doc.collection.oracle_sid));
});
