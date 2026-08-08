// GUARDS over what actually ships, read from dist/ rather than from source.
//
//   1. Every inline script COMPILES. A `//` comment inside a script that gets
//      emitted on one line eats the rest of the file, the markup still looks
//      perfect, and the page dies with "Unexpected end of input".
//   2. No em dash in rendered output. Founder rule, and CSS comments inside an
//      inlined <style> do reach the page, so they are covered too.
//   3. The capture form ships CLOSED. If Astro's prerender of the island ever
//      changes, this is what catches it, not React state that nobody reads.
//
// Point DIST_DIR at a deliberately broken build to watch these fire.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = process.env.DIST_DIR ?? new URL('../dist', import.meta.url).pathname;
const PAGES = [
  'kit/index.html',
  'roadmap/index.html',
  'index.html',
  'terms/index.html',
  'privacy/index.html',
  'refund/index.html',
  'contact/index.html',
  // Phase 6. This list enumerates its inputs, so a new page is uncovered until
  // it is named here. /changelog/ is covered TWICE on purpose: this guard reads
  // the built shell, and test/changelog.test.js reads the page the Worker
  // actually renders, which is a different document.
  'reissue/index.html',
  'changelog/index.html',
  // Phase 8. Both /watch/ pages are covered TWICE, for the same reason
  // /changelog/ is: this guard reads the built shell, and test/watch.test.js
  // reads the page the Worker actually renders out of D1, which is a different
  // document and is where a database row could put an em dash on the page.
  'watch/index.html',
  'watch/brief/index.html',
];

function read(page) {
  const path = join(DIST, page);
  assert.ok(existsSync(path), `${path} does not exist. Run npm run build first.`);
  return readFileSync(path, 'utf8');
}

// Everything that styles this page: inline <style> blocks plus every local
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

function inlineScripts(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    const body = m[1].trim();
    if (body) out.push({ attrs: m[0].slice(0, m[0].indexOf('>') + 1), body });
  }
  return out;
}

// ---------------------------------------------------------------------------
// EVERY BUILT PAGE, DISCOVERED, NOT NAMED.
//
// PAGES above is a hand-kept list of seven, and the site builds twenty. That is
// the fan-out-by-name trap this repo has now hit four times, and this is the
// occasion it actually cost something: `/pricing/` carried an em dash in its
// title, straight through to the rendered page, on a live site whose house rule
// forbids them. Every guard was green because no guard was looking.
//
// Two of the four per-page guards are universal (a dead inline script kills any
// page, and the em dash rule is site-wide), so they run over whatever is on
// disk. The other two are about the capture form and stay on a named list,
// because a page without a form cannot be asserted to ship one closed.
// ---------------------------------------------------------------------------
function allBuiltPages() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.html')) out.push(relative(DIST, full));
    }
  };
  walk(DIST);
  return out.sort();
}

const ALL_PAGES = allBuiltPages();

// ---------------------------------------------------------------------------
// THE EM DASH EXEMPTIONS, NAMED AND COUNTED RATHER THAN SKIPPED.
//
// The article bodies break the house no-em-dash rule, up to eighteen times on a
// single article, and they are NOT swept here. That is a registered decision
// and not an oversight: they are the founder's own published writing, a blind
// purge would edit thirteen articles' voice, and the scope of that edit is his
// call. It is recorded as an open decision in SESSION_HANDOFF.
//
// So the exemption is written down, with a reason, and its SIZE IS ASSERTED.
// A silent skip would mean the fourteenth article inherits the exemption
// without anybody choosing that. With the count asserted, a new article fails
// this test until somebody decides which side of the line it is on, and the
// founder's eventual ruling closes it by deleting entries rather than by
// remembering that entries existed.
// ---------------------------------------------------------------------------
const EM_DASH_EXEMPT_PREFIXES = [
  // Article bodies, and the index and tag pages that display their titles.
  'articles/', 'asm/', 'community/', 'dba/', 'goldengate/', 'oci/', 'scripts/', 'tags/',
];
const EM_DASH_EXEMPT_EXACT = [
  'admin/index.html', // Sveltia CMS, third party markup this project does not author
];
const isEmDashExempt = (p) =>
  EM_DASH_EXEMPT_EXACT.includes(p) || EM_DASH_EXEMPT_PREFIXES.some((pre) => p.startsWith(pre));

test('page discovery finds the built site, and covers every hand-named page', () => {
  // Without this, a discovery bug that matched nothing would report every
  // universal guard below as passing over zero pages.
  assert.ok(ALL_PAGES.length >= 20, `only ${ALL_PAGES.length} built pages discovered. Run npm run build first.`);
  for (const p of PAGES) {
    assert.ok(ALL_PAGES.includes(p), `${p} is named in PAGES but was not built`);
  }
});

test('the em dash exemption list has not grown by itself', () => {
  const exempt = ALL_PAGES.filter(isEmDashExempt);
  assert.equal(
    exempt.length,
    62,
    `${exempt.length} pages are exempt from the em dash rule, not 62.\n` +
      'If an article was added, decide whether it follows the house rule before changing this number.\n' +
      exempt.join('\n'),
  );
  // And the guard must still be covering the pages that matter. 15 today,
  // against the 7 that were hand-named before page discovery replaced the list.
  const guarded = ALL_PAGES.filter((p) => !isEmDashExempt(p));
  assert.ok(guarded.length >= 15, `only ${guarded.length} pages are actually guarded`);
});

for (const page of ALL_PAGES.filter((p) => !isEmDashExempt(p))) {
  test(`${page}: no em dash in rendered output`, () => {
    const html = read(page);
    const idx = html.indexOf('—');
    assert.equal(
      idx,
      -1,
      idx === -1 ? '' : `${page}: em dash at ${idx}: ...${html.slice(Math.max(0, idx - 90), idx + 60)}...`,
    );
  });
}

