// ===========================================================================
// GUARDS over the brand mark: the two SVGs, the contact sheet, and the wiring
// that puts the mark on the site.
//
// The failure this file exists to make impossible is the one that was live
// when it was written: public/logo.svg was a rounded square in Oracle red,
// dated 17 April, and it was painted onto the header and the footer of every
// page by one line of CSS that nobody had read. Red is a CLOSED founder
// decision, dropped entirely and re-confirmed 8 Aug 2026, and the site was
// serving it anyway.
//
// FOUR THINGS ARE CHECKED, AND THREE OF THEM READ THE DELIVERED ARTEFACT
// RATHER THAN THE SOURCE THAT CLAIMS TO PRODUCE IT:
//
//   1. No Oracle red family pixel in a delivered brand asset. Measured in a
//      HUE BAND in the PIXELS, by scripts/brand/check-brand-red.py, never as a
//      hex match: #C84739 would pass a hex search and look identical.
//   2. The mark files carry no raster and no external font reference. An SVG
//      that depends on a webfont renders differently on every machine.
//   3. Every built page that HAS a header renders the mark. Pages are
//      DISCOVERED from dist/, never hand named: this repository has hit the
//      fan-out-by-name trap four times, and each time the guard was green
//      because it was looking at a list rather than at the site.
//   4. The size reduction was really applied. logo.svg carries three arcs and
//      favicon.svg carries two, with the surviving seam thicker, on the same
//      body and the same tail. Asserted from the geometry, not from the names.
//
// To watch these fire, point them at deliberately broken input:
//   DIST_DIR=/tmp/broken node --test test/brand.test.js
//   BRAND_PUBLIC=/tmp/broken-public node --test test/brand.test.js
// ===========================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { GEOMETRY, FILES, INK, SIGNAL } from '../scripts/brand/build-logo.mjs';

const REPO = new URL('..', import.meta.url).pathname;
const DIST = process.env.DIST_DIR ?? join(REPO, 'dist');
const PUBLIC = process.env.BRAND_PUBLIC ?? join(REPO, 'public');
const BRAND_DIR = process.env.BRAND_SHOWCASE ?? join(REPO, 'Showcase', 'brand');
const SCRIPTS = join(REPO, 'scripts', 'brand');

const FULL_MARK = 'logo.svg';
const SMALL_MARK = 'favicon.svg';
const CONTACT_SHEET = join(BRAND_DIR, 'logo-contact-sheet.png');
// Built from its code point, not written out, because this file is inside the
// set the em dash guard below walks and a literal here would fail it. That is
// the guard working, and it is how it was first watched firing.
const EM_DASH = String.fromCharCode(0x2014);

// The house capture standard: device scale factor 2 on a 1280 CSS canvas.
const SHEET_DEVICE_WIDTH = 2560;

// ---------------------------------------------------------------------------
// THE KNOWN RED ASSET, PINNED RATHER THAN EXCLUDED.
//
// public/og-image.png is the social card. It is 1200x630 of the OLD brand: the
// red "Od" square, Oracle red furniture, and the RETIRED "ACE Apprentice"
// credential which the record already calls a live credibility defect. It is
// not converted here because redrawing it means re-deciding the headline and
// the credential line, which is copy and not a logo.
//
// It is PINNED, not skipped. The count below is measured, so:
//   * a new red brand asset cannot appear and hide inside an exclusion,
//   * this one cannot quietly get redder,
//   * and fixing it FAILS this test, which is the only way a follow-up in a
//     list somebody has to remember ever actually gets closed.
// ---------------------------------------------------------------------------
const KNOWN_RED = {
  'og-image.png': {
    redFamilyPixels: 120419,
    why: 'the pre-Phase-2b social card: Oracle red furniture, the old Od square, and the '
      + 'retired ACE Apprentice credential. Redrawing it is a copy decision, not a logo one.',
  },
};

function runChecker(paths) {
  const script = join(SCRIPTS, 'check-brand-red.py');
  assert.ok(existsSync(script), `no brand colour guard at ${script}`);
  const r = spawnSync('python3', [script, ...paths], { encoding: 'utf8' });
  let report = null;
  try { report = JSON.parse(r.stdout); } catch { /* reported below */ }
  return { ...r, report };
}

function allBuiltPages() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.html')) out.push(relative(DIST, full));
    }
  };
  if (existsSync(DIST)) walk(DIST);
  return out.sort();
}

