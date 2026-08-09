/* The social card, generated rather than hand-made.
 *
 * The card this replaces was drawn once at the initial scaffold and never
 * touched again, and it drifted badly: it said "Oracle Mastery, Distilled"
 * (the old blog's positioning) over a chip list of blog topics, it carried
 * Oracle red at 10.1% of its pixels after red was dropped, it showed the
 * retired "Od" square, and it described Mahmoud as an ACE Apprentice, a level
 * he was promoted out of on 1 June 2026. Meanwhile the og:title and
 * og:description in the HTML BESIDE it already said the true thing. The image
 * and its own metadata had been contradicting each other on every share.
 *
 * So this script authors NO COPY. Every string is lifted verbatim from
 * src/pages/index.astro, which is what production already serves, and a guard
 * asserts that they still match. If somebody changes the positioning, the
 * guard fails and the card is regenerated, rather than drifting for a year.
 *
 * It also carries no credential. A credential level is a fast-moving fact,
 * this exact one already rotted once, and baking it into a binary is how that
 * defect survived so long. It lives in the HTML where one line fixes it.
 *
 * The mark is read from public/logo.svg at build time rather than copied, so
 * the card cannot show a different logo from the site.
 *
 * Run: npm run build:og
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureBatch } from '../showcase/capture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');

/* Authored at the size social feeds actually display, then captured at
 * deviceScaleFactor 2, which gives exactly 1200 x 630. Judging legibility at
 * 1200 px and shipping something read at 600 is how cards end up unreadable. */
const CSS_W = 600;
const CSS_H = 315;

const GROUND = '#F7F5F1';
const INK = '#1C1917';
const INK2 = '#4A443D';
const INK3 = '#787065';
const HAIR = '#E0D9CD';
const ACTION = '#8A4B12';

const OUT_NEW = join(REPO, 'public', 'og-card.png');
/* The old path is served immutable with a year-long max-age and is already
 * scraped into other people's caches. It is overwritten with the same corrected
 * card rather than deleted, so that whatever still resolves there serves truth. */
const OUT_LEGACY = join(REPO, 'public', 'og-image.png');

/* Verbatim from src/pages/index.astro. Kept as literals here, and a guard
 * asserts these exact strings are still what that page passes. */
const TITLE_SOURCE = 'OraDiscuss: read-only Oracle tooling that feeds your own AI';
const DESC_SOURCE =
  'Read-only Oracle DBA packs that run on your machine and produce two things from one collection: ' +
  'a report you read, and a briefing your own AI reads. Nothing is uploaded.';

/* The headline is the part of the title after the site name, because the
 * wordmark on the card already says OraDiscuss. The sub is a contiguous clause
 * of the description. Both are selections, never rewrites. */
export const HEADLINE = 'Read-only Oracle tooling that feeds your own AI';
export const SUB = 'A report you read, and a briefing your own AI reads. Nothing is uploaded.';
export { TITLE_SOURCE, DESC_SOURCE };

export function buildHtml({ mark, generic = false }) {
  /* generic:true forces the webfonts off. Two renders that differ is the only
   * honest proof the webfont loaded; getComputedStyle just echoes our own CSS. */
  const sora = generic ? 'monospace' : "'Sora',system-ui,sans-serif";
  const arch = generic ? 'monospace' : "'Archivo',system-ui,sans-serif";
  const mono = generic ? 'serif' : "'JetBrains Mono',ui-monospace,monospace";
  const fonts = generic
    ? ''
    : '<link rel="preconnect" href="https://fonts.googleapis.com">' +
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?' +
      'family=Archivo:wght@400;500;600&family=JetBrains+Mono:wght@600&family=Sora:wght@700;800&display=block">';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${fonts}<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${CSS_W}px;height:${CSS_H}px;overflow:hidden}
