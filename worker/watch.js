// THE SECURITY WATCH PIPELINE. It reads the registry, fetches, and writes
// DRAFTS. It cannot publish, and there is no branch below that sets a brief
// live or sends anything to anybody: publishing is a founder gate and lives in
// worker/watch-publish.js, behind a token, reached only by an HTTP call a
// person makes. A guard in test/watch.test.js sweeps this file for the words
// that would break that separation.
//
// THREE PROPERTIES THIS FILE EXISTS TO HAVE:
//
//   1. IDEMPOTENT. An item's identity is a digest of the source id, the item's
//      own path and, where the source has one, its revision string. Second run,
//      same page, zero new rows, and the draft body is rewritten to the same
//      bytes so nothing is even touched.
//   2. ISOLATED FAILURES. Each source is fetched, parsed and recorded inside
//      its own try. A source that 403s cannot stop the source after it.
//   3. FAILURES ARE RECORDED, NOT SKIPPED. Every source leaves a row in
//      watch_source_run every run, ok or not, with the status code and the
//      reason. A watch that quietly stopped watching looks exactly like a quiet
//      month, and this table is the only thing that tells the two apart.

import { sha256Hex } from './crypto.js';
import { enabledSources, registrySummary } from './watch-sources.js';

// A page we cannot read in fifteen seconds is a failure worth recording rather
// than a scheduled run that hangs.
const FETCH_TIMEOUT_MS = 15000;

// Oracle's advisory index was 49,778 bytes on 8 Aug 2026. This is a sanity
// ceiling, not a tuning knob.
const MAX_PAGE_BYTES = 4 * 1024 * 1024;

// How far back an item may be dated and still enter a brief. The advisory index
// carries every release since 2021, and a brief that opens with a 2021 bulletin
// because Oracle revised its page is not a security watch, it is noise. Undated
// items are kept: the founder can see them and decide.
export const RECENT_DAYS = 120;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/* --------------------------------------------------------------- text */

