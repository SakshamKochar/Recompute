/** Every backend call the app makes, in one place. Paths and fields follow the FastAPI source (app/*.py). */

let transport = null;

export function setTransport(t) {
  transport = t;
}
export function getTransport() {
  return transport;
}
const req = (method, path, opts) => {
  if (!transport) throw new Error("API transport not configured");
  return transport.request(method, path, opts);
};
const enc = encodeURIComponent;

export const api = {
  health: (opts) => req("GET", "/health", { retries: 0, timeout: 5000, ...opts }),
  meta: () => req("GET", "/meta"),
  dashboard: () => req("GET", "/dashboard"),
  assets: () => req("GET", "/assets"),
  asset: (id, { confidence = true } = {}) =>
    req("GET", `/assets/${enc(id)}`, { query: confidence ? undefined : { confidence: false } }),
  history: (id) => req("GET", `/assets/${enc(id)}/history`),
  patchInputs: (id, inputs) => req("PATCH", `/assets/${enc(id)}/inputs`, { body: inputs }),
  postEvent: (id, { event, note, override = false, selected_route }) =>
    req("POST", `/assets/${enc(id)}/events`, {
      body: { event, override, ...(note ? { note } : {}), ...(selected_route ? { selected_route } : {}) },
    }),
  recordOutcome: (id, { realized_value, note }) =>
    req("POST", `/assets/${enc(id)}/outcomes`, { body: { realized_value, ...(note ? { note } : {}) } }),
  outcomes: () => req("GET", "/outcomes"),
  recommend: (inputs, { scenario, flipPoints = false, signal, demo } = {}) =>
    req("POST", "/recommend", {
      body: inputs,
      query: { scenario, flip_points: flipPoints || undefined },
      signal,
      demo,
    }),
  batches: () => req("GET", "/batches"),
  batch: (id, { scenario = "base" } = {}) => req("GET", `/batches/${enc(id)}`, { query: { scenario } }),
  batchScenarios: (id) => req("GET", `/batches/${enc(id)}/scenarios`),
  batchCsvUrl: (id, scenario = "base") => transport?.url(`/batches/${enc(id)}/results.csv`, { scenario }),
  templateUrl: () => transport?.url("/assets/upload/template"),
  template: () => req("GET", "/assets/upload/template", { raw: true }),
  upload: (file, { dryRun = false, skipExisting = false } = {}) => {
    const form = new FormData();
    form.append("file", file);
    return req("POST", "/assets/upload", {
      form,
      query: { dry_run: dryRun || undefined, skip_existing: skipExisting || undefined },
      timeout: 60000,
    });
  },
  marketEvidence: () => req("GET", "/market/evidence"),
  marketLive: () => req("GET", "/market/live", { retries: 0, timeout: 20000 }),
};
