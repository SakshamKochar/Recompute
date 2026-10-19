import { rerender } from "../app.js";
import { api, getTransport } from "../api/backend.js";
import { R } from "../state/data.js";
import { store, uid } from "../state/store.js";
import { adaptAssetDetail, adaptAssetRow, adaptHistory, hardwareTitle, routeTable } from "../lib/adapters.js";
import { dateTime, money, signedMoney } from "../lib/format.js";
import { esc } from "../lib/html.js";
import { formatInput, fromDisplay, INPUT_SPECS, toDisplay } from "../lib/inputs.js";
import { eventInfo, stateInfo } from "../lib/lifecycle.js";
import { routeInfo } from "../lib/routes.js";
import { contextStrip, emptyBlock, errorBlock, heading, isDemo, loadingBlock, routeChip, sceneLabel, tag } from "../ui/components.js";
import { toast } from "../ui/feedback.js";
import { baseInputsFor } from "./lab.js";

const calc = { key: null, status: "idle", out: null, error: null, seq: 0, controller: null };

const rs = () => store.ws.replay;
const setR = (patch) => store.update((ws) => Object.assign(ws.replay, patch));

function pickAsset(route, rows) {
  const want = route.query.asset || rs().assetId || store.ws.focusAssetId;
  if (want && rows.some((a) => a.asset_id === want)) return want;
  return (rows.find((a) => a.asset_id === "DEMO-SHAURYAA") || rows[0])?.asset_id;
}

/** The value one step past a driver's flip point, or the nearest recorded value in Demo mode. */
export function flipTarget(driver, gridValues = null) {
  const flip = driver.down && driver.up ? (Math.abs(driver.down.at - driver.now) <= Math.abs(driver.up.at - driver.now) ? driver.down : driver.up) : driver.down || driver.up;
  if (!flip) return null;
  const dir = flip.at < driver.now ? -1 : 1;
  if (!gridValues) return { value: flip.at, route: flip.route, dir };
  const beyond = gridValues.filter((v) => (dir < 0 ? v <= flip.at + 1e-9 : v >= flip.at - 1e-9)).sort((a, b) => Math.abs(a - flip.at) - Math.abs(b - flip.at));
  return beyond.length ? { value: beyond[0], route: flip.route, dir, snapped: true } : null;
}

function runCounterfactual(id, base, driver, value) {
  const key = JSON.stringify([getTransport()?.mode, id, driver, value]);
  if (calc.key === key) return;
  calc.key = key;
  calc.status = "loading";
  calc.error = null;
  calc.controller?.abort();
  const controller = new AbortController();
  calc.controller = controller;
  const seq = ++calc.seq;
  api
    .recommend({ ...base, [driver]: value }, { signal: controller.signal, demo: { assetId: id, dial: driver, value } })
    .then((out) => {
      if (seq !== calc.seq) return;
      calc.status = "ready";
      calc.out = { ...out, driver, value, assetId: id, at: new Date().toISOString() };
      rerender();
    })
    .catch((e) => {
      if (seq !== calc.seq || e.kind === "aborted") return;
      calc.status = "error";
      calc.error = e;
      rerender();
    });
}

