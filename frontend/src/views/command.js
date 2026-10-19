import { rerender } from "../app.js";
import { api } from "../api/backend.js";
import { R, invalidateAsset } from "../state/data.js";
import { invalidate, resource } from "../state/resources.js";
import { store } from "../state/store.js";
import { adaptAssetRow, hardwareTitle } from "../lib/adapters.js";
import { money, pad2 } from "../lib/format.js";
import { esc } from "../lib/html.js";
import { eventInfo, stateInfo } from "../lib/lifecycle.js";
import { COMPUTE_ROUTES, LANES, routeInfo } from "../lib/routes.js";
import { contextStrip, emptyBlock, heading, isDemo, tag, withData } from "../ui/components.js";
import { openDialog, toast } from "../ui/feedback.js";

export const STRATEGIES = {
  model: ["Follow the recommendation", "Each asset takes the route ReCompute recommends."],
  capital: ["Free up capital", "Each asset takes its baseline: sell now if it passed diagnostics, otherwise the better of harvest and recycle."],
  earn: ["Keep earning", "Each asset takes its best eligible compute route (yield while listed or host longer). Assets with no eligible compute route keep the model’s route."],
};
const LANE_LIMIT = 12;
let laneOpen = {};
let lastRun = null;
let running = false;

const plan = () => store.ws.plan;
const lite = (id) => resource(`lite:${id}`, () => api.asset(id, { confidence: false }));

/**
 * The route a strategy assigns to one asset. Pure policy over backend values: it never computes a value,
 * only picks which of the model's own per-route results to use.
 */
export function strategyRoute(a, strategy, detail) {
  if (strategy === "capital") return { route: a.baselineRoute, value: a.baselineValue };
  if (strategy === "earn") {
    if (!detail) return { route: null, value: null, pending: true };
    const res = detail.recommendation?.result;
    const options = COMPUTE_ROUTES.filter((r) => res?.eligible?.includes(r)).sort((x, y) => res.base[y] - res.base[x]);
    if (!options.length) return { route: a.route, value: a.routeValue, fallback: true };
    return { route: options[0], value: res.base[options[0]] };
  }
  return { route: a.route, value: a.routeValue };
}

/** How the backend would treat a route's first lifecycle step for this asset right now. */
export function moveFor(a, route) {
  const event = routeInfo(route).firstEvent;
  if (!event) return { event: null, kind: "blocked" };
  if (a.allowedEvents.includes(event)) return { event, kind: "allowed" };
  if (a.overrideEvents.includes(event)) return { event, kind: "override" };
  return { event, kind: "blocked" };
}

function items(rows, strategy) {
  return rows.map((a) => {
    const d = strategy === "earn" ? lite(a.id) : null;
    const pick = strategyRoute(a, strategy, d?.data);
    return { a, ...pick, error: d?.status === "error" && !d.data ? d.error : null, move: pick.route ? moveFor(a, pick.route) : null };
  });
}

function card(it, selected) {
  const { a } = it;
  const r = it.route ? routeInfo(it.route) : null;
  const differs = it.route && it.route !== a.route;
  return `<label class="command-asset ${selected ? "selected" : ""}"><div class="row"><span class="micro">${esc(a.id)}</span><input type="checkbox" data-select="${esc(a.id)}" aria-label="Include ${esc(a.id)} in the plan" ${selected ? "checked" : ""} ${it.route ? "" : "disabled"}></div><h3>${esc(hardwareTitle(a))}</h3><p>${esc(a.model || "")}${a.site ? ` · ${esc(a.site)}` : ""}</p><div class="row"><span>${r ? `${r.symbol} ${esc(r.label)}` : it.error ? "Couldn’t check" : "Checking…"}</span><b>${it.value === null ? "—" : money(it.value)}</b></div>${
    differs ? `<small class="cmd-note">ReCompute recommends ${esc(a.routeInfo.label.toLowerCase())}${it.move?.kind === "override" ? " · needs an override" : ""}</small>` : ""
  }${it.fallback ? `<small class="cmd-note">No compute route is eligible; keeps the model’s route</small>` : ""}${it.move?.kind === "blocked" ? `<small class="cmd-note warn">This asset can’t move to ${esc(eventInfo(it.move.event).label.toLowerCase())} from here</small>` : ""}</label>`;
}

