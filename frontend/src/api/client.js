import { config } from "../config.js";

export class ApiError extends Error {
  /**
   * kind: network | timeout | aborted | http | parse | demo-readonly | demo-unsupported
   */
  constructor(message, { kind, status = null, detail = null, fieldErrors = [], path = "", retryAfterMs = 0, requestId = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
    this.fieldErrors = fieldErrors;
    this.path = path;
    this.retryAfterMs = retryAfterMs;
    this.requestId = requestId;
  }
  get retryable() {
    return this.kind === "network" || this.kind === "timeout" || (this.kind === "http" && this.status >= 500);
  }
}

/** Turn FastAPI's three error shapes (string, {message, errors}, pydantic list) into one readable message. */
export function describeError(status, body) {
  const detail = body && typeof body === "object" ? body.detail : body;
  if (typeof detail === "string") return { message: detail, fieldErrors: [] };
  if (Array.isArray(detail)) {
    const fieldErrors = detail.map((d) => ({
      field: (d.loc || []).filter((p) => p !== "body" && p !== "query").join("."),
      message: d.msg,
      input: d.input,
    }));
    return {
      message: fieldErrors.map((f) => (f.field ? `${f.field}: ${f.message}` : f.message)).join("; "),
      fieldErrors,
    };
  }
  if (detail && typeof detail === "object") {
    if (detail.error && detail.problems) {
      return {
        message: `${detail.error} (model ${detail.model_version})`,
        fieldErrors: detail.problems.map((p) => ({ field: p.field, message: p.problem })),
      };
    }
    const rows = detail.errors || [];
    return {
      message: detail.message || `Request failed (${status})`,
      fieldErrors: rows.map((e) => ({ row: e.row, field: e.field, message: e.error, input: e.value })),
      extra: detail,
    };
  }
  return { message: `Request failed (${status})`, fieldErrors: [] };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildUrl(base, path, query) {
  const qs = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&")
    : "";
  return `${base}${path}${qs ? `?${qs}` : ""}`;
}

/**
 * Live HTTP transport. GETs retry on network failures, timeouts and 5xx; writes never retry.
 */
export function createHttpTransport({ base = config.apiBase, timeoutMs = config.timeoutMs, fetchImpl, onUnavailable = () => {} } = {}) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));

  async function once(method, path, { query, body, form, signal, timeout = timeoutMs, raw = false } = {}) {
    if (signal?.aborted) throw new ApiError("Request cancelled", { kind: "aborted", path });
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeout);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await doFetch(buildUrl(base, path, query), {
        method, signal: ctrl.signal,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      });
      const header = (key) => res.headers?.get(key);
      const retry = header("retry-after");
      const delay = retry == null ? (res.status === 429 || header("cf-mitigated") === "challenge" ? 30000 : 0) : /^\d+(\.\d+)?$/.test(retry)
        ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
      const retryAfterMs = Number.isFinite(delay) ? Math.max(0, delay) : 30000;
      const requestId = header("x-upstream-ray") || header("cf-ray") || null;
      const errorInfo = { status: res.status, path, retryAfterMs, requestId };
      if (header("cf-mitigated") === "challenge") {
        throw new ApiError("The API provider is temporarily blocking the connection. Reconnecting automatically.", { ...errorInfo, kind: "challenge" });
      }
      const text = await res.text();
      if (raw && res.ok && !/text\/html/i.test(header("content-type") || "")) return text;
      let data = null;
      if (text) {
        try { data = JSON.parse(text); }
        catch {
          if (res.status === 429) throw new ApiError("The workspace is busy. Reconnecting automatically.", { ...errorInfo, kind: "rate-limit" });
          if (!res.ok) throw new ApiError("The workspace is temporarily unavailable. Please try again shortly.", { ...errorInfo, kind: "http" });
          throw new ApiError("The API returned something that isn't JSON", { ...errorInfo, kind: "parse" });
        }
      }
      if (!res.ok) {
        const kind = data?.code === "UPSTREAM_CHALLENGE" ? "challenge" : res.status === 429 ? "rate-limit" : "http";
        const { message, fieldErrors, extra } = describeError(res.status, data);
        throw new ApiError(message, { ...errorInfo, kind, detail: extra ?? data?.detail, fieldErrors, requestId: data?.request_id || requestId });
      }
      return data;
    } catch (e) {
      if (signal?.aborted) throw new ApiError("Request cancelled", { kind: "aborted", path });
      if (timedOut) throw new ApiError(`The API did not answer within ${Math.round(timeout / 1000)} s`, { kind: "timeout", path });
      if (e instanceof ApiError) throw e;
      throw new ApiError("Can't reach the ReCompute API", { kind: "network", path });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  return {
    mode: "live",
    base,
    url: (path, query) => buildUrl(base, path, query),
    async request(method, path, opts = {}) {
      const retries = method === "GET" ? (opts.retries ?? 2) : 0;
      for (let attempt = 0; ; attempt++) {
        try {
          return await once(method, path, opts);
        } catch (e) {
          if (!(e instanceof ApiError) || !e.retryable || attempt >= retries || e.retryAfterMs > 10000 || opts.signal?.aborted) {
            if (path !== "/health" && !path.startsWith("/market/") && e instanceof ApiError && (e.retryable || ["challenge", "rate-limit"].includes(e.kind))) onUnavailable(e);
            throw e;
          }
          await sleep(Math.max(300 * 2 ** attempt, e.retryAfterMs || 0) + Math.floor(Math.random() * 100));
        }
      }
    },
  };
}
