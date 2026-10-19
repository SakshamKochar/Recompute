import { rerender } from "../app.js";
import { R, executeEvent, invalidateAsset, patchInputs, recordOutcome } from "../state/data.js";
import { store } from "../state/store.js";
import { adaptAssetDetail, adaptHistory, decisionStates, hardwareTitle, profileLabel } from "../lib/adapters.js";
import { dateTime, money, num, pct, signedMoney } from "../lib/format.js";
import { esc } from "../lib/html.js";
import { formatInput, INPUT_SPECS, validateInput } from "../lib/inputs.js";
import { eventInfo, stateInfo } from "../lib/lifecycle.js";
import { routeInfo } from "../lib/routes.js";
import { boardArt } from "../ui/art.js";
import { errorBlock, fieldErrorsTable, isDemo, loadingBlock, routeChip, stateChip, tag } from "../ui/components.js";
import { confirmDialog, openDialog, toast } from "../ui/feedback.js";

const lastError = new Map();

const SOURCE_LABEL = { recorded: "on record", backend: "estimated", default: "profile default" };
const srcTag = (src) => `<span class="src-tag ${src}">${SOURCE_LABEL[src] || src}</span>`;

const EDITABLE = ["offer_today", "market_price", "dwell_days", "utilization", "rental_rate", "elec_per_kwh"];

function headline(a) {
  if (a.terminal) return ["Chapter complete.", `${a.stateInfo.label}.`];
  if (a.inMotion) return ["In motion.", `${a.stateInfo.long}.`];
  if (a.failed) return ["A little attention.", "A different future."];
  return ["Good condition.", "Open possibilities."];
}

function cover(a) {
  return `<section class="passport-cover"><div class="row"><a class="studio-wordmark" href="#home">ReCompute®</a><span class="micro">Asset / ${esc(a.id)}</span></div><div class="passport-object">${boardArt(a, true)}</div><span class="micro">The asset passport</span><h2>${esc(hardwareTitle(a))}</h2><p>${esc(a.model || "Model not recorded")} · ${esc(profileLabel(a.profile))}</p><div class="cover-tags">${a.synthetic ? tag("synthetic", a.diagnostics.simulated ? "Sample seller" : "Sample server") : ""}${a.diagnostics.simulated ? tag("simulated") : ""}${isDemo() ? tag("demo") : ""}</div><div class="passport-cover-bottom"><span>${a.site ? esc(a.site) : "Location not recorded"}</span><span>${a.ageMonths !== null ? `${a.ageMonths} months in service` : "Age not recorded"}</span></div></section>`;
}

function states(a, ds) {
  const cell = (label, main, sub, tone = "") =>
    `<div class="dstate ${tone}"><span class="micro">${label}</span><b>${main}</b><small>${sub}</small></div>`;
  return `<div class="decision-states" aria-label="Decision status">${cell(
    "Recommended",
    ds.recommended ? esc(routeInfo(ds.recommended.route).label) : "None",
    ds.recommended ? money(ds.recommended.value) : "No model run",
    "rec",
  )}${cell(
    "Selected",
    ds.selected ? esc(routeInfo(ds.selected.route).label) : "Not selected",
    ds.selected ? (ds.selected.recorded ? "Recorded with a lifecycle move" : "Draft on this device · not recorded") : "No route chosen yet",
    ds.selected && ds.selected.route !== ds.recommended?.route ? "differs" : "",
  )}${cell(
    "Executed",
    ds.executed ? esc(eventInfo(ds.executed.event).verb) : "Nothing yet",
    ds.executed ? `${esc(stateInfo(ds.executed.state).label)} · ${dateTime(ds.executed.at)}${ds.executed.override ? " · override" : ""}` : "Still in RECEIVED",
  )}${cell(
    "Completed",
    ds.completed ? esc(stateInfo(ds.completed.state).label) : "Not yet",
    ds.completed ? dateTime(ds.completed.at) : "No final state",
    ds.completed ? "done" : "",
  )}</div>`;
}

