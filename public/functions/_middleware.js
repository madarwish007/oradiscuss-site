// Edge middleware — runs on every request before static assets & _redirects.
// Returns a real 404 for scanner-probe paths so security scanners stop flagging
// the site and Google doesn't index junk URLs.
//
// NOTE: /admin is intentionally NOT in the block list anymore — Sveltia CMS
// lives there. /administrator is kept blocked (WP/Joomla probe target).
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

export const onRequest = async ({ request, next }) => {
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
  return next();
};
