import "@fontsource-variable/inter/opsz.css";
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/instrument-serif/latin-400-italic.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./styles/base.css";
import "./styles/studio.css";
import "./styles/integration.css";

import { app } from "./app.js";
import { config } from "./config.js";
import { api, setTransport, getTransport } from "./api/backend.js";
import { createHttpTransport } from "./api/client.js";
import { createDemoTransport } from "./api/demo.js";
import { store } from "./state/store.js";
import { clearResources, invalidate, setResourceListener } from "./state/resources.js";
import { esc } from "./lib/html.js";
import { confirmDialog, toast } from "./ui/feedback.js";
import { startTicker } from "./ui/ticker.js";

import home from "./views/home.js";
import overview from "./views/overview.js";
import fleet from "./views/fleet.js";
import passport from "./views/passport.js";
import command from "./views/command.js";
import lab from "./views/lab.js";
import replay from "./views/replay.js";
import market from "./views/market.js";
import outcomes from "./views/outcomes.js";
import about from "./views/about.js";

const VIEWS = { home, overview, fleet, passport, command, lab, replay, market, outcomes, about };
const NAV = ["overview", "fleet", "command", "lab", "replay", "market", "outcomes", "about"];

export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#/, "") || "home";
  const [pathPart, queryPart = ""] = raw.split("?");
  const [page, ...rest] = pathPart.split("/");
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  return { page: VIEWS[page] ? page : "overview", param: rest.length ? decodeURIComponent(rest.join("/")) : null, query };
}

/* ---------------------------------------------------------------- mode and transport */

async function checkHealth() {
  app.health = { state: "checking", version: null, error: null };
  renderChrome();
  try {
    const h = await api.health();
    app.health = { state: h?.ok ? "ok" : "down", version: h?.model_version ?? null, error: null };
  } catch (e) {
    app.health = { state: "down", version: null, error: e };
  }
  renderChrome();
  return app.health.state === "ok";
}

export async function setMode(mode, { persist = true } = {}) {
  clearResources();
  if (persist) store.setMode(mode);
  if (mode === "demo") {
    setTransport(createDemoTransport());
    try {
      const snap = await getTransport().snapshot();
      app.health = { state: "ok", version: snap.model_version, error: null };
    } catch (e) {
      app.health = { state: "down", version: null, error: e };
    }
  } else {
    setTransport(createHttpTransport());
    await checkHealth();
  }
  renderChrome();
  scheduleRender(true);
  startTicker();
}

async function boot() {
  const stored = store.mode;
  const wanted = stored || (config.defaultMode === "demo" ? "demo" : "live");
  await setMode(wanted, { persist: !!stored || config.defaultMode !== "auto" });
}

/* ---------------------------------------------------------------- chrome */

function renderChrome() {
  const t = getTransport();
  const demo = t?.mode === "demo";
  const h = app.health;
  const sw = document.querySelector("#mode-switch");
  if (sw) {
    const status = demo ? "demo" : h.state === "ok" ? "live" : h.state === "checking" ? "checking" : "offline";
    const label = demo ? "Demo" : h.state === "ok" ? "" : h.state === "checking" ? "Connecting" : "Offline";
    const pill = label
      ? `<span class="mode-pill ${status}"><span class="sandbox-dot ${status}" aria-hidden="true"></span><span class="mode-label">${label}</span></span>`
      : `<span class="sr-only">Live mode, model v${esc(h.version || "")}</span>`;
    sw.innerHTML = `<span class="mode-status" aria-live="polite">${pill}</span>
      <button type="button" class="mode-toggle" data-action="switch-mode" data-mode="${demo ? "live" : "demo"}">${demo ? "Use Live data" : "Explore Demo"}</button>
      <button type="button" id="reset" data-action="clear-drafts" aria-label="Clear drafts saved on this device" title="Clear drafts saved on this device"><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 6.4A5 5 0 1 1 3 9.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M2.6 2.8v3.8h3.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  }
  const banner = document.querySelector("#mode-banner");
  if (banner) {
    if (demo) {
      banner.innerHTML = `<div class="mode-banner demo" role="note"><span class="micro">DEMO MODE</span><p>Illustrative snapshot recorded from the ReCompute v${esc(h.version || "0.9")} backend on synthetic servers and simulated NVIDIA diagnostics. Lifecycle actions are disabled and nothing executes.</p><button type="button" class="textlink" data-action="switch-mode" data-mode="live">Switch to Live ↗</button></div>`;
    } else if (h.state === "down") {
      banner.innerHTML = `<div class="mode-banner offline" role="alert"><span class="micro">LIVE MODE · NOT CONNECTED</span><p>Can’t reach the ReCompute API at <code>${esc(getTransport()?.base)}</code>. ${esc(h.error?.message || "")}. No figures are shown until it answers; nothing falls back to demo data.</p><button type="button" class="btn secondary" data-action="retry-health">Retry</button><button type="button" class="textlink" data-action="switch-mode" data-mode="demo">Explore the demo instead ↗</button></div>`;
    } else banner.innerHTML = "";
  }
  const fm = document.querySelector("#footer-model");
  if (fm) fm.innerHTML = demo ? "Demo snapshot · illustrative · no transactions" : h.version ? `Decision model v${esc(h.version)}` : "Every asset has a next chapter.";
}

/* ---------------------------------------------------------------- rendering */

let pending = false;
let dragging = false;
let lastPage = null;

export function scheduleRender(routeChanged = false) {
  if (routeChanged) app._routeChanged = true;
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    if (dragging) {
      app._deferred = true;
      return;
    }
    render();
  });
}

function captureFocus(root) {
  const el = document.activeElement;
  if (!el || !root.contains(el) || !el.id) return null;
  return { id: el.id, start: el.selectionStart, end: el.selectionEnd };
}

function restoreFocus(root, f) {
  if (!f) return;
  const el = root.querySelector(`#${CSS.escape(f.id)}`);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (typeof f.start === "number" && el.setSelectionRange) {
    try {
      el.setSelectionRange(f.start, f.end);
    } catch {
      /* not a text input */
    }
  }
}

