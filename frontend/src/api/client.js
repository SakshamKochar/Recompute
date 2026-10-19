import { config } from "../config.js";

export class ApiError extends Error {
  /**
   * kind: network | timeout | aborted | http | parse | demo-readonly | demo-unsupported
   */
  constructor(message, { kind, status = null, detail = null, fieldErrors = [], path = "" } = {}) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
    this.fieldErrors = fieldErrors;
    this.path = path;
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
export function createHttpTransport({ base = config.apiBase, timeoutMs = config.timeoutMs, fetchImpl } = {}) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));

  async function once(method, path, { query, body, form, signal, timeout = timeoutMs, raw = false } = {}) {
    const url = buildUrl(base, path, query);
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, timeout);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort);
    let res;
    try {
      res = await doFetch(url, {
        method,
        signal: ctrl.signal,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      });
    } catch (e) {
      if (signal?.aborted) throw new ApiError("Request cancelled", { kind: "aborted", path });
      if (timedOut) throw new ApiError(`The API did not answer within ${Math.round(timeout / 1000)} s`, { kind: "timeout", path });
      throw new ApiError("Can't reach the ReCompute API", { kind: "network", path, detail: String(e?.message || e) });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    if (raw && res.ok) return res.text();
    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (!res.ok) data = { detail: text.slice(0, 300) };
        else throw new ApiError("The API returned something that isn't JSON", { kind: "parse", status: res.status, path });
      }
    }
    if (!res.ok) {
      const { message, fieldErrors, extra } = describeError(res.status, data);
      throw new ApiError(message, { kind: "http", status: res.status, detail: extra ?? data?.detail, fieldErrors, path });
    }
    return data;
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
          if (!(e instanceof ApiError) || !e.retryable || attempt >= retries || opts.signal?.aborted) throw e;
          await sleep(300 * 2 ** attempt);
        }
      }
    },
  };
}