function timeline(a, hist) {
  const items = adaptHistory(hist).filter((e) => e.type !== "transition" || e.event !== "received");
  if (!items.length) return "";
  const step = Math.min(rs().step ?? items.length - 1, items.length - 1);
  const cur = items[step];
  const describe = (e) => {
    if (e.type === "recommendation")
      return `<h3>Recommendation #${esc(e.id)}: ${esc(routeInfo(e.route).label)}</h3><p>The model chose ${esc(routeInfo(e.route).label.toLowerCase())}${e.routeChanged ? `, changing from ${esc(routeInfo(e.previousRoute).label.toLowerCase())}` : ""}.${e.changedInputs.length ? ` Inputs changed: ${e.changedInputs.map((k) => esc(INPUT_SPECS[k]?.label || k)).join(", ")}.` : ""}</p>${e.audit?.length ? `<ol class="audit">${e.audit.slice(0, 4).map((l) => `<li>${esc(l)}</li>`).join("")}</ol>` : ""}`;
    if (e.type === "outcome") return `<h3>Outcome recorded: ${money(e.realized_value)}</h3><p>${e.note ? esc(e.note) : "No note."}</p>`;
    return `<h3>${esc(eventInfo(e.event).verb)}: ${e.from_state ? `${esc(stateInfo(e.from_state).label)} → ` : ""}${esc(stateInfo(e.to_state).label)}</h3><p>${e.route_at_time ? `The recommendation at the time was ${esc(routeInfo(e.route_at_time).label.toLowerCase())}.` : ""}${e.details?.selected_route ? ` Selected route: ${esc(routeInfo(e.details.selected_route).label.toLowerCase())}.` : ""}${e.override ? " Recorded as an override." : ""}</p>${e.note ? `<p class="tl-note">“${esc(e.note)}”</p>` : ""}`;
  };
  return `<section class="replay-step" aria-labelledby="rp-record"><div class="replay-head">${sceneLabel("04", "The record")}<h2 id="rp-record">Replay what happened.</h2></div><div class="replay-scrub" role="group" aria-label="Step through the asset’s history"><button class="btn secondary" data-action="step" data-dir="-1" ${step === 0 ? "disabled" : ""} aria-label="Previous event">←</button><ol class="scrub-dots">${items
    .map((e, i) => `<li><button class="${i === step ? "on" : ""} ${e.type}" data-action="goto" data-step="${i}" aria-label="Event ${i + 1}: ${esc(e.type === "recommendation" ? `recommendation ${routeInfo(e.route).label}` : e.type === "outcome" ? "outcome" : eventInfo(e.event).verb)}" ${i === step ? 'aria-current="step"' : ""}></button></li>`)
    .join("")}</ol><button class="btn secondary" data-action="step" data-dir="1" ${step === items.length - 1 ? "disabled" : ""} aria-label="Next event">→</button></div><article class="replay-card" aria-live="polite"><span class="micro">Event ${step + 1} of ${items.length} · ${dateTime(cur.at)}</span>${describe(cur)}</article></section>`;
}

function counterfactual(a, base) {
  const conf = a.confidence;
  const grids = isDemo() ? getTransport()._snap?.lab?.[a.id]?.grids : null;
  if (a.failed) return `<p class="pp-note">Decision Replay’s “change one thing” step uses the model’s flip drivers, which apply to healthy servers. For this failed server, explore repair inputs in the <a href="#lab?asset=${encodeURIComponent(a.id)}">What-if Lab</a>.</p>`;
  if (!conf?.level) return `<p class="pp-note">${esc(conf?.note || "No decision confidence was returned for this asset.")}</p>`;
  const drivers = conf.drivers.filter((d) => d.move !== null);
  if (!drivers.length) return `<p class="pp-note">No single change, within the allowed range, changes this route.</p>`;
  const sel = drivers.find((d) => d.input === rs().driver) || drivers[0];
  const gridVals = grids?.[sel.input] ? Object.keys(grids[sel.input]).map(Number) : null;
  const unavailableInDemo = isDemo() && !gridVals;
  const target = flipTarget(sel, gridVals);
  const value = rs().driver === sel.input && rs().value !== null && rs().value !== undefined ? rs().value : target?.value;
  if (!unavailableInDemo && value !== undefined && value !== null) runCounterfactual(a.id, base, sel.input, value);
  const spec = INPUT_SPECS[sel.input];
  const range = spec ? (gridVals ? [Math.min(...gridVals), Math.max(...gridVals)] : spec.slider || [spec.min, spec.max]) : null;
  const step = gridVals ? gridVals[1] - gridVals[0] : spec?.step;
  return `<div class="replay-drivers" role="group" aria-label="Pick one driver">${drivers
    .map((d) => `<button data-action="driver" data-driver="${esc(d.input)}" aria-pressed="${d.input === sel.input}">${esc(d.label)}</button>`)
    .join("")}</div>${
    unavailableInDemo
      ? `<p class="mode-inline demo">The demo snapshot didn’t record runs for ${esc(sel.label.toLowerCase())}. Pick utilization, electricity, wait or value decline, or switch to Live.</p>`
      : `<div class="replay-change"><p>Now: <b>${formatInput(sel.input, sel.now)}</b>. ${target ? `The model says the route becomes <b>${esc(routeInfo(target.route).label.toLowerCase())}</b> at ${formatInput(sel.input, (sel.down && sel.up ? null : (sel.down || sel.up).at) ?? target.value)}.` : ""}</p>${
          spec && range
            ? `<div class="control"><label for="rp-value"><span>Try ${esc(sel.label.toLowerCase())}</span><b id="rp-value-v">${formatInput(sel.input, value)}</b></label><input type="range" id="rp-value" data-replay-value="${esc(sel.input)}" min="${toDisplay(sel.input, range[0])}" max="${toDisplay(sel.input, range[1])}" step="${toDisplay(sel.input, step)}" value="${toDisplay(sel.input, value)}" aria-valuetext="${esc(formatInput(sel.input, value))}"></div>${target ? `<button class="textlink" data-action="to-flip">Jump to the flip point (${formatInput(sel.input, target.value)}) ↺</button>` : ""}`
            : ""
        }</div>${diff(a)}`
  }`;
}