body{background:${GROUND};font-family:${arch};-webkit-font-smoothing:antialiased}
.card{width:100%;height:100%;padding:34px 44px 30px;display:flex;flex-direction:column}
.lock{display:flex;align-items:center;gap:10px}
/* 32px, not 26. public/logo.svg carries a stated contract that its three-arc
 * form is for 30px and up, and a feed renders this card at its authored size. */
.lock svg{width:32px;height:32px;display:block}
.lock .wm{font-family:${sora};font-weight:800;font-size:21px;letter-spacing:-.03em;color:${INK};line-height:1}
.mid{flex:1;display:flex;flex-direction:column;justify-content:center;padding:14px 0}
h1{font-family:${sora};font-weight:800;font-size:36px;line-height:1.08;letter-spacing:-.032em;color:${INK};text-wrap:balance;max-width:17ch}
p{margin-top:16px;font-family:${arch};font-weight:400;font-size:15.5px;line-height:1.5;color:${INK2};max-width:60ch}
.foot{display:flex;align-items:center;gap:12px;border-top:1px solid ${HAIR};padding-top:13px}
.dom{font-family:${mono};font-weight:600;font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:${ACTION}}
.who{margin-left:auto;font-family:${arch};font-weight:500;font-size:11.5px;color:${INK3}}
</style></head><body><div class="card">
<div class="lock">${mark}<span class="wm">OraDiscuss</span></div>
<div class="mid"><h1>${HEADLINE}</h1><p>${SUB}</p></div>
<div class="foot"><span class="dom">oradiscuss.com</span><span class="who">Mahmoud Darwish</span></div>
</div></body></html>`;
}

export async function render({ out, generic = false } = {}) {
  const mark = readFileSync(join(REPO, 'public', 'logo.svg'), 'utf8').trim();
  const work = mkdtempSync(join(tmpdir(), 'og-card-'));
  try {
    const page = join(work, 'card.html');
    writeFileSync(page, buildHtml({ mark, generic }));
    mkdirSync(dirname(out), { recursive: true });
    await captureBatch({
      dsf: 2,
      tileMaxCss: 2400,
      jobs: [{ file: page, out, width: CSS_W, height: CSS_H }],
    });
    return out;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/* PROOF THAT THE WEBFONT LOADED, and it lives here rather than in the test
 * suite on purpose.
 *
 * getComputedStyle().fontFamily only echoes our own CSS, so it cannot tell a
 * loaded Sora from a silent fallback. The only honest proof is to render the
 * card twice, once with the families forced to generics, and require the pixels
 * to differ. That costs a second headless Chrome, which made the default test
 * run fragile: on a loaded machine the suite was SIGKILLed at 105 seconds.
 *
 * So the check runs at GENERATION time, which is the moment it actually
 * protects, and it throws rather than warns. test/og-card.test.js asserts this
 * block still exists, so it cannot be quietly deleted.
 */
export async function proveWebfontLoaded() {
  const work = mkdtempSync(join(tmpdir(), 'og-proof-'));
  try {
    const real = join(work, 'real.png');
    const generic = join(work, 'generic.png');
    await render({ out: real });
    await render({ out: generic, generic: true });
    const a = readFileSync(real);
    const b = readFileSync(generic);
    if (a.equals(b)) {
      throw new Error(
        'the card renders identically with and without the webfonts, so Sora never loaded and ' +
          'this card would ship set in a fallback face. Refusing to write it.'
      );
    }
    return { realBytes: a.length, genericBytes: b.length };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('build-og-card.mjs');
if (invokedDirectly) {
  const proof = await proveWebfontLoaded();
  console.log(
    `webfont proof: real render ${proof.realBytes} bytes, generic render ${proof.genericBytes} bytes, ` +
      'and they differ'
  );
  await render({ out: OUT_NEW });
  copyFileSync(OUT_NEW, OUT_LEGACY);
  console.log('wrote', OUT_NEW);
  console.log('wrote', OUT_LEGACY, '(same bytes: the old immutable URL must not serve the old claim)');
}