function identity(a) {
  const r = a.resolved;
  const s = a.inputSource;
  const fact = (label, value, src) => `<div><span>${label}</span><b>${value}${src ? ` ${srcTag(src)}` : ""}</b></div>`;
  return `<section class="pp-section" id="pp-identity" aria-labelledby="pp-identity-h"><h3 class="pp-h" id="pp-identity-h"><span class="micro">01 / Identity</span>What this asset is</h3><div class="passport-facts">${[
    fact("Asset ID", esc(a.id)),
    fact("Hardware on record", esc(a.model || "Not recorded")),
    fact("Model profile", esc(profileLabel(a.profile))),
    fact("GPUs", esc(r.gpus), s.gpus),
    fact("Server power draw", `${esc(r.server_kw)} kW`, s.server_kw),
    fact("Ownership", esc(r.ownership), s.ownership),
    fact("Site", a.site ? esc(a.site) : "Not recorded"),
    fact("Age", a.ageMonths !== null ? `${a.ageMonths} months` : "Not recorded"),
    fact("Grade on record", a.grade ? esc(a.grade) : "Not recorded"),
    fact("Batch", esc(a.batchId || "None")),
    fact("Lifecycle state", stateChip(a.state)),
    fact("Last updated", dateTime(a.updatedAt)),
  ].join("")}</div><p class="pp-note">Hardware facts describe the whole server record. GPU count and power come from the asset’s inputs or, where marked, the model profile’s defaults; they are not measured.</p></section>`;
}

