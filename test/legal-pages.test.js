// GUARDS over the policy pages, read from dist/ rather than from source.
//
// Paddle will not approve a checkout domain unless the site links through to,
// or contains, terms of service, a privacy notice and a refund policy. These
// pages are therefore load-bearing for the money track, not decoration, and
// silently losing one would not be visible anywhere else in the suite.
//
// The price guard is the interesting one. House rule: no page states a price
// from memory, because prices come from the catalog config and a hand-written
// number goes stale the moment a price moves. A policy page is exactly where a
// stray "$99/yr" would sit unnoticed for a year.
//
// Point DIST_DIR at a deliberately broken build to watch these fire.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = process.env.DIST_DIR ?? new URL('../dist', import.meta.url).pathname;
const LEGAL = ['terms', 'privacy', 'refund', 'contact'];
const SUPPORT = 'support@oradiscuss.com';

function read(slug) {
  const path = join(DIST, slug, 'index.html');
  assert.ok(existsSync(path), `${path} does not exist. Run npm run build first.`);
  return readFileSync(path, 'utf8');
}

// Strip markup so a match means the words are READABLE on the page, not that
// they appear in a meta tag, a link href or a JSON-LD blob.
function bodyText(html) {
  const main = /<main[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? html;
  return main
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

for (const slug of LEGAL) {
  test(`/${slug}/ ships and carries the support address`, () => {
    const html = read(slug);
    assert.ok(
      bodyText(html).includes(SUPPORT),
      `/${slug}/ must give a reachable contact address in its body`,
    );
  });

  test(`/${slug}/ states no price`, () => {
    const text = bodyText(read(slug));
    const hit = /\$\s?\d/.exec(text);
    const context = hit ? `...${text.slice(Math.max(0, hit.index - 80), hit.index + 80)}...` : '';
    assert.equal(hit, null, `/${slug}/ hard-codes a price: ${context}`);
  });

  test(`/${slug}/ links to the other policies`, () => {
    const html = read(slug);
    for (const other of LEGAL.filter((s) => s !== slug)) {
      assert.match(html, new RegExp(`href="/${other}/"`), `/${slug}/ must link to /${other}/`);
    }
  });
}

test('every page reaches the policies from its footer', () => {
  // Paddle verification expects contact details within two clicks of the home
  // page. A footer link is the only thing that makes that true site-wide.
  for (const page of ['index.html', 'about/index.html', 'kit/index.html']) {
    const path = join(DIST, page);
    assert.ok(existsSync(path), `${path} does not exist`);
    const html = readFileSync(path, 'utf8');
    for (const slug of LEGAL) {
      assert.match(html, new RegExp(`href="/${slug}/"`), `${page} footer must link to /${slug}/`);
    }
  }
});

test('the terms carry the Oracle trademark and non-endorsement statement', () => {
  // The ACE credential is a personal recognition. Presenting it anywhere near a
  // product claim is the one thing that risks the credential the business
  // stands on, so the disclaimer is a guarded requirement rather than a habit.
  const text = bodyText(read('terms'));
  assert.match(text, /registered trademarks of Oracle/i);
  assert.match(text, /not affiliated with, endorsed by/i);
});

test('the refund policy states the 14 day window, not some other number', () => {
  // Spec section 6.4 fixes this at 14 days. The reference site this was modeled
  // on says 30, which is exactly the kind of number that survives a copy edit.
  const text = bodyText(read('refund'));
  assert.match(text, /14 days/);
  assert.ok(!/30[- ]day/i.test(text), 'a 30 day window is the reference site policy, not ours');
});