function diff(a) {
  if (calc.status === "error") return errorBlock(calc.error, { title: calc.error?.kind === "demo-unsupported" ? "Not recorded in the demo." : "The model didn’t answer." });
  if (!calc.out || calc.out.assetId !== a.id) return loadingBlock("Asking the model…");
  const after = calc.out.result;
  const before = a.recommendation.result;
  const resolved = { ...a.profileDefaults, ...calc.out.inputs };
  const rowsA = routeTable(after, resolved);
  const flipped = after.route !== before.route;
  return `<div class="replay-diff ${calc.status === "loading" ? "is-stale" : ""}" aria-live="polite"><div class="diff-pair"><div><span class="micro">Before · Stored #${esc(a.recommendation.id)}</span>${routeChip(before.route)}<strong>${money(before.base[before.route])}</strong></div><span class="diff-arrow" aria-hidden="true">→</span><div class="${flipped ? "flipped" : ""}"><span class="micro">After · ${esc(INPUT_SPECS[calc.out.driver]?.label || calc.out.driver)} ${formatInput(calc.out.driver, calc.out.value)} ${tag(isDemo() ? "demo" : "live")}</span>${routeChip(after.route)}<strong>${money(after.base[after.route])}</strong></div></div><p class="diff-verdict">${
    flipped ? `<b>The answer changes.</b> With this one input moved, the model chooses ${esc(routeInfo(after.route).label.toLowerCase())} instead of ${esc(routeInfo(before.route).label.toLowerCase())}.` : `<b>Same answer.</b> The model still chooses ${esc(routeInfo(before.route).label.toLowerCase())}.`
  }</p><div class="tablewrap compact"><table><caption class="sr-only">Every route before and after the change</caption><thead><tr><th scope="col">Route</th><th scope="col" class="num">Before</th><th scope="col" class="num">After</th><th scope="col" class="num">Change</th></tr></thead><tbody>${rowsA
    .map((r) => {
      const b = before.base[r.route];
      const delta = r.value !== null && b !== undefined ? r.value - b : null;
      return `<tr class="${r.recommended ? "leading" : ""} ${r.eligible ? "" : "muted"}"><th scope="row">${esc(r.info.label)}${r.recommended ? " <small>chosen</small>" : ""}${r.eligible ? "" : " <small>not eligible</small>"}</th><td class="num">${money(b)}</td><td class="num">${money(r.value)}</td><td class="num ${delta > 0 ? "gain" : delta < 0 ? "loss" : ""}">${delta === null ? "—" : signedMoney(delta)}</td></tr>`;
    })
    .join("")}</tbody></table></div><div class="modalactions"><button class="btn secondary" data-action="save" ${calc.status === "ready" ? "" : "disabled"}>Keep this comparison +</button>${
    flipped && !a.terminal && after.eligible.includes(after.route) && a.recommendation.result.eligible.includes(after.route)
      ? `<button class="btn" data-action="propose" data-route="${esc(after.route)}">Propose ${esc(routeInfo(after.route).label.toLowerCase())} for this asset ↗</button>`
      : ""
  }</div><p class="subtle">Proposing sets your choice on the passport as a draft. Nothing is recorded until you take a lifecycle step there.</p></div>`;
}

