import { rerender } from "../app.js";
import { api } from "../api/backend.js";
import { R, uploadCsv } from "../state/data.js";
import { store } from "../state/store.js";
import { peek } from "../state/resources.js";
import { adaptAssetRow, hardwareTitle } from "../lib/adapters.js";
import { compactMoney, money, pad2, pct, signedMoney } from "../lib/format.js";
import { esc } from "../lib/html.js";
import { STATE_ORDER, stateInfo } from "../lib/lifecycle.js";
import { ROUTE_ORDER, routeInfo } from "../lib/routes.js";
import { boardArt } from "../ui/art.js";
import { contextStrip, emptyBlock, errorBlock, fieldErrorsTable, heading, isDemo, loadingBlock, routeChip, stateChip, tag } from "../ui/components.js";
import { openDialog, toast } from "../ui/feedback.js";

const PAGE = { cards: 24, list: 50 };
const SORTS = {
  gain: [(a, b) => b.gain - a.gain || a.id.localeCompare(b.id), "Gain vs baseline"],
  value: [(a, b) => b.routeValue - a.routeValue || a.id.localeCompare(b.id), "Route value"],
  asset_id: [(a, b) => a.id.localeCompare(b.id), "Asset ID"],
  route: [(a, b) => ROUTE_ORDER.indexOf(a.route) - ROUTE_ORDER.indexOf(b.route) || a.id.localeCompare(b.id), "Route"],
  state: [(a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || a.id.localeCompare(b.id), "Lifecycle state"],
};

const f = () => store.ws.fleet;
const setF = (patch) => store.update((ws) => Object.assign(ws.fleet, patch));

/** Rows for the current filters. With a bear/bull scenario the batch endpoint's values replace route and value. */
export function fleetRows(assetRows, { query = "", route = "all", state = "all", batch = "all", sort = "gain" } = {}, overlay = null) {
  const q = query.trim().toLowerCase();
  let rows = assetRows.map(adaptAssetRow);
  if (batch !== "all") rows = rows.filter((a) => a.batchId === batch);
  if (overlay) {
    const byId = new Map(overlay.assets.map((r) => [r.asset_id, r]));
    rows = rows.map((a) => {
      const s = byId.get(a.id);
      if (!s) return a;
      return {
        ...a,
        base: { route: a.route, routeValue: a.routeValue, gain: a.gain },
        route: s.route,
        routeInfo: routeInfo(s.route),
        routeValue: s.route_value,
        baselineRoute: s.baseline_route,
        baselineValue: s.sell_now_value,
        gain: s.gain_vs_baseline,
        scenario: overlay.scenario,
      };
    });
  }
  if (q)
    rows = rows.filter((a) =>
      [a.id, a.model, a.site, a.batchId, a.grade, a.failedPart, a.route, a.selectedRoute].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  if (route !== "all") rows = rows.filter((a) => a.route === route);
  if (state !== "all") rows = rows.filter((a) => a.state === state);
  return rows.sort((SORTS[sort] || SORTS.gain)[0]);
}

function statusText(a) {
  if (a.terminal) return ["", "Chapter complete"];
  if (a.failed) return ["needs", "Failed diagnostics"];
  if (a.inMotion) return ["", a.stateInfo.label];
  return ["", "Ready for what’s next"];
}

function card(a) {
  const [dot, status] = statusText(a);
  const hw = a.hardware;
  return `<article class="asset-card ${a.routeInfo.tone}"><div class="asset-card-top"><span>${esc(a.id)}</span><span><i class="health-dot ${dot}"></i>${esc(status)}</span></div><a class="asset-visual" href="#passport/${encodeURIComponent(a.id)}" aria-label="Open passport for ${esc(a.id)}, ${esc(a.model || "server")}">${boardArt(a)}</a><div class="asset-card-copy"><small>${a.site ? esc(a.site) : "Location not recorded"} · ${esc(a.batchId || "no batch")}</small><h2>${esc(hardwareTitle(a))}<span>NVIDIA${hw?.count ? ` · ${hw.count} GPUs` : ""}</span></h2><p>${a.grade ? `Grade ${esc(a.grade)}` : "Grade not recorded"} <span>·</span> ${a.ageMonths !== null ? `${a.ageMonths} months in service` : "Age not recorded"}</p><div class="asset-card-stats"><div><span>Route value</span><strong>${compactMoney(a.routeValue)}</strong></div><div><span>vs baseline</span><strong class="${a.gain > 0 ? "gain" : ""}">${signedMoney(a.gain)}</strong></div></div><a class="asset-route" href="#passport/${encodeURIComponent(a.id)}"><span><span aria-hidden="true">${a.routeInfo.symbol}</span> &nbsp;${esc(a.routeInfo.label)}${a.scenario ? ` · ${esc(a.scenario)}` : ""}</span><span>${a.inMotion || a.terminal ? esc(a.stateInfo.label) + " · " : ""}Passport ↗</span></a></div></article>`;
}

function table(rows) {
  return `<div class="tablewrap"><table><caption class="sr-only">Fleet assets</caption><thead><tr><th scope="col">Asset / passport</th><th scope="col">State</th><th scope="col">Condition</th><th scope="col">Recommended route</th><th scope="col" class="num">Route value</th><th scope="col">Baseline</th><th scope="col" class="num">vs baseline</th><th scope="col">Selected</th></tr></thead><tbody>${rows
    .map(
      (a) =>
        `<tr><td><a class="assetname" href="#passport/${encodeURIComponent(a.id)}"><span class="gpuicon" aria-hidden="true">▥</span>${esc(a.model || "Server")}<small>${esc(a.id)} · ${esc(a.site || "location not recorded")}</small></a></td><td>${stateChip(a.state)}</td><td>${a.failed ? `<span class="cond failed">Failed${a.failedPart ? ` · ${esc(a.failedPart)}` : ""}</span>` : `<span class="cond">Passed${a.grade ? ` · ${esc(a.grade)}` : ""}</span>`}</td><td>${routeChip(a.route)}${a.scenario ? ` <small>${esc(a.scenario)}</small>` : ""}</td><td class="num">${money(a.routeValue)}</td><td>${esc(routeInfo(a.baselineRoute).label)} <small>${money(a.baselineValue)}</small></td><td class="num ${a.gain > 0 ? "gain" : ""}">${signedMoney(a.gain)}</td><td>${a.selectedRoute ? esc(routeInfo(a.selectedRoute).label) : `<span class="subtle">—</span>`}</td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}

function results(rows) {
  const { view, page } = f();
  const shown = rows.slice(0, PAGE[view] * page);
  if (!rows.length)
    return emptyBlock("◎", "No assets match.", "Try another model, ID or location, or clear the filters.", `<button class="textlink" data-action="clear-filters">Clear filters ↗</button>`);
  return `${view === "cards" ? `<div class="asset-gallery">${shown.map(card).join("")}</div>` : table(shown)}${
    shown.length < rows.length
      ? `<div class="load-more"><button class="btn secondary" data-action="more">Show ${Math.min(PAGE[view], rows.length - shown.length)} more</button><span class="subtle">${shown.length} of ${rows.length} shown</span></div>`
      : ""
  }`;
}

function batchSummary(batchId) {
  const sc = R.batchScenarios(batchId);
  if (sc.status === "error") return errorBlock(sc.error, { retryKeys: [`scenarios:${batchId}`], title: "Batch scenarios didn’t load." });
  if (!sc.data) return loadingBlock("Running bear, base and bull for this batch…");
  const s = sc.data.scenarios;
  const cols = ["bear", "base", "bull"];
  const cur = f().scenario;
  const csv = api.batchCsvUrl(batchId, cur);
  return `<section class="batch-summary" aria-labelledby="batch-title"><div class="panelhead"><h2 id="batch-title">Batch ${esc(batchId)}</h2><small>${s.base.count} SERVERS · MODEL v${esc(sc.data.model_version)}</small></div><div class="scenario-compare" role="table" aria-label="Batch totals by scenario"><div role="row" class="sc-head"><span role="columnheader"></span>${cols
    .map((c) => `<span role="columnheader" class="${c === cur ? "current" : ""}">${c[0].toUpperCase() + c.slice(1)}</span>`)
    .join("")}</div>${[
    ["Recommended value", (t) => compactMoney(t.recommended_value)],
    ["Baseline value", (t) => compactMoney(t.baseline_value)],
    ["Gain vs baseline", (t) => `${signedMoney(t.gain_vs_baseline)} <small>${pct(t.gain_pct, 1)}</small>`],
    ["Servers off baseline", (t) => `${t.changed_from_baseline} / ${t.count}`],
    ["Failed diagnostics", (t) => `${t.failed_count}`],
  ]
    .map(([label, fn]) => `<div role="row"><span role="rowheader">${label}</span>${cols.map((c) => `<span role="cell" class="${c === cur ? "current" : ""}">${fn(s[c])}</span>`).join("")}</div>`)
    .join("")}</div><p class="subtle">${esc(sc.data.note)} Totals assume every recommendation is followed.</p>${
    csv ? `<a class="textlink" href="${esc(csv)}" download>Download ${esc(cur)} results CSV from the API ↓</a>` : ""
  }</section>`;
}

function controls(batches) {
  const s = f();
  const batchOpts = batches.map((b) => `<option value="${esc(b.batch_id)}" ${s.batch === b.batch_id ? "selected" : ""}>${esc(b.batch_id)} · ${b.totals.count}</option>`).join("");
  const sel = (id, label, value, opts) =>
    `<label class="ctl"><span>${label}</span><select id="${id}" data-filter="${id.replace("f-", "")}">${opts}</select></label>`;
  return `<div class="fleet-controls"><div class="toolbar"><label class="ctl grow"><span>Search</span><input type="search" id="f-query" placeholder="Asset ID, model, site, batch, grade…" value="${esc(s.query)}" autocomplete="off"></label>${sel(
    "f-route",
    "Recommended route",
    s.route,
    `<option value="all">All routes</option>${ROUTE_ORDER.map((r) => `<option value="${r}" ${s.route === r ? "selected" : ""}>${routeInfo(r).label}</option>`).join("")}`,
  )}${sel(
    "f-state",
    "Lifecycle state",
    s.state,
    `<option value="all">All states</option>${STATE_ORDER.map((st) => `<option value="${st}" ${s.state === st ? "selected" : ""}>${stateInfo(st).label}</option>`).join("")}`,
  )}${sel("f-batch", "Batch", s.batch, `<option value="all">All batches</option>${batchOpts}`)}${sel(
    "f-scenario",
    "Market scenario",
    s.scenario,
    ["base", "bear", "bull"].map((c) => `<option value="${c}" ${s.scenario === c ? "selected" : ""} ${s.batch === "all" && c !== "base" ? "disabled" : ""}>${c[0].toUpperCase() + c.slice(1)}${s.batch === "all" && c !== "base" ? " (pick a batch)" : ""}</option>`).join(""),
  )}${sel("f-sort", "Sort", s.sort, Object.entries(SORTS).map(([k, [, l]]) => `<option value="${k}" ${s.sort === k ? "selected" : ""}>${l}</option>`).join(""))}</div><div class="view-switch" role="group" aria-label="Fleet view"><button data-action="view" data-view="cards" aria-pressed="${s.view === "cards"}">▦ Cards</button><button data-action="view" data-view="list" aria-pressed="${s.view === "list"}">☷ List</button></div></div>`;
}

function currentRows() {
  const assets = peek("assets");
  if (!assets) return null;
  const s = f();
  const overlay = s.batch !== "all" && s.scenario !== "base" ? R.batch(s.batch, s.scenario) : null;
  if (overlay && !overlay.data) return { rows: null, overlay };
  return { rows: fleetRows(assets.assets, s, overlay?.data), overlay };
}

function caption(rows, overlay) {
  return `<span>${pad2(rows.length)} ASSETS IN VIEW</span><span>${overlay ? `${esc(f().scenario.toUpperCase())} SCENARIO VALUES` : "MODEL ESTIMATES"} · USD</span>`;
}

function refreshResults() {
  const cur = currentRows();
  if (!cur?.rows) return rerender();
  document.querySelector("#fleet-results").innerHTML = results(cur.rows);
  document.querySelector("#fleet-caption").innerHTML = caption(cur.rows, cur.overlay);
}

function exportCsv() {
  const cur = currentRows();
  if (!cur?.rows) return;
  const cols = ["asset_id", "model", "site", "batch_id", "state", "grade", "failed", "route", "route_value", "baseline_route", "baseline_value", "gain_vs_baseline", "selected_route"];
  const q = (v) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = cur.rows.map((a) =>
    [a.id, a.model, a.site, a.batchId, a.state, a.grade, a.failed, a.route, a.routeValue?.toFixed(2), a.baselineRoute, a.baselineValue?.toFixed(2), a.gain?.toFixed(2), a.selectedRoute].map(q).join(","),
  );
  download(`recompute-fleet-${f().scenario}.csv`, [cols.join(","), ...lines].join("\n"));
  toast(`Exported ${cur.rows.length} rows${isDemo() ? " from the demo snapshot" : " from the API"}.`);
}

function download(name, text) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/* ---------------------------------------------------------------- upload */

function uploadResultHtml(res) {
  const t = res.totals;
  return `<div class="upload-result" role="status"><span class="micro">${res.dry_run ? "DRY RUN · NOTHING SAVED" : `SAVED AS BATCH ${esc(res.batch_id)}`}</span><h3>${res.dry_run ? `${res.would_add} servers would be added` : `${res.added} servers added`}${res.skipped.length ? `, ${res.skipped.length} skipped (already exist)` : ""}.</h3><div class="mini-totals"><div><span>Recommended value</span><b>${money(t.recommended_value)}</b></div><div><span>Baseline</span><b>${money(t.baseline_value)}</b></div><div><span>Gain vs baseline</span><b class="gain">${signedMoney(t.gain_vs_baseline)}</b></div></div><p class="subtle">Routes: ${Object.entries(res.routes)
    .map(([r, n]) => `${esc(routeInfo(r).label)} ${n}`)
    .join(" · ") || "none"}${res.ignored_columns.length ? `. Ignored result columns: ${res.ignored_columns.map(esc).join(", ")}` : ""}.</p>${
    res.assets.length
      ? `<div class="tablewrap compact"><table><thead><tr><th>Row</th><th>Asset</th><th>Route</th><th class="num">Value</th><th class="num">vs baseline</th><th>Warnings</th></tr></thead><tbody>${res.assets
          .slice(0, 12)
          .map((a) => `<tr><td>${a.row}</td><td>${esc(a.asset_id)}</td><td>${esc(routeInfo(a.route).label)}</td><td class="num">${money(a.route_value)}</td><td class="num">${signedMoney(a.gain_vs_baseline)}</td><td>${(a.warnings || []).map((w) => esc(w.code)).join(", ")}</td></tr>`)
          .join("")}</tbody></table>${res.assets.length > 12 ? `<p class="subtle">…and ${res.assets.length - 12} more.</p>` : ""}</div>`
      : ""
  }</div>`;
}

async function openUpload() {
  const demo = isDemo();
  const templateUrl = api.templateUrl();
  openDialog({
    label: "Upload inventory CSV",
    wide: true,
    html: `<form class="upload-form" data-upload novalidate><div class="row"><h2>Bring in a batch.</h2><button type="button" class="close" data-close aria-label="Close">×</button></div><p class="subtext">One server per row. <code>asset_id</code> is the only required column; any of the 43 model inputs can be columns. The API checks everything and saves nothing if a single row has a problem.</p>${
      demo ? `<p class="mode-inline demo">Demo mode is read-only. Switch to Live mode to upload. You can still download the template.</p>` : ""
    }<p>${templateUrl ? `<a class="textlink" href="${esc(templateUrl)}" download>Download the CSV template from the API ↓</a>` : `<button type="button" class="textlink" id="demo-template">Download the CSV template ↓</button>`}</p><label class="field-label" for="upload-file">CSV file (UTF-8, up to 5 MB and 5,000 rows)</label><input id="upload-file" type="file" accept=".csv,text/csv" ${demo ? "disabled" : ""} required aria-describedby="upload-help"><p class="subtle" id="upload-help">Check the file first: a dry run shows every server’s route without saving.</p><label class="check-row"><input type="checkbox" id="upload-skip" ${demo ? "disabled" : ""}> Skip asset IDs that already exist</label><div id="upload-output" aria-live="polite"></div><div class="modalactions"><button type="button" class="btn secondary" data-close>Close</button><button type="submit" class="btn secondary" id="upload-dry" ${demo ? "disabled" : ""}>Check file</button><button type="button" class="btn" id="upload-commit" ${demo ? "disabled" : ""} disabled>Upload as a new batch</button></div></form>`,
    bind(d, close) {
      const out = d.querySelector("#upload-output");
      const fileEl = d.querySelector("#upload-file");
      const commit = d.querySelector("#upload-commit");
      d.querySelector("#demo-template")?.addEventListener("click", async () => {
        download("recompute_upload_template.csv", await api.template());
      });
      fileEl.addEventListener("change", () => {
        commit.disabled = true;
        out.innerHTML = "";
      });
      const run = async (dryRun) => {
        const file = fileEl.files?.[0];
        if (!file) {
          out.innerHTML = `<p class="field-error" role="alert">Choose a CSV file first.</p>`;
          fileEl.focus();
          return;
        }
        out.innerHTML = loadingBlock(dryRun ? "Checking every row with the model…" : "Uploading and running the model…");
        try {
          const res = await uploadCsv(file, { dryRun, skipExisting: d.querySelector("#upload-skip").checked });
          out.innerHTML = uploadResultHtml(res);
          commit.disabled = !dryRun || !res.would_add;
          if (!dryRun) {
            setF({ batch: res.batch_id || "all", scenario: "base", page: 1, query: "", route: "all", state: "all" });
            toast(`Batch ${res.batch_id || ""} saved: ${res.added} servers.`);
            close();
            rerender();
          }
        } catch (e) {
          commit.disabled = true;
          out.innerHTML = `${errorBlock(e, { title: dryRun ? "The file has problems. Nothing was saved." : "Upload failed. Nothing was saved." })}${fieldErrorsTable(e.fieldErrors)}${
            e.detail?.unknown_columns ? `<p class="subtle">Unknown columns: ${e.detail.unknown_columns.map(esc).join(", ")}</p>` : ""
          }`;
        }
      };
      d.querySelector("form").onsubmit = (e) => {
        e.preventDefault();
        run(true);
      };
      commit.onclick = () => run(false);
    },
  });
}

/* ---------------------------------------------------------------- view */

export default {
  title: "Fleet",
  render() {
    const assets = R.assets();
    const batches = R.batches();
    const err = (assets.status === "error" && !assets.data && assets) || (batches.status === "error" && !batches.data && batches);
    const head = heading(
      "Fleet",
      "Every asset has<br><em>a story worth knowing.</em>",
      "Open a passport to understand the server—and its next best chapter.",
      `<div class="head-actions"><button class="btn secondary" data-action="upload">Upload CSV ↑</button><button class="btn secondary" data-action="export">Export view ↓</button></div>`,
    );
    if (err) return head + errorBlock(err.error, { retryKeys: ["assets", "batches"] });
    if (!assets.data || !batches.data) return head + loadingBlock();
    const s = f();
    if (s.batch !== "all" && batches.status === "ready" && !batches.stale && !batches.data.batches.some((b) => b.batch_id === s.batch)) setF({ batch: "all", scenario: "base" });
    const cur = currentRows();
    const overlayErr = cur.overlay?.status === "error" && !cur.overlay.data;
    return (
      contextStrip([`${pad2(assets.data.count)} assets`, `${pad2(batches.data.batches.length)} batches`]) +
      head +
      controls(batches.data.batches) +
      (s.batch !== "all" ? batchSummary(s.batch) : "") +
      (cur.overlay
        ? `<div class="scenario-banner" role="note">${tag(isDemo() ? "demo" : "live", `${s.scenario.toUpperCase()} SCENARIO`)} Routes and values recomputed by the model for each server’s latest inputs under Saksham’s ${esc(s.scenario)} market. Lifecycle actions still follow each asset’s stored (base) recommendation.</div>`
        : "") +
      (overlayErr
        ? errorBlock(cur.overlay.error, { retryKeys: [`batch:${s.batch}:${s.scenario}`] })
        : !cur.rows
          ? loadingBlock(`Running the ${s.scenario} scenario…`)
          : `<div class="collection-caption" id="fleet-caption">${caption(cur.rows, cur.overlay)}</div><div id="fleet-results">${results(cur.rows)}</div>`) +
      `<div class="collection-note"><span>↗</span><p>A passport travels with the asset.<br><small>Condition, economics, decision and history—all in one place.</small></p><a href="#command" class="textlink">Think across the whole fleet ↗</a></div>`
    );
  },
  after(root, route, { routeChanged }) {
    if (routeChanged && Object.keys(route.query).length) {
      const q = route.query;
      setF({
        ...(q.state ? { state: q.state } : {}),
        ...(q.route ? { route: q.route } : {}),
        ...(q.batch ? { batch: q.batch } : {}),
        page: 1,
      });
      history.replaceState(null, "", "#fleet");
      rerender();
    }
  },
  actions: {
    view: (el) => {
      setF({ view: el.dataset.view, page: 1 });
      rerender();
    },
    more: () => {
      setF({ page: f().page + 1 });
      refreshResults();
    },
    "clear-filters": () => {
      setF({ query: "", route: "all", state: "all", page: 1 });
      rerender();
    },
    export: exportCsv,
    upload: openUpload,
  },
  onInput(e) {
    if (e.target.id !== "f-query") return;
    setF({ query: e.target.value, page: 1 });
    refreshResults();
  },
  onChange(e) {
    const key = e.target.dataset.filter;
    if (!key) return;
    const patch = { [key]: e.target.value, page: 1 };
    if (key === "batch" && e.target.value === "all") patch.scenario = "base";
    setF(patch);
    rerender();
  },
};