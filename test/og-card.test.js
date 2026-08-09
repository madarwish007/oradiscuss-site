/* The social card must keep saying what the metadata beside it says.
 *
 * The card this replaces drifted for months: the PNG said "Oracle Mastery,
 * Distilled" with a chip list of blog topics and a retired credential, while
 * the og:title and og:description in the same HTML head said the current
 * thing. Both halves were individually correct. Nothing tested the join, which
 * is the exact shape of the producer-and-validator-live-in-different-files
 * defect, applied to an image instead of an enum.
 *
 * So the contract here is two-directional: the generator's copy must still be
 * a verbatim selection from the page that ships the metadata, AND the built
 * pages must point at the card the generator writes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { HEADLINE, SUB, TITLE_SOURCE, DESC_SOURCE, render } from '../scripts/brand/build-og-card.mjs';

const REPO = new URL('..', import.meta.url).pathname;
const DIST = join(REPO, 'dist');
const CARD = join(REPO, 'public', 'og-card.png');
const LEGACY = join(REPO, 'public', 'og-image.png');
const GEN = join(REPO, 'scripts', 'brand', 'build-og-card.mjs');

const EM_DASH = String.fromCharCode(0x2014);

const digest = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

test('the card copy is still a verbatim selection from the page that ships the metadata', () => {
  const index = readFileSync(join(REPO, 'src', 'pages', 'index.astro'), 'utf8');

  assert.ok(
    index.includes(TITLE_SOURCE),
    `src/pages/index.astro no longer passes the title this card was cut from.\n` +
      `  card expects: ${TITLE_SOURCE}\n` +
      `  If the positioning changed, run npm run build:og and update the generator, ` +
      `rather than letting the image and the meta tag disagree again.`
  );
  assert.ok(
    index.includes(DESC_SOURCE),
    'src/pages/index.astro no longer passes the description this card was cut from. ' +
      'Regenerate the card rather than leaving it stale.'
  );

  /* Selections, never rewrites. Compared case-insensitively on purpose: a
   * clause lifted out of a sentence gets its first letter capitalised, which is
   * typography rather than authoring. Every WORD must still be theirs, so
   * anything beyond a case change fails here. */
  assert.ok(
    TITLE_SOURCE.toLowerCase().includes(HEADLINE.toLowerCase()),
    `the card headline is not a clause of the real title, so it is authored copy now:\n` +
      `  headline: ${HEADLINE}\n  title:    ${TITLE_SOURCE}`
  );
  assert.ok(
    DESC_SOURCE.toLowerCase().includes(SUB.toLowerCase()),
    `the card sub-line is not a contiguous clause of the real description:\n` +
      `  sub:  ${SUB}\n  desc: ${DESC_SOURCE}`
  );
});

test('the card carries no credential, because that fact rots', () => {
  assert.ok(
    !/ACE (Apprentice|Associate|Pro|Director)/.test(HEADLINE + ' ' + SUB),
    'a credential level is in the card copy. It moved once already, on 1 June 2026, and a level ' +
      'baked into a PNG is how the last one stayed wrong for months. Keep it in HTML.'
  );
});

test('the house em-dash rule reaches the generator source too', () => {
  const src = readFileSync(GEN, 'utf8');
  assert.ok(!src.includes(EM_DASH), 'em dash in the card generator, comments included');
  assert.ok(!(HEADLINE + SUB).includes(EM_DASH), 'em dash in the card copy');
});

test('the card is exactly the size every social scraper expects', async () => {
  for (const f of [CARD, LEGACY]) {
    assert.ok(existsSync(f), `${f} is missing. Run npm run build:og`);
    const buf = readFileSync(f);
    /* PNG IHDR: width and height are big-endian uint32 at bytes 16 and 20. */
    assert.equal(buf.toString('ascii', 1, 4), 'PNG', `${f} is not a PNG`);
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    assert.equal(w, 1200, `${f} is ${w}px wide, expected 1200`);
    assert.equal(h, 630, `${f} is ${h}px tall, expected 630`);
  }
});

