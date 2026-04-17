// OraDiscuss CMS OAuth proxy.
//
// Flow:
//   /auth       → 302 → github.com/login/oauth/authorize (with CSRF state cookie)
//   /callback   ← github redirects here with ?code&state
//               → exchange code for token, serve HTML that postMessage's the
//                 token back to the CMS window (Sveltia/Decap handshake).
//
// This worker holds the only copy of GITHUB_CLIENT_SECRET — the site itself
// never sees it, which is the whole point of the proxy.

export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  // Optional override. Defaults to oradiscuss.com — covers production.
  ALLOWED_DOMAIN?: string;
}

const DEFAULT_ALLOWED_DOMAIN = 'oradiscuss.com';
const LOCAL_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const allowedDomain = (env.ALLOWED_DOMAIN ?? DEFAULT_ALLOWED_DOMAIN)
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '');
    const allowedOrigin = `https://${allowedDomain}`;

    if (url.pathname === '/' || url.pathname === '') {
      return new Response('OraDiscuss CMS OAuth proxy — ready.', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    // Step 1 — CMS sends the user here to start the OAuth dance.
    if (url.pathname === '/auth') {
      const provider = url.searchParams.get('provider') ?? 'github';
      if (provider !== 'github') {
        return new Response('Unsupported provider', { status: 400 });
      }
      const scope = url.searchParams.get('scope') ?? 'repo,user';
      const state = crypto.randomUUID();
      const redirectUri = `${url.origin}/callback`;

      const authorize = new URL('https://github.com/login/oauth/authorize');
      authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      authorize.searchParams.set('scope', scope);
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('redirect_uri', redirectUri);

      const headers = new Headers({ Location: authorize.toString() });
      headers.append(
        'Set-Cookie',
        `cms_state=${state}; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=Lax`,
      );
      return new Response(null, { status: 302, headers });
    }

    // Step 2 — GitHub redirects back with ?code&state. We exchange & deliver.
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const cookie = request.headers.get('cookie') ?? '';
      const m = cookie.match(/(?:^|;\s*)cms_state=([^;]+)/);
      const savedState = m ? decodeURIComponent(m[1]) : null;

      if (!code) {
        return renderResult('error', 'Missing authorization code', allowedOrigin);
      }
      if (!returnedState || !savedState || returnedState !== savedState) {
        return renderResult('error', 'State mismatch — possible CSRF attempt', allowedOrigin);
      }

      try {
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'oradiscuss-cms-auth-proxy',
          },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code,
          }),
        });
        const data = (await tokenRes.json()) as {
          access_token?: string;
          error?: string;
          error_description?: string;
        };
        if (!data.access_token) {
          const msg =
            data.error_description || data.error || 'No access_token returned by GitHub';
          return renderResult('error', msg, allowedOrigin);
        }
        return renderResult(
          'success',
          JSON.stringify({ token: data.access_token, provider: 'github' }),
          allowedOrigin,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Token exchange failed';
        return renderResult('error', message, allowedOrigin);
      }
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function renderResult(
  status: 'success' | 'error',
  payload: string,
  allowedOrigin: string,
): Response {
  // Sveltia/Decap handshake: child posts `authorizing:github`, parent echoes back
  // from its own origin, child then posts the actual payload to e.origin.
  const message =
    status === 'success'
      ? `authorization:github:success:${payload}`
      : `authorization:github:error:${JSON.stringify(payload)}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>OraDiscuss CMS \u2014 authentication</title>
<style>
  body { font: 14px/1.5 -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 40px; color: #161513; background: #fbfaf9; }
  .card { max-width: 420px; margin: 0 auto; padding: 24px; border: 1px solid #e5e1da; border-radius: 10px; background: #fff; box-shadow: 0 1px 2px rgba(22,21,19,.04); }
  h1 { font-size: 18px; margin: 0 0 8px; letter-spacing: -0.01em; }
  p { margin: 0; color: #665f59; }
  .err { color: #a83a2b; }
</style>
</head>
<body>
<div class="card">
  <h1>${status === 'success' ? 'Signed in' : '<span class="err">Authentication failed</span>'}</h1>
  <p>${
    status === 'success'
      ? 'You can close this window \u2014 the editor will continue.'
      : 'Check the browser console for details.'
  }</p>
</div>
<script>
(function(){
  var message = ${JSON.stringify(message)};
  var allowed = ${JSON.stringify(allowedOrigin)};
  var localRe = /^https?:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?$/;

  function acceptOrigin(o){ return o === allowed || localRe.test(o); }

  function send(origin){
    if (!window.opener || window.opener.closed) return;
    try { window.opener.postMessage(message, origin); } catch (_) {}
  }

  window.addEventListener('message', function(e){
    if (e.data === 'authorizing:github' && acceptOrigin(e.origin)) {
      send(e.origin);
      setTimeout(function(){ window.close(); }, 600);
    }
  });

  // Poke the opener until it handshakes (or give up after ~8s).
  var attempts = 0;
  (function poke(){
    attempts++;
    if (!window.opener || window.opener.closed) return;
    try { window.opener.postMessage('authorizing:github', '*'); } catch (_) {}
    if (attempts < 20) setTimeout(poke, 400);
  })();
})();
</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': 'cms_state=; Max-Age=0; Path=/',
    },
  });
}