// Everything that styles a page: inline <style> blocks plus every local
// stylesheet it links. Astro puts shared CSS in a hashed bundle, so a check
// that reads only the page file sees almost none of the real rules.
function allCss(html) {
  const parts = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  for (const m of html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/g)) {
    const href = /href=["']([^"']+)["']/.exec(m[0])?.[1];
    if (!href || !href.startsWith('/')) continue;
    const path = join(DIST, href);
    if (existsSync(path)) parts.push(readFileSync(path, 'utf8'));
  }
  return parts.join('\n');
}

const ALL_PAGES = allBuiltPages();
const PAGES_WITH_HEADER = ALL_PAGES.filter((p) => readFileSync(join(DIST, p), 'utf8').includes('<header'));

// ===========================================================================
// 1. COLOUR, MEASURED IN THE PIXELS
// ===========================================================================
test('no Oracle red family pixel in a delivered brand asset', () => {
  assert.ok(existsSync(CONTACT_SHEET), `no contact sheet at ${CONTACT_SHEET}. Run npm run build:brand.`);
  const r = runChecker([CONTACT_SHEET]);
  assert.notEqual(r.report, null, `the brand colour guard produced no JSON report.\n${r.stderr || ''}`);
  const img = r.report.images[0];
  // Asleep checks, restated here so a checker that silently stopped measuring
  // cannot report clean through this test either.
  assert.ok(img.ink_pixels > 200, `the sheet holds ${img.ink_pixels} ink pixels, so nothing was drawn on it`);
  assert.ok(img.signal_pixels > 200, `the sheet holds ${img.signal_pixels} signal pixels, so the amber face never rendered`);
  assert.equal(
    r.status, 0,
    'a delivered brand asset carries an Oracle red family pixel. Red is dropped ENTIRELY and '
    + `that is a closed founder decision, re-confirmed 8 Aug 2026.\n${r.stderr || ''}`,
  );
  assert.equal(img.red_family_pixels, 0);
});

test('the contact sheet rasterises BOTH mark files, so the colour guard is not measuring one of them', () => {
  // The sheet is what gives two vector files pixels to be judged in. If it
  // stopped drawing one of them the red guard above would still pass while
  // covering half of the brand.
  const src = readFileSync(join(SCRIPTS, 'contact-sheet.mjs'), 'utf8');
  for (const f of [FULL_MARK, SMALL_MARK]) {
    assert.ok(src.includes(`'${f}'`), `the contact sheet builder no longer names ${f}`);
  }
  for (const size of [16, 24, 32, 64, 128, 512]) {
    assert.ok(
      new RegExp(`\\b${size}\\b`).test(src),
      `the contact sheet builder no longer renders ${size}px. The founder judges the mark at `
      + 'the sizes it is used at, and a size that stops being drawn stops being judged.',
    );
  }
  const [w] = pngSize(CONTACT_SHEET);
  assert.equal(
    w, SHEET_DEVICE_WIDTH,
    `the contact sheet is ${w} device px wide, not ${SHEET_DEVICE_WIDTH}. Showcase/STANDARDS.md `
    + 'section 3 fixes device scale factor 2 on a 1280 CSS canvas.',
  );
});

test('the brand red register is exhaustive, so a red asset cannot hide by not being listed', () => {
  // Every image asset at the root of public/ is either scanned clean or pinned
  // in KNOWN_RED with its measured count. Nothing is silently out of scope.
  const assets = readdirSync(PUBLIC)
    .filter((f) => /\.(png|svg|jpg|jpeg|webp)$/i.test(f))
    .filter((f) => statSync(join(PUBLIC, f)).isFile())
    .sort();
  assert.ok(assets.length >= 3, `only ${assets.length} brand assets found in ${PUBLIC}, so this register is measuring nothing`);

  const rasters = assets.filter((f) => f.toLowerCase().endsWith('.png'));
  assert.ok(rasters.length >= 1, 'no raster brand asset found, so the pixel register is measuring nothing');
  const r = runChecker(rasters.map((f) => join(PUBLIC, f)));
  assert.notEqual(r.report, null, `the brand colour guard produced no JSON report.\n${r.stderr || ''}`);

  const offenders = [];
  for (const img of r.report.images) {
    const name = img.path.split('/').pop();
    const known = KNOWN_RED[name];
    if (!known) {
      if (img.red_family_pixels > 0) {
        offenders.push(`${name}: ${img.red_family_pixels} red family pixels and it is not in KNOWN_RED`);
      }
      continue;
    }
    if (img.red_family_pixels !== known.redFamilyPixels) {
      offenders.push(
        `${name}: ${img.red_family_pixels} red family pixels, pinned at ${known.redFamilyPixels}. `
        + `If this asset was FIXED, delete its KNOWN_RED entry, which is how the follow-up closes. `
        + `Pinned because: ${known.why}`,
      );
    }
  }
  assert.deepEqual(offenders, []);

  // And the pin must still be pointing at something that exists.
  for (const name of Object.keys(KNOWN_RED)) {
    assert.ok(assets.includes(name), `KNOWN_RED names ${name}, which is not in ${PUBLIC} any more. Delete the entry.`);
  }
});

