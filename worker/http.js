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
  return json({ error: message }, { status });
}

// Client IP for rate-limit keying. Cloudflare always sets CF-Connecting-IP at
// the edge; the fallback only matters in local dev.
export function clientKey(request) {
  return request.headers.get('CF-Connecting-IP') || 'local-dev';
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