function body(assetsResp) {
  const all = assetsResp.assets.map(adaptAssetRow);
  const open = all.filter((a) => a.state === "RECEIVED");
  const motion = all.filter((a) => a.inMotion).length;
  const done = all.filter((a) => a.terminal).length;
  const p = plan();
  const list = items(open, p.strategy);
  const pending = list.filter((x) => x.pending && !x.error).length;
  const sel = new Set(p.selected.filter((id) => open.some((a) => a.id === id)));
  const chosen = list.filter((x) => sel.has(x.a.id) && x.route);
  const total = chosen.reduce((s, x) => s + (x.value || 0), 0);
  const overrides = chosen.filter((x) => x.move?.kind === "override").length;
  const blocked = chosen.filter((x) => x.move?.kind === "blocked").length;
  const demo = isDemo();

  const lanes = LANES.map((lane) => {
    const inLane = list.filter((x) => x.route && lane.routes.includes(x.route)).sort((x, y) => (y.value || 0) - (x.value || 0));
    const shown = laneOpen[lane.key] ? inLane : inLane.slice(0, LANE_LIMIT);
    return `<section class="command-lane" aria-labelledby="lane-${lane.key}"><div class="lane-title"><h2 id="lane-${lane.key}">${lane.label}</h2><span>${pad2(inLane.length)}</span></div>${
      shown.map((x) => card(x, sel.has(x.a.id))).join("") || '<p class="lane-empty">No assets on this route.</p>'
    }${inLane.length > shown.length ? `<button class="textlink" data-action="lane-more" data-lane="${lane.key}">Show all ${inLane.length} ↓</button>` : ""}<div class="lane-select"><button class="textlink" data-action="lane-select" data-lane="${lane.key}">Select lane</button></div></section>`;
  }).join("");

  return (
    contextStrip([`${pad2(open.length)} awaiting a first move`, `${pad2(motion)} in motion`, `${pad2(done)} complete`]) +
    heading("Fleet Command", "Many assets.<br><em>One considered plan.</em>", "Choose your priority. Review each route. Then put the decisions in motion.") +
    `<div class="strategy-bar"><div><span class="micro">What matters most right now?</span><div class="strategy-options" role="group" aria-label="Strategy">${Object.entries(STRATEGIES)
      .map(([k, [label]]) => `<button data-action="strategy" data-strategy="${k}" aria-pressed="${p.strategy === k}">${label}</button>`)
      .join("")}</div><p class="strategy-help">${esc(STRATEGIES[p.strategy][1])}</p></div><div class="strategy-tools"><button class="textlink" data-action="select-all">${sel.size && sel.size === list.filter((x) => x.route).length ? "Deselect all" : "Select all"}</button>${sel.size ? `<button class="textlink" data-action="select-none">Clear selection</button>` : ""}</div></div>
    ${pending ? `<p class="async-inline" role="status"><span class="spinner" aria-hidden="true"></span> Checking which compute routes each asset is eligible for… ${list.length - pending} of ${list.length}</p>` : ""}
    ${
      open.length
        ? `<div class="command-workspace"><div class="command-board">${lanes}</div><aside class="plan-summary" aria-labelledby="plan-h"><span class="micro">Your proposed next chapter ${tag("draft")}</span><h2 id="plan-h">${chosen.length}<em> ${chosen.length === 1 ? "asset" : "assets"}.</em><br>One clear direction.</h2><div class="plan-value"><span>Combined modeled route value</span><strong>${money(total)}</strong><small>Sum of each asset’s modeled value on its own timeline. Not a same-date valuation or a quote.</small></div>${
            overrides ? `<p class="choice-note">${overrides} ${overrides === 1 ? "move goes" : "moves go"} against the model and will need an override note.</p>` : ""
          }${blocked ? `<p class="choice-note warn">${blocked} selected ${blocked === 1 ? "asset" : "assets"} can’t take this route’s first step and will be skipped.</p>` : ""}<p>Committing records each asset’s first step on your selected route. It does not list, sell, host or ship anything on its own.</p><button class="btn" data-action="review" ${chosen.length && !demo ? "" : "disabled"}>Review ${chosen.length} ${chosen.length === 1 ? "move" : "moves"} <span>↗</span></button>${
            demo ? `<small>Demo mode is read-only. Switch to Live to commit a plan.</small>` : `<small>Nothing is sent until you confirm.</small>`
          }</aside></div>`
        : emptyBlock("↗", "Every asset already has its first move.", "Fleet Command plans the first step for servers still in Received. Assets in motion are managed from their passports.", `<a class="textlink" href="#fleet">Meet your fleet ↗</a>`)
    }
    ${lastRun ? runReport(lastRun) : ""}
    <details class="model-details"><summary>How this plan works</summary><p>Each strategy uses the values already calculated for every route. Follow the recommendation keeps the suggested route. Free up capital uses the baseline route. Keep earning picks the higher-value rental route when the server qualifies. Only servers still waiting for a first move are included. The first step is a listing, a repair, a harvest or a recycle. Later steps happen on the passport as the work progresses.</p></details>`
  );
}