for (const page of PAGES) {
  test(`${page}: every inline script compiles`, () => {
    const scripts = inlineScripts(read(page));
    assert.ok(scripts.length > 0, `${page} has no inline scripts, which means this guard is asleep`);
    for (const s of scripts) {
      const isModule = /type=["']module["']/.test(s.attrs);
      const isJson = /type=["']application\/(ld\+)?json["']/.test(s.attrs);
      if (isJson) {
        JSON.parse(s.body);
        continue;
      }
      try {
        // A module body is wrapped so that top level import/export parse.
        // eslint-disable-next-line no-new-func
        new Function(isModule ? `export {};\n${s.body}` : s.body);
      } catch (err) {
        if (isModule && /import|export/.test(String(err))) continue;
        assert.fail(`${page}: inline script failed to compile: ${err}\n---\n${s.body.slice(0, 400)}`);
      }
    }
  });

}

for (const page of ['kit/index.html', 'roadmap/index.html']) {
  test(`${page}: the capture form ships closed`, () => {
    const html = read(page);
    assert.match(html, /<fieldset class="cap-fields" disabled=""/, 'the fieldset must ship disabled');
    assert.match(
      html,
      /This form is disabled until the connection to the list is confirmed/,
      'the closed form must say so in the static HTML',
    );
    assert.match(html, /<noscript>/, 'the no-JavaScript case must be addressed in prose');
    // Nothing may offer a download of an artifact that does not exist yet.
    assert.ok(!/href="[^"]*\.zip"/.test(html), 'no pack download link may ship before the pack does');
  });

  test(`${page}: no opacity on the disabled state`, () => {
    // Opacity multiplies text toward its ground, so a contrast sweep that reads
    // `color` alone would call a failing control a pass.
    //
    // This reads the LINKED bundles as well as any inline <style>. The first
    // version of this guard read inline styles only, which on this build is
    // nothing at all: it passed against a fixture with opacity:.5 deliberately
    // injected, because the capture CSS ships in /_astro/*.css. A guard that
    // matches no rules is not a guard, so the count is asserted too.
    const css = allCss(read(page));
    const capRules = [...css.matchAll(/\.cap[^{}]*\{[^}]*\}/g)].map((m) => m[0]);
    assert.ok(capRules.length >= 10, `only ${capRules.length} .cap rules found, so this guard is asleep`);
    const offenders = capRules.filter((r) => /opacity\s*:/.test(r));
    assert.deepEqual(offenders, [], 'a .cap rule sets opacity');
  });
}

test('the re-issue form ships closed', () => {
  // Same law as the capture form, and the same reason: what lands in dist/ is
  // what a visitor gets with no JavaScript, with a failed fetch, or before the
  // signing key exists. In every one of those states the form must be unable to
  // take a reference it could not act on.
  const html = read('reissue/index.html');
  assert.match(html, /<fieldset class="rei-fields" disabled=""/, 'the fieldset must ship disabled');
  assert.match(
    html,
    /This form is disabled until the download service confirms it is open/,
    'the closed form must say so in the static HTML',
  );
  assert.match(html, /<noscript>/, 'the no-JavaScript case must be addressed in prose');
  assert.match(html, /noindex/, 'a members utility page must not be indexed');
});

test('the re-issue form does not dim its disabled state with opacity', () => {
  const css = allCss(read('reissue/index.html'));
  const rules = [...css.matchAll(/\.rei[^{}]*\{[^}]*\}/g)].map((m) => m[0]);
  assert.ok(rules.length >= 10, `only ${rules.length} .rei rules found, so this guard is asleep`);
  assert.deepEqual(
    rules.filter((r) => /opacity\s*:/.test(r)),
    [],
    'a .rei rule sets opacity, which multiplies text toward its ground and defeats a contrast check',
  );
});

test('no built page collects a comment', () => {
  // Founder ruling 7 Aug: comments are dropped. The reason is the product's
  // central claim, not tidiness. The comments Worker stored a name, the
  // comment text and a partial IP in KV under our control, and forwarded name
  // and text to Telegram, which is precisely what the privacy page says we do
  // not do. Production had no privacy page, so nothing was false; it would
  // have become false at promote.
  //
  // This asserts the ABSENCE of the collecting endpoint rather than the
  // absence of the component, because the component could come back under any
  // name. /api/ora-error and /api/search on /tools/ are deliberately still
  // allowed: they look things up in Oracle's docs and store nothing.
  const offenders = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(html|js)$/.test(e.name)) continue;
      if (readFileSync(full, 'utf8').includes('/api/comments')) offenders.push(relative(DIST, full));
    }
  };
  walk(DIST);
  assert.deepEqual(offenders, [], `these pages post to the comment store: ${offenders.join(', ')}`);
});

test('the built site ships no dotfiles', () => {
  // wrangler uploads dist/ wholesale, so anything that lands there becomes a
  // public URL. On 7 Aug a Finder-created dist/.DS_Store was uploaded to
  // preview and served 200: it is a directory index of the folder it sits in,
  // and at promote it would have gone to the real domain. Production was clean
  // at the time, so this guard exists to keep it that way.
  //
  // It refuses ALL dotfiles rather than .DS_Store by name. A check that lists
  // its inputs misses every input added after it was written.
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.name.startsWith('.') ? [relative(DIST, full)] : [];
    });

  assert.ok(existsSync(DIST), `${DIST} does not exist. Run npm run build first.`);
  assert.deepEqual(
    walk(DIST),
    [],
    'dotfiles in dist/ become public URLs. `npm run build` strips .DS_Store; anything else here needs a decision, not a delete.',
  );
});