// ===========================================================================
// 2. THE MARK FILES THEMSELVES
// ===========================================================================
const markSource = (f) => readFileSync(join(PUBLIC, f), 'utf8');

test('the mark files are exactly what scripts/brand/build-logo.mjs emits', () => {
  for (const [rel, body] of Object.entries(FILES)) {
    const onDisk = readFileSync(join(REPO, rel), 'utf8');
    assert.equal(
      onDisk, body,
      `${rel} has drifted from its generator. The geometry in scripts/brand/build-logo.mjs is `
      + 'the record: edit it and run npm run build:brand, never hand edit the SVG.',
    );
  }
});

test('neither mark file carries a raster or an external font reference', () => {
  // An SVG that depends on a webfont renders differently depending on whether
  // a font server answered, and an <image> makes a vector into a screenshot.
  const banned = [
    [/<image\b/i, 'an <image> element, which makes this a raster rather than a drawing'],
    [/<text\b/i, 'a <text> element, whose shape depends on a font that may not be there'],
    [/@font-face/i, 'an @font-face rule'],
    [/font-family/i, 'a font-family, so the file depends on type it does not carry'],
    [/xlink:href/i, 'an xlink:href, which can reach outside the file'],
    [/https?:\/\//i, 'an absolute URL, so the file depends on a server answering'],
    [/url\s*\(/i, 'a url() reference'],
  ];
  const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';
  for (const f of [FULL_MARK, SMALL_MARK]) {
    const src = markSource(f);
    // The one URL an SVG must carry is its namespace, which names a standard
    // and fetches nothing. It is removed by an EXACT match rather than by a
    // pattern, so a real URL cannot sneak through by looking namespace shaped.
    assert.ok(src.includes(SVG_NS), `public/${f} is missing the SVG namespace declaration`);
    const body = src.replace(SVG_NS, '');
    for (const [re, why] of banned) {
      assert.ok(!re.test(body), `public/${f} contains ${why}`);
    }
  }
});

test('every colour literal in the mark files is outside the Oracle red hue band', () => {
  // The same hue band the pixel guard uses, applied to the source, so a red
  // that has not been rasterised yet still fails.
  const hueFromRed = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
    if (mx === mn) return { away: 180, sat: 0 };
    const d = mx - mn;
    let h;
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    h = ((h % 360) + 360) % 360;
    return { away: Math.min(h, 360 - h), sat: d / mx };
  };
  for (const f of [FULL_MARK, SMALL_MARK]) {
    const found = [...markSource(f).matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]);
    assert.ok(found.length >= 2, `public/${f} declares ${found.length} colours, so this check is measuring nothing`);
    for (const hex of found) {
      const { away, sat } = hueFromRed(hex);
      assert.ok(
        !(sat >= 0.3 && away <= 20),
        `public/${f} declares ${hex}, which is ${away.toFixed(1)} degrees from pure red. Oracle `
        + 'red is dropped ENTIRELY and that is a closed founder decision. The mark is ink '
        + `${INK} with signal ${SIGNAL}.`,
      );
    }
    assert.ok(found.includes(INK) && found.includes(SIGNAL), `public/${f} no longer uses the ratified ink and signal`);
  }
});

test('the small variant really drops an arc, on the same body and the same tail', () => {
  const { full, small } = GEOMETRY;
  assert.equal(full.seams.length, 2, 'logo.svg should carry two seams, which with the top face is three arcs');
  assert.equal(small.seams.length, 1, 'favicon.svg should carry one seam, which with the top face is two arcs');
  assert.ok(
    small.seam > full.seam,
    `the surviving seam is ${small.seam.toFixed(2)} and the full mark's is ${full.seam.toFixed(2)}. `
    + 'Dropping an arc without thickening the survivor leaves a hairline that greys out too.',
  );
  // Same family, asserted rather than assumed: only the seams may differ.
  for (const k of ['cx', 'top', 'base', 'rx', 'ry', 'tailLen', 'tailLean', 'tailFrom', 'tailTo', 'face']) {
    assert.equal(small[k], full[k], `the two files disagree on ${k}, so they are not the same mark`);
  }
  // And the emitted paths must show it: one subpath for the outline, one per seam.
  const subpaths = (f) => (/ d="([^"]+)"/.exec(markSource(f))[1].match(/M/g) || []).length;
  assert.equal(subpaths(FULL_MARK), 3, 'logo.svg should be one outline plus two seams');
  assert.equal(subpaths(SMALL_MARK), 2, 'favicon.svg should be one outline plus one seam');
});