function runReport(run) {
  const ok = run.results.filter((r) => r.ok);
  const bad = run.results.filter((r) => !r.ok);
  return `<section class="panel-card run-report" aria-labelledby="run-h" tabindex="-1" id="run-report"><div class="panelhead"><h2 id="run-h">${run.running ? "Committing your plan…" : `${ok.length} of ${run.results.length} moves recorded.`}</h2><small>${run.running ? `${run.results.length} of ${run.total}` : "What came back"}</small></div><ul class="run-list">${run.results
    .map(
      (r) =>
        `<li class="${r.ok ? "ok" : "fail"}"><span aria-hidden="true">${r.ok ? "✓" : "✕"}</span><a href="#passport/${encodeURIComponent(r.id)}">${esc(r.id)}</a> <span>${esc(eventInfo(r.event).label)} · ${esc(routeInfo(r.route).label)}${r.override ? " · override" : ""}</span><small>${r.ok ? `Now ${esc(stateInfo(r.state).label.toLowerCase())}` : esc(r.message)}</small></li>`,
    )
    .join("")}</ul>${!run.running && bad.length ? `<p class="subtle">${bad.length} ${bad.length === 1 ? "move was" : "moves were"} not recorded. Rejected assets stay selected so you can review them.</p>` : ""}${run.running ? "" : `<button class="textlink" data-action="dismiss-run">Dismiss</button>`}</section>`;
}

function currentItems() {
  const rows = (R.assets().data?.assets || []).map(adaptAssetRow).filter((a) => a.state === "RECEIVED");
  return items(rows, plan().strategy);
}

function review() {
  const sel = new Set(plan().selected);
  const chosen = currentItems().filter((x) => sel.has(x.a.id) && x.route);
  const runnable = chosen.filter((x) => x.move.kind !== "blocked");
  const overrides = runnable.filter((x) => x.move.kind === "override");
  const skipped = chosen.length - runnable.length;
  openDialog({
    label: "Review your plan",
    wide: true,
    html: `<form id="commitForm" novalidate><div class="row"><h2>Review ${runnable.length} ${runnable.length === 1 ? "move" : "moves"}.</h2><button type="button" class="close" data-close aria-label="Close">×</button></div><p class="subtext">Strategy: <b>${esc(STRATEGIES[plan().strategy][0])}</b>. Moves are recorded one at a time, and each is checked against the asset’s current state and recommendation.</p><div class="tablewrap compact"><table><thead><tr><th scope="col">Asset</th><th scope="col">Route</th><th scope="col">First step</th><th scope="col" class="num">Modeled value</th></tr></thead><tbody>${chosen
      .map(
        (x) =>
          `<tr class="${x.move.kind === "blocked" ? "muted" : ""}"><th scope="row">${esc(x.a.id)}</th><td>${esc(routeInfo(x.route).label)}${x.route !== x.a.route ? ` <small>recommended: ${esc(x.a.routeInfo.label)}</small>` : ""}</td><td>${x.move.kind === "blocked" ? "Skipped · not allowed" : esc(eventInfo(x.move.event).label)}${x.move.kind === "override" ? ` <span class="prov-tag hypothesis">override</span>` : ""}</td><td class="num">${money(x.value)}</td></tr>`,
      )
      .join("")}</tbody></table></div>${skipped ? `<p class="choice-note warn">${skipped} ${skipped === 1 ? "asset is" : "assets are"} skipped: that route’s first step isn’t possible from where they are today.</p>` : ""}${
      overrides.length
        ? `<label for="commit-note" class="field-label">Why go against the model for ${overrides.length} ${overrides.length === 1 ? "asset" : "assets"}? <span class="req">required</span></label><textarea id="commit-note" rows="3" maxlength="2000" placeholder="e.g. treasury needs cash this quarter" aria-describedby="commit-error"></textarea>`
        : ""
    }<label class="check"><input type="checkbox" id="commit-ack"> I understand this records these moves in ReCompute. It does not list, sell or ship anything by itself.</label><p class="field-error" id="commit-error" role="alert"></p><div class="modalactions"><button type="button" class="btn secondary" data-close>Keep editing</button><button class="btn" type="submit" ${runnable.length ? "" : "disabled"}>Commit ${runnable.length} ${runnable.length === 1 ? "move" : "moves"}</button></div></form>`,
    bind(d, close) {
      d.querySelector("form").onsubmit = (ev) => {
        ev.preventDefault();
        const err = d.querySelector("#commit-error");
        const noteEl = d.querySelector("#commit-note");
        const note = noteEl?.value.trim() || null;
        if (overrides.length && !note) {
          err.textContent = "Add a note. It’s kept with every override.";
          noteEl.focus();
          return;
        }
        if (!d.querySelector("#commit-ack").checked) {
          err.textContent = "Confirm you understand what committing does.";
          d.querySelector("#commit-ack").focus();
          return;
        }
        close();
        commit(runnable, note);
      };
    },
  });
}

