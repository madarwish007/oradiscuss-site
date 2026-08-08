// THE CHANGELOG IS GENERATED. Founder ruling, 5 Aug: truth lives in data, pages
// render from it, automation writes it. Hand edited static truth is a defect
// wherever automation can own it.
//
// So there is no changelog content in the repository. The `changelog` table in
// D1 is written by the release pipeline, and this file is the only thing that
// turns it into a page.
//
// HOW THE PAGE IS ASSEMBLED, and why it is done this way. The site is a static
// Astro build served from the ASSETS binding, and D1 exists only at request
// time, so neither half can produce this page alone. The Worker fetches the
// built page, which carries the site's real header, footer, styles and layout,
// and replaces one slot inside it with rows read from D1. The alternative, a
// self contained page rendered here, would be a second copy of the design that
// drifts from the first the moment anyone touches the brand.
//
// EVERY FAILURE SERVES THE STATIC PAGE UNTOUCHED. Its slot already contains the
// sentence "the changelog could not be read", so a D1 outage produces a page
// that is true rather than a page that is broken or, worse, a page that shows
// nothing and implies there have been no releases.

import { json } from './http.js';

// The slot name is a parameter rather than a constant, because /watch/ fills
// slots of its own with the same injector. It was a literal "changelog" until
// Phase 8, and the first watch page silently served its fallback because of it:
// the injector found no slot, returned null, and the page that reached the
// browser was the honest one saying the record could not be read. That failure
// mode is the right one, and it is also why the guard that caught it asserts
// the CONTENT rather than the status code.
const SLOT_NAME = /^[a-z][a-z0-9-]{2,40}$/;

function slotOpener(name) {
  if (!SLOT_NAME.test(name)) throw new Error(`unusable slot name: ${name}`);
  return new RegExp(`<div[^>]*data-slot="${name}"[^>]*>`);
}

export async function readChangelog(env) {
  const { results } = await env.DB.prepare(
    `SELECT c.pack, c.version, c.body_md, c.released_at, r.sha256, r.min_tier
       FROM changelog c
       LEFT JOIN pack_release r ON r.pack = c.pack AND r.version = c.version
      ORDER BY c.released_at DESC, c.id DESC
      LIMIT 200`,
  ).all();
  return results ?? [];
}

// GET /api/changelog. The same data the page renders, for anyone who would
// rather read it as JSON than scrape a page.
export async function changelogJson(env) {
  try {
    const entries = await readChangelog(env);
    return json({ entries }, { cache: 'public, max-age=300' });
  } catch (err) {
    console.error('changelog_read_failed', String(err?.message ?? err));
    return json({ ok: false, error: 'The changelog could not be read just now.' }, { status: 503 });
  }
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Release notes are rendered as ESCAPED TEXT with paragraph breaks, and that is
// a decision rather than a shortcut. There is no markdown renderer in this
// Worker, and hand rolling one is how a store of text becomes a store of
// scripts: every plausible shortcut ends in emitting markup that came out of a
// database row. Blank lines separate paragraphs, single newlines are kept, and
// everything else arrives on the page as the characters somebody typed.
export function renderNotes(bodyMd) {
  const text = typeof bodyMd === 'string' ? bodyMd : '';
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length === 0) return '';
  return blocks
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

// D1 writes `datetime('now')` as "YYYY-MM-DD HH:MM:SS" in UTC with no zone
// marker, while an ISO string from the release pipeline carries one. Both are
// handled, and anything else is escaped and shown as it was stored rather than
// silently becoming "Invalid Date".
export function formatDate(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  const iso = value.replace(' ', 'T');
  const zoned = /([Zz]|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`;
  const parsed = Date.parse(zoned);
  if (!Number.isFinite(parsed)) return escapeHtml(value);
  return new Date(parsed).toISOString().slice(0, 10);
}

function audience(minTier) {
  if (minTier === 0) return 'Free tier';
  if (minTier === 1) return 'Toolkit and above';
  if (Number.isInteger(minTier) && minTier >= 2) return 'Toolkit and Academy';
  return 'Not yet released';
}

export function renderEntries(entries) {
  if (!entries.length) {
    return '<p class="cl-empty">No releases have been published yet. The first one appears here the day a pack ships.</p>';
  }

  return entries
    .map((entry) => {
      const heading = `${escapeHtml(entry.pack)} ${escapeHtml(entry.version)}`;
      const digest = typeof entry.sha256 === 'string' && entry.sha256.length > 0
        ? `<p class="cl-digest"><span>sha256</span><code>${escapeHtml(entry.sha256)}</code></p>`
        : '';
      return [
        '<article class="cl-entry">',
        '<header class="cl-head">',
        `<h2 class="cl-title">${heading}</h2>`,
        `<p class="cl-meta"><time datetime="${escapeHtml(entry.released_at ?? '')}">${formatDate(entry.released_at)}</time><span class="cl-dot">·</span><span>${audience(entry.min_tier)}</span></p>`,
        '</header>',
        `<div class="cl-notes">${renderNotes(entry.body_md)}</div>`,
        digest,
        '</article>',
      ].join('');
    })
    .join('');
}

// Replaces the CONTENT of the slot element, leaving the element and everything
// around it alone. It refuses rather than guesses: if the slot is absent, or if
// somebody has nested a div inside it so the closing tag is ambiguous, this
// returns null and the caller serves the static page.
export function injectIntoSlot(html, replacement, name = 'changelog') {
  const open = slotOpener(name).exec(html);
  if (!open) return null;
  const innerStart = open.index + open[0].length;
  const end = html.indexOf('</div>', innerStart);
  if (end < 0) return null;
  if (html.slice(innerStart, end).includes('<div')) return null;
  return html.slice(0, innerStart) + replacement + html.slice(end);
}

export async function changelogPage(request, env) {
  const asset = await env.ASSETS.fetch(request);
  const type = asset.headers.get('content-type') ?? '';
  if (!asset.ok || !type.includes('text/html')) return asset;

  const html = await asset.text();

  let entries;
  try {
    entries = await readChangelog(env);
  } catch (err) {
    console.error('changelog_read_failed', String(err?.message ?? err));
    return htmlResponse(html);
  }

  const injected = injectIntoSlot(html, renderEntries(entries));
  if (injected === null) {
    // The page shipped without the slot this Worker writes into. That is a
    // build problem, and serving the static page is the honest answer.
    console.error('changelog_slot_missing');
    return htmlResponse(html);
  }
  return htmlResponse(injected);
}

function htmlResponse(body) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Short, because a release should appear without waiting on an edge TTL.
      'Cache-Control': 'public, max-age=60',
    },
  });
}