function condition(a) {
  const d = a.diagnostics;
  const r = a.resolved;
  let body;
  if (d.assessed) {
    const sev = (s) => `<span class="sev ${esc(s.toLowerCase())}">${esc(s)}</span>`;
    body = `<div class="passport-health"><strong>${esc(d.score)}<small>/100</small></strong><div><b>Grade ${esc(d.grade)}${d.pricedAtGrade && d.pricedAtGrade !== d.grade ? ` · priced at ${esc(d.pricedAtGrade)} after repair` : ""}</b><p>${d.simulated ? "Graded from simulated NVIDIA files" : "Graded from an NVIDIA capture"} · evidence confidence ${esc(d.evidenceConfidence)} · DCGM run level ${esc(d.runLevel)}</p></div><div class="health-meter" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, d.score))}%"></i></div></div>
    <div class="passport-facts compact"><div><span>Working GPUs</span><b>${esc(d.workingGpus)}${d.totalGpus ? ` of ${d.totalGpus}` : ""}</b></div><div><span>Failed GPUs</span><b>${d.failedGpus.length ? d.failedGpus.map((g) => `GPU ${esc(g.gpu ?? g)}`).join(", ") : "None"}</b></div><div><span>Chassis faults</span><b>${d.chassisFaults.length ? d.chassisFaults.map((c) => esc(c.part)).join(", ") : "None"}</b></div><div><span>Tests not run</span><b>${d.testsMissing.length ? d.testsMissing.map(esc).join(", ") : "None"}</b></div></div>
    <h4 class="pp-sub">Findings</h4><ul class="findings">${d.findings.map((f) => `<li>${sev(f.severity)}<p>${esc(f.text)}</p></li>`).join("")}</ul>
    ${d.chassisFaults.length ? `<ul class="findings">${d.chassisFaults.map((c) => `<li>${sev("CRITICAL")}<p>${esc(c.part)}${c.slot !== undefined ? ` (slot ${esc(c.slot)})` : ""}: ${esc(c.detail)}</p></li>`).join("")}</ul>` : ""}
    ${d.deductions.length ? `<details class="model-details"><summary>How the score was reached (${d.deductions.length} deductions)</summary><ul class="plain">${d.deductions.map((x) => `<li>−${esc(x.points)} · ${esc(x.category)}: ${esc(x.name)}${x.count > 1 ? ` ×${esc(x.count)}` : ""}${x.evidence ? ` (${esc(x.evidence)})` : ""}</li>`).join("")}</ul>${d.caps.length ? `<p>Grade caps: ${d.caps.map((c) => `${esc(c.max_grade)}: ${esc(c.reason)}${c.binding ? " (binding)" : ""}`).join("; ")}</p>` : ""}<p>Sources: ${d.sources.map(esc).join(" · ") || "not recorded"}. Grade price factors are a team hypothesis until resale data arrives.</p></details>` : ""}`;
  } else {
    body = `<div class="not-assessed"><span class="micro">Not yet assessed</span><p>No NVIDIA diagnostic capture is on file for this asset, so there is no score, findings or evidence confidence. The health flag below comes from the inventory record, not from test output.</p></div><div class="passport-facts compact"><div><span>Passed diagnostics</span><b>${r.health_pass ? "Yes" : "No"} ${srcTag(a.inputSource.health_pass)}</b></div><div><span>Failed part</span><b>${esc(a.failedPart || (r.health_pass ? "None" : "Not recorded"))}</b></div><div><span>Repairable</span><b>${r.health_pass ? "Not applicable" : r.repairable ? "Yes" : "No"}${r.health_pass ? "" : ` ${srcTag(a.inputSource.repairable)}`}</b></div><div><span>Grade on record</span><b>${esc(a.grade || "Not recorded")}</b></div></div>`;
  }
  const failed = r.health_pass === false;
  const rp = a.repairPricing;
  const repairCost = (r.repair_parts_cost || 0) + (r.repair_labor_cost || 0) + (r.repair_test_cost || 0);
  const repairRow = a.routes.find((x) => x.route === "REPAIR");
  const repair = failed
    ? `<h4 class="pp-sub">Repair economics</h4><div class="passport-facts compact"><div><span>Parts</span><b>${money(r.repair_parts_cost)} ${srcTag(a.inputSource.repair_parts_cost)}</b></div><div><span>Labour + retest</span><b>${money((r.repair_labor_cost || 0) + (r.repair_test_cost || 0))}</b></div><div><span>Total repair cost</span><b>${money(repairCost)}</b></div><div><span>Days out of market</span><b>${num(r.repair_days)} ${srcTag(a.inputSource.repair_days)}</b></div><div><span>Success rate</span><b>${pct(r.repair_success)}</b></div><div><span>Once repaired it would</span><b>${a.afterRepair ? esc(routeInfo(a.afterRepair).label) : "Not modeled"}</b></div></div>${
        rp ? `<p class="pp-note">${rp.priced ? `Repair cost ${rp.source === "inputs" ? "came with the asset’s inputs" : `filled from <code>${esc(rp.source)}</code> row “${esc(rp.table_row)}” (${esc(rp.status)})`}.` : esc(rp.note)}</p>` : ""
      }${repairRow && repairRow.value !== null ? `<p class="pp-note">Expected value of repairing: ${money(repairRow.value)}, weighed against ${esc(routeInfo(a.baselineRoute).label.toLowerCase())} at ${money(a.baselineValue)}.</p>` : ""}`
    : "";
  const warn = a.warnings.length
    ? `<div class="warnings" role="note">${a.warnings.map((w) => `<p><b>Check:</b> ${esc(w.message)}</p>`).join("")}</div>`
    : "";
  return `<section class="pp-section" id="pp-condition" aria-labelledby="pp-condition-h"><h3 class="pp-h" id="pp-condition-h"><span class="micro">02 / Condition</span>What the evidence says</h3>${body}${repair}${warn}</section>`;
}