function render() {
  const route = parseHash();
  const routeChanged = app._routeChanged || route.page !== app.route.page || route.param !== app.route.param;
  app._routeChanged = false;
  if (routeChanged && lastPage && VIEWS[lastPage]?.leave) VIEWS[lastPage].leave();
  app.route = route;
  const view = VIEWS[route.page];
  const isHome = route.page === "home";
  document.body.classList.toggle("experience-mode", isHome);

  if (isHome) {
    const root = document.querySelector("#experience");
    const f = captureFocus(root);
    root.innerHTML = view.render(route);
    view.after?.(root, route, { routeChanged });
    restoreFocus(root, f);
  } else {
    document.querySelector("#experience").innerHTML = "";
    const navKey = route.page === "passport" ? "fleet" : route.page;
    document.querySelector("#nav").innerHTML = NAV.map((k) => {
      const v = VIEWS[k];
      return `<a href="#${k}" class="${navKey === k ? "active" : ""}" ${navKey === k ? 'aria-current="page"' : ""}>${esc(v.title)}</a>`;
    }).join("");
    const root = document.querySelector("#main");
    const f = captureFocus(root);
    root.innerHTML = view.render(route);
    view.after?.(root, route, { routeChanged });
    restoreFocus(root, f);
    if (routeChanged) document.title = `${view.title} — ReCompute`;
  }
  if (routeChanged) {
    window.scrollTo(0, 0);
    if (!isHome && lastPage !== null) document.querySelector("#main").focus({ preventScroll: true });
  }
  lastPage = route.page;
}

/* ---------------------------------------------------------------- events */

const globalActions = {
  "switch-mode": async (el) => {
    await setMode(el.dataset.mode);
    toast(el.dataset.mode === "demo" ? "Demo mode: illustrative snapshot, nothing executes." : "Live mode: data comes from the ReCompute API.");
  },
  "retry-health": async () => {
    if (await checkHealth()) {
      clearResources();
      scheduleRender(true);
      toast("Connected to the ReCompute API.");
    }
  },
  "clear-drafts": async () => {
    const { confirmed } = await confirmDialog({
      title: "Clear drafts on this device?",
      body: `<p class="subtext">This removes saved scenarios, the draft Fleet Command plan and unsaved What-if inputs for ${getTransport()?.mode === "demo" ? "Demo" : "Live"} mode in this browser. Backend records, lifecycle history and outcomes are not touched.</p>`,
      confirmLabel: "Clear drafts",
      cancelLabel: "Keep my work",
    });
    if (confirmed) {
      store.clearWorkspace();
      scheduleRender();
      toast("Drafts on this device cleared.");
    }
  },
  retry: (el) => {
    invalidate(...(el.dataset.keys || "").split(",").filter(Boolean));
  },
};

function viewFor(target) {
  const inHome = target.closest("#experience");
  return inHome ? VIEWS.home : VIEWS[app.route.page];
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const name = el.dataset.action;
  const view = viewFor(el);
  const handler = view?.actions?.[name] || globalActions[name];
  if (!handler) return;
  if (el.tagName === "A" && !el.getAttribute("href")?.startsWith("#")) return;
  e.preventDefault();
  Promise.resolve(handler(el, e, app.route)).catch((err) => {
    console.error(err);
    toast(err?.message || "Something went wrong");
  });
});

for (const type of ["input", "change"]) {
  document.addEventListener(type, (e) => {
    const view = viewFor(e.target);
    const fn = type === "input" ? view?.onInput : view?.onChange;
    fn?.(e, app.route);
  });
}

document.addEventListener("submit", (e) => {
  const form = e.target.closest("form[data-submit]");
  if (!form) return;
  const view = viewFor(form);
  const handler = view?.actions?.[form.dataset.submit];
  if (!handler) return;
  e.preventDefault();
  Promise.resolve(handler(form, e, app.route)).catch((err) => toast(err?.message || "Something went wrong"));
});

document.addEventListener("pointerdown", (e) => {
  if (e.target.matches?.('input[type="range"]')) dragging = true;
});
const endDrag = () => {
  if (!dragging) return;
  dragging = false;
  if (app._deferred) {
    app._deferred = false;
    scheduleRender();
  }
};
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);

window.addEventListener("hashchange", () => scheduleRender(true));
setResourceListener(() => scheduleRender());
app.schedule = scheduleRender;
app.setMode = setMode;

boot();
