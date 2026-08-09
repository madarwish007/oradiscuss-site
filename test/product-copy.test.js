/* Product pages must not describe our own build process to a customer.
 *
 * /pricing/ shipped the sentence "This page is a Phase 1 scaffold on the
 * preview environment. ... Checkout arrives in Phase 6". Three separate
 * problems in one line: it asserted an environment, so it would have been
 * FALSE the moment the page reached oradiscuss.com; "Phase 1" and "Phase 6"
 * are internal planning descriptors that mean nothing to a DBA; and "scaffold"
 * tells a paying visitor the shop is unfinished in our words rather than in
 * terms of what they can and cannot do yet.
 *
 * The honest half of that sentence is kept and is load bearing: checkout is
 * NOT open, and saying so is what makes a catalogue of not-yet-field-tested
 * packs survivable on a live site.
 *
 * SCOPE. This walks only the pages we author about the product. Article prose
 * legitimately says "Phase 2" about an Oracle upgrade, and sweeping that would
 * be editing the founder's published writing, which is his call and not a
 * defect. Comments and scripts are stripped before matching, because
 * BaseLayout inlines developer commentary that mentions preview environments
 * on purpose and that is not customer-facing copy.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;

/* The pages we author about the product, as opposed to the founder's writing. */
const PRODUCT_PAGES = [
  'index.html',
  'pricing/index.html',
  'kit/index.html',
  'roadmap/index.html',
  'reissue/index.html',
  'changelog/index.html',
  'watch/index.html',
  'academy/index.html',
  'tools/index.html',
  'services/index.html',
];

function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

const BANNED = [
  { re: /preview environment/i, why: 'asserts an environment, so it is false the moment the page is on oradiscuss.com' },
  { re: /\bPhase \d/i, why: 'an internal planning descriptor that means nothing to a customer' },
  { re: /\bscaffold\b/i, why: 'describes our build state rather than what the visitor can do' },
  { re: /\bTODO\b|\bFIXME\b|\bplaceholder\b/i, why: 'unfinished-work marker on a customer page' },
  { re: /\blorem ipsum\b/i, why: 'filler text' },
];

test('the product pages exist in the build', () => {
  const present = PRODUCT_PAGES.filter((p) => existsSync(join(DIST, p)));
  assert.ok(
    present.length >= 8,
    `only ${present.length} of the ${PRODUCT_PAGES.length} product pages are in dist/, so this guard is ` +
      'nearly asleep. Run npm run build, and if a page was renamed, update PRODUCT_PAGES.'
  );
});

test('no product page describes our own build process to a customer', () => {
  const offenders = [];
  let scanned = 0;
  for (const rel of PRODUCT_PAGES) {
    const full = join(DIST, rel);
    if (!existsSync(full)) continue;
    scanned += 1;
    const text = visibleText(readFileSync(full, 'utf8'));
    for (const { re, why } of BANNED) {
      const m = text.match(re);
      if (!m) continue;
      const at = text.indexOf(m[0]);
      offenders.push(
        `${rel}: "${m[0]}" (${why})\n      ...${text.slice(Math.max(0, at - 90), at + 90).trim()}...`
      );
    }
  }
  assert.ok(scanned >= 8, `only ${scanned} product pages scanned, so this guard is nearly asleep`);
  assert.equal(offenders.length, 0, `${offenders.length} product-copy defect(s):\n  ` + offenders.join('\n  '));
});

test('the pricing page still says checkout is not open, because that sentence is load bearing', () => {
  /* The fix above deleted a false claim from this paragraph. It must not also
   * have deleted the true one: a catalogue with prices and no working checkout
   * has to say so, and this is the only place on the site that does. */
  const p = join(DIST, 'pricing', 'index.html');
  assert.ok(existsSync(p), 'no built pricing page');
  const text = visibleText(readFileSync(p, 'utf8'));
  assert.match(
    text,
    /Checkout is not open yet/i,
    'the pricing page no longer states that checkout is closed. Prices are live on that page, so ' +
      'without this sentence it reads as a shop that is merely broken.'
  );
  assert.match(
    text,
    /field-tested/i,
    'the pricing page no longer says what has to happen before checkout opens'
  );
});