function economics(a) {
  const rec = a.routes.find((r) => r.recommended);
  const r = a.resolved;
  const res = a.recommendation?.result;
  const rows = a.routes
    .map((x) => {
      const status = x.recommended
        ? `<span class="rt-status rec">Recommended</span>`
        : x.eligible
          ? `<span class="rt-status">Eligible${x.audit.length ? " · not chosen" : ""}</span>`
          : `<span class="rt-status no">Not eligible</span>`;
      const why = x.recommended ? "" : x.eligible ? x.audit.join(" ") : x.reason;
      return `<tr class="${x.recommended ? "leading" : ""} ${x.eligible ? "" : "muted"}"><th scope="row"><span aria-hidden="true">${x.info.symbol}</span> ${esc(x.info.label)}${x.baseline ? ` <small>baseline</small>` : ""}</th><td class="num">${x.value === null ? "—" : money(x.value)}</td><td class="num">${x.stress === null ? "—" : money(x.stress)}</td><td>${status}${why ? `<small>${esc(why)}</small>` : ""}</td></tr>`;
    })
    .join("");
  const assumption = (k) => `<div><span>${esc(INPUT_SPECS[k]?.label || k)}</span><b>${formatInput(k, r[k])} ${srcTag(a.inputSource[k])}</b></div>`;
  const plain = (label, v, src) => `<div><span>${label}</span><b>${v}${src ? ` ${srcTag(src)}` : ""}</b></div>`;
  return `<section class="pp-section" id="pp-economics" aria-labelledby="pp-economics-h"><h3 class="pp-h" id="pp-economics-h"><span class="micro">03 / Economics</span>What each future is worth</h3><div class="passport-recommendation"><span class="micro">The model recommends</span><div class="row"><h3>${esc(a.routeInfo.label)}</h3><span aria-hidden="true">${a.routeInfo.symbol}</span></div><p>${esc(a.routeInfo.model)}</p><div class="recommendation-value"><span>Modeled net route value</span><strong>${money(a.routeValue)}</strong></div><div class="baseline-line"><span>Baseline: ${esc(routeInfo(a.baselineRoute).label)} ${money(a.baselineValue)}</span><b class="${a.gain > 0 ? "gain" : ""}">${signedMoney(a.gain)} uplift</b></div></div>
  <div class="tablewrap compact"><table class="route-table"><caption class="sr-only">All seven routes for ${esc(a.id)}</caption><thead><tr><th scope="col">Route</th><th scope="col" class="num">Base case</th><th scope="col" class="num">Stress case</th><th scope="col">Status</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="pp-note">Base case is the model’s expected value; the stress case is each riskier route’s own worst plausible case (slower buyers, weaker demand, faster decline). A riskier route only wins if it beats the safer ones by the margin of safety in the base case and still wins in its stress case.</p>
  <details class="model-details"><summary>Assumptions behind these numbers</summary><div class="passport-facts compact">${[
    "offer_today",
    "market_price",
    "dwell_days",
    "utilization",
    "first_month_utilization",
    "rental_rate",
    "elec_per_kwh",
    "market_decay_pct_mo",
    "horizon_months",
  ]
    .map(assumption)
    .join("")}${plain("Selling fee", pct(r.sell_fee_pct, 1), a.inputSource.sell_fee_pct)}${plain("Marketplace cut", pct(r.platform_fee_pct), a.inputSource.platform_fee_pct)}${plain("Discount rate", `${pct(r.discount_rate_yr, 2)} / yr`, a.inputSource.discount_rate_yr)}${plain("Margin of safety", `${money(r.margin_abs)} or ${pct(r.margin_pct)}`, a.inputSource.margin_abs)}</div>${
    res
      ? `<div class="passport-facts compact"><div><span>Daily compute margin</span><b>${money(res.daily_compute_margin, { cents: true })}</b></div><div><span>Break-even wait for yield</span><b>${res.breakeven_dwell_days === null ? "None in 0–365 days" : `${res.breakeven_dwell_days} days`}</b></div><div><span>Break-even utilization for hosting</span><b>${res.breakeven_utilization === null ? "None up to 100%" : pct(res.breakeven_utilization, 1)}</b></div></div>`
      : ""
  }<p>Source and status for every default: Market Intelligence → Assumptions.</p></details></section>`;
}

