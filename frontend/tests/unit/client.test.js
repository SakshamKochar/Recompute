import { describe, expect, it, vi } from "vitest";
import { ApiError, createHttpTransport, describeError } from "../../src/api/client.js";

const res = (status, body) => ({ ok: status < 400, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

describe("describeError", () => {
  it("passes through a string detail (409 wrong state)", () => {
    expect(describeError(409, { detail: "cannot sell from RECEIVED; allowed from ['LISTED', 'SANITIZING']" }).message).toMatch(/cannot sell/);
  });
  it("flattens pydantic validation lists into field errors", () => {
    const out = describeError(422, { detail: [{ loc: ["body", "utilization"], msg: "Input should be less than or equal to 1", input: 7 }] });
    expect(out.fieldErrors).toEqual([{ field: "utilization", message: "Input should be less than or equal to 1", input: 7 }]);
    expect(out.message).toBe("utilization: Input should be less than or equal to 1");
  });
  it("reads upload row errors", () => {
    const out = describeError(422, { detail: { message: "1 row has problems", errors: [{ row: 2, field: "utilization", error: "too big", value: "7" }] } });
    expect(out.message).toBe("1 row has problems");
    expect(out.fieldErrors[0]).toMatchObject({ row: 2, field: "utilization", input: "7" });
  });
  it("reads model-output problems", () => {
    const out = describeError(500, { detail: { error: "model output failed checks", model_version: "0.9", problems: [{ field: "base", problem: "NaN" }] } });
    expect(out.message).toContain("model 0.9");
    expect(out.fieldErrors[0].field).toBe("base");
  });
});

describe("HTTP transport", () => {
  it("builds URLs and drops empty query params", async () => {
    const fetchImpl = vi.fn(async () => res(200, { ok: true }));
    const t = createHttpTransport({ base: "/api", fetchImpl });
    await t.request("GET", "/batches/X", { query: { scenario: "bear", empty: undefined } });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/batches/X?scenario=bear");
  });
  it("retries GETs on 5xx, then succeeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(res(503, { detail: "busy" })).mockResolvedValueOnce(res(200, { n: 1 }));
    const t = createHttpTransport({ base: "", fetchImpl });
    await expect(t.request("GET", "/x")).resolves.toEqual({ n: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("never retries writes", async () => {
    const fetchImpl = vi.fn(async () => res(503, { detail: "busy" }));
    const t = createHttpTransport({ base: "", fetchImpl });
    await expect(t.request("POST", "/assets/A/events", { body: { event: "list" } })).rejects.toMatchObject({ kind: "http", status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("does not retry 4xx and keeps the backend message", async () => {
    const fetchImpl = vi.fn(async () => res(404, { detail: "asset NOPE not found" }));
    const t = createHttpTransport({ base: "", fetchImpl });
    const err = await t.request("GET", "/assets/NOPE").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("asset NOPE not found");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("reports network failures as kind network", async () => {
    const t = createHttpTransport({ base: "", fetchImpl: async () => Promise.reject(new TypeError("Failed to fetch")) });
    await expect(t.request("GET", "/x", { retries: 0 })).rejects.toMatchObject({ kind: "network" });
  });
  it("times out", async () => {
    const fetchImpl = (url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const t = createHttpTransport({ base: "", fetchImpl });
    await expect(t.request("GET", "/slow", { retries: 0, timeout: 20 })).rejects.toMatchObject({ kind: "timeout" });
  });
  it("reports caller cancellation as aborted, without retrying", async () => {
    const fetchImpl = vi.fn((url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    const t = createHttpTransport({ base: "", fetchImpl });
    const c = new AbortController();
    const p = t.request("POST", "/recommend", { body: {}, signal: c.signal });
    c.abort();
    await expect(p).rejects.toMatchObject({ kind: "aborted" });
  });
  it("rejects non-JSON success bodies", async () => {
    const t = createHttpTransport({ base: "", fetchImpl: async () => res(200, "<html>") });
    await expect(t.request("GET", "/x")).rejects.toMatchObject({ kind: "parse" });
  });
});
