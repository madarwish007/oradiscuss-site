// THE PUBLIC /watch/ ARCHIVE, rendered from D1 into the built pages, exactly
// as /changelog/ is. The site is a static Astro build served from ASSETS and
// D1 exists only at request time, so neither half can produce these pages
// alone: the Worker fetches the built page, which carries the real header,
// footer and styles, and replaces one slot inside it.
//
// A DRAFT CANNOT REACH EITHER PAGE. Not by policy, by query: both reads filter
// `status = 'live'` by equality in worker/watch.js, an unknown slug answers
// 404 from the same code that serves a real one, and there is no parameter on
// either route that selects a status. A guard in test/watch.test.js seeds a
// draft and asserts it is absent from the index and 404 by slug.
//
// EVERY FAILURE SERVES THE BUILT PAGE UNTOUCHED, whose slot already says the
// record could not be read. A database outage produces a page that is true
// rather than one that is broken or, worse, one that shows nothing and implies
// there have been no briefs.

import { escapeHtml, renderNotes, formatDate, injectIntoSlot } from './changelog.js';
import { listLiveBriefs, readLiveBrief } from './watch.js';
import { registryHosts } from './watch-sources.js';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

// The shell page every /watch/<slug>/ URL is rendered into. It is a real built
// page so that a brief inherits the site design instead of a second copy of it.
const BRIEF_SHELL_PATH = '/watch/brief/';

/* --------------------------------------------------------------- citations */

// A stored URL becomes a link only if it parses, speaks https, and lives on a
// host the REGISTRY declares. The pipeline enforces the same rule on the way
// in; this is the second of the two, because the thing being defended is a
// page that carries our name and a reader who trusts the link on it.
export function citationUrl(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  return registryHosts().includes(url.hostname) ? url.href : null;
}

