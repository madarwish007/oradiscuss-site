// OraDiscuss Search & Error Lookup Worker - Cloudflare Worker
// Deploy to: oradiscuss-ai.mahmood-darweesh.workers.dev
//
// ZERO EXTERNAL AI CALLS. ZERO ANTHROPIC CREDITS CONSUMED.
// Sources:
//   - docs.oracle.com (error-help + free-text search)
//   - oradiscuss.com  (searched client-side from the inline SPA content)
// All upstream responses are edge-cached via the Cloudflare Cache API.
//
// COMMENTS MODEL:
//   KV key "comments:<slug>" → JSON array of comment objects:
//     { id, parentId, name, rating, text, date, ip, approved }
//   Legacy comments (no id) are backfilled with a uuid on first read.
//   parentId is null for top-level comments, or the id of the parent
//   comment for a reply. Replies do not carry a rating.

const ALLOWED_ORIGINS = [
  'https://oradiscuss.com',
  'https://www.oradiscuss.com'
];

function resolveAllowedOrigin(origin) {
  if (!origin) return '*';
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin;
  return ALLOWED_ORIGINS[0];
}

const RATE_LIMIT = 200;
const rateLimitMap = new Map();

function getRateLimit(ip) {
  const key = `${ip}_${new Date().toDateString()}`;
  return rateLimitMap.get(key) || 0;
}
function incrementRateLimit(ip) {
  const key = `${ip}_${new Date().toDateString()}`;
  rateLimitMap.set(key, (rateLimitMap.get(key) || 0) + 1);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = resolveAllowedOrigin(origin);

    const headers = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
      'Content-Type': 'application/json',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/comments') {
      return await handleGetComments(url, env, headers, ctx);
    }

    if (request.method === 'POST' && url.pathname === '/api/comments') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      return await handlePostComment(request, env, headers, ip, ctx);
    }

    if (url.pathname === '/api/admin/comments') {
      return await handleAdminComments(request, url, env, headers);
    }
    if (url.pathname === '/api/admin/ratelimits') {
      return await handleAdminRatelimits(request, url, env, headers);
    }

    if (request.method === 'GET') {
      return new Response(JSON.stringify({
        ok: true,
        service: 'oradiscuss-ai',
        endpoints: ['/api/ora-error', '/api/search', '/api/comments', '/api/admin/comments', '/api/admin/ratelimits'],
        note: 'Zero AI calls. Sourced from docs.oracle.com.'
      }), { headers });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (getRateLimit(ip) >= RATE_LIMIT) {
      return new Response(JSON.stringify({
        error: `Daily limit reached (${RATE_LIMIT} requests/day). Please try again tomorrow.`
      }), { status: 429, headers });
    }

    const path = new URL(request.url).pathname;
    try {
      const body = await request.json();
      if (path === '/api/ora-error') return await handleORAError(body, ctx, headers, ip);
      if (path === '/api/search' || path === '/api/chat') {
        return await handleSearch(body, ctx, headers, ip);
      }
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Request failed: ' + e.message }), { status: 400, headers });
    }
  }
};