function decision(a, ds) {
  const res = a.recommendation?.result;
  const conf = a.confidence;
  const draft = store.ws.selections[a.id];
  const eligible = res?.eligible || [];
  const current = draft && eligible.includes(draft) ? draft : a.selectedRoute && eligible.includes(a.selectedRoute) ? a.selectedRoute : a.route;
  const err = lastError.get(a.id);
  const demo = isDemo();
  const confHtml = !conf
    ? ""
    : conf.level
      ? `<div class="confidence ${esc(conf.level.toLowerCase())}"><span class="micro">Decision confidence</span><b>${esc(conf.level ? conf.level[0].toUpperCase() + conf.level.slice(1).toLowerCase() : "")}</b><p>${conf.smallest_move === null ? "No single change, within the allowed range, changes this route." : `The smallest change to one detail that would change the route is ${pct(conf.smallest_move)} of its current value.`}</p><ul class="plain">${conf.drivers
          .filter((d) => d.move !== null)
          .slice(0, 3)
          .map((d) => {
            const flip = d.down && d.up ? (Math.abs(d.down.at - d.now) < Math.abs(d.up.at - d.now) ? d.down : d.up) : d.down || d.up;
            return `<li>${esc(d.label)}: now ${formatInput(d.input, d.now)}; at ${formatInput(d.input, flip.at)} it becomes ${esc(routeInfo(flip.route).label)}</li>`;
          })
          .join("")}</ul><small>Confidence is how far one detail has to move before the recommended route changes.</small></div>`
      : `<div class="confidence"><span class="micro">Decision confidence</span><b>Not computed</b><p>${esc(conf.note)}</p></div>`;

  let actions;
  if (a.terminal) {
    actions = `<div class="locked"><span class="micro">Inputs locked</span><p>This asset is ${esc(a.stateInfo.label.toLowerCase())}. Its model inputs and lifecycle are final.</p></div>`;
  } else if (!a.allowedEvents.length && !a.overrideEvents.length) {
    actions = `<p class="pp-note">No lifecycle step is available from ${esc(a.state)}.</p>`;
  } else {
    actions = `<div class="event-actions" role="group" aria-label="Lifecycle actions">${a.allowedEvents
      .map((e) => `<button class="btn" data-action="event" data-event="${esc(e)}" ${demo ? "disabled" : ""}>${esc(eventInfo(e).label)}</button>`)
      .join("")}${a.overrideEvents
      .map((e) => `<button class="btn secondary override" data-action="event" data-event="${esc(e)}" data-override="1" ${demo ? "disabled" : ""}>${esc(eventInfo(e).label)} <span class="prov-tag hypothesis">override</span></button>`)
      .join("")}</div><p class="pp-note">Normal buttons are the steps available right now. Override steps go against the recommendation and need a note. Steps that are not possible for this asset are not shown.</p>`;
  }
  return `<section class="pp-section" id="pp-decision" aria-labelledby="pp-decision-h"><h3 class="pp-h" id="pp-decision-h"><span class="micro">04 / Decision</span>Why, and what you can do</h3>
  <h4 class="pp-sub">Why the model chose ${esc(a.routeInfo.label.toLowerCase())}</h4><ol class="audit">${(res?.audit || []).map((l) => `<li>${esc(l)}</li>`).join("")}</ol>${confHtml}
  ${
    a.terminal
      ? ""
      : `<label for="routeSelect" class="route-label">Your choice</label><select id="routeSelect" data-select-route>${eligible
          .map((r) => `<option value="${esc(r)}" ${r === current ? "selected" : ""}>${esc(routeInfo(r).label)}${r === a.route ? " (recommended)" : ""}</option>`)
          .join("")}</select>${
          current !== a.route
            ? `<p class="choice-note" role="note">You’re choosing ${esc(routeInfo(current).label)} over the model’s ${esc(a.routeInfo.label)} (${money(a.routes.find((x) => x.route === current)?.value)} vs ${money(a.routeValue)}). The recommendation stays on record. Steps that go against it will ask for an override with a note.</p>`
            : ""
        }<p class="pp-note">Only routes the model found eligible are offered. Your choice is recorded with the next lifecycle step.</p>`
  }
  ${err ? `<div class="inline-error" role="alert"><b>${esc(err.title)}</b><p>${esc(err.message)}</p></div>` : ""}
  ${demo && !a.terminal ? `<p class="mode-inline demo">Demo mode is read-only: lifecycle steps are shown but disabled. Switch to Live data to use them.</p>` : ""}
  ${actions}
  <div class="modalactions"><a class="btn secondary" href="#lab?asset=${encodeURIComponent(a.id)}">Explore what-if ↗</a><a class="btn secondary" href="#replay?asset=${encodeURIComponent(a.id)}">Replay this decision ↗</a></div>
  ${a.terminal ? outcomeBlock(a) : editInputs(a)}</section>`;
}

function outcomeBlock(a) {
  const o = a.outcome;
  return `<div class="outcome-block"><span class="micro">Realized outcome</span>${
    o
      ? `<p><b>${money(o.realized_value)}</b> recorded ${dateTime(o.at)}${o.note ? ` · “${esc(o.note)}”` : ""}</p>`
      : `<p>No realized value recorded yet. Model values are estimates; only a recorded outcome is realized.</p>`
  }<button class="btn secondary" data-action="outcome" ${isDemo() ? "disabled" : ""}>${o ? "Record a correction" : "Record what happened"} ↗</button></div>`;
}

