// THE CIRCUIT BREAKER, and it is the whole safety argument for publishing a
// brief under the founder's name with nobody in the loop.
//
// Founder ruling 9 Aug 2026, verbatim: "Monthly is okay, and that should be
// automated workflow without any human intervention, as a Founder, i need to
// get an aknowledgement about the updated kits only." That reverses his own
// 5 Aug standing gate, under which publishing and sending were founder-only.
//
// AUTOMATION IS DEFENSIBLE ONLY IF THE PIPELINE CAN VERIFY WHAT IT IS ABOUT TO
// PUT OUT. So every check below is OBJECTIVE and none is a judgement: each one
// compares a fact about this cycle against a fact we already hold, and a brief
// that fails any of them HOLDS as a draft with the reason recorded and reported.
// A held brief is a founder-visible state, never a silent one.
//
// THE CHECKS, in the order they are evaluated:
//
//   1. COVERAGE.   Every enabled source reported a run this cycle. This is
//                  first because it is what stops the rest of the sweep from
//                  being asleep: [].every(ok) is TRUE, so a summary carrying no
//                  sources at all would otherwise pass the source check.
//   2. SOURCES.    Every enabled source returned ok: no 403, no throw, no
//                  timeout, no unreadable page.
//   3. CEILING.    The draft carries no more items than config allows.
//   4. URLS.       Every item URL is https on a host the REGISTRY declares,
//                  checked with citationUrl, the same function the render path
//                  uses. This is a separate check from the render sweep on
//                  purpose: renderCitations DOWNGRADES a bad URL to a span
//                  rather than emitting it, so a poisoned row would pass a
//                  reading of the rendered HTML while still sitting in the
//                  snapshot the page is built from.
//   5. AGE.        No item is dated further back than RECENT_DAYS. An undated
//                  item passes, which mirrors the ingest rule exactly: a date
//                  we could not read is stored NULL rather than guessed.
//   6. RENDER.     The brief is RENDERED and the rendered bytes are swept with
//                  the same em dash rule the built pages are held to, plus an
//                  escaping sweep. Run, not assumed.
//   7. TRIPWIRE.   The important one. See below.
//
// THE STALENESS TRIPWIRE. A breaker that only asks "did the source answer 200"
// misses the failure this whole feature exists to survive: Oracle redesigns its
// advisory page, our matcher silently matches nothing, every fetch is a clean
// 200, and the watch quietly stops watching. That is the asleep-guard failure
// mode running monthly in production under his name.
//
// Oracle ships security content on the THIRD TUESDAY OF EVERY MONTH (quarterly
// Critical Patch Updates in January, April, July and October, Critical Security
// Patch Updates in the other eight), so an empty draft in a cycle whose release
// day has already passed is parse rot rather than a quiet month, UNLESS a brief
// for that same cycle is already live, which is the ordinary "we published on
// Thursday and nothing has happened since" case.
//
// KNOWN BLIND SPOT, written down rather than left to be discovered: a HELD
// draft carried over from last month keeps item_count above zero, so it masks
// this month's parse rot. That is acceptable because a held draft is already a
// notified, founder-visible state: he is being told every cycle that something
// is wrong, which is the outcome the tripwire exists to produce.

import { RECENT_DAYS, thirdTuesdayOf, patchCyclePeriod } from './watch.js';
import { renderBrief, citationUrl } from './watch-pages.js';

// THE HOUSE EM DASH RULE, and it is deliberately the SAME character the built
// page guard in test/built-pages.test.js looks for rather than a wider family
// of our own invention. The ingest path normalises the whole dash family in
// worker/watch.js plainText; this is the last check before publication and it
// must agree with what the site is actually held to.
// Written as an escape rather than as the character, so a repository wide sweep
// for the character finds the fixtures that test this guard and not the guard.
const EM_DASH = '\u2014';

// A rendered fragment may only carry anchors the registry would allow. Anything
// that looks like markup arriving from a database row is a failure, not a
// cosmetic problem.
const SCRIPT_RE = /<script/i;
const HANDLER_RE = /\son[a-z]+\s*=/i;
const HREF_RE = /href="([^"]*)"/gi;

/* ------------------------------------------------------------------ config */