// ===========================================================================
// 3. THE WIRING
// ===========================================================================
test('page discovery found the built site', () => {
  assert.ok(
    ALL_PAGES.length >= 20,
    `only ${ALL_PAGES.length} built pages discovered in ${DIST}. Run npm run build first. `
    + 'A discovery bug that matched nothing would report the guard below as passing over zero pages.',
  );
  assert.ok(
    PAGES_WITH_HEADER.length >= 90,
    `only ${PAGES_WITH_HEADER.length} of ${ALL_PAGES.length} built pages carry a header`,
  );
});

test('every built page that has a header renders the mark', () => {
  const missing = [];
  for (const page of PAGES_WITH_HEADER) {
    const html = readFileSync(join(DIST, page), 'utf8');
    if (!/class="logo"/.test(html) || !/class="lm"/.test(html)) missing.push(`${page}: no brand lockup in the header`);
  }
  assert.deepEqual(
    missing, [],
    'a page ships a header with no brand mark in it. The lockup is Header.astro and Footer.astro.',
  );
});

test('the mark is actually painted, and the file it names is on the built site', () => {
  // Three legs, because the mark reaches the page through CSS rather than
  // through markup: the hook in the page, the rule in the bundle, and the file
  // on disk. Any one of them alone is a mark nobody can see.
  const sample = PAGES_WITH_HEADER.slice(0, 12);
  assert.ok(sample.length >= 5, 'too few pages with a header to sample, so this guard is measuring nothing');
  for (const page of sample) {
    const css = allCss(readFileSync(join(DIST, page), 'utf8'));
    assert.ok(
      /\.lm\s*\{[^}]*url\(\/logo\.svg\)/.test(css),
      `${page}: no .lm rule paints /logo.svg. The header would render an empty box.`,
    );
    assert.ok(
      /\.ln em\s*\{[^}]*var\(--brand-act\)/.test(css),
      `${page}: the wordmark accent is not on --brand-act. A new mark beside a wordmark still `
      + 'accented in the dropped Oracle red puts the retired colour next to the thing retiring it.',
    );
    assert.ok(
      /--brand-act:\s*#8A4B12/i.test(css),
      `${page}: --brand-act is not the ratified action colour #8A4B12`,
    );
  }
  for (const f of [FULL_MARK, SMALL_MARK]) {
    assert.ok(existsSync(join(DIST, f)), `${f} is referenced but was not built into ${DIST}`);
  }
});

test('the tab icon is the small variant, and nothing in the head still names Oracle red', () => {
  const sample = PAGES_WITH_HEADER.slice(0, 12);
  for (const page of sample) {
    const html = readFileSync(join(DIST, page), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    assert.ok(
      /rel="icon"[^>]+href="\/favicon\.svg"/.test(head),
      `${page}: the tab icon is not /favicon.svg, which is the two arc file. A favicon is never `
      + 'drawn larger than about 24px and the three arc form greys out below that.',
    );
    assert.ok(
      !/#C74634/i.test(head),
      `${page}: the document head still names Oracle red #C74634, which is dropped entirely`,
    );
  }
});

// ===========================================================================
// 4. HOUSE RULES
// ===========================================================================
test('no em dash in any brand source or delivered brand text', () => {
  const files = [
    ...readdirSync(SCRIPTS).map((f) => join(SCRIPTS, f)),
    join(PUBLIC, FULL_MARK),
    join(PUBLIC, SMALL_MARK),
    new URL(import.meta.url).pathname,
  ];
  const offenders = files.filter((f) => statSync(f).isFile() && readFileSync(f, 'utf8').includes(EM_DASH));
  assert.deepEqual(offenders, [], 'em dash found. Founder rule, and it applies inside comments too.');
});

// PNG dimensions from the IHDR chunk, so the sheet's size is read from the file
// rather than from whatever the build script said it wrote.
function pngSize(path) {
  const b = readFileSync(path);
  assert.equal(b.toString('ascii', 1, 4), 'PNG', `${path} is not a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}
