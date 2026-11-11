/**
 * What-if Demo: the finals walkthrough, built from the studio's own Lab and passport pieces.
 * Every figure is a recorded v0.9 model answer from the Demo-mode snapshot, so nothing waits on the API.
 *
 *   One input (Shauryaa): SYN-003 at the dated rental index ($1.57), then the stage what-if ($0.80).
 *   Healthy or failed (Saksham): SYN-003, Grade A and healthy on the inventory, next to SYN-039,
 *   the same A100 80 GB model at Grade C with a failed GPU, where the repair bill meets the value after repair.
 */
import { rerender } from "../app.js";
import { loadSnapshot } from "../api/demo.js";
import { resource } from "../state/resources.js";
import { adaptAssetDetail } from "../lib/adapters.js";
import { money } from "../lib/format.js";
import { esc } from "../lib/html.js";
import { routeInfo } from "../lib/routes.js";
import { contextStrip, errorBlock, heading, loadingBlock, tag } from "../ui/components.js";
import { comparison, verdict } from "./lab.js";
import { condition } from "./passport.js";

export const HEALTHY = "SYN-003";
export const FAILED = "SYN-039";
export const RATES = { index: 1.57, stage: 0.8 };

let rateKey = "index";

const detailOf = (snap, id) =>
  adaptAssetDetail(snap.responses[`GET /assets/${id}`], { meta: snap.responses["GET /meta"], history: snap.responses[`GET /assets/${id}/history`] });

/** SYN-003's recorded answer at one of the two stage rental prices. */
export function caseFor(snap, key) {
  const lab = snap.lab[HEALTHY];
  const hit = lab.grids.rental_rate?.[String(RATES[key])];
  if (!hit) return null;
  return { result: hit.result, warnings: hit.warnings, inputs: { ...lab.inputs, rental_rate: RATES[key] } };
}

function card(a, out, sub) {
  const res = out.result;
  const value = res.base[res.route];
  const inPlay = res.eligible.map((r) => routeInfo(r).label).join(", ");
  const after = res.after_repair_route;
  const x = a.resolved;
  // A failed server: the repair bill next to what the server is worth once repaired.
  const repair = after
    ? `<div class="dstate"><span class="micro">Repair bill</span><b>${money((x.repair_parts_cost || 0) + (x.repair_labor_cost || 0) + (x.repair_test_cost || 0))}</b><small>${esc(a.failedPart || "Part")}, labour and retest</small></div><div class="dstate"><span class="micro">Value after repair</span><b>${money(res.base[after])}</b><small>If it passes (${Math.round((x.repair_success ?? 0) * 100)}%): ${esc(routeInfo(after).label.toLowerCase())}</small></div>`
    : "";
  return `<article class="whatif-asset"><div class="panelhead"><h2>${esc(a.id)} · Grade ${esc(a.grade || "—")}</h2><small>${esc(sub)}</small></div><p class="lab-asset-note">${esc(a.model || "")} · ${a.ageMonths !== null ? `${a.ageMonths} months` : ""} · ${esc(a.site || "")}</p><div class="decision-states"><div class="dstate rec"><span class="micro">Recommended</span><b>${esc(routeInfo(res.route).label)}</b><small>${money(value)}</small></div><div class="dstate"><span class="micro">Routes in play</span><b>${res.eligible.length} of 7</b><small>${esc(inPlay)}</small></div>${repair}</div>${condition(a)}</article>`;
}

function page() {
  const entry = resource("snapshot", () => loadSnapshot());
  const snap = entry.data;
  const head = heading("What-if Demo", "One server. One input.<br><em>A different call.</em>", "Two recorded cases from the sample fleet: what moves a recommendation, and what changes when a server fails.");
  if (!snap) return head + (entry.error ? errorBlock(entry.error, { retryKeys: ["snapshot"] }) : loadingBlock("Loading the demo cases…"));
  const out = caseFor(snap, rateKey);
  if (!out) return head + errorBlock(new Error("The SYN-003 rental case is missing from the demo snapshot."));

  const a = detailOf(snap, HEALTHY);
  const failed = detailOf(snap, FAILED);
  const failedOut = { result: failed.recommendation.result, inputs: failed.effectiveInputs };
  const stored = a.recommendation ? { route: a.route, id: a.recommendation.id } : null;
  const r = out.inputs;

  return (
    contextStrip([HEALTHY, FAILED, `Recorded from model v${esc(snap.model_version)}`]) +
    head +
    `<section class="whatif-act" aria-labelledby="whatif-one"><div class="panelhead"><h2 id="whatif-one">01 · One input</h2><small>${esc(HEALTHY)} · ${tag("demo")}</small></div>
    <div class="lab-presets" role="group" aria-label="Rental price for ${esc(HEALTHY)}"><span class="micro">Rental price per GPU-hour</span><button data-action="whatif-rate" data-rate="index" aria-pressed="${rateKey === "index"}">$1.57 · dated index</button><button data-action="whatif-rate" data-rate="stage" aria-pressed="${rateKey === "stage"}">$0.80 · what-if</button></div>
    <p class="preset-help">${rateKey === "index" ? "Silicon Data A100 rental index, Sep 29, 2026. A dated index, not the owner’s payout." : "The stage hypothetical: not the index and not a host payout. Every other input stays the same."}</p>
    <div class="labgrid studio-lab"><section class="lab-controls"><span class="micro">The inputs</span><p class="lab-asset-note">${esc(a.model || "")} · Grade ${esc(a.grade)} · ${esc(a.site || "")}</p><div class="passport-facts compact whatif-inputs"><div><span>Rental price</span><b>$${r.rental_rate.toFixed(2)} /GPU-hr</b></div><div><span>Offer today (gross)</span><b>${money(r.offer_today)}</b></div><div><span>Listing price</span><b>${money(r.market_price)}</b></div><div><span>Days until a buyer</span><b>${r.dwell_days} days</b></div><div><span>Utilization</span><b>${Math.round(r.utilization * 100)}% steady · ${Math.round(r.first_month_utilization * 100)}% month one</b></div><div><span>Hosting horizon</span><b>${a.resolved.horizon_months ?? 12} months, then resale</b></div></div><p class="subtle">Sell now is net of the assumed fee and shipping. Hosting is net of power, space, fees and maintenance, including the resale at the end.</p></section>
    <section class="lab-output">${verdict(a, out, stored)}${comparison(a, out)}<details class="model-details"><summary>Why the model chose this</summary><ol class="audit">${out.result.audit.map((l) => `<li>${esc(l)}</li>`).join("")}</ol></details></section></div></section>
    <section class="whatif-act" aria-labelledby="whatif-two"><div class="panelhead"><h2 id="whatif-two">02 · Healthy or failed</h2><small>Same A100 80 GB model, two conditions</small></div>
    <p class="preset-help">A healthy server is compared across sale and compute routes. Repair only enters when a server has failed: then the repair bill sits next to the value after the repair, and harvest or recycle are the fallback.</p>
    <div class="whatif-pair">${card(a, out, "Healthy on the inventory")}${card(failed, failedOut, `Failed ${failed.failedPart || "part"} on the inventory`)}</div></section>`
  );
}

export default {
  title: "What-if Demo",
  demoOnly: true,
  render(route) {
    if (route.query.rate === "0.80") rateKey = "stage";
    return page();
  },
  leave() {
    rateKey = "index";
  },
  actions: {
    "whatif-rate": (el) => {
      el.blur();
      rateKey = el.dataset.rate === "stage" ? "stage" : "index";
      rerender();
    },
  },
};