// ──────────────────────────────────────────────────────────────────────
// /api/search  — free-text search against docs.oracle.com
// ──────────────────────────────────────────────────────────────────────
async function handleSearch(body, ctx, headers, ip) {
  const query = (body.message || body.query || '').toString().trim();
  if (!query) {
    return new Response(JSON.stringify({ error: 'Empty query.' }), { status: 400, headers });
  }
  if (query.length > 200) {
    return new Response(JSON.stringify({ error: 'Query too long (max 200 chars).' }), { status: 400, headers });
  }

  const oraMatch = query.toUpperCase().match(/\bORA-\d{3,5}\b/);
  if (oraMatch && query.replace(/\s+/g,'').length <= oraMatch[0].length + 2) {
    return handleORAError({ errorCode: oraMatch[0] }, ctx, headers, ip);
  }

  const norm = query.toLowerCase().replace(/\s+/g,' ').trim();
  const cacheKey = new Request(`https://cache.oradiscuss.internal/search/${encodeURIComponent(norm)}`, { method: 'GET' });
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) {
    incrementRateLimit(ip);
    const data = await hit.json();
    return new Response(JSON.stringify({ ...data, cached: true }), { headers });
  }

  const deepLink = `https://docs.oracle.com/search/?q=${encodeURIComponent(query)}&category=database&pg=1`;
  const upstreams = [
    `https://docs.oracle.com/search/?q=${encodeURIComponent(query)}&category=database&pg=1`,
    `https://docs.oracle.com/en/search.html?q=${encodeURIComponent(query)}`
  ];

  let html = '';
  for (const u of upstreams) {
    try {
      const r = await fetch(u, {
        headers: { 'User-Agent': 'OraDiscuss-Search/1.0 (+https://oradiscuss.com)', 'Accept': 'text/html' },
        cf: { cacheTtl: 86400, cacheEverything: true }
      });
      if (r.ok) { html = await r.text(); if (html.length > 500) break; }
    } catch (_) { /* try next */ }
  }

  const results = html ? parseOracleSearchResults(html, 6) : [];
  const payload = {
    query,
    source: 'docs.oracle.com',
    results,
    deepLink,
    explanation: formatSearchMarkdown(query, results, deepLink),
    cached: false
  };

  const resp = new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' }
  });
  ctx.waitUntil(cache.put(cacheKey, resp));

  incrementRateLimit(ip);
  return new Response(JSON.stringify(payload), { headers });
}

function parseOracleSearchResults(html, limit) {
  const doc = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  const out = [];
  const seen = new Set();

  const tileRe = /<(?:li|div|article)[^>]*class="[^"]*(?:search-result|result-item|u21-listing-item)[^"]*"[^>]*>([\s\S]*?)<\/(?:li|div|article)>/gi;
  let m;
  while ((m = tileRe.exec(doc)) !== null && out.length < limit) {
    const block = m[1];
    const aM = block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!aM) continue;
    const href = absUrl(aM[1]);
    if (!href || seen.has(href)) continue;
    const title = htmlToText(aM[2]).slice(0, 200);
    const snipM = block.match(/<(?:p|div|span)[^>]*class="[^"]*(?:snippet|description|summary)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/i);
    const snippet = (snipM ? htmlToText(snipM[1]) : '').slice(0, 260);
    seen.add(href);
    out.push({ title, url: href, snippet });
  }

  if (out.length === 0) {
    const aRe = /<a[^>]+href="(https?:\/\/docs\.oracle\.com\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = aRe.exec(doc)) !== null && out.length < limit) {
      const href = m[1];
      if (seen.has(href)) continue;
      const title = htmlToText(m[2]).slice(0, 200);
      if (!title || title.length < 6) continue;
      seen.add(href);
      out.push({ title, url: href, snippet: '' });
    }
  }

  return out;
}

function absUrl(u) {
  if (!u) return '';
  if (u.startsWith('http')) return u;
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return 'https://docs.oracle.com' + u;
  return '';
}

function formatSearchMarkdown(query, results, deepLink) {
  const lines = [`## Results for "${query}"`];
  if (results.length === 0) {
    lines.push(
      `I couldn't extract inline results from Oracle's search page for this query, but you can open the full results on Oracle's documentation site.`,
      ``,
      `[Open on docs.oracle.com](${deepLink})`
    );
    return lines.join('\n\n');
  }
  lines.push(`From **docs.oracle.com**:`);
  for (const r of results) {
    const snip = r.snippet ? `\n  ${r.snippet}` : '';
    lines.push(`- [${r.title}](${r.url})${snip}`);
  }
  lines.push(`---`, `[See all results on docs.oracle.com →](${deepLink})`);
  return lines.join('\n\n');
}