function editInputs(a) {
  const r = a.resolved;
  return `<details class="model-details edit-inputs"><summary>Update this asset’s model inputs</summary><form data-submit="patch" novalidate><p>Saves new inputs to the asset and reruns the model. The previous recommendation stays in history.</p><div class="input-grid">${EDITABLE.map((k) => {
    const s = INPUT_SPECS[k];
    const v = s.scale ? +(r[k] * s.scale).toFixed(4) : r[k];
    return `<label class="ctl"><span>${esc(s.label)} <small>${esc(s.scale ? "%" : s.unit)}</small></span><input type="number" name="${k}" id="edit-${k}" value="${esc(v)}" step="${s.scale ? 0.1 : s.step}" min="${s.scale ? s.min * s.scale : s.min}" max="${s.scale ? s.max * s.scale : s.max}" data-original="${esc(v)}"></label>`;
  }).join("")}<label class="ctl"><span>Ownership</span><select name="ownership" id="edit-ownership" data-original="${esc(r.ownership)}">${["owned", "client_approved", "consigned"]
    .map((o) => `<option ${o === r.ownership ? "selected" : ""}>${o}</option>`)
    .join("")}</select></label></div><div id="edit-errors" aria-live="polite"></div><button class="btn secondary" type="submit" ${isDemo() ? "disabled" : ""}>Save inputs and rerun the model</button></form></details>`;
}

