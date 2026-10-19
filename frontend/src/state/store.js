/**
 * Browser-local working state: drafts and preferences that must survive navigation and reloads.
 * Kept per mode so Demo-mode work never mixes with Live-mode work. Nothing here is a backend record.
 */
const KEY = "recompute.workspace.v2";
const listeners = new Set();

const blankMode = () => ({
  focusAssetId: null,
  labDrafts: {},
  scenarios: [],
  plan: { strategy: "model", items: {}, selected: [] },
  selections: {},
  replay: { assetId: null, step: 0, driver: null, value: null },
  fleet: { query: "", route: "all", state: "all", batch: "all", sort: "gain", scenario: "base", view: "cards", page: 1 },
});

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && raw.version === 2) return raw;
  } catch {
    /* fall through to a fresh workspace */
  }
  return { version: 2, mode: null, live: blankMode(), demo: blankMode() };
}

let state = load();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or disabled: keep working in memory */
  }
}

export const store = {
  get mode() {
    return state.mode;
  },
  setMode(mode) {
    state.mode = mode;
    persist();
    listeners.forEach((l) => l("mode"));
  },
  /** The working state for the current mode. */
  get ws() {
    const m = state.mode === "demo" ? "demo" : "live";
    state[m] = { ...blankMode(), ...state[m] };
    return state[m];
  },
  update(fn) {
    fn(this.ws);
    persist();
  },
  clearWorkspace() {
    const m = state.mode === "demo" ? "demo" : "live";
    state[m] = blankMode();
    persist();
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  _reset() {
    state = { version: 2, mode: null, live: blankMode(), demo: blankMode() };
    persist();
  },
};

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