function page(route) {
  const assetsR = R.assets();
  const meta = R.meta();
  if ((assetsR.status === "error" && !assetsR.data) || (meta.status === "error" && !meta.data)) return errorBlock(assetsR.error || meta.error, { retryKeys: ["assets", "meta"] });
  if (!assetsR.data || !meta.data) return loadingBlock();
  const rows = assetsR.data.assets;
  if (!rows.length) return emptyBlock("◌", "Nothing to replay yet.", "Upload inventory from the Fleet page first.");
  const id = pickAsset(route, rows);
  const featured = isDemo() ? Object.keys(getTransport()._snap?.lab || {}) : null;
  const select = `<label for="rp-asset" class="field-label">Replay a decision for</label><select id="rp-asset" data-replay-asset>${rows
    .map(adaptAssetRow)
    .map((x) => `<option value="${esc(x.id)}" ${x.id === id ? "selected" : ""}>${esc(hardwareTitle(x))} · ${esc(x.id)} · ${esc(x.routeInfo.label)}${featured && !featured.includes(x.id) ? " (record only in Demo)" : ""}</option>`)
    .join("")}</select>`;
  const head = heading("Decision Replay", "Not done.<br><em>Just next.</em>", "Walk through one decision: the evidence, the model’s call, and the single change that would have made it different.");
  const d = R.asset(id);
  const h = R.history(id);
  const failed = [d, h].find((e) => e.status === "error" && !e.data);
  if (failed) return head + select + errorBlock(failed.error, { retryKeys: [`asset:${id}`, `history:${id}`] });
  if (!d.data || !h.data) return head + select + loadingBlock(`Loading ${id}…`);
  const a = adaptAssetDetail(d.data, { meta: meta.data, history: h.data });
  if (!a.recommendation) return head + select + emptyBlock("◌", "No recommendation on record.", "This asset has not been through the model yet.");
  const base = baseInputsFor(a, meta.data);
  const dg = a.diagnostics;
  const rec = a.recommendation;
  const keyInputs = ["offer_today", "market_price", "dwell_days", "utilization", "rental_rate", "elec_per_kwh"];
  return (
    contextStrip([esc(id), `Recommendation #${rec.id}`]) +
    head +
    `<div class="replay-picker">${select}</div><div class="replay">
    <section class="replay-step" aria-labelledby="rp-evidence"><div class="replay-head">${sceneLabel("01", "The evidence")}<h2 id="rp-evidence">What the model knew.</h2></div><div class="replay-body"><p>${esc(a.model || "A server")} · ${esc(a.ageMonths !== null ? `${a.ageMonths} months in service` : "age not recorded")} · ${esc(a.site || "site not recorded")}.</p>${
      dg.assessed
        ? `<p><b>Grade ${esc(dg.grade)}, ${esc(dg.score)}/100</b> from ${dg.simulated ? "simulated" : "captured"} NVIDIA diagnostics (evidence confidence ${esc(dg.evidenceConfidence)}). ${dg.findings.filter((f) => f.severity !== "OK").length} findings beyond OK.</p>`
        : `<p><b>No diagnostic capture on file.</b> The model used the inventory’s health flag: ${a.resolved.health_pass ? "passed" : "failed"}${a.failedPart ? ` (${esc(a.failedPart)})` : ""}.</p>`
    }<div class="passport-facts compact">${keyInputs.map((k) => `<div><span>${esc(INPUT_SPECS[k].label)}</span><b>${formatInput(k, a.resolved[k])} <span class="src-tag ${a.inputSource[k]}">${a.inputSource[k] === "default" ? "profile default" : a.inputSource[k] === "backend" ? "estimated" : "on record"}</span></b></div>`).join("")}</div></div></section>
    <section class="replay-step" aria-labelledby="rp-call"><div class="replay-head">${sceneLabel("02", "The call")}<h2 id="rp-call">What the model decided.</h2></div><div class="replay-body"><div class="replay-verdict">${routeChip(a.route)}<strong>${money(a.routeValue)}</strong><small>Stored ${dateTime(rec.createdAt)} · ${tag("stored")}</small></div><ol class="audit">${rec.result.audit.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>${a.confidence?.level ? `<p>Decision confidence: <b>${esc(a.confidence.level[0].toUpperCase() + a.confidence.level.slice(1).toLowerCase())}</b>. ${a.confidence.smallest_move !== null ? `The smallest change to one detail that would change the route is ${Math.round(a.confidence.smallest_move * 100)}% of its current value.` : ""}</p>` : ""}</div></section>
    <section class="replay-step" aria-labelledby="rp-change"><div class="replay-head">${sceneLabel("03", "Change one thing")}<h2 id="rp-change">What would have changed it?</h2></div><div class="replay-body">${counterfactual(a, base)}</div></section>
    ${timeline(a, h.data)}
    <div class="modalactions"><a class="btn secondary" href="#passport/${encodeURIComponent(id)}">Open the passport ↗</a><a class="btn secondary" href="#lab?asset=${encodeURIComponent(id)}">Explore every input in the Lab ↗</a></div></div>`
  );
}