// ──────────────────────────────────────────────────────────────────────
// /api/ora-error  — ORA-xxxxx lookup against docs.oracle.com/en/error-help/db/
// ──────────────────────────────────────────────────────────────────────
async function handleORAError(body, ctx, headers, ip) {
  const raw = (body.errorCode || '').toString().trim().toUpperCase();
  if (!/^ORA-\d{3,5}$/.test(raw)) {
    return new Response(JSON.stringify({ error: 'Invalid format. Use ORA-XXXXX (3–5 digits).' }), { status: 400, headers });
  }

  const digits = raw.split('-')[1].padStart(5, '0');
  const slug = `ora-${digits}`;
  const code = `ORA-${digits}`;

  const cacheKey = new Request(`https://cache.oradiscuss.internal/ora/v2/${slug}`, { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    incrementRateLimit(ip);
    const data = await cached.json();
    return new Response(JSON.stringify({ ...data, cached: true }), { headers });
  }

  const docUrl = `https://docs.oracle.com/en/error-help/db/${slug}/index.html`;

  const jsonCandidates = [
    `https://docs.oracle.com/error-help/api/errorcode/${slug}`,
    `https://docs.oracle.com/error-help/api/public/errorcode?errorCode=${code}`,
    `https://docs.oracle.com/error-help/api/public/errorcode/${slug}`,
  ];
  let parsed = null;
  let diag = [];

  for (const u of jsonCandidates) {
    try {
      const r = await fetch(u, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'OraDiscuss-ErrorLookup/2.0 (+https://oradiscuss.com)'
        },
        cf: { cacheTtl: 2592000, cacheEverything: true }
      });
      diag.push(`${u} → ${r.status}`);
      if (r.ok) {
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('json')) {
          const j = await r.json();
          parsed = parseOracleErrorJson(j);
          if (parsed && (parsed.message || parsed.cause || parsed.action)) break;
        }
      }
    } catch (e) { diag.push(`${u} → ${e.message}`); }
  }

  let html = '';
  if (!parsed || (!parsed.message && !parsed.cause && !parsed.action)) {
    try {
      const res = await fetch(docUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; OraDiscuss-ErrorLookup/2.0; +https://oradiscuss.com)',
          'Accept': 'text/html,application/xhtml+xml'
        },
        cf: { cacheTtl: 2592000, cacheEverything: true }
      });
      diag.push(`${docUrl} → ${res.status}`);
      if (res.status === 404) {
        return new Response(JSON.stringify({
          error: `${code} was not found in Oracle's official error-help documentation. Double-check the code.`,
          source: docUrl, diag
        }), { status: 404, headers });
      }
      if (res.ok) {
        html = await res.text();
        parsed = parseOracleErrorPage(html) || parsed;
      }
    } catch (e) { diag.push(`${docUrl} → ${e.message}`); }
  }

  if (!parsed || (!parsed.message && !parsed.cause && !parsed.action)) {
    const fallbackExplanation = [
      `## ${code}`,
      `Oracle's official error-help page for this code loads its content dynamically and couldn't be parsed server-side.`,
      `**[Open ${code} on docs.oracle.com →](${docUrl})**`,
      `---`,
      `Source: [Oracle official documentation](${docUrl})`
    ].join('\n\n');

    const result = {
      errorCode: code,
      message: '', cause: '', action: '',
      source: docUrl,
      explanation: fallbackExplanation,
      partial: true,
      diag,
      cached: false
    };
    ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
    })));
    incrementRateLimit(ip);
    return new Response(JSON.stringify(result), { headers });
  }

  const result = {
    errorCode: code,
    message: parsed.message || '',
    cause: parsed.cause || '',
    action: parsed.action || '',
    source: docUrl,
    explanation: formatErrorMarkdown(code, parsed, docUrl),
    cached: false
  };

  ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=2592000' }
  })));

  incrementRateLimit(ip);
  return new Response(JSON.stringify(result), { headers });
}

function parseOracleErrorJson(j) {
  if (!j || typeof j !== 'object') return null;
  const pick = (...keys) => {
    for (const k of keys) {
      const v = getDeep(j, k);
      if (v && typeof v === 'string' && v.trim()) return stripTags(v);
    }
    return '';
  };
  return {
    message: pick('message','errorMessage','messageText','Message','text','summary'),
    cause:   pick('cause','errorCause','Cause','causeText','description'),
    action:  pick('action','errorAction','Action','actionText','userAction','response')
  };
}
function getDeep(obj, key) {
  if (obj == null) return undefined;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const r = getDeep(v, key);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}
function stripTags(s) { return String(s).replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim(); }

function parseOracleErrorPage(html) {
  const doc = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  const pickByHeading = (labelRegex) => {
    const re = new RegExp(
      `<h[1-6][^>]*>\\s*(?:${labelRegex})\\s*<\\/h[1-6]>([\\s\\S]*?)(?=<h[1-6][^>]*>|<\\/main>|<\\/article>|<\\/section>|<\\/body>)`,
      'i'
    );
    const m = doc.match(re);
    return m ? htmlToText(m[1]) : '';
  };

  let message = pickByHeading('Error Code Message|Message');
  let cause   = pickByHeading('Error Code Cause|Cause');
  let action  = pickByHeading('Error Code Action|Action|Response|User Action');

  if (!cause || !action) {
    const dlRe = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
    let m;
    while ((m = dlRe.exec(doc)) !== null) {
      const label = htmlToText(m[1]).toLowerCase();
      const value = htmlToText(m[2]);
      if (!message && /(message|error\s*code\s*message)/.test(label)) message = value;
      else if (!cause && /cause/.test(label)) cause = value;
      else if (!action && /(action|response|user\s*action)/.test(label)) action = value;
    }
  }

  if (!cause) {
    const m = doc.match(/<[a-z]+[^>]*class="[^"]*(?:cause|error-cause)[^"]*"[^>]*>([\s\S]*?)<\/[a-z]+>/i);
    if (m) cause = htmlToText(m[1]);
  }
  if (!action) {
    const m = doc.match(/<[a-z]+[^>]*class="[^"]*(?:action|error-action|user-action)[^"]*"[^>]*>([\s\S]*?)<\/[a-z]+>/i);
    if (m) action = htmlToText(m[1]);
  }

  if (!message) {
    const m = doc.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
    if (m) message = stripTags(m[1]);
  }

  if (!cause) {
    const m = doc.match(/Cause\s*:\s*([^<][\s\S]{0,800}?)(?=Action\s*:|<\/p>|<\/div>|$)/i);
    if (m) cause = stripTags(m[1]);
  }
  if (!action) {
    const m = doc.match(/Action\s*:\s*([^<][\s\S]{0,800}?)(?=<\/p>|<\/div>|$)/i);
    if (m) action = stripTags(m[1]);
  }

  return { message, cause, action };
}

