// Edge entry for oradiscuss-site.
//
// Deployed via Cloudflare Workers Builds (production) and
// `wrangler deploy --env preview` (preview). Runs before the static ASSETS
// binding on every request.
//
// Responsibilities:
//   1. Return a real 404 (not the themed site 404) for scanner-probe paths
//      so security scanners stop flagging the site and search engines do not
//      index junk URLs. Previously a Pages Function `_middleware.js` did
//      this; on the Workers Builds deploy target it needs to be inline here.
//   2. Serve /api/* from the system layer (D1 / KV / R2).
//   3. Render /changelog/ by filling one slot in the built page from D1, so the
//      changelog is generated from releases and never hand edited.
//   4. Everything else goes to env.ASSETS (the static Astro build).
//   5. Apply security headers to every response.
//
// It also exports `queue`, the consumer for the webhook retry queue. A webhook
// that verified but did not apply is queued rather than dropped, and this is
// where it is picked up again.

import { handleApi } from './worker/api.js';
import { changelogPage } from './worker/changelog.js';
import { handleRetryBatch } from './worker/webhook.js';
import { withSecurityHeaders } from './worker/http.js';
import { watchIndexPage, watchBriefPage } from './worker/watch-pages.js';
import { runWatchCycle } from './worker/watch-cycle.js';

const BLOCKED = [
  /^\/wp-login\.php$/i,
  /^\/wp-admin(\/|$)/i,
  /^\/wp-content(\/|$)/i,
  /^\/wp-includes(\/|$)/i,
  /^\/wp-json(\/|$)/i,
  /^\/xmlrpc\.php$/i,
  /^\/phpmyadmin(\/|$)/i,
  /^\/pma(\/|$)/i,
  /^\/\.env(\.|$|\/)/i,
  /^\/\.git(\/|$)/i,
  /^\/\.aws(\/|$)/i,
  /^\/administrator(\/|$)/i,
  /^\/cgi-bin(\/|$)/i,
];

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (BLOCKED.some((re) => re.test(pathname))) {
      return withSecurityHeaders(
        new Response('Not Found', {
          status: 404,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
            'X-Robots-Tag': 'noindex, nofollow',
          },
        }),
      );
    }

    if (pathname.startsWith('/api/')) {
      try {
        return withSecurityHeaders(await handleApi(request, env, pathname));
      } catch (err) {
        // Never leak an internal error to a caller, but do record it:
        // observability is enabled, so this reaches the dashboard.
        console.error('api_error', pathname, err?.stack ?? err);
        return withSecurityHeaders(
          new Response(JSON.stringify({ error: 'Internal error.' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          }),
        );
      }
    }

    // The built page carries the design; D1 carries the releases. Neither half
    // can produce this page alone, so the Worker joins them here. Any failure
    // inside falls back to serving the built page untouched, which already says
    // the changelog could not be read.
    if (pathname === '/changelog' || pathname === '/changelog/') {
      try {
        return withSecurityHeaders(await changelogPage(request, env));
      } catch (err) {
        console.error('changelog_error', err?.stack ?? err);
        return withSecurityHeaders(await env.ASSETS.fetch(request));
      }
    }

    // The Security Watch archive, on the same principle as the changelog: the
    // built page carries the design, D1 carries the briefs. Only PUBLISHED
    // briefs are ever read; see worker/watch-pages.js.
    if (pathname === '/watch' || pathname === '/watch/') {
      try {
        return withSecurityHeaders(await watchIndexPage(request, env));
      } catch (err) {
        console.error('watch_index_error', err?.stack ?? err);
        return withSecurityHeaders(await env.ASSETS.fetch(request));
      }
    }

    if (pathname.startsWith('/watch/')) {
      const slug = pathname.slice('/watch/'.length).replace(/\/+$/, '');
      try {
        return withSecurityHeaders(await watchBriefPage(request, env, slug));
      } catch (err) {
        console.error('watch_brief_error', err?.stack ?? err);
        return withSecurityHeaders(await env.ASSETS.fetch(request));
      }
    }

    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },

  // Consumer for the webhook-retry queue. Declared in wrangler.toml; the remote
  // queue must exist before a deploy carrying this binding will succeed.
  async queue(batch, env) {
    await handleRetryBatch(batch, env);
  },

  // THE SECURITY WATCH CRON. It drafts, verifies, publishes, sends, and tells
  // the founder what it did.
  //
  // FOUNDER RULING 9 Aug 2026, verbatim: "Monthly is okay, and that should be
  // automated workflow without any human intervention, as a Founder, i need to
  // get an aknowledgement about the updated kits only." That REVERSES his own
  // 5 Aug standing gate, under which publishing a brief and sending it were
  // founder-only actions. He was shown the gate and ruled anyway.
  //
  // THIS HANDLER CANNOT SKIP THE CIRCUIT BREAKER, and that is structural rather
  // than a promise: worker/watch-cycle.js reaches publishing only through
  // publishBrief, and publishBrief runs the breaker inside the one function in
  // this repository that can write status = 'live'. A brief that fails any
  // check stays a draft and the founder is told why.
  async scheduled(event, env) {
    try {
      const summary = await runWatchCycle(env);
      const failed = summary.sources.filter((s) => !s.ok).map((s) => s.id);
      console.log(
        'watch_run_complete',
        `sources=${summary.sources.length}`,
        `failed=${failed.join(',') || 'none'}`,
        `items_new=${summary.items_new}`,
        `brief=${summary.cycle.brief_slug ?? 'none'}`,
        `verdict=${summary.cycle.verdict}`,
        `send=${summary.cycle.send_status ?? 'none'}`,
        `notify=${summary.cycle.notify_status}`,
      );
    } catch (err) {
      // A scheduled run that throws leaves no reply anybody would see, so the
      // log line is the whole record. The next run is a month away, which is
      // exactly why the cycle records itself in D1 as it goes rather than only
      // at the end.
      console.error('watch_run_failed', err?.stack ?? err);
    }
  },
};