function historyBlock(h) {
  const items = adaptHistory(h).slice().reverse();
  return `<section class="pp-section" id="pp-history" aria-labelledby="pp-history-h"><h3 class="pp-h" id="pp-history-h"><span class="micro">05 / History</span>Everything that happened</h3><ol class="timeline">${items
    .map((e) => {
      if (e.type === "recommendation")
        return `<li class="tl rec"><span class="tl-kind">Recommendation #${esc(e.id)}</span><b>${routeChip(e.route)}${e.routeChanged ? ` <span class="prov-tag historical">changed from ${esc(routeInfo(e.previousRoute).label)}</span>` : ""}</b><small>${dateTime(e.at)}${e.changedInputs.length ? ` · inputs changed: ${e.changedInputs.map((k) => esc(INPUT_SPECS[k]?.label || k)).join(", ")}` : ""}</small>${e.audit?.length ? `<details><summary>Model reasoning</summary><ul class="plain">${e.audit.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></details>` : ""}</li>`;
      if (e.type === "outcome")
        return `<li class="tl outcome"><span class="tl-kind">Outcome recorded</span><b>${money(e.realized_value)} realized</b><small>${dateTime(e.at)}${e.note ? ` · ${esc(e.note)}` : ""}</small></li>`;
      const d = e.details || {};
      const extras = [
        d.selected_route ? `selected ${esc(routeInfo(d.selected_route).label)}` : "",
        d.at_risk ? "sale at risk" : "",
        d.repair_cost !== undefined ? `repair ${money(d.repair_cost)}` : "",
      ].filter(Boolean);
      return `<li class="tl tr ${e.override ? "override" : ""}"><span class="tl-kind">${esc(eventInfo(e.event).verb)}</span><b>${e.from_state ? `${esc(stateInfo(e.from_state).label)} → ` : ""}${esc(stateInfo(e.to_state).label)}${e.override ? ` <span class="prov-tag hypothesis">override</span>` : ""}</b><small>${dateTime(e.at)}${e.route_at_time ? ` · recommendation then: ${esc(routeInfo(e.route_at_time).label)}` : ""}${extras.length ? ` · ${extras.join(" · ")}` : ""}</small>${e.note ? `<p class="tl-note">“${esc(e.note)}”</p>` : ""}</li>`;
    })
    .join("")}</ol></section>`;
}

function page(detail, hist, meta) {
  const a = adaptAssetDetail(detail, { meta, history: hist });
  const ds = decisionStates(a, hist, store.ws.selections[a.id]);
  const [h1, h2] = headline(a);
  return `<div class="passport-page"><a class="textlink back" href="#fleet">← Back to the fleet</a><div class="passport-layout">${cover(a)}<section class="passport-reading"><div class="row"><span class="micro">Understand, then decide</span><button class="textlink" data-action="share">Copy passport link</button></div><p class="passport-mobile-identity">${esc(a.model || "")} · ${esc(a.id)}</p><h2>${esc(h1)}<br><em>${esc(h2)}</em></h2>${states(a, ds)}<nav class="pp-nav" aria-label="Passport sections"><a href="#pp-identity" data-action="jump">Identity</a><a href="#pp-condition" data-action="jump">Condition</a><a href="#pp-economics" data-action="jump">Economics</a><a href="#pp-decision" data-action="jump">Decision</a><a href="#pp-history" data-action="jump">History</a></nav>${identity(a)}${condition(a)}${economics(a)}${decision(a, ds)}${historyBlock(hist)}</section></div></div>`;
}

async function runEvent(a, event, override) {
  const draft = store.ws.selections[a.id];
  const eligible = a.recommendation?.result?.eligible || [];
  const selected = document.querySelector("#routeSelect")?.value || (draft && eligible.includes(draft) ? draft : null);
  const info = eventInfo(event);
  const { confirmed, note } = await confirmDialog({
    title: override ? `Override: ${info.label}?` : `${info.label}?`,
    body: `<p class="subtext">${esc(a.id)} moves from <b>${esc(stateInfo(a.state).label)}</b> in the ReCompute lifecycle. This records the move; it doesn’t list, sell, host or ship anything by itself.</p>${
      override
        ? `<p class="choice-note">The model recommends <b>${esc(a.routeInfo.label)}</b>. This step goes against it, so it needs a note. The override and note are kept in the asset’s history.</p>`
        : ""
    }${selected ? `<p class="subtext">Recorded as your selected route: <b>${esc(routeInfo(selected).label)}</b>${selected !== a.route ? " (differs from the recommendation)" : ""}.</p>` : ""}`,
    confirmLabel: override ? "Override and continue" : info.label,
    requireNote: override,
    noteLabel: "Why are you going against the recommendation?",
    notePlaceholder: "e.g. client asked for a quarter of hosting before sale",
  });
  if (!confirmed) return;
  try {
    const out = await executeEvent(a.id, { event, override, note, selected_route: selected || undefined });
    lastError.delete(a.id);
    store.update((ws) => delete ws.selections[a.id]);
    toast(`${a.id}: ${info.verb}. Now ${stateInfo(out.asset.state).label.toLowerCase()}.`);
  } catch (e) {
    lastError.set(a.id, {
      title: e.status === 409 ? "That move isn’t possible right now." : e.status === 422 ? "Some details need another look." : "The move didn’t go through.",
      message: e.message,
    });
    if (e.status === 409) invalidateAsset(a.id);
    toast(e.message);
  }
  rerender();
}

function currentAsset(id) {
  const d = R.asset(id).data;
  const h = R.history(id).data;
  return d && h ? adaptAssetDetail(d, { meta: R.meta().data, history: h }) : null;
}

export default {
  title: "Asset Passport",
  render(route) {
    const id = route.param;
    if (!id) return errorBlock({ message: "No asset ID in the link.", status: 404 }, {});
    const asset = R.asset(id);
    const hist = R.history(id);
    const meta = R.meta();
    const failed = [asset, hist, meta].find((e) => e.status === "error" && !e.data);
    if (failed)
      return `<div class="passport-page"><a class="textlink back" href="#fleet">← Back to the fleet</a>${errorBlock(failed.error, {
        retryKeys: [`asset:${id}`, `history:${id}`, "meta"],
        title: failed.error?.status === 404 ? `No passport for ${id}.` : "This passport didn’t load.",
      })}</div>`;
    if (!asset.data || !hist.data || !meta.data) return loadingBlock(`Opening the passport for ${id}…`);
    return page(asset.data, hist.data, meta.data);
  },
  after(root, route) {
    if (route.param) store.update((ws) => (ws.focusAssetId = route.param));
  },
  actions: {
    jump: (el) => {
      const t = document.querySelector(el.getAttribute("href"));
      t?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      t?.querySelector("h3")?.setAttribute("tabindex", "-1");
      t?.querySelector("h3")?.focus({ preventScroll: true });
    },
    share: async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        toast("Passport link copied. Anyone with the link can open this asset.");
      } catch {
        toast(location.href);
      }
    },
    event: (el, e, route) => {
      const a = currentAsset(route.param);
      if (a) return runEvent(a, el.dataset.event, !!el.dataset.override);
    },
    outcome: (el, e, route) => {
      const a = currentAsset(route.param);
      if (a) return openOutcomeDialog(a);
    },
    patch: async (form, e, route) => {
      const id = route.param;
      const changes = {};
      const errors = [];
      for (const k of EDITABLE) {
        const el = form.elements[k];
        if (el.value === el.dataset.original) continue;
        const s = INPUT_SPECS[k];
        const v = s.scale ? Number(el.value) / s.scale : Number(el.value);
        const msg = el.value === "" ? `${s.label} is required` : validateInput(k, v);
        if (msg) errors.push({ field: k, message: msg });
        else changes[k] = v;
      }
      const own = form.elements.ownership;
      if (own.value !== own.dataset.original) changes.ownership = own.value;
      const out = form.querySelector("#edit-errors");
      if (errors.length) {
        out.innerHTML = fieldErrorsTable(errors);
        return;
      }
      if (!Object.keys(changes).length) {
        out.innerHTML = `<p class="subtle">Nothing changed.</p>`;
        return;
      }
      try {
        const res = await patchInputs(id, changes);
        toast(`New recommendation #${res.recommendation.id}: ${routeInfo(res.route).label} at ${money(res.route_value)}.`);
      } catch (err) {
        out.innerHTML = errorBlock(err, { title: "Some of these details need another look." }) + fieldErrorsTable(err.fieldErrors);
      }
    },
  },
  onChange(e, route) {
    if (e.target.matches("[data-select-route]")) {
      store.update((ws) => (ws.selections[route.param] = e.target.value));
      rerender();
    }
  },
};