async function commit(list, note) {
  if (running) return;
  running = true;
  lastRun = { running: true, total: list.length, results: [] };
  rerender();
  for (const x of list) {
    const override = x.move.kind === "override";
    try {
      const out = await api.postEvent(x.a.id, { event: x.move.event, override, note: override ? note : undefined, selected_route: x.route });
      lastRun.results.push({ id: x.a.id, ok: true, event: x.move.event, route: x.route, override, state: out.asset?.state });
    } catch (e) {
      lastRun.results.push({ id: x.a.id, ok: false, event: x.move.event, route: x.route, override, message: e.message });
    }
    invalidateAsset(x.a.id);
    rerender();
  }
  invalidate("lite:*");
  const okIds = new Set(lastRun.results.filter((r) => r.ok).map((r) => r.id));
  store.update((ws) => (ws.plan.selected = ws.plan.selected.filter((id) => !okIds.has(id))));
  lastRun.running = false;
  running = false;
  toast(`${okIds.size} of ${list.length} moves recorded.`, { action: { label: "Track outcomes", run: () => (location.hash = "#outcomes") } });
  rerender();
  requestAnimationFrame(() => document.querySelector("#run-report")?.focus());
}

export default {
  title: "Fleet Command",
  render() {
    return withData([R.assets()], body, { retryKeys: ["assets"] });
  },
  actions: {
    strategy: (el) => {
      store.update((ws) => (ws.plan.strategy = el.dataset.strategy));
      rerender();
    },
    "select-all": () => {
      const ids = currentItems().filter((x) => x.route).map((x) => x.a.id);
      store.update((ws) => (ws.plan.selected = ws.plan.selected.length === ids.length ? [] : ids));
      rerender();
    },
    "select-none": () => {
      store.update((ws) => (ws.plan.selected = []));
      rerender();
    },
    "lane-select": (el) => {
      const lane = LANES.find((l) => l.key === el.dataset.lane);
      const ids = currentItems().filter((x) => x.route && lane.routes.includes(x.route)).map((x) => x.a.id);
      store.update((ws) => (ws.plan.selected = [...new Set([...ws.plan.selected, ...ids])]));
      rerender();
    },
    "lane-more": (el) => {
      laneOpen[el.dataset.lane] = true;
      rerender();
    },
    review: () => review(),
    "dismiss-run": () => {
      lastRun = null;
      rerender();
    },
  },
  onChange(e) {
    const id = e.target.dataset?.select;
    if (!id) return;
    store.update((ws) => {
      const s = new Set(ws.plan.selected);
      e.target.checked ? s.add(id) : s.delete(id);
      ws.plan.selected = [...s];
    });
    rerender();
  },
};
