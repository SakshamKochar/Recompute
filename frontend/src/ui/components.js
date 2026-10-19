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
  return `<div class="studio-context${demo ? "" : " live"}"><span><i class="${demo ? "demo" : ""}"></i> ${demo ? "Sample fleet" : "Your fleet"}</span>${parts
    .filter(Boolean)
    .map((p) => `<span>${p}</span>`)
    .join("")}${demo ? `<span>For exploring. Nothing here is bought or sold</span>` : ""}</div>`;
}

export function loadingBlock(label = "Getting the latest figures…") {
  return `<div class="async-state loading" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><p>${esc(label)}</p></div>`;
}

export function errorBlock(error, { retryKeys = [], title = "This didn’t load." } = {}) {
  const kind = error?.kind;
  const hint =
    kind === "network"
      ? "We couldn’t connect just now. Check your connection, then try again."
      : kind === "timeout"
        ? "This is taking longer than usual. Give it a moment and try again."
        : kind === "demo-unsupported"
          ? "This part works with your live fleet. Switch to Live data to use it."
          : error?.status === 404
            ? "We couldn’t find a record with that ID."
            : "Something went wrong on our side. Try again in a moment.";
  return `<div class="async-state error" role="alert"><h3>${esc(title)}</h3><p>${esc(hint)}</p>${error?.message && kind === "http" && error.status < 500 ? `<p class="subtle">${esc(error.message)}</p>` : ""}${
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
  live: ["Live estimate", "Worked out just now from this asset’s latest details"],
  stored: ["Stored recommendation", "The latest recommendation saved on this asset"],
  historical: ["Earlier estimate", "Recorded earlier; details may have changed since"],
  demo: ["Sample", "Illustrative figures for exploring"],
  simulated: ["Simulated diagnostics", "Graded from simulated NVIDIA files"],
  synthetic: ["Sample server", "Part of the sample fleet"],
  hypothesis: ["Working assumption", "Not yet backed by a published source"],
  draft: ["Draft", "Saved only on this device"],
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
