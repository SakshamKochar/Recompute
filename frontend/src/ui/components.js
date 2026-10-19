import { esc } from "../lib/html.js";
import { routeInfo } from "../lib/routes.js";
import { stateInfo } from "../lib/lifecycle.js";
import { getTransport } from "../api/backend.js";

export const isDemo = () => getTransport()?.mode === "demo";

export function sceneLabel(n, label) {
  return `<div class="scene-label"><span>${esc(n)}</span>${esc(label)}</div>`;
}

export function heading(section, title, sub, action = "") {
  return `<div class="pagehead"><div>${sceneLabel("RE:", section)}<h1>${title}</h1><p>${sub}</p></div>${action}</div>`;
}

/** The context strip under the header: what data this screen is showing and where it came from. */
export function contextStrip(parts) {
  const demo = isDemo();
  return `<div class="studio-context"><span><i class="${demo ? "demo" : ""}"></i> ${demo ? "DEMO SNAPSHOT" : "LIVE FLEET"}</span>${parts
    .filter(Boolean)
    .map((p) => `<span>${p}</span>`)
    .join("")}<span>${demo ? "Illustrative · recorded model output · nothing executes" : "Backend model results · ReCompute API"}</span></div>`;
}

export function loadingBlock(label = "Loading from the ReCompute API…") {
  return `<div class="async-state loading" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><p>${esc(label)}</p></div>`;
}

export function errorBlock(error, { retryKeys = [], title = "This didn’t load." } = {}) {
  const kind = error?.kind;
  const hint =
    kind === "network"
      ? "The browser couldn’t reach the API. Check that the backend is running, then retry."
      : kind === "timeout"
        ? "The API took too long to answer. It may be starting up."
        : kind === "demo-unsupported"
          ? "This part of the product needs Live mode."
          : error?.status === 404
            ? "The backend has no record with that ID."
            : "The backend returned an error.";
  return `<div class="async-state error" role="alert"><span class="micro">${esc(kind === "http" ? `HTTP ${error.status}` : (kind || "error").toUpperCase())}</span><h3>${esc(title)}</h3><p>${esc(error?.message || "Unknown error")}</p><p class="subtle">${esc(hint)}</p>${
    retryKeys.length && kind !== "demo-unsupported" && error?.status !== 404
      ? `<button class="btn secondary" data-action="retry" data-keys="${esc(retryKeys.join(","))}">Retry</button>`
      : ""
  }</div>`;
}

export function emptyBlock(symbol, title, body, cta = "") {
  return `<div class="ledger-empty"><span aria-hidden="true">${esc(symbol)}</span><h3>${esc(title)}</h3><p>${body}</p>${cta}</div>`;
}

export function routeChip(route, { prefix = "" } = {}) {
  if (!route) return `<span class="route-chip none">Not assessed</span>`;
  const r = routeInfo(route);
  return `<span class="route-chip ${r.tone}">${prefix}<span aria-hidden="true">${r.symbol}</span> ${esc(r.label)}</span>`;
}

export function stateChip(state) {
  const s = stateInfo(state);
  return `<span class="state-chip ${s.phase}">${esc(s.label)}</span>`;
}

const TAGS = {
  live: ["Live model", "Computed by the ReCompute API just now"],
  stored: ["Stored recommendation", "The latest recommendation saved on this asset"],
  historical: ["Historical", "Recorded earlier; inputs or model may have changed"],
  demo: ["Demo snapshot", "Recorded from the real model; illustrative data"],
  simulated: ["Simulated diagnostics", "Graded from simulated NVIDIA files"],
  synthetic: ["Synthetic server", "From Saksham’s synthetic test fleet"],
  hypothesis: ["Team hypothesis", "Not yet sourced"],
  draft: ["Draft · this browser", "Saved only on this device; nothing was executed"],
};

export function tag(kind, text) {
  const [label, title] = TAGS[kind] || [kind, ""];
  return `<span class="prov-tag ${esc(kind)}" title="${esc(title)}">${esc(text || label)}</span>`;
}

/** Render a set of resources: error > loading > content. */
export function withData(entries, render, { retryKeys = [], loadingLabel } = {}) {
  const failed = entries.find((e) => e.status === "error" && e.data === undefined);
  if (failed) return errorBlock(failed.error, { retryKeys });
  if (entries.some((e) => e.data === undefined)) return loadingBlock(loadingLabel);
  return render(...entries.map((e) => e.data));
}

export function journey() {
  return `<div class="journey-strip">${[
    ["fleet", "01", "Understand your assets", "Open a passport"],
    ["lab", "02", "Explore the possibilities", "Ask the model what-if"],
    ["command", "03", "Make your move", "Review and commit a plan"],
    ["outcomes", "04", "See what happened", "Track the outcome"],
  ]
    .map((x) => `<a href="#${x[0]}"><span>${x[1]}</span><div><b>${x[2]}</b><small>${x[3]} ↗</small></div></a>`)
    .join("")}</div>`;
}

export function fieldErrorsTable(errors) {
  if (!errors?.length) return "";
  const hasRow = errors.some((e) => e.row !== undefined);
  return `<div class="tablewrap error-table"><table><thead><tr>${hasRow ? "<th>Row</th>" : ""}<th>Field</th><th>Value</th><th>Problem</th></tr></thead><tbody>${errors
    .slice(0, 50)
    .map(
      (e) =>
        `<tr>${hasRow ? `<td>${esc(e.row)}</td>` : ""}<td>${esc(e.field || "—")}</td><td>${esc(e.input ?? "")}</td><td>${esc(e.message)}</td></tr>`,
    )
    .join("")}</tbody></table>${errors.length > 50 ? `<p class="subtle">…and ${errors.length - 50} more.</p>` : ""}</div>`;
}
