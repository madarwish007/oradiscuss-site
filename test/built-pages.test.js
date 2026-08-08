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
