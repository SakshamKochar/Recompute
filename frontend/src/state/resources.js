/**
 * A tiny keyed cache for backend reads. Views ask for a resource; when it settles, the app re-renders.
 * Mutations call invalidate() with the keys they affect so dependent views refetch.
 */
const cache = new Map();
let onChange = () => {};
let generation = 0;

export function setResourceListener(fn) {
  onChange = fn;
}

export function resource(key, loader, { refresh = false } = {}) {
  let entry = cache.get(key);
  if (!entry || refresh || entry.stale) {
    const gen = generation;
    const previous = entry?.data;
    entry = { status: previous !== undefined ? "refreshing" : "loading", data: previous, error: null };
    cache.set(key, entry);
    entry.promise = Promise.resolve()
      .then(loader)
      .then(
        (data) => {
          if (gen !== generation) return;
          cache.set(key, { status: "ready", data, error: null, at: Date.now(), promise: entry.promise });
          onChange(key);
        },
        (error) => {
          if (gen !== generation) return;
          cache.set(key, { status: "error", data: previous, error, at: Date.now(), promise: entry.promise });
          onChange(key);
        },
      );
  }
  return cache.get(key);
}

/** Await a resource (used where a handler needs the data before continuing). */
export async function load(key, loader) {
  const entry = resource(key, loader);
  await entry.promise;
  const settled = cache.get(key);
  if (settled.status === "error") throw settled.error;
  return settled.data;
}

export function peek(key) {
  return cache.get(key)?.data;
}

/** Mark keys stale (exact keys, or prefixes ending in '*'). The next read refetches; the old data stays visible. */
export function invalidate(...keys) {
  for (const k of [...cache.keys()]) {
    if (keys.some((p) => (p.endsWith("*") ? k.startsWith(p.slice(0, -1)) : k === p))) {
      const e = cache.get(k);
      cache.set(k, { ...e, stale: true });
    }
  }
  onChange("invalidate");
}

export function clearResources() {
  generation++;
  cache.clear();
}