// THE FOUNDER'S KNOBS. Every one is read from the environment with a default
// that is safe on its own, so a Worker deployed with none of them set behaves
// the way this file documents rather than the way a missing value happens to.
export function watchConfig(env) {
  return {
    // The sane ceiling the work order asks for. The registry caps each source
    // at 25 items, and four are enabled, so a run can legitimately produce up
    // to 100: this ceiling sits BELOW that on purpose, or it could never fire.
    // A cycle that suddenly finds forty advisories has almost certainly started
    // matching the wrong thing, and that is worth a hold and a look.
    maxItems: positiveInt(env?.WATCH_MAX_ITEMS, 40),

    // NOTIFY_EMPTY_CYCLES DEFAULTS TO OFF, and that is the founder's own rule
    // applied to his own inbox: he asked for "an aknowledgement about the
    // updated kits only", and an acknowledgement of nothing is exactly the
    // recurring chore his automation-first ruling bans. Set it to 1, true, on
    // or yes to be told about quiet, healthy cycles as well. Held cycles and
    // published cycles are reported WHATEVER this is set to: a hold is not a
    // quiet cycle, it is a fault.
    notifyEmptyCycles: truthy(env?.NOTIFY_EMPTY_CYCLES),

    // Where an acknowledgement is POSTed. A plain configuration value rather
    // than a secret, read the way BEEHIIV_MEMBERS_SEGMENT_ID is read, and https
    // only. Absent means acknowledgements are recorded in D1 and in the log and
    // reach nobody's inbox, which is reported as `not_configured` rather than
    // as a success.
    notifyWebhook: httpsUrl(env?.WATCH_NOTIFY_WEBHOOK),

    // The origin a scheduled run builds links from. A cron has no Request, so
    // the origin cannot be derived the way the HTTP path derives it.
    siteOrigin: httpsUrl(env?.SITE_ORIGIN) ?? 'https://oradiscuss.com',
  };
}

