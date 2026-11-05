/** Same-origin API gateway. Never send upstream challenge HTML to the studio. */
export function apiTarget(requestUrl, origin) {
  const incoming = new URL(requestUrl);
  const target = new URL(origin);
  target.pathname = incoming.pathname.replace(/^\/api(?=\/|$)/, "") || "/";
  target.search = incoming.search;
  return target;
}

// Only public, read-only reference data. Fleet, health and writes are never cached.
const PUBLIC_TTL = { "/meta": 60, "/market/evidence": 60, "/market/live": 15 };
function failure(code, message, status, ray, retryAfter = "30") {
  return Response.json({ detail: message, code, request_id: ray || null }, {
    status, headers: { "Cache-Control": "no-store", "Retry-After": retryAfter,
      ...(ray ? { "X-Upstream-Ray": ray } : {}) },
  });
}

export async function onRequest(context) {
  const origin = context.env?.API_ORIGIN?.trim();
  if (!origin) return failure("API_UNCONFIGURED", "The workspace connection is not configured.", 503);
  let target;
  try {
    target = apiTarget(context.request.url, origin);
    if (target.protocol !== "https:" || target.username || target.password) throw Error("Invalid origin");
  } catch {
    return failure("API_UNCONFIGURED", "The workspace connection is not configured.", 503);
  }
  const request = context.request;
  const read = request.method === "GET" || request.method === "HEAD";
  const headers = new Headers(request.headers);
  for (const h of ["host", "connection", "content-length", "transfer-encoding"]) headers.delete(h);
  const ttl = request.method === "GET" && !target.search &&
    !headers.has("authorization") && !headers.has("cookie") ? PUBLIC_TTL[target.pathname] : 0;
  const cache = ttl ? globalThis.caches?.default : null;
  // Include origin in the key so switching API deployments cannot reuse old metadata.
  const keyUrl = new URL(request.url);
  keyUrl.searchParams.set("__api_origin", target.origin);
  keyUrl.searchParams.set("__request_origin", headers.get("origin") || "");
  const key = new Request(keyUrl, { method: "GET" });
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) {
        const result = new Response(hit.body, hit);
        result.headers.set("X-Recompute-Cache", "HIT");
        result.headers.set("Cache-Control", "no-store");
        return result;
      }
    } catch { /* Cache failures must not make the API unavailable. */ }
  }
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), read ? 20000 : 60000);
  let upstream;
  const started = Date.now();
  try {
    const init = { method: request.method, headers, redirect: "manual", signal: ctrl.signal };
    if (!read) init.body = request.body;
    upstream = await fetch(target, init);
    const ray = upstream.headers.get("cf-ray");
    const challenged = upstream.headers.get("cf-mitigated") === "challenge";
    const html = /text\/html/i.test(upstream.headers.get("content-type") || "");
    if (challenged || html || upstream.status === 429) {
      const code = challenged ? "UPSTREAM_CHALLENGE" : upstream.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_NOT_READY";
      console.warn(JSON.stringify({ event: "api_unavailable", code, path: target.pathname,
        upstream_status: upstream.status, upstream_ray: ray, elapsed_ms: Date.now() - started }));
      await upstream.body?.cancel();
      return failure(code, challenged ? "The API provider is temporarily blocking the workspace connection. We will reconnect automatically."
        : "The workspace is temporarily busy or starting up. We will reconnect automatically.",
        upstream.status === 429 && !challenged ? 429 : 503, ray, upstream.headers.get("retry-after") || "30");
    }
    // Keep the deadline active through the body, not just until response headers arrive.
    const body = read && request.method === "HEAD" || upstream.status === 204 || upstream.status === 304
      ? null : await upstream.arrayBuffer();
    const result = new Response(body, { status: upstream.status, headers: upstream.headers });
    result.headers.set("Cache-Control", "no-store");
    result.headers.set("Server-Timing", `upstream;dur=${Date.now() - started}`);
    if (ray) result.headers.set("X-Upstream-Ray", ray);
    if (cache && upstream.ok && /application\/json/i.test(upstream.headers.get("content-type") || "") &&
        !upstream.headers.has("set-cookie") && !/private|no-store/i.test(upstream.headers.get("cache-control") || "") &&
        (upstream.headers.get("vary") || "").split(",").every(v => ["", "origin", "accept-encoding"].includes(v.trim().toLowerCase()))) {
      const cached = result.clone();
      cached.headers.delete("Vary");
      cached.headers.set("Cache-Control", `public, max-age=${ttl}`);
      result.headers.set("X-Recompute-Cache", "MISS");
      const put = cache.put(key, cached).catch(() => {});
      if (context.waitUntil) context.waitUntil(put); else await put;
    }
    return result;
  } catch {
    console.warn(JSON.stringify({ event: "api_unavailable", code: ctrl.signal.aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_NETWORK",
      path: target.pathname, elapsed_ms: Date.now() - started }));
    return failure(ctrl.signal.aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_NETWORK",
      "The workspace is taking longer than usual to respond. We will reconnect automatically.", ctrl.signal.aborted ? 504 : 502);
  } finally {
    clearTimeout(timeout);
  }
}