function current(route) {
  const rows = R.assets().data?.assets || [];
  const id = pickAsset(route, rows);
  const d = R.asset(id).data;
  const h = R.history(id).data;
  const meta = R.meta().data;
  if (!d || !h || !meta) return null;
  const a = adaptAssetDetail(d, { meta, history: h });
  return { id, a, base: baseInputsFor(a, meta), items: adaptHistory(h).filter((e) => e.type !== "transition" || e.event !== "received") };
}

export default {
  title: "Decision Replay",
  render: page,
  leave() {
    calc.controller?.abort();
    calc.key = null;
  },
  actions: {
    driver: (el) => {
      setR({ driver: el.dataset.driver, value: null });
      rerender();
    },
    "to-flip": () => {
      setR({ value: null });
      rerender();
    },
    step: (el, e, route) => {
      const c = current(route);
      if (!c) return;
      const n = Math.max(0, Math.min(c.items.length - 1, (rs().step ?? c.items.length - 1) + Number(el.dataset.dir)));
      setR({ step: n });
      rerender();
    },
    goto: (el) => {
      setR({ step: Number(el.dataset.step) });
      rerender();
    },
    save: (el, e, route) => {
      const c = current(route);
      if (!c || !calc.out) return;
      const out = calc.out;
      const name = `Replay: ${INPUT_SPECS[out.driver]?.label || out.driver} ${formatInput(out.driver, out.value)}`;
      store.update((ws) =>
        ws.scenarios.push({
          id: uid(),
          name,
          assetId: c.id,
          preset: "custom",
          edited: [out.driver],
          inputs: out.inputs,
          sentInputs: { ...c.base, [out.driver]: out.value },
          scenario: null,
          result: out.result,
          decisionConfidence: null,
          modelVersion: out.model_version,
          savedAt: new Date().toISOString(),
          recommendationId: c.a.recommendation?.id ?? null,
          storedRoute: c.a.route,
          mode: getTransport()?.mode,
        }),
      );
      toast(`Saved “${name}”. Reopen it from the What-if Lab.`);
    },
    propose: (el, e, route) => {
      const c = current(route);
      if (!c) return;
      store.update((ws) => (ws.selections[c.id] = el.dataset.route));
      toast(`Draft choice set: ${routeInfo(el.dataset.route).label} for ${c.id}. Review it on the passport.`, {
        action: { label: "Open passport", run: () => (location.hash = `#passport/${encodeURIComponent(c.id)}`) },
      });
    },
  },
  onInput(e) {
    const key = e.target.dataset?.replayValue;
    if (!key) return;
    const v = fromDisplay(key, e.target.value);
    const label = document.querySelector("#rp-value-v");
    if (label) label.textContent = formatInput(key, v);
    e.target.setAttribute("aria-valuetext", formatInput(key, v));
  },
  onChange(e) {
    if (e.target.matches("[data-replay-asset]")) {
      setR({ assetId: e.target.value, driver: null, value: null, step: null });
      calc.out = null;
      location.hash = `#replay?asset=${encodeURIComponent(e.target.value)}`;
      return;
    }
    const key = e.target.dataset?.replayValue;
    if (!key) return;
    setR({ driver: key, value: fromDisplay(key, e.target.value) });
    rerender();
  },
};
