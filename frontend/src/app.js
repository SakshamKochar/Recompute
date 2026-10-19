/** Shared app handle for views. main.js installs the real scheduler and mode switch at boot. */
export const app = {
  health: { state: "checking", version: null, error: null },
  route: { page: "home", param: null, query: {} },
  schedule: () => {},
  setMode: async () => {},
};

export const rerender = () => app.schedule();

export function navigate(hash) {
  if (location.hash === hash) app.schedule(true);
  else location.hash = hash;
}
