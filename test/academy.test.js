// GUARDS over the Academy, read from dist/ rather than from source.
//
// The Academy has zero courses in it. The site already describes things that do
// not exist yet, which is survivable only because there is nothing to click and
// buy, and the rule that keeps it survivable is that every blurb has to be true
// the day a buy button appears. /academy/ is the page most likely to break that
// rule, because "coming soon" is the natural thing to write on an empty shelf
// and it reads exactly like a catalogue.
//
// So these guards assert against GROUND TRUTH, which is the content tree on
// disk, not against the collection the page happened to render. They are
// written to SELF-HEAL: when the first real course lands, the empty branch
// stops being asserted and the courses branch starts, with no edit here.
//
// Point DIST_DIR at a deliberately broken build to watch every one of them
// fire. Each was watched failing before it was trusted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = process.env.DIST_DIR ?? new URL('../dist', import.meta.url).pathname;
const ACADEMY_DIST = join(DIST, 'academy');
const SRC = new URL('../src/content', import.meta.url).pathname;

// GROUND TRUTH. Counted from the files on disk, deliberately not from Astro's
// content store: that store lives in node_modules/.astro/data-store.json, it is
// SHARED with every sibling worktree through the node_modules symlink, and it
// does not reconcile deletions when a collection becomes empty. A build off a
// stale store emitted pages for four content files that had already been
// deleted. Counting the files is the only reading that cannot be poisoned.
function countEntries(dir) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
    if (e.isDirectory()) n += countEntries(join(dir, e.name));
    else if (/\.mdx?$/.test(e.name)) n += 1;
  }
  return n;
}

const courseCount = countEntries(join(SRC, 'academy-courses'));
const lessonCount = countEntries(join(SRC, 'academy'));

function pagesUnderAcademy() {
  assert.ok(existsSync(ACADEMY_DIST), `${ACADEMY_DIST} does not exist. Run npm run build first.`);
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.name.endsWith('.html') ? [full] : [];
    });
  const found = walk(ACADEMY_DIST);
  // A guard that matches nothing looks exactly like a guard that passed.
  assert.ok(found.length > 0, 'no HTML found under dist/academy, so these guards are asleep');
  return found;
}

