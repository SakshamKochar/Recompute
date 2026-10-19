import { ApiError } from "./client.js";
import { config } from "../config.js";

let snapshotPromise = null;

export function loadSnapshot(url = config.demoSnapshotUrl, fetchImpl = (...a) => globalThis.fetch(...a)) {
  if (!snapshotPromise) {
    snapshotPromise = fetchImpl(url)
      .then((r) => {
        if (!r.ok) throw new Error(`demo snapshot ${r.status}`);
        return r.json();
      })
      .catch((e) => {
        snapshotPromise = null;
        throw new ApiError("The demo snapshot could not be loaded", { kind: "network", detail: String(e) });
      });
  }
  return snapshotPromise;
}

export function resetSnapshotCache() {
  snapshotPromise = null;
}

/** Map a request onto a recorded response key. Only the query params the snapshot was recorded with survive. */
export function snapshotKey(path, query = {}) {
  if (/^\/assets\/[^/]+$/.test(path)) return `GET ${path}`;
  if (/^\/batches\/[^/]+$/.test(path)) return `GET ${path}?scenario=${query.scenario || "base"}`;
  return `GET ${path}`;
}

/**
 * Demo transport: answers reads from a snapshot of real backend responses and refuses writes.
 * It never computes a financial value; anything not recorded is reported as unavailable in Demo mode.
 */
export function createDemoTransport({ snapshot } = {}) {
  const get = async () => {
    if (!snapshot) snapshot = await loadSnapshot();
    transport._snap = snapshot;
    return snapshot;
  };
  const transport = {
    _snap: snapshot || null,
    mode: "demo",
    base: "demo-snapshot",
    url: () => null,
    async snapshot() {
      return get();
    },
    async request(method, path, opts = {}) {
      const snap = await get();
      if (method === "POST" && path === "/recommend") return demoRecommend(snap, opts.demo);
      if (method !== "GET") {
        throw new ApiError("Demo mode is read-only. Switch to Live mode to execute this against the backend.", {
          kind: "demo-readonly",
          path,
        });
      }
      const key = snapshotKey(path, opts.query);
      if (!(key in snap.responses)) {
        if (/^GET \/assets\/[^/]+(\/history)?$/.test(key)) {
          throw new ApiError(`No asset ${path.split("/")[2]} in the demo snapshot`, { kind: "http", status: 404, path });
        }
        throw new ApiError("This view was not recorded in the demo snapshot", { kind: "demo-unsupported", path });
      }
      return structuredClone(snap.responses[key]);
    },
  };
  return transport;
}

function demoRecommend(snap, hint) {
  const lab = hint && snap.lab[hint.assetId];
  const unsupported = (msg) => {
    throw new ApiError(msg, { kind: "demo-unsupported", path: "/recommend" });
  };
  if (!lab) unsupported("Recalculation for this asset needs Live mode. The demo snapshot recorded model runs for featured assets only.");
  if (hint.dial) {
    const grid = lab.grids[hint.dial] || {};
    const key = Object.keys(grid).find((k) => Math.abs(Number(k) - Number(hint.value)) < 1e-9);
    const hit = key !== undefined ? grid[key] : null;
    if (!hit) unsupported("That value was not recorded in the demo snapshot. Live mode recalculates any input.");
    return {
      model_version: snap.model_version,
      inputs: { ...lab.inputs, [hint.dial]: hint.value },
      result: structuredClone(hit.result),
      warnings: hit.warnings,
    };
  }
  const s = lab.scenarios[hint.scenario || "base"];
  if (!s) unsupported("That scenario was not recorded in the demo snapshot.");
  return structuredClone(s);
}