function positiveInt(raw, fallback) {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function truthy(raw) {
  return ['1', 'true', 'yes', 'on'].includes(String(raw ?? '').trim().toLowerCase());
}

function httpsUrl(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- verdict */

function fault(code, detail) {
  return { code, detail };
}

// The one place a verdict is shaped, so every caller reads the same three words.
//
// THE BREAKER SAYS `pass`, NOT `published`. It decides whether a brief MAY go
// out; the cycle ledger records what then HAPPENED, as published, held or
// quiet. Keeping the two vocabularies apart is what lets "the breaker passed
// and the publish write failed" be a state with a name.
function verdict(name, faults) {
  return {
    verdict: name,
    ok: name === 'pass',
    faults,
    // The founder-facing sentence. Joined here rather than at each caller so
    // the log line, the D1 row, the API response and the acknowledgement all
    // quote the same text.
    reasons: faults.length ? faults.map((f) => f.detail).join('; ') : null,
  };
}

/* ---------------------------------------------------------------- the checks */

// EVERY ENABLED SOURCE REPORTED, AND EVERY ONE OF THEM RETURNED OK.
export function checkSources(summary, expectedIds) {
  const faults = [];
  const reported = new Map((summary?.sources ?? []).map((s) => [s.id, s]));

  for (const id of expectedIds) {
    const row = reported.get(id);
    if (!row) {
      faults.push(fault('source_missing', `source ${id} reported no run this cycle`));
      continue;
    }
    if (row.ok !== true) {
      const status = Number.isInteger(row.http_status) ? ` (http ${row.http_status})` : '';
      faults.push(fault('source_failed', `source ${id} did not return ok: ${row.error ?? 'unknown'}${status}`));
    }
  }
  return faults;
}

// EVERY ITEM URL IS https ON A HOST THE REGISTRY DECLARES, and no item is older
// than the ingest window.
export function checkItems(snapshot, { now, maxItems }) {
  const faults = [];

  if (snapshot.length > maxItems) {
    faults.push(
      fault('item_ceiling', `the draft carries ${snapshot.length} items, above the configured ceiling of ${maxItems}`),
    );
  }

  snapshot.forEach((item, index) => {
    const url = String(item?.url ?? '');
    if (citationUrl(url) === null) {
      faults.push(
        fault(
          'item_url',
          `item ${index + 1} links to ${url.slice(0, 120) || '(nothing)'}, which is not https on a host the registry declares`,
        ),
      );
    }

    // Undated items pass, exactly as they do at ingest. A date we could not
    // read is NULL rather than guessed into today, and holding a whole brief
    // because Oracle left a cell blank would be a breaker that fires on the
    // source's formatting rather than on our own correctness.
    const dated = typeof item?.published_on === 'string' ? Date.parse(`${item.published_on}T00:00:00Z`) : NaN;
    if (Number.isFinite(dated) && now.getTime() - dated > RECENT_DAYS * 86400000) {
      faults.push(
        fault('item_age', `item ${index + 1} is dated ${item.published_on}, older than the ${RECENT_DAYS} day window`),
      );
    }
  });

  return faults;
}

// THE RENDERED BYTES, SWEPT. This renders the brief with the same function the
// public page uses and reads the result, because a guard that reasons about
// what the renderer would probably do is not a guard.
export function checkRendered(brief, snapshot) {
  const faults = [];
  let html;
  try {
    html = renderBrief({ ...brief, sources_json: JSON.stringify(snapshot) });
  } catch (err) {
    return [fault('render_failed', `the brief could not be rendered: ${String(err?.message ?? err).slice(0, 120)}`)];
  }

  const dash = html.indexOf(EM_DASH);
  if (dash >= 0) {
    faults.push(
      fault('render_em_dash', `the rendered brief carries an em dash at offset ${dash}: ...${context(html, dash)}...`),
    );
  }

  if (SCRIPT_RE.test(html)) faults.push(fault('render_markup', 'the rendered brief carries a script tag'));
  if (HANDLER_RE.test(html)) {
    faults.push(fault('render_markup', 'the rendered brief carries an inline event handler attribute'));
  }

  for (const [, href] of html.matchAll(HREF_RE)) {
    // The rendered href is HTML escaped, so it is unescaped before it is judged
    // by the same rule the registry sets. &amp; is the only entity escapeHtml
    // can put inside a URL that changes how it parses.
    const raw = href.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    if (raw.startsWith('/watch/') || raw.startsWith('#')) continue;
    if (citationUrl(raw) === null) {
      faults.push(fault('render_link', `the rendered brief carries a link to ${raw.slice(0, 120)}`));
    }
  }

  return faults;
}

function context(html, index) {
  return html.slice(Math.max(0, index - 60), index + 40).replace(/\s+/g, ' ');
}

// THE STALENESS TRIPWIRE. Returns a fault when an empty cycle cannot be
// explained, and null when it can.
export function checkStaleness(snapshot, { now, publishedThisPeriod }) {
  if (snapshot.length > 0) return null;
  const period = patchCyclePeriod(now);
  const releaseDay = thirdTuesdayOf(now.getUTCFullYear(), now.getUTCMonth());
  if (now.getTime() < releaseDay.getTime()) return null;
  if (publishedThisPeriod) return null;
  return fault(
    'stale_parse',
    `every source returned ok and the draft is empty, but Oracle's release day for ${period} was ` +
      `${releaseDay.toISOString().slice(0, 10)} and no brief has been published for that cycle: ` +
      'that is a parser that stopped matching, not a quiet month',
  );
}

/* ------------------------------------------------------------- the verdict */

// THE WHOLE BREAKER. `pass` only when every check passed; `quiet` when there
// was nothing to publish and nothing wrong with that; `hold` otherwise.
//
// A quiet cycle is NOT an ok cycle with zero items dressed up: it is the state
// where the pipeline is healthy, Oracle has not shipped anything we have not
// already covered, and there is no brief to put out. It publishes nothing and,
// by default, says nothing.
export function evaluateBreaker({ summary, brief, snapshot, now, config, expectedIds, publishedThisPeriod }) {
  const faults = [...checkSources(summary, expectedIds)];
  const items = Array.isArray(snapshot) ? snapshot : [];

  // The source sweep is the gate on everything after it. If a source failed we
  // do not yet know what the cycle SHOULD have found, so "the draft is empty"
  // carries no information and the tripwire must not speak.
  if (faults.length > 0) {
    faults.push(...checkItems(items, { now, maxItems: config.maxItems }));
    return verdict('hold', faults);
  }

  if (items.length === 0) {
    const stale = checkStaleness(items, { now, publishedThisPeriod });
    return stale ? verdict('hold', [stale]) : verdict('quiet', []);
  }

  faults.push(...checkItems(items, { now, maxItems: config.maxItems }));
  faults.push(...checkRendered(brief, items));

  return faults.length ? verdict('hold', faults) : verdict('pass', []);
}
