var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/http.js
function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": init.cache ?? "no-store",
      ...init.headers ?? {}
    }
  });
}
__name(json, "json");
function problem(status, message) {
  return json({ error: message }, { status });
}
__name(problem, "problem");
function clientKey(request) {
  return request.headers.get("CF-Connecting-IP") || "local-dev";
}
__name(clientKey, "clientKey");
var SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=(self)",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
};
function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
__name(withSecurityHeaders, "withSecurityHeaders");

// worker/api.js
async function health(env) {
  const checks = {};
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM catalog").first();
    checks.d1 = { ok: true, catalog_rows: row?.n ?? 0 };
  } catch (err) {
    checks.d1 = { ok: false, error: String(err?.message ?? err) };
  }
  try {
    await env.ENTITLEMENT.get("__healthcheck__");
    checks.kv = { ok: true };
  } catch (err) {
    checks.kv = { ok: false, error: String(err?.message ?? err) };
  }
  try {
    await env.PACKS.head("__healthcheck__");
    checks.r2 = { ok: true };
  } catch (err) {
    checks.r2 = { ok: false, error: String(err?.message ?? err) };
  }
  try {
    if (!env.API_RATE_LIMIT) {
      checks.ratelimit = { ok: false, error: "binding absent" };
    } else {
      const probe = await env.API_RATE_LIMIT.limit({ key: "__healthcheck__" });
      checks.ratelimit = { ok: true, probe_success: probe?.success ?? null };
    }
  } catch (err) {
    checks.ratelimit = { ok: false, error: String(err?.message ?? err) };
  }
  const ok = Object.values(checks).every((c) => c.ok);
  return json(
    {
      ok,
      environment: env.ENVIRONMENT ?? "unknown",
      time: (/* @__PURE__ */ new Date()).toISOString(),
      checks
    },
    { status: ok ? 200 : 503 }
  );
}
__name(health, "health");
async function catalog(env) {
  const { results } = await env.DB.prepare(
    `SELECT sku, tier, name, blurb, launch_price, regular_price, currency,
            billing_period, sort_order
       FROM catalog
      WHERE active = 1
      ORDER BY sort_order`
  ).all();
  const items = results.map((r) => ({
    ...r,
    launch_display: formatMoney(r.launch_price, r.currency),
    regular_display: formatMoney(r.regular_price, r.currency)
  }));
  return json({ items }, { cache: "public, max-age=300" });
}
__name(catalog, "catalog");
async function roadmap(env) {
  const { results } = await env.DB.prepare(
    `SELECT course_slug, title, summary, count, status
       FROM roadmap_interest
      ORDER BY count DESC, title`
  ).all();
  return json({ courses: results }, { cache: "public, max-age=60" });
}
__name(roadmap, "roadmap");
function formatMoney(minor, currency) {
  if (minor === 0) return "Free";
  const major = minor / 100;
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${Number.isInteger(major) ? major : major.toFixed(2)}`;
}
__name(formatMoney, "formatMoney");
async function handleApi(request, env, pathname) {
  if (env.API_RATE_LIMIT) {
    const { success } = await env.API_RATE_LIMIT.limit({ key: clientKey(request) });
    if (!success) return problem(429, "Too many requests. Slow down and try again shortly.");
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return problem(405, "Method not allowed. Phase 1 exposes read-only endpoints.");
  }
  switch (pathname) {
    case "/api/health":
      return health(env);
    case "/api/catalog":
      return catalog(env);
    case "/api/roadmap":
      return roadmap(env);
    case "/api/_limiter-selftest": {
      const key = `selftest-${Date.now()}`;
      let allowed = 0;
      let denied = 0;
      for (let i = 0; i < 100; i++) {
        const r = await env.API_RATE_LIMIT.limit({ key });
        if (r.success) allowed++;
        else denied++;
      }
      return json({ key, allowed, denied, limit_config: "60 per 60s" });
    }
    default:
      return problem(404, "No such endpoint.");
  }
}
__name(handleApi, "handleApi");

// worker.js
var BLOCKED = [
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
  /^\/cgi-bin(\/|$)/i
];
var worker_default = {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (BLOCKED.some((re) => re.test(pathname))) {
      return withSecurityHeaders(
        new Response("Not Found", {
          status: 404,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
            "X-Robots-Tag": "noindex, nofollow"
          }
        })
      );
    }
    if (pathname.startsWith("/api/")) {
      try {
        return withSecurityHeaders(await handleApi(request, env, pathname));
      } catch (err) {
        console.error("api_error", pathname, err?.stack ?? err);
        return withSecurityHeaders(
          new Response(JSON.stringify({ error: "Internal error." }), {
            status: 500,
            headers: { "Content-Type": "application/json; charset=utf-8" }
          })
        );
      }
    }
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  }
};

// ../../../../opt/homebrew/lib/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// .wrangler/tmp/bundle-WgpS5e/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../../opt/homebrew/lib/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-WgpS5e/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
