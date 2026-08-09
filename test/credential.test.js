/* The retired credential must never read as a claim about the present.
 *
 * Mahmoud was an Oracle ACE Apprentice and was promoted to Oracle ACE Associate
 * on 1 June 2026. The old level is still legitimate HISTORY: one blog post
 * narrates joining at that level, and that post keeps its title wherever it is
 * listed. What is a defect is any surface that describes him as one TODAY.
 *
 * That distinction is why this guard is not a substring search. A plain
 * "no ACE Apprentice anywhere" check would fail on the honest historical post,
 * and the obvious fix for that failure is an allowlist of pages, which then
 * silently absorbs the next real regression the moment it lands on a listed
 * page. So the rule here is structural: every occurrence must be the post
 * NARRATING ITSELF, either inside the post's own page or as its exact title.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const RETIRED = 'ACE Apprentice';
const CURRENT = 'ACE Associate';

/* The one post allowed to say it, and the fragment of its title that travels
 * with it onto listing pages. Apostrophes get entity-encoded differently by
 * different renderers, so anchor before the apostrophe. */
const HISTORY_PAGE = 'community/oracle-ace-apprentice-how-to-join/index.html';
const HISTORY_TITLE = 'Oracle ACE Apprentice! Here';

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(html|xml|json|txt)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(DIST);

test('the built site exists and is big enough to be worth scanning', () => {
  assert.ok(
    files.length >= 90,
    `only ${files.length} scannable files under dist/, so this guard is nearly asleep. Run npm run build first.`
  );
});

test('the retired credential never appears except as the post narrating itself', () => {
  const offenders = [];
  let historicalOccurrences = 0;

  for (const file of files) {
    const rel = file.slice(DIST.length);
    const body = readFileSync(file, 'utf8');
    if (!body.includes(RETIRED)) continue;

    /* The post's own page may say it as often as it likes. */
    if (rel === HISTORY_PAGE) {
      historicalOccurrences += body.split(RETIRED).length - 1;
      continue;
    }

    /* Anywhere else, every single occurrence must be carrying the title. */
    let from = 0;
    for (;;) {
      const at = body.indexOf(RETIRED, from);
      if (at === -1) break;
      from = at + RETIRED.length;
      const window = body.slice(Math.max(0, at - 80), at + 80);
      if (window.includes(HISTORY_TITLE)) {
        historicalOccurrences += 1;
        continue;
      }
      offenders.push(`${rel}: ...${window.replace(/\s+/g, ' ').trim()}...`);
    }
  }

  assert.ok(
    historicalOccurrences > 0,
    `found no historical mention of "${RETIRED}" at all. Either the post was removed or ` +
      `HISTORY_PAGE/HISTORY_TITLE have gone stale, and a guard that matches nothing passes everything.`
  );

  assert.equal(
    offenders.length,
    0,
    `the retired credential is presented as current in ${offenders.length} place(s):\n  ` +
      offenders.join('\n  ')
  );
});

test('the feed and the site describe him at the level he actually holds', () => {
  const rss = readFileSync(join(DIST, 'rss.xml'), 'utf8');
  assert.ok(
    rss.includes(`practising Oracle ${CURRENT}`),
    'rss.xml does not describe him as a practising Oracle ACE Associate. The feed description is ' +
      'a separate string from every page, so the site can be correct while the feed is stale.'
  );

  const home = readFileSync(join(DIST, 'index.html'), 'utf8');
  assert.ok(home.includes(CURRENT), 'the homepage does not name the current credential at all');
});