// Oracle's own markup arrives inside the cells we read: HTML comments left by
// a paste from Word (<!--StartFragment-->), nested spans, and entities. All of
// it is stripped before anything is stored, so what lands in D1 is the text a
// person would have read.
export function plainText(value) {
  let text = String(value ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ');
  text = decodeEntities(text);
  // Anything that still looks like a tag after decoding is dropped rather than
  // stored. The render path escapes as well, so this is the second of two.
  text = text.replace(/[<>]/g, ' ');
  // NO EM DASHES ANYWHERE is a house rule that applies to text we did not
  // write, because it reaches the same rendered page and the same guard.
  text = text.replace(/[‒–—―−]/g, '-');
  return text.replace(/\s+/g, ' ').trim();
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => safeChar(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => safeChar(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function safeChar(code) {
  if (!Number.isInteger(code) || code < 32 || code > 0x10ffff) return ' ';
  return String.fromCodePoint(code);
}

// "Rev 5, 30 July 2026" becomes { revision: 'Rev 5', published_on: '2026-07-30' }.
// Either half may be missing and the item still counts: a date we cannot read
// is stored as NULL rather than guessed into today, which would make an old
// advisory look like this month's news.
export function parseRevisionCell(raw) {
  const text = plainText(raw);
  const revision = /rev\s*\.?\s*(\d+)/i.exec(text);
  const date = /(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/.exec(text);
  let published_on = null;
  if (date) {
    const month = MONTHS.findIndex((m) => m.toLowerCase().startsWith(date[2].toLowerCase().slice(0, 3)));
    const day = Number(date[1]);
    if (month >= 0 && day >= 1 && day <= 31) {
      published_on = `${date[3]}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return { revision: revision ? `Rev ${revision[1]}` : null, published_on, text };
}

/* ---------------------------------------------------------- extractors */

// One extractor per registry `kind`. A source names its kind; nothing here
// names a source.
export const EXTRACTORS = {
  'oracle-alert-index': extractAlertIndex,
  feed: extractFeed,
};

// Oracle's advisory index is four HTML tables of two cells: a linked title, and
// a "Rev N, DD Month YYYY" cell. Verified against the live page on 8 Aug 2026,
// where this matcher found 55 rows.
export function extractAlertIndex(html, source) {
  // A registry row of this kind without a path pattern would match every link
  // on the page, so it matches nothing instead.
  if (!source?.pathPattern) return [];
  const rows = [
    ...String(html ?? '').matchAll(
      /<tr[^>]*>\s*<td[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
    ),
  ];
  const out = [];
  for (const [, href, title, meta] of rows) {
    const path = href.startsWith('http') ? safePath(href) : href;
    if (path === null || !source.pathPattern.test(path)) continue;
    const { revision, published_on } = parseRevisionCell(meta);
    out.push({
      href,
      title: plainText(title),
      revision,
      published_on,
      // Identity includes the revision on purpose: "July 2026 is now Rev 5" is
      // news for a security brief, and a second sighting of Rev 5 is not.
      identity: `${path.toLowerCase()}:${revision ?? 'rev?'}`,
    });
  }
  return out;
}

function safePath(href) {
  try {
    return new URL(href).pathname;
  } catch {
    return null;
  }
}

// RSS 2.0 and Atom, enough of each to read a title, a link, a date and an id.
// No source in the registry is currently enabled for this kind: it exists so
// the blogs.oracle.com row is an unconfirmed SOURCE rather than an unwritten
// PARSER, and it is exercised by the tests against a synthetic feed.
export function extractFeed(xml, source) {
  const text = String(xml ?? '');
  const blocks = [
    ...text.matchAll(/<item[\s>][\s\S]*?<\/item>/gi),
    ...text.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi),
  ].map((m) => m[0]);

  const out = [];
  for (const block of blocks) {
    const title = plainText(tag(block, 'title'));
    const href = feedLink(block);
    if (!title || !href) continue;
    const dateRaw = tag(block, 'pubDate') || tag(block, 'updated') || tag(block, 'published');
    const parsed = dateRaw ? Date.parse(plainText(dateRaw)) : NaN;
    const published_on = Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
    const guid = plainText(tag(block, 'guid') || tag(block, 'id')) || href;
    out.push({ href, title, revision: null, published_on, identity: guid.toLowerCase() });
  }
  return out.slice(0, source.maxItems ?? 25);
}

function tag(block, name) {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? m[1] : '';
}

function feedLink(block) {
  const atom = /<link[^>]+href="([^"]+)"/i.exec(block);
  if (atom) return plainText(atom[1]);
  const rss = /<link[^>]*>([\s\S]*?)<\/link>/i.exec(block);
  return rss ? plainText(rss[1]) : '';
}

/* ------------------------------------------------------------ items */

// The gate between a fetched page and our database. It refuses more than it
// accepts on purpose: a source page we do not control must not be able to put
// a javascript: link, an off Oracle host, or an empty title into a brief that
// carries our name.
export function normaliseItem(source, raw) {
  const title = plainText(raw.title).slice(0, 200);
  if (!title) return null;

  let url;
  try {
    url = new URL(raw.href, source.url);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!source.hosts.includes(url.hostname)) return null;

  return {
    source_id: source.id,
    title,
    url: url.href,
    revision: raw.revision ? String(raw.revision).slice(0, 32) : null,
    published_on: raw.published_on ?? null,
    identity: String(raw.identity ?? url.href).slice(0, 300),
  };
}

export async function itemKey(item) {
  return sha256Hex(`${item.source_id}:${item.identity}`);
}

function isRecent(item, now) {
  if (!item.published_on) return true;
  const at = Date.parse(`${item.published_on}T00:00:00Z`);
  if (!Number.isFinite(at)) return true;
  return now.getTime() - at <= RECENT_DAYS * 86400000;
}

/* --------------------------------------------------------- the D1 writes */

// INSERT OR IGNORE is what makes a second run over the same source produce
// nothing. `changes` is read rather than assumed, so the count reported is the
// count the database actually made.
async function insertItem(env, key, item) {
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO watch_item (item_key, source_id, title, url, revision, published_on, first_seen_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))`,
  )
    .bind(key, item.source_id, item.title, item.url, item.revision, item.published_on)
    .run();
  return (res?.meta?.changes ?? 0) > 0;
}

async function recordRun(env, sourceId, result) {
  await env.DB.prepare(
    `INSERT INTO watch_source_run (source_id, ran_at, ok, http_status, items_found, items_new, error)
     VALUES (?1, datetime('now'), ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(
      sourceId,
      result.ok ? 1 : 0,
      Number.isInteger(result.http_status) ? result.http_status : null,
      result.items_found ?? 0,
      result.items_new ?? 0,
      result.error ? String(result.error).slice(0, 200) : null,
    )
    .run();
}

/* --------------------------------------------------------------- fetching */

async function fetchPage(url, fetcher) {
  const init = {
    headers: {
      // Says who we are and where to complain. A watcher that hides is a
      // scraper; this one is a reader.
      'User-Agent': 'OraDiscussSecurityWatch/1.0 (+https://oradiscuss.com/watch/)',
      Accept: 'text/html, application/xhtml+xml, application/rss+xml, application/atom+xml, */*;q=0.8',
    },
  };
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    init.signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  }

  const res = await fetcher(url, init);
  if (!res.ok) {
    return { ok: false, http_status: res.status, body: null, error: `http_${res.status}` };
  }
  const body = await res.text();
  if (body.length > MAX_PAGE_BYTES) {
    return { ok: false, http_status: res.status, body: null, error: 'page_too_large' };
  }
  return { ok: true, http_status: res.status, body, error: null };
}

async function ingestSource(env, source, { now, fetcher, pages }) {
  const extractor = EXTRACTORS[source.kind];
  if (!extractor) return { ok: false, http_status: null, items_found: 0, items_new: 0, error: 'no_extractor' };

  if (!pages.has(source.url)) pages.set(source.url, fetchPage(source.url, fetcher));
  let page;
  try {
    page = await pages.get(source.url);
  } catch (err) {
    return { ok: false, http_status: null, items_found: 0, items_new: 0, error: reason(err) };
  }
  if (!page.ok) {
    return { ok: false, http_status: page.http_status, items_found: 0, items_new: 0, error: page.error };
  }

  const raw = extractor(page.body, source);
  const items = raw
    .map((r) => normaliseItem(source, r))
    .filter((i) => i !== null && isRecent(i, now))
    .slice(0, source.maxItems ?? 25);

  let created = 0;
  for (const item of items) {
    const key = await itemKey(item);
    if (await insertItem(env, key, item)) created += 1;
  }
  return { ok: true, http_status: page.http_status, items_found: items.length, items_new: created, error: null };
}

function reason(err) {
  const text = String(err?.message ?? err ?? 'unknown');
  return text.slice(0, 200);
}

/* ------------------------------------------------------------- the draft */

/* ---------------------------------------------------------------------------
   THE BRIEF IS KEYED TO ORACLE'S PATCH CYCLE, WHICH IS MONTHLY.
   Founder ruling 9 Aug 2026: monthly, not weekly, timed one or two days after
   Oracle publishes.

   THIS IS NOT AN ARBITRARY CADENCE. IT IS ORACLE'S OWN, READ OFF ORACLE'S OWN
   PAGE rather than recalled. https://www.oracle.com/security-alerts/ states:

     - Critical Patch Updates are quarterly, and the next four are 20 October
       2026, 19 January 2027, 20 April 2027 and 20 July 2027, which are the
       THIRD TUESDAY of January, April, July and October.
     - "Critical Security Patch Updates will be released on the third Tuesday
       of February, March, May, June, August, September, November, and
       December."

   Those two series together mean Oracle ships security content on the THIRD
   TUESDAY OF EVERY MONTH. Two days later is the third Thursday, which is why
   the cron in wrangler.toml reads `0 6 * * THU#3`.

   ONE THING THIS CADENCE DOES NOT COVER, stated rather than left to be found:
   Oracle issues out-of-band Security Alerts for "vulnerability fixes deemed
   too critical to wait", so a monthly schedule can trail one by up to a month.
   The token-gated `POST /api/watch/run` picks those up on demand with no
   schedule change. A second, more frequent polling cron is a one-line addition
   and is deliberately NOT made here: the founder asked for monthly, and a seat
   should not quietly widen the instruction it was given.
   --------------------------------------------------------------------------- */

// The Oracle patch cycle a brief belongs to, at the granularity Oracle
// publishes at.
export function patchCyclePeriod(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

// The third Tuesday of a month: Oracle's own release day. Exported so a test
// can check it against the real dates Oracle published rather than against a
// reimplementation of the same arithmetic.
export function thirdTuesdayOf(year, monthIndex) {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  // getUTCDay: 0 is Sunday, so 2 is Tuesday. Step to the first Tuesday, then
  // two more weeks to the third.
  const offset = (2 - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, monthIndex, 1 + offset + 14));
}

export function briefTitleFor(date) {
  return `Security Watch, ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// The generated lede. It says only what stays true after the founder publishes,
// because he may publish it unedited: nothing here describes the draft state,
// and the item list is NOT in this text. Citations are rendered from the
// structured snapshot instead, so there is one source of truth for a link.
export function briefBody(count) {
  const what =
    count === 1
      ? 'This brief cites one item from the Oracle sources in our watch registry.'
      : `This brief cites ${count} items from the Oracle sources in our watch registry.`;
  return [
    count === 0
      ? 'No new advisory appeared on the Oracle sources in our watch registry for this period.'
      : what,
    "Each one links to Oracle's own page, which is the authority. This is a pointer to it, never a copy of it.",
    'My Oracle Support notes are not covered: MOS needs an authenticated session and is not machine readable, so anything from there is added by hand or not at all.',
  ].join('\n\n');
}

// The one open draft, or a new one. Everything unassigned attaches to whatever
// this returns, which is why publishing a brief is all it takes to start the
// next one: a published brief is no longer open, so the next run opens a fresh
// draft and the item found an hour later lands there.
async function openDraft(env, now) {
  const existing = await env.DB.prepare(
    `SELECT id, slug, title, body_md, sources_json, period, item_count
       FROM watch_brief
      WHERE status = 'draft'
      ORDER BY id DESC
      LIMIT 1`,
  ).first();
  if (existing) return existing;

  const period = patchCyclePeriod(now);
  const base = `watch-${period.toLowerCase()}`;
  let slug = base;
  for (let n = 2; n <= 50; n += 1) {
    const taken = await env.DB.prepare('SELECT 1 AS taken FROM watch_brief WHERE slug = ?1').bind(slug).first();
    if (!taken) break;
    slug = `${base}-${n}`;
  }

  const title = briefTitleFor(now);
  await env.DB.prepare(
    `INSERT INTO watch_brief (slug, title, body_md, sources_json, status, period, item_count, created_at, updated_at)
     VALUES (?1, ?2, ?3, '[]', 'draft', ?4, 0, datetime('now'), datetime('now'))`,
  )
    .bind(slug, title, briefBody(0), period)
    .run();

  return env.DB.prepare(
    `SELECT id, slug, title, body_md, sources_json, period, item_count FROM watch_brief WHERE slug = ?1`,
  )
    .bind(slug)
    .first();
}

// Deterministic on purpose. Same items in, same bytes out, so "a second run
// changes nothing" is an assertion a test can make about the CONTENT rather
// than about a row count.
export function snapshotOf(items) {
  return JSON.stringify(
    items.map((i) => ({
      source_id: i.source_id,
      title: i.title,
      url: i.url,
      revision: i.revision ?? null,
      published_on: i.published_on ?? null,
    })),
  );
}

export async function rollUpDraft(env, now) {
  const draft = await openDraft(env, now);
  if (!draft) return null;

  // Only the open draft is ever written to. The UPDATE below carries the same
  // condition, so even a race that published this brief mid run cannot let the
  // job rewrite a published one.
  await env.DB.prepare('UPDATE watch_item SET brief_id = ?1 WHERE brief_id IS NULL').bind(draft.id).run();

  const { results } = await env.DB.prepare(
    `SELECT source_id, title, url, revision, published_on, item_key
       FROM watch_item
      WHERE brief_id = ?1
      ORDER BY (published_on IS NULL) ASC, published_on DESC, item_key ASC`,
  )
    .bind(draft.id)
    .all();

  const items = results ?? [];
  const sources_json = snapshotOf(items);
  const body_md = briefBody(items.length);

  if (draft.body_md === body_md && draft.sources_json === sources_json) {
    return { id: draft.id, slug: draft.slug, item_count: items.length, changed: false };
  }

  await env.DB.prepare(
    `UPDATE watch_brief
        SET body_md = ?1, sources_json = ?2, item_count = ?3, updated_at = datetime('now')
      WHERE id = ?4 AND status = 'draft'`,
  )
    .bind(body_md, sources_json, items.length, draft.id)
    .run();

  return { id: draft.id, slug: draft.slug, item_count: items.length, changed: true };
}

/* ----------------------------------------------------------------- the run */

// The whole job. Called by the Cron Trigger through worker.js `scheduled`, and
// by the authenticated POST /api/watch/run so the pipeline can be verified on
// preview WITHOUT arming a cron anywhere.
export async function runWatch(env, options = {}) {
  const now = options.now ?? new Date();
  const fetcher = options.fetcher ?? fetch;
  const sources = options.sources ?? enabledSources();
  const pages = new Map();

  const summary = { ran_at: now.toISOString(), sources: [], items_new: 0, brief: null };

  for (const source of sources) {
    let result;
    try {
      result = await ingestSource(env, source, { now, fetcher, pages });
    } catch (err) {
      // One source cannot take the run down with it.
      console.error('watch_source_failed', source.id, reason(err));
      result = { ok: false, http_status: null, items_found: 0, items_new: 0, error: reason(err) };
    }

    let recorded = true;
    try {
      await recordRun(env, source.id, result);
    } catch (err) {
      // The failure of the failure record. It cannot be swallowed, because the
      // whole point of that table is that nothing goes unseen.
      recorded = false;
      console.error('watch_run_unrecorded', source.id, reason(err));
    }

    if (!result.ok) console.warn('watch_source_not_ok', source.id, result.error, `recorded=${recorded}`);
    summary.sources.push({ id: source.id, ...result, recorded });
    summary.items_new += result.items_new ?? 0;
  }

  try {
    summary.brief = await rollUpDraft(env, now);
  } catch (err) {
    console.error('watch_rollup_failed', reason(err));
    summary.brief_error = reason(err);
  }

  return summary;
}

/* -------------------------------------------------------------- the reads */

// PUBLIC READS. Both filter on status = 'live' by EQUALITY rather than on
// "not draft", so any status word invented later is invisible to the public
// site until somebody deliberately teaches these two queries about it.
export async function listLiveBriefs(env, limit = 100) {
  const { results } = await env.DB.prepare(
    `SELECT slug, title, published_at, item_count
       FROM watch_brief
      WHERE status = 'live'
      ORDER BY published_at DESC, id DESC
      LIMIT ?1`,
  )
    .bind(limit)
    .all();
  return results ?? [];
}

export async function readLiveBrief(env, slug) {
  return env.DB.prepare(
    `SELECT slug, title, body_md, sources_json, published_at, item_count
       FROM watch_brief
      WHERE slug = ?1 AND status = 'live'`,
  )
    .bind(slug)
    .first();
}

// The founder's view, behind the token in worker/watch-publish.js. It reports
// the registry INCLUDING the sources that are not watched, because a source
// nobody watches must be visible as such, and the last run of each watched one.
export async function watchStatus(env) {
  const drafts = await env.DB.prepare(
    `SELECT slug, title, period, item_count, created_at, updated_at
       FROM watch_brief
      WHERE status = 'draft'
      ORDER BY id DESC
      LIMIT 20`,
  ).all();

  const runs = await env.DB.prepare(
    `SELECT r.source_id, r.ran_at, r.ok, r.http_status, r.items_found, r.items_new, r.error
       FROM watch_source_run r
       JOIN (SELECT source_id, MAX(id) AS id FROM watch_source_run GROUP BY source_id) latest
         ON latest.id = r.id
      ORDER BY r.source_id`,
  ).all();

  const published = await env.DB.prepare(
    `SELECT slug, title, published_at, sent_at, send_status
       FROM watch_brief
      WHERE status = 'live'
      ORDER BY published_at DESC, id DESC
      LIMIT 10`,
  ).all();

  return {
    registry: registrySummary(),
    last_run_by_source: runs.results ?? [],
    drafts: drafts.results ?? [],
    published: published.results ?? [],
  };
}