function htmlToText(s) {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatErrorMarkdown(code, p, src) {
  const parts = [`## ${code}`];
  if (p.message) parts.push(`**Message**\n\n${p.message}`);
  if (p.cause)   parts.push(`**Cause**\n\n${p.cause}`);
  if (p.action)  parts.push(`**Action**\n\n${p.action}`);
  parts.push(`---\n\nSource: [Oracle official documentation](${src})`);
  return parts.join('\n\n');
}

// ──────────────────────────────────────────────────────────────────────
// COMMENTS + RATINGS  (Cloudflare KV: bind as COMMENTS)
// KV key: "comments:<slug>" → JSON array of comment objects
// Each comment: { id, parentId, name, rating, text, date, ip, approved }
// ──────────────────────────────────────────────────────────────────────
const COMMENT_RATE_LIMIT = 10;

function sanitize(s, max) {
  return String(s || '').replace(/<[^>]*>/g, '').trim().slice(0, max);
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function backfillIds(comments) {
  let mutated = false;
  for (const c of comments) {
    if (!c.id) { c.id = newId(); mutated = true; }
    if (c.parentId === undefined) { c.parentId = null; }
  }
  return mutated;
}

async function handleGetComments(url, env, headers, ctx) {
  const slug = url.searchParams.get('slug');
  if (!slug) return new Response(JSON.stringify({ error: 'Missing slug parameter.' }), { status: 400, headers });
  if (!env.COMMENTS) return new Response(JSON.stringify({ comments: [], avgRating: 0, total: 0 }), { headers });

  const key = `comments:${slug}`;
  const raw = await env.COMMENTS.get(key);
  const comments = raw ? JSON.parse(raw) : [];

  // Backfill legacy records so the client can thread replies.
  if (backfillIds(comments) && ctx) {
    ctx.waitUntil(env.COMMENTS.put(key, JSON.stringify(comments)));
  }

  const visible = comments.filter(c => c.approved !== false);
  // Average rating only counts top-level comments (replies have no rating).
  const ratings = visible.filter(c => !c.parentId && c.rating > 0).map(c => c.rating);
  const avgRating = ratings.length ? +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : 0;

  return new Response(JSON.stringify({
    comments: visible.map(c => ({
      id: c.id,
      parentId: c.parentId || null,
      name: c.name,
      rating: c.rating,
      text: c.text,
      date: c.date
    })),
    avgRating,
    total: visible.length
  }), { headers });
}

async function handlePostComment(request, env, headers, ip, ctx) {
  if (!env.COMMENTS) {
    return new Response(JSON.stringify({ error: 'Comments are not configured yet.' }), { status: 503, headers });
  }

  let body;
  try { body = await request.json(); } catch (_) {
    return new Response(JSON.stringify({ error: 'Invalid JSON.' }), { status: 400, headers });
  }

  const slug = sanitize(body.slug, 200);
  const name = sanitize(body.name, 80) || 'Anonymous';
  const parentId = body.parentId ? sanitize(body.parentId, 64) : null;
  const parsedRating = Math.max(0, Math.min(10, parseInt(body.rating) || 0));
  const text = sanitize(body.text, 2000);

  if (!slug) return new Response(JSON.stringify({ error: 'Missing article slug.' }), { status: 400, headers });
  if (parentId && !text) {
    return new Response(JSON.stringify({ error: 'Replies must include text.' }), { status: 400, headers });
  }
  if (!parentId && !text && !parsedRating) {
    return new Response(JSON.stringify({ error: 'Please provide a rating or comment.' }), { status: 400, headers });
  }

  const dayKey = `ratelimit:comment:${ip}:${new Date().toISOString().slice(0, 10)}`;
  const dayCount = parseInt(await env.COMMENTS.get(dayKey) || '0');
  if (dayCount >= COMMENT_RATE_LIMIT) {
    return new Response(JSON.stringify({ error: 'Daily comment limit reached. Please try again tomorrow.' }), { status: 429, headers });
  }

  const key = `comments:${slug}`;
  const raw = await env.COMMENTS.get(key);
  const comments = raw ? JSON.parse(raw) : [];
  backfillIds(comments);

  let parentComment = null;
  if (parentId) {
    parentComment = comments.find(c => c.id === parentId);
    if (!parentComment) {
      return new Response(JSON.stringify({ error: 'Parent comment not found.' }), { status: 400, headers });
    }
  }

  const newComment = {
    id: newId(),
    parentId: parentId || null,
    name,
    rating: parentId ? 0 : parsedRating,
    text,
    date: new Date().toISOString(),
    ip: ip.slice(0, 8) + '***',
    approved: true
  };

  comments.push(newComment);
  await env.COMMENTS.put(key, JSON.stringify(comments));
  await env.COMMENTS.put(dayKey, String(dayCount + 1), { expirationTtl: 86400 });

  ctx.waitUntil(notifyNewComment(env, slug, name, newComment.rating, text, parentComment));

  return new Response(JSON.stringify({ ok: true, message: 'Comment submitted successfully.', id: newComment.id }), { headers });
}

async function notifyNewComment(env, slug, name, rating, text, parentComment) {
  try {
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      const stars = rating > 0 ? '⭐'.repeat(Math.min(rating, 10)) + ` (${rating}/10)` : '';
      const article = slug.split('/').pop().replace(/-/g, ' ');
      const h = escapeHtml;
      const title = parentComment
        ? `💬 <b>New Reply on OraDiscuss</b>`
        : `📝 <b>New Comment on OraDiscuss</b>`;
      const parentLine = parentComment
        ? `↪ <b>Replying to:</b> ${h(parentComment.name || 'Anonymous')}`
        : '';
      const message = [
        title,
        ``,
        `📄 <b>Article:</b> ${h(article)}`,
        `👤 <b>From:</b> ${h(name)}`,
        parentLine,
        stars,
        text ? `💬 ${h(text)}` : '',
        ``,
        `🔗 https://oradiscuss.com${slug}`
      ].filter(Boolean).join('\n');

      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });
    }
  } catch (e) {
    console.error('Notification failed:', e.message);
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ──────────────────────────────────────────────────────────────────────
// /api/admin/comments — admin comment management (requires ADMIN_KEY)
// ──────────────────────────────────────────────────────────────────────
async function handleAdminComments(request, url, env, headers) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!env.ADMIN_KEY || !adminKey || adminKey !== env.ADMIN_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized.' }), { status: 401, headers });
  }
  if (!env.COMMENTS) {
    return new Response(JSON.stringify({ error: 'KV not configured.' }), { status: 503, headers });
  }

  const slug = url.searchParams.get('slug');

  if (request.method === 'GET' && !slug) {
    const list = await env.COMMENTS.list({ prefix: 'comments:' });
    const keys = list.keys.map(k => k.name);
    return new Response(JSON.stringify({ keys, count: keys.length }), { headers });
  }

  if (request.method === 'GET' && slug) {
    const raw = await env.COMMENTS.get(`comments:${slug}`);
    const comments = raw ? JSON.parse(raw) : [];
    return new Response(JSON.stringify({ slug, comments, total: comments.length }), { headers });
  }

  if (request.method === 'DELETE' && slug) {
    const indexParam = url.searchParams.get('index');
    const commentId = url.searchParams.get('id');

    // Delete by comment id. Removes the comment AND any descendant replies.
    if (commentId) {
      const raw = await env.COMMENTS.get(`comments:${slug}`);
      const comments = raw ? JSON.parse(raw) : [];
      const targetIds = new Set([commentId]);
      // Walk the tree: keep collecting ids whose parent is already in the set.
      let changed = true;
      while (changed) {
        changed = false;
        for (const c of comments) {
          if (c.parentId && targetIds.has(c.parentId) && !targetIds.has(c.id)) {
            targetIds.add(c.id);
            changed = true;
          }
        }
      }
      const kept = comments.filter(c => !targetIds.has(c.id));
      const removed = comments.length - kept.length;
      if (removed === 0) {
        return new Response(JSON.stringify({ error: `No comment with id "${commentId}" on this slug.` }), { status: 404, headers });
      }
      if (kept.length === 0) {
        await env.COMMENTS.delete(`comments:${slug}`);
      } else {
        await env.COMMENTS.put(`comments:${slug}`, JSON.stringify(kept));
      }
      return new Response(JSON.stringify({ ok: true, message: `Deleted ${removed} comment(s) (including replies).` }), { headers });
    }

    if (indexParam !== null) {
      const idx = parseInt(indexParam);
      const raw = await env.COMMENTS.get(`comments:${slug}`);
      const comments = raw ? JSON.parse(raw) : [];
      if (idx < 0 || idx >= comments.length) {
        return new Response(JSON.stringify({ error: `Index ${idx} out of range (0-${comments.length - 1}).` }), { status: 400, headers });
      }
      const removed = comments.splice(idx, 1)[0];
      if (comments.length === 0) {
        await env.COMMENTS.delete(`comments:${slug}`);
      } else {
        await env.COMMENTS.put(`comments:${slug}`, JSON.stringify(comments));
      }
      return new Response(JSON.stringify({ ok: true, message: 'Comment deleted.', removed }), { headers });
    }

    await env.COMMENTS.delete(`comments:${slug}`);
    return new Response(JSON.stringify({ ok: true, message: `All comments for "${slug}" deleted.` }), { headers });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed.' }), { status: 405, headers });
}

async function handleAdminRatelimits(request, url, env, headers) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!env.ADMIN_KEY || !adminKey || adminKey !== env.ADMIN_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized.' }), { status: 401, headers });
  }
  if (!env.COMMENTS) {
    return new Response(JSON.stringify({ error: 'KV not configured.' }), { status: 503, headers });
  }

  if (request.method === 'GET') {
    const list = await env.COMMENTS.list({ prefix: 'ratelimit:' });
    const keys = [];
    for (const k of list.keys) {
      const val = await env.COMMENTS.get(k.name);
      keys.push({ key: k.name, count: val, expiration: k.expiration || null });
    }
    return new Response(JSON.stringify({ keys, count: keys.length }), { headers });
  }

  if (request.method === 'DELETE') {
    const specificKey = url.searchParams.get('key');
    if (specificKey) {
      await env.COMMENTS.delete(specificKey);
      return new Response(JSON.stringify({ ok: true, message: `Rate limit key "${specificKey}" deleted.` }), { headers });
    }
    const list = await env.COMMENTS.list({ prefix: 'ratelimit:' });
    let deleted = 0;
    for (const k of list.keys) {
      await env.COMMENTS.delete(k.name);
      deleted++;
    }
    return new Response(JSON.stringify({ ok: true, message: `${deleted} rate limit key(s) cleared.` }), { headers });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed.' }), { status: 405, headers });
}
