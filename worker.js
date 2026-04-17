// Edge worker for oradiscuss-site.
//
// Deployed via Cloudflare Workers Builds. Runs before the static ASSETS
// binding on every request.
//
// Responsibilities:
//   1. Return a real 404 (not the themed site 404) for scanner-probe paths
//      so security scanners stop flagging the site and search engines don't
//      index junk URLs. Previously a Pages Function `_middleware.js` did
//      this — on the Workers Builds deploy target, we need it inline here.
//   2. Everything else → delegate to env.ASSETS (the static site).

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
      return new Response('Not Found', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
          'X-Robots-Tag': 'noindex, nofollow',
        },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
