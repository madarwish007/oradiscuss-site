# OraDiscuss CMS OAuth proxy

Tiny Cloudflare Worker that lets Sveltia CMS authenticate against GitHub
without the site ever seeing the OAuth client secret. This Worker is the only
component that holds `GITHUB_CLIENT_SECRET`.

## One-time setup

### 1. Create a GitHub OAuth App

1. Open <https://github.com/settings/developers> → **New OAuth App**
2. Fill in:
   - **Application name:** `OraDiscuss CMS`
   - **Homepage URL:** `https://oradiscuss.com`
   - **Authorization callback URL:** `https://oradiscuss-cms-auth.mahmood-darweesh.workers.dev/callback`
3. Click **Register application**
4. On the next screen, generate a new **Client Secret** and copy both values.

> ⚠️ Use a *classic* OAuth App (what the "New OAuth App" button creates), **not**
> a GitHub App. Decap/Sveltia-style CMSes talk to the classic OAuth endpoint.

### 2. Deploy the Worker

From this directory:

```bash
cd worker-oauth
npm install
npx wrangler login                    # once per machine
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler deploy
```

After `deploy` succeeds you should see a URL like
`https://oradiscuss-cms-auth.<account>.workers.dev`. Confirm it matches what's
in `public/admin/config.yml` under `backend.base_url`. If your account's
default workers subdomain is different, update `config.yml` accordingly.

### 3. Sanity check

Open `https://<worker-url>/` in a browser — you should see the plain-text
health string `OraDiscuss CMS OAuth proxy — ready.`

## How the flow works

```
[CMS] /admin/             [Worker] /auth         [GitHub]        [Worker] /callback
  │                          │                     │                  │
  │  user clicks "login"  →  │                     │                  │
  │                          │  302 redirect   →   │                  │
  │                          │                     │  user authorises │
  │                          │                     │  302 back  →     │
  │                          │                     │                  │  exchange code
  │                          │                     │                  │  for token
  │  ← postMessage(token) ───────────────────────────────────────────│
```

The Worker sets a short-lived `cms_state` cookie during `/auth` and verifies
it on `/callback` — this prevents CSRF on the OAuth exchange. On success, it
returns an HTML page that posts the access token back to the opener window
using the Netlify-CMS-compatible `authorization:github:success:{...}` message
format, scoped to the `ALLOWED_DOMAIN` origin.

## Overriding the allowed domain

By default the token is only posted to `https://oradiscuss.com` (and any
`localhost` origin during development). If you ever stage the CMS on a
different domain, either edit `DEFAULT_ALLOWED_DOMAIN` in `src/index.ts` or
set a var:

```bash
npx wrangler deploy --var ALLOWED_DOMAIN:staging.oradiscuss.com
```