test('the old immutable URL serves the corrected card, byte for byte', () => {
  /* og-image.png is cached public, max-age=31536000, immutable and is already
   * scraped into other people's caches. We cannot purge those. What we CAN do
   * is make sure that whatever still resolves at the old path is the truth,
   * so the two files are required to be identical rather than merely both new.
   *
   * Compared by DIGEST, not with assert.deepEqual on the buffers. deepEqual on
   * two differing 60KB buffers tries to build an element-wise diff for the
   * failure message and the process is SIGKILLed at about 100 seconds, so the
   * guard would correctly detect the break and then report nothing at all.
   * Found by watching this exact test fail. */
  assert.equal(
    digest(CARD),
    digest(LEGACY),
    'public/og-image.png and public/og-card.png differ. The old path is immutable-cached and ' +
      'still referenced by already-scraped shares, so it must serve the same corrected card. ' +
      'Run npm run build:og, which writes both.'
  );
});

test('every built page points at the card, and the card is in the build', () => {
  assert.ok(existsSync(join(DIST, 'og-card.png')), 'og-card.png was not built into dist/');

  const pages = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.html')) pages.push(full);
    }
  };
  walk(DIST);
  assert.ok(pages.length >= 90, `only ${pages.length} built pages, so this guard is nearly asleep`);

  const stale = [];
  let pointing = 0;
  for (const p of pages) {
    const html = readFileSync(p, 'utf8');
    const m = html.match(/property="og:image" content="([^"]+)"/);
    if (!m) continue;
    if (m[1].includes('/og-image.png')) stale.push(`${p.slice(DIST.length + 1)} -> ${m[1]}`);
    if (m[1].includes('/og-card.png')) pointing += 1;
  }
  assert.ok(pointing > 0, 'no built page points at /og-card.png, so this guard matched nothing');
  assert.equal(
    stale.length,
    0,
    `${stale.length} page(s) still declare the old card path:\n  ` + stale.slice(0, 5).join('\n  ')
  );
});

test('the webfont proof still exists in the generator', () => {
  /* The proof itself is a double render, which needs two headless Chromes.
   * Running that in the default suite made this file SIGKILL at 105 seconds on
   * a loaded machine, so it lives in build-og-card.mjs and runs at generation
   * time, which is the moment it protects. Being honest about that: THIS test
   * does not prove the font loaded. It proves the thing that does prove it has
   * not been deleted, and the expensive version is available on demand below.
   */
  const src = readFileSync(GEN, 'utf8');
  assert.ok(
    /export async function proveWebfontLoaded/.test(src),
    'proveWebfontLoaded is gone from the generator, so nothing checks that Sora loaded any more'
  );
  assert.ok(
    /generic: true/.test(src) && /a\.equals\(b\)/.test(src),
    'the generator no longer renders a generic-font comparison, so its webfont proof is now an ' +
      'assertion about nothing'
  );
  assert.ok(
    /throw new Error/.test(src),
    'the webfont proof no longer throws, so a fallback-face card would ship with a warning nobody reads'
  );
});

/* The real thing, on demand: OG_CARD_RENDER=1 npm test
 * Kept out of the default run for the reason above, kept in the file so it is
 * one environment variable away rather than a paragraph somebody has to act on. */
test(
  'the card is reproducible from its generator',
  { skip: process.env.OG_CARD_RENDER ? false : 'set OG_CARD_RENDER=1 to run the two-Chrome render' },
  async () => {
    const work = mkdtempSync(join(tmpdir(), 'og-font-'));
    try {
      const real = join(work, 'real.png');
      await render({ out: real });
      assert.equal(
        createHash('sha256').update(readFileSync(real)).digest('hex'),
        digest(CARD),
        'regenerating the card does not reproduce the committed bytes. Either the generator changed ' +
          'without a rebuild, or the committed card was not produced by it.'
      );
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
);