// Strip markup so a match means the words are READABLE on the page, not that
// they sit in a meta tag, a link href or an inline script.
function bodyText(html) {
  const main = /<main[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? html;
  return main
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

function mainOf(html) {
  return /<main[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? '';
}

test('the academy index does not claim a course exists while the tree is empty', () => {
  const index = join(ACADEMY_DIST, 'index.html');
  assert.ok(existsSync(index), `${index} does not exist. Run npm run build first.`);
  const html = readFileSync(index, 'utf8');
  const main = mainOf(html);

  // Assert the marker mechanism itself is present before asserting its value,
  // or a page that lost both branches would pass this test silently.
  const states = [...html.matchAll(/data-academy-state="([a-z]+)"/g)].map((m) => m[1]);
  assert.equal(
    states.length,
    1,
    `the index must render exactly one state marker, found ${states.length}: ${states.join(', ')}`,
  );

  if (courseCount === 0) {
    assert.equal(states[0], 'empty', 'the content tree holds no course, so the index must render the empty state');

    // No link may point at a course page. /academy/ itself is fine.
    const courseLinks = [...main.matchAll(/href="\/academy\/[^"]+"/g)].map((m) => m[0]);
    assert.deepEqual(courseLinks, [], 'the index links to a course while no course exists');

    // And no course page may exist to link to. This is what catches a build off
    // the stale shared content store, which emits pages for deleted content
    // while the source tree is empty.
    const strays = pagesUnderAcademy().filter((p) => relative(ACADEMY_DIST, p) !== 'index.html');
    assert.deepEqual(
      strays.map((p) => relative(DIST, p)),
      [],
      'pages exist under /academy/ for courses that are not in src/content/academy-courses',
    );

    // The page has to say the true thing, not merely omit the false one.
    assert.match(
      bodyText(html),
      /no courses here yet/i,
      'the empty state must say plainly that there are no courses',
    );
  } else {
    assert.equal(states[0], 'courses', `${courseCount} course file(s) exist, so the index must render the list`);
    assert.ok(
      /href="\/academy\/[^"]+"/.test(main),
      'courses exist but the index links to none of them',
    );
  }
});

test('the academy index never prints a count of nothing', () => {
  // A "0 courses" or "0 lessons" badge is the polite version of the same lie,
  // and it is the shape an eager edit would take.
  const html = readFileSync(join(ACADEMY_DIST, 'index.html'), 'utf8');
  const text = bodyText(html);
  const hit = /\b0\s+(courses?|lessons?|modules?)\b/i.exec(text);
  assert.equal(hit, null, `the index prints an empty count: ...${text.slice(Math.max(0, (hit?.index ?? 0) - 60), (hit?.index ?? 0) + 60)}...`);
  if (lessonCount === 0) {
    assert.ok(!/\blessons?\b\s*:/i.test(text), 'the index advertises a lesson tally while no lesson exists');
  }
});

test('no page under /academy/ says "coming soon"', () => {
  // Named explicitly because it is the sentence an empty shelf attracts, and it
  // is a promise with no date, no owner and nothing behind it. The empty state
  // is allowed to say the shelf is empty. It is not allowed to imply that
  // something is on its way, because nobody has committed to when.
  for (const page of pagesUnderAcademy()) {
    const text = bodyText(readFileSync(page, 'utf8'));
    const hit = /coming soon|launching soon|available soon|arriving soon/i.exec(text);
    assert.equal(
      hit,
      null,
      `${relative(DIST, page)} promises a delivery nobody committed to: ...${text.slice(Math.max(0, (hit?.index ?? 0) - 70), (hit?.index ?? 0) + 70)}...`,
    );
  }
});

test('no page under /academy/ states a price', () => {
  // House rule, already guarded on the policy pages and followed here: prices
  // come from the catalog config, and a hand written number goes stale the
  // moment a price moves. It matters twice over on the Academy, because flat
  // all access is a locked decision and per course pricing was proposed and
  // rejected (spec section 2.1). A price on a course page would be that
  // rejected decision growing back in the one place nobody rereads.
  for (const page of pagesUnderAcademy()) {
    const text = bodyText(readFileSync(page, 'utf8'));
    const hit = /\$\s?\d/.exec(text);
    const context = hit ? `...${text.slice(Math.max(0, hit.index - 80), hit.index + 80)}...` : '';
    assert.equal(hit, null, `${relative(DIST, page)} states a price: ${context}`);
  }
});

test('no em dash in anything rendered under /academy/', () => {
  // Founder rule. CSS comments inside an inlined <style> do reach the page, so
  // the whole document is read rather than just the prose.
  for (const page of pagesUnderAcademy()) {
    const html = readFileSync(page, 'utf8');
    const idx = html.indexOf('—');
    assert.equal(
      idx,
      -1,
      idx === -1 ? '' : `${relative(DIST, page)}: em dash at ${idx}: ...${html.slice(Math.max(0, idx - 90), idx + 60)}...`,
    );
  }
});

test('every inline script under /academy/ compiles', () => {
  // A `//` comment inside a script emitted on one line eats the rest of the
  // file. The markup still looks perfect and the page dies with "Unexpected end
  // of input", so markup assertions cannot see it.
  for (const page of pagesUnderAcademy()) {
    const html = readFileSync(page, 'utf8');
    const scripts = [];
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html))) {
      const body = m[1].trim();
      if (body) scripts.push({ attrs: m[0].slice(0, m[0].indexOf('>') + 1), body });
    }
    assert.ok(scripts.length > 0, `${relative(DIST, page)} has no inline scripts, which means this guard is asleep`);
    for (const s of scripts) {
      const isModule = /type=["']module["']/.test(s.attrs);
      const isJson = /type=["']application\/(ld\+)?json["']/.test(s.attrs);
      if (isJson) {
        JSON.parse(s.body);
        continue;
      }
      try {
        // eslint-disable-next-line no-new-func
        new Function(isModule ? `export {};\n${s.body}` : s.body);
      } catch (err) {
        if (isModule && /import|export/.test(String(err))) continue;
        assert.fail(`${relative(DIST, page)}: inline script failed to compile: ${err}\n---\n${s.body.slice(0, 400)}`);
      }
    }
  }
});