export function openOutcomeDialog(a, { onDone } = {}) {
  const planned = a.routeValue;
  openDialog({
    label: "Record an outcome",
    html: `<form id="outcomeForm" novalidate><div class="row"><h2>Record the next chapter.</h2><button type="button" class="close" data-close aria-label="Close">×</button></div><p class="subtext">${esc(a.model || a.id)} · ${esc(a.id)} · ${esc(stateInfo(a.state).label)}. The model’s current estimate for ${esc(a.routeInfo.label.toLowerCase())} is ${money(planned)}.</p><label class="field-label" for="actual">Realized net value (USD)</label><input id="actual" type="number" step="0.01" min="-1000000000" max="1000000000" required aria-describedby="actual-help actual-error" placeholder="Proceeds after every cost"><p class="subtle" id="actual-help">Enter net proceeds after fees, freight, labour and any other cost. Use a negative number if the decision lost money. This records an outcome; it does not perform a transaction.</p><p class="field-error" id="actual-error" role="alert"></p><label class="field-label" for="actual-note">Note <span class="subtle">optional</span></label><textarea id="actual-note" rows="2" maxlength="2000" placeholder="e.g. final invoice, freight over estimate"></textarea><div class="modalactions"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" type="submit">Save outcome</button></div></form>`,
    bind(d, close) {
      d.querySelector("form").onsubmit = async (ev) => {
        ev.preventDefault();
        const raw = d.querySelector("#actual").value;
        const v = Number(raw);
        const errEl = d.querySelector("#actual-error");
        if (raw.trim() === "" || !Number.isFinite(v) || Math.abs(v) > 1e9) {
          errEl.textContent = "Enter a number between −$1,000,000,000 and $1,000,000,000.";
          d.querySelector("#actual").setAttribute("aria-invalid", "true");
          d.querySelector("#actual").focus();
          return;
        }
        try {
          await recordOutcome(a.id, { realized_value: v, note: d.querySelector("#actual-note").value.trim() || undefined });
          close();
          toast(`Outcome recorded for ${a.id}: ${money(v)}.`);
          onDone?.();
          rerender();
        } catch (e) {
          errEl.textContent = e.message;
        }
      };
    },
  });
}
