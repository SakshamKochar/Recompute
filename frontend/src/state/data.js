/** Named backend resources and the mutations that keep them consistent. */
import { api } from "../api/backend.js";
import { invalidate, load, resource } from "./resources.js";

export const R = {
  meta: () => resource("meta", api.meta),
  dashboard: () => resource("dashboard", api.dashboard),
  assets: () => resource("assets", api.assets),
  asset: (id) => resource(`asset:${id}`, () => api.asset(id)),
  history: (id) => resource(`history:${id}`, () => api.history(id)),
  batches: () => resource("batches", api.batches),
  batch: (id, scenario = "base") => resource(`batch:${id}:${scenario}`, () => api.batch(id, { scenario })),
  batchScenarios: (id) => resource(`scenarios:${id}`, () => api.batchScenarios(id)),
  outcomes: () => resource("outcomes", api.outcomes),
  evidence: () => resource("evidence", api.marketEvidence),
};

export const loadAsset = (id) => load(`asset:${id}`, () => api.asset(id));
export const loadHistory = (id) => load(`history:${id}`, () => api.history(id));
export const loadMeta = () => load("meta", api.meta);

/** Everything that can change when one asset's state or inputs change. */
export function invalidateAsset(id) {
  invalidate(`asset:${id}`, `history:${id}`, "dashboard", "assets", "batches", "batch:*", "scenarios:*", "outcomes");
}

export async function executeEvent(id, body) {
  const out = await api.postEvent(id, body);
  invalidateAsset(id);
  return out;
}

export async function patchInputs(id, inputs) {
  const out = await api.patchInputs(id, inputs);
  invalidateAsset(id);
  return out;
}

export async function recordOutcome(id, body) {
  const out = await api.recordOutcome(id, body);
  invalidateAsset(id);
  return out;
}

export async function uploadCsv(file, opts) {
  const out = await api.upload(file, opts);
  if (!opts?.dryRun) invalidate("dashboard", "assets", "batches", "batch:*", "scenarios:*");
  return out;
}
