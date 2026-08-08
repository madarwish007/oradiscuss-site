// Shared HTTP helpers for the OraDiscuss system layer.

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': init.cache ?? 'no-store',
      ...(init.headers ?? {}),
    },
  });
}

export function problem(status, message) {
  return json({ ok: false, error: message }, { status });
}

// A refusal the browser can act on. `code` is a stable machine word the form
// branches on; `error` is the sentence a person reads. Nothing internal goes in
// either: no upstream error text, no stack, no key name that is not already
// public configuration state.
export function fail(status, code, message, extra = {}) {
  return json({ ok: false, code, error: message, ...extra }, { status });
}

// Client IP for rate-limit keying. Cloudflare always sets CF-Connecting-IP at
// the edge; the fallback only matters in local dev.
export function clientKey(request) {
  return request.headers.get('CF-Connecting-IP') || 'local-dev';
}

// A form post is tiny. Anything larger is not one of our forms.
export const MAX_BODY_BYTES = 2048;

// Shared by every JSON endpoint. It lives here rather than in api.js because
// the delivery routes need exactly the same refusals, and two copies of a body
// reader is two places for a size cap to drift.
export async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const type = request.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    return { error: 'Send this as application/json.' };
  }
  const raw = await request.text();
  if (raw.length > maxBytes) return { error: 'That request body is too large.' };
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object') return { error: 'Body is not valid JSON.' };
    return { value };
  } catch {
    return { error: 'Body is not valid JSON.' };
  }
}

// Applied to every response leaving the Worker.
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(self)',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
