const env = import.meta.env || {};

export const config = {
  apiBase: (env.VITE_API_BASE ?? "/api").replace(/\/$/, ""),
  timeoutMs: Number(env.VITE_API_TIMEOUT_MS ?? 15000),
  defaultMode: env.VITE_DEFAULT_MODE ?? "auto",
  demoSnapshotUrl: `${env.BASE_URL ?? "/"}demo/snapshot.json`,
};
