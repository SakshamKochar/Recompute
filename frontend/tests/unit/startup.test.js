import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { snapshot } from "./fixtures.js";

vi.mock("../../src/ui/motion.js", () => ({
  mountMotion: vi.fn(), orbitArt: () => "", constellationArt: () => "",
}));
vi.mock("../../src/ui/ticker.js", () => ({ startTicker: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  localStorage.clear();
  location.hash = "";
  document.body.innerHTML = '<div id="mode-switch"></div><div id="mode-banner"></div><div id="footer-model"></div><div id="experience"></div><nav id="nav"></nav><main id="main"></main>';
  vi.stubGlobal("requestAnimationFrame", (fn) => setTimeout(fn, 16));
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (url.endsWith("/health")) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      return { ok: true, text: async () => JSON.stringify({ok:true}) };
    }
    return { ok: true, json: async () => snapshot, text: async () => JSON.stringify({}) };
  }));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("measures landing render with a five-second health response", async () => {
  await import("../../src/main.js");
  await vi.advanceTimersByTimeAsync(50);
  const early = !!document.querySelector('#experience h1');
  expect(early).toBe(true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(document.querySelector('#experience h1')).not.toBeNull();
  console.log(JSON.stringify({healthDelayMs:5000,visibleBy50ms:early,renderBudgetMs:early?50:5050}));
});

it("a late Live health response cannot replace a newly selected Demo session", async () => {
  const { setMode } = await import("../../src/main.js");
  const { getTransport } = await import("../../src/api/backend.js");
  const { app } = await import("../../src/app.js");
  await vi.advanceTimersByTimeAsync(50);
  await setMode("demo");
  await vi.advanceTimersByTimeAsync(5050);
  expect(getTransport().mode).toBe("demo");
  expect(app.health.version).toBe(snapshot.model_version);
  expect(document.querySelector('#experience h1')).not.toBeNull();
});


it("automatically reconnects after a challenge without replacing the live session with demo data", async () => {
  let healthCalls = 0;
  fetch.mockImplementation(async (url) => {
    if (url.endsWith("/health")) {
      healthCalls++;
      if (healthCalls === 1) return new Response("<html>challenge</html>", {
        status: 429, headers: { "cf-mitigated": "challenge", "retry-after": "30" },
      });
      return Response.json({ ok: true, model_version: "0.9" });
    }
    return Response.json(snapshot);
  });
  await import("../../src/main.js");
  const { app } = await import("../../src/app.js");
  const { getTransport } = await import("../../src/api/backend.js");
  await vi.advanceTimersByTimeAsync(50);
  expect(app.health.state).toBe("waking");
  await vi.advanceTimersByTimeAsync(29000);
  expect(healthCalls).toBe(1);
  await vi.advanceTimersByTimeAsync(2100);
  expect(healthCalls).toBe(2);
  expect(app.health.state).toBe("ok");
  expect(getTransport().mode).toBe("live");
});
