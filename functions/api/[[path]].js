/** Proxy `/api/...` on Cloudflare Pages to the Render service.
 * The studio calls `/api`. Render's routes have no `/api` prefix.
 * Set API_ORIGIN to the service origin, for example https://recompute-api.onrender.com
 */

export function apiTarget(requestUrl, origin) {
  const incoming = new URL(requestUrl);
  const stripped = incoming.pathname.replace(/^\/api(?=\/|$)/, "") || "/";
  const target = new URL(origin);
  target.pathname = stripped;
  target.search = incoming.search;
  return target;
}

export async function onRequest(context) {
  const origin = context.env?.API_ORIGIN?.trim();
  if (!origin) {
    return Response.json(
      { detail: "API_ORIGIN is not set. Point it at the Render service URL." },
      { status: 503 },
    );
  }
  const target = apiTarget(context.request.url, origin);
  const headers = new Headers(context.request.headers);
  headers.delete("host");
  const init = { method: context.request.method, headers, redirect: "manual" };
  if (context.request.method !== "GET" && context.request.method !== "HEAD") {
    init.body = context.request.body;
  }
  return fetch(target, init);
}
