// GUARDS over the generated changelog.
//
// The page in dist/ is a shell. The releases come from D1 at request time, so
// the assertions that matter are on the RENDERED page, and no guard that reads
// dist/ can see them: built-pages.test.js is structurally blind to everything
// this Worker injects. That is the reason this file exists rather than another
// entry in the PAGES list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { handleApi } from '../worker/api.js';
import { changelogPage, renderNotes, injectIntoSlot } from '../worker/changelog.js';
import { makeEnv, captureConsole } from './support/system-env.js';

const DIST = process.env.DIST_DIR ?? new URL('../dist', import.meta.url).pathname;
const PAGE = join(DIST, 'changelog', 'index.html');
const SOURCE = new URL('../src/pages/changelog.astro', import.meta.url).pathname;

function builtPage() {
  assert.ok(existsSync(PAGE), `${PAGE} does not exist. Run npm run build first.`);
  return readFileSync(PAGE, 'utf8');
}

// An ASSETS binding that serves the real built page, which is what the Worker
// actually receives in production.
function assetsFor(html) {
  return {
    async fetch() {
      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    },
  };
}

async function seedEntry(env, { pack, version, body_md, released_at, sha256, min_tier = 1 }) {
  await env.DB.prepare(
    `INSERT INTO changelog (pack, version, body_md, released_at) VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(pack, version, body_md, released_at)
    .run();
  if (sha256) {
    await env.DB.prepare(
      `INSERT INTO pack_release (pack, version, r2_key, sha256, min_tier, released_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
      .bind(pack, version, `packs/${pack}/${version}.zip`, sha256, min_tier, released_at)
      .run();
  }
}

async function render(env) {
  const request = new Request('https://oradiscuss.com/changelog/');
  const res = await changelogPage(request, env);
  return { res, html: await res.text() };
}

// Astro wraps prose across lines, so a sentence in the built HTML is broken by
// a newline and eight spaces in the middle. The first version of these guards
// searched for the unwrapped sentence, matched nothing, and passed every
// assertion including the ones asserting ABSENCE. Collapsing whitespace first
// is what makes them able to fail.
const flat = (html) => html.replace(/\s+/g, ' ');

const FALLBACK = 'could not be read just now. Nothing is shown rather than a stale list.';

/* --------------------------------------------------------------- structure */

test('the built page carries the slot the Worker writes into', () => {
  const html = builtPage();
  assert.match(
    html,
    /<div[^>]*data-slot="changelog"[^>]*>/,
    'the slot is gone or renamed. Repoint worker/changelog.js, do not delete this guard.',
  );
});

test('the repository holds no changelog CONTENT, only the page', () => {
  // Founder ruling: the changelog is generated from releases, never hand
  // edited. A version string in the page source is what a hand edit looks like
  // on its first day.
  const source = readFileSync(SOURCE, 'utf8');
  const versions = source.match(/\bv\d+\.\d+\.\d+\b/g) ?? [];
  assert.deepEqual(versions, [], `the page source names releases: ${versions.join(', ')}`);
});

/* ---------------------------------------------------------------- rendering */

test('releases render from D1 into the built page', async () => {
  const env = makeEnv({ ASSETS: assetsFor(builtPage()) });
  await seedEntry(env, {
    pack: 'health-check',
    version: 'v1.0.0',
    body_md: 'First release of the dual output.\n\nRAC instance census added.',
    released_at: '2026-08-02 09:00:00',
    sha256: 'a'.repeat(64),
    min_tier: 0,
  });
  await seedEntry(env, {
    pack: 'daily-ops',
    version: 'v1.0.0',
    body_md: 'Morning briefing and JSON from one collection.',
    released_at: '2026-08-05 09:00:00',
    sha256: 'b'.repeat(64),
  });

  const { res, html } = await render(env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8');

  assert.ok(html.includes('health-check'), 'the first release is missing from the page');
  assert.ok(html.includes('Morning briefing and JSON from one collection.'));
  assert.ok(html.includes('a'.repeat(64)), 'the digest must be published beside the release');
  assert.ok(html.includes('Free tier'), 'min_tier 0 must read as the free tier');

  // Newest first.
  assert.ok(
    html.indexOf('daily-ops') < html.indexOf('health-check'),
    'releases must be newest first',
  );

  // And the shell survived: this is one page, not a second copy of the design.
  assert.ok(html.includes('</footer>'), 'the site chrome was lost during injection');
  assert.ok(
    !flat(html).includes(FALLBACK),
    'the fallback sentence must be replaced when the data is there',
  );
});

test('release notes are ESCAPED, never interpreted as markup', async () => {
  const env = makeEnv({ ASSETS: assetsFor(builtPage()) });
  await seedEntry(env, {
    pack: 'health-check',
    version: 'v1.0.1',
    body_md: 'Fixed <script>alert(1)</script> and an <img src=x onerror=alert(2)> in the report.',
    released_at: '2026-08-06 09:00:00',
  });

  const { html } = await render(env);
  const notes = /<div class="cl-notes">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  assert.ok(notes.length > 0, 'the notes block is missing, so this guard is asleep');
  assert.ok(!notes.includes('<script'), 'a database row became a script tag');
  assert.ok(!notes.includes('<img'), 'a database row became an img tag');
  assert.ok(!/<[a-z]/i.test(notes.replace(/<\/?p>|<br \/>/g, '')), `a database row emitted markup: ${notes}`);
  assert.ok(notes.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'the text should still be readable');
});

test('an empty table says there are no releases, which is a different sentence', async () => {
  const env = makeEnv({ ASSETS: assetsFor(builtPage()) });
  const { html } = await render(env);
  assert.ok(html.includes('No releases have been published yet'));
  assert.ok(
    !flat(html).includes(FALLBACK),
    'an empty table is not a failure and must not read like one',
  );
});

test('a database failure serves the built page untouched', async () => {
  const env = makeEnv({ ASSETS: assetsFor(builtPage()) });
  env.DB = {
    prepare() {
      throw new Error('D1_ERROR: connection lost');
    },
  };
  const capture = captureConsole();
  try {
    const { res, html } = await render(env);
    assert.equal(res.status, 200, 'a changelog outage is not a broken page');
    assert.ok(flat(html).includes(FALLBACK), 'the honest fallback must survive');
    assert.ok(!html.includes('No releases have been published yet'), 'an outage is not an empty list');
    assert.match(capture.text(), /changelog_read_failed/);
    assert.ok(capture.text().includes('connection lost'), 'the reason must be logged for us');
  } finally {
    capture.restore();
  }
});

test('a page with no slot is served untouched and says so in the log', async () => {
  const env = makeEnv({ ASSETS: assetsFor('<html><body><p>no slot here</p></body></html>') });
  const capture = captureConsole();
  try {
    const { res, html } = await render(env);
    assert.equal(res.status, 200);
    assert.ok(html.includes('no slot here'));
    assert.match(capture.text(), /changelog_slot_missing/);
  } finally {
    capture.restore();
  }
});

test('the injector refuses an ambiguous slot rather than guessing', () => {
  const ambiguous = '<div data-slot="changelog"><div>nested</div></div>';
  assert.equal(injectIntoSlot(ambiguous, 'X'), null);
  assert.equal(injectIntoSlot('<p>nothing</p>', 'X'), null);
});

test('notes keep their paragraphs and drop nothing', () => {
  const html = renderNotes('One.\n\nTwo.\nStill two.');
  assert.equal(html, '<p>One.</p><p>Two.<br />Still two.</p>');
  assert.equal(renderNotes(''), '');
  assert.equal(renderNotes(null), '');
});

/* ------------------------------------------------- the rendered page itself */

test('the RENDERED page carries no em dash and every inline script compiles', async () => {
  // dist/ guards cannot see this page: half of it does not exist until the
  // Worker builds it. So the house rules are checked on the output.
  const env = makeEnv({ ASSETS: assetsFor(builtPage()) });
  await seedEntry(env, {
    pack: 'health-check',
    version: 'v1.0.0',
    body_md: 'A note with a comma, a full stop. Nothing else.',
    released_at: '2026-08-02 09:00:00',
    sha256: 'c'.repeat(64),
  });

  const { html } = await render(env);

  const dash = html.indexOf('—');
  assert.equal(dash, -1, dash === -1 ? '' : `em dash at ${dash}: ...${html.slice(dash - 90, dash + 60)}...`);

  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0, 'no inline scripts on the rendered page, so this guard is asleep');
  for (const [tag, body] of scripts) {
    if (!body.trim()) continue;
    if (/type=["']application\/(ld\+)?json["']/.test(tag)) {
      JSON.parse(body);
      continue;
    }
    const isModule = /type=["']module["']/.test(tag);
    try {
      // eslint-disable-next-line no-new-func
      new Function(isModule ? `export {};\n${body}` : body);
    } catch (err) {
      if (isModule && /import|export/.test(String(err))) continue;
      assert.fail(`inline script failed to compile: ${err}\n---\n${body.slice(0, 300)}`);
    }
  }
});

/* -------------------------------------------------------------------- JSON */

test('GET /api/changelog serves the same rows as data', async () => {
  const env = makeEnv();
  await seedEntry(env, {
    pack: 'health-check',
    version: 'v1.0.0',
    body_md: 'First release.',
    released_at: '2026-08-02 09:00:00',
    sha256: 'a'.repeat(64),
  });
  const res = await handleApi(new Request('https://oradiscuss.com/api/changelog'), env, '/api/changelog');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.entries.length, 1);
  assert.equal(body.entries[0].pack, 'health-check');
  assert.equal(body.entries[0].sha256, 'a'.repeat(64));
});

test('GET /api/changelog degrades to 503 rather than a 500 page', async () => {
  const env = makeEnv();
  env.DB = {
    prepare() {
      throw new Error('D1_ERROR');
    },
  };
  const capture = captureConsole();
  try {
    const res = await handleApi(new Request('https://oradiscuss.com/api/changelog'), env, '/api/changelog');
    assert.equal(res.status, 503);
  } finally {
    capture.restore();
  }
});