export function parseSnapshot(sourcesJson) {
  let parsed;
  try {
    parsed = JSON.parse(typeof sourcesJson === 'string' && sourcesJson.length ? sourcesJson : '[]');
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter((i) => i && typeof i === 'object') : [];
}

// Citations are rendered from the STRUCTURED snapshot, never from body_md.
// body_md is prose and is escaped to text by renderNotes; a link built out of
// prose would be a link built out of a database row, which is how a store of
// text becomes a store of markup.
export function renderCitations(items) {
  const rows = items
    .map((item) => {
      const href = citationUrl(item.url);
      const title = escapeHtml(String(item.title ?? '').slice(0, 200));
      if (!title) return '';
      const label = href ? `<a href="${escapeHtml(href)}" rel="noopener">${title}</a>` : `<span>${title}</span>`;
      const bits = [];
      if (item.published_on) bits.push(escapeHtml(String(item.published_on).slice(0, 10)));
      if (item.revision) bits.push(escapeHtml(String(item.revision).slice(0, 32)));
      if (item.source_id) bits.push(escapeHtml(String(item.source_id).slice(0, 40)));
      return `<div class="wb-cite">${label}<p>${bits.join(' &middot; ')}</p></div>`;
    })
    .filter(Boolean);

  return rows.length ? `<div class="wb-cites">${rows.join('')}</div>` : '';
}

/* ------------------------------------------------------------- the index */

export function renderIndex(briefs) {
  const rows = briefs
    .filter((b) => typeof b.slug === 'string' && SLUG_RE.test(b.slug))
    .map((b) => {
      const count = Number.isInteger(b.item_count) ? b.item_count : 0;
      const items = count === 1 ? '1 cited item' : `${count} cited items`;
      return [
        '<article class="wa-entry">',
        `<h2 class="wa-title"><a href="/watch/${escapeHtml(b.slug)}/">${escapeHtml(b.title ?? b.slug)}</a></h2>`,
        `<p class="wa-meta"><time datetime="${escapeHtml(b.published_at ?? '')}">${formatDate(b.published_at)}</time><span class="wa-dot">&middot;</span><span>${items}</span></p>`,
        '</article>',
      ].join('');
    });

  if (!rows.length) {
    return '<p class="wa-empty">No brief has been published yet. The first one appears here on the day a person publishes it.</p>';
  }
  return rows.join('');
}

export async function watchIndexPage(request, env) {
  const asset = await env.ASSETS.fetch(request);
  const type = asset.headers.get('content-type') ?? '';
  if (!asset.ok || !type.includes('text/html')) return asset;

  const html = await asset.text();

  let briefs;
  try {
    briefs = await listLiveBriefs(env);
  } catch (err) {
    console.error('watch_index_read_failed', String(err?.message ?? err));
    return htmlResponse(html);
  }

  const injected = injectIntoSlot(html, renderIndex(briefs), 'watch-index');
  if (injected === null) {
    console.error('watch_index_slot_missing');
    return htmlResponse(html);
  }
  return htmlResponse(injected);
}

/* -------------------------------------------------------------- one brief */

export function renderBrief(brief) {
  const items = parseSnapshot(brief.sources_json);
  const count = items.length;
  const label = count === 1 ? '1 cited item' : `${count} cited items`;
  return [
    `<h1 class="rv">${escapeHtml(brief.title ?? 'Security Watch')}</h1>`,
    `<p class="wb-meta"><time datetime="${escapeHtml(brief.published_at ?? '')}">${formatDate(brief.published_at)}</time><span>&middot;</span><span>${label}</span></p>`,
    `<div class="wb-body">${renderNotes(brief.body_md)}</div>`,
    renderCitations(items),
  ].join('');
}

// The shell is built once with one title, one description and one canonical, so
// serving every brief through it without rewriting the head would give every
// brief the same title in a search result and the same canonical URL, which
// tells a crawler they are all the same page. The robots meta goes the other
// way: the shell ships noindex and the real brief has it removed.
export function rewriteHead(html, { title, description, canonical }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const c = escapeHtml(canonical);

  let out = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`);
  out = out.replace(/(<meta name="description" content=")[^"]*(")/, `$1${d}$2`);
  out = out.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${c}$2`);
  out = out.replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${t}$2`);
  out = out.replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${d}$2`);
  out = out.replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${c}$2`);
  out = out.replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${t}$2`);
  out = out.replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${d}$2`);
  out = out.replace(/<meta name="robots" content="noindex[^"]*"\s*\/?>\s*/, '');
  return out;
}

// A brief's description, built from its own text rather than from a template,
// and truncated on a word boundary so a search result does not end mid word.
export function briefDescription(brief) {
  const flat = String(brief.body_md ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return 'A published Security Watch brief, citing Oracle security advisories.';
  if (flat.length <= 180) return flat;
  const cut = flat.slice(0, 180);
  const space = cut.lastIndexOf(' ');
  return `${(space > 80 ? cut.slice(0, space) : cut).trim()}...`;
}

export async function watchBriefPage(request, env, slug) {
  if (!SLUG_RE.test(slug)) return notFound(request, env);

  let brief;
  try {
    brief = await readLiveBrief(env, slug);
  } catch (err) {
    // A database outage must not answer 404, which would tell a reader and a
    // crawler that a real brief has been withdrawn. The shell is served with
    // its own honest sentence and its own noindex.
    console.error('watch_brief_read_failed', String(err?.message ?? err));
    const shell = await shellHtml(request, env);
    return shell === null ? notFound(request, env) : htmlResponse(shell, 503);
  }

  if (!brief) return notFound(request, env);

  const shell = await shellHtml(request, env);
  if (shell === null) return notFound(request, env);

  const injected = injectIntoSlot(shell, renderBrief(brief), 'watch-brief');
  if (injected === null) {
    console.error('watch_brief_slot_missing');
    return htmlResponse(shell, 503);
  }

  const canonical = new URL(`/watch/${brief.slug}/`, request.url).href;
  return htmlResponse(
    rewriteHead(injected, {
      title: `${brief.title ?? 'Security Watch'}: OraDiscuss Security Watch`,
      description: briefDescription(brief),
      canonical,
    }),
  );
}

async function shellHtml(request, env) {
  const shellRequest = new Request(new URL(BRIEF_SHELL_PATH, request.url), { headers: request.headers });
  const asset = await env.ASSETS.fetch(shellRequest);
  const type = asset.headers.get('content-type') ?? '';
  if (!asset.ok || !type.includes('text/html')) return null;
  return asset.text();
}

async function notFound(request, env) {
  try {
    const asset = await env.ASSETS.fetch(new Request(new URL('/404.html', request.url), { headers: request.headers }));
    if (asset.ok) {
      return new Response(await asset.text(), {
        status: 404,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex',
        },
      });
    }
  } catch (err) {
    console.error('watch_404_asset_failed', String(err?.message ?? err));
  }
  return new Response('Not Found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Short, because a brief should appear without waiting on an edge TTL.
      'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store',
    },
  });
}
