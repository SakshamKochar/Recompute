import { rerender } from "../app.js";
import { api, getTransport } from "../api/backend.js";
import { R, patchInputs } from "../state/data.js";
import { store, uid } from "../state/store.js";
import { adaptAssetDetail, adaptAssetRow, baselineOf, hardwareTitle, routeTable } from "../lib/adapters.js";
import { dateTime, money, pct, signedMoney } from "../lib/format.js";
import { esc } from "../lib/html.js";
import { ADVANCED_KEYS, changedKeys, formatInput, fromDisplay, INPUT_SPECS, REPAIR_KEYS, SLIDER_KEYS, toDisplay, validateInput } from "../lib/inputs.js";
import { routeInfo } from "../lib/routes.js";
import { contextStrip, emptyBlock, errorBlock, heading, isDemo, loadingBlock, routeChip, tag } from "../ui/components.js";
import { confirmDialog, toast } from "../ui/feedback.js";

export const PRESETS = {
  base: ["Base case", "The asset’s own inputs."],
  bear: ["Bear market", "A tough market: low utilization, slow buyers, expensive power, fast decline, low resale."],
  bull: ["Bull market", "The mirror image: busy GPUs, quick buyers, cheap power, steady prices."],
};
const DEBOUNCE_MS = 250;

/** Live calculation state for the asset on screen. Results are never cached across inputs. */
const calc = { key: null, status: "idle", out: null, error: null, seq: 0, controller: null, timer: null };


/** The inputs the model last ran on for this asset, limited to fields the API accepts. */
export function baseInputsFor(a, meta) {
  const allowed = new Set(["asset_profile", ...Object.keys(meta?.profiles?.[a.profile] || meta?.profiles?.a100_8x || {})]);
  return Object.fromEntries(Object.entries(a.effectiveInputs).filter(([k]) => allowed.has(k)));
}

/** A draft as the user sees it: which preset it started from, and the full inputs to send. */
export function draftFor(assetId, base) {
  const d = store.ws.labDrafts[assetId];
  if (!d) return { preset: "base", inputs: { ...base }, edited: [] };
  return { preset: d.preset, inputs: { ...base, ...d.inputs }, edited: d.edited || [] };
}

/** Editing any input after choosing a preset makes the draft Custom: the preset no longer describes it. */
export function applyEdit(draft, key, value, presetInputs) {
  const inputs = { ...(draft.preset !== "custom" && presetInputs ? presetInputs : draft.inputs), [key]: value };
  return { preset: "custom", inputs, edited: [...new Set([...(draft.edited || []), key])] };
}

function requestFor(assetId, draft, base) {
  if (draft.preset === "bear" || draft.preset === "bull") return { inputs: base, scenario: draft.preset, demo: { assetId, scenario: draft.preset } };
  if (draft.preset === "base") return { inputs: base, demo: { assetId, scenario: "base" } };
  const changed = changedKeys(base, draft.inputs);
  const demo = changed.length === 1 ? { assetId, dial: changed[0], value: draft.inputs[changed[0]] } : changed.length === 0 ? { assetId, scenario: "base" } : { assetId, multi: true };
  return { inputs: draft.inputs, demo };
}

function schedule(assetId, draft, base, { immediate = false } = {}) {
  const key = JSON.stringify([getTransport()?.mode, assetId, draft.preset, draft.inputs]);
  if (key === calc.key) return;
  calc.key = key;
  calc.status = "loading";
  calc.error = null;
  clearTimeout(calc.timer);
  calc.timer = setTimeout(() => run(assetId, draft, base, key), immediate ? 0 : DEBOUNCE_MS);
}

async function run(assetId, draft, base, key) {
  calc.controller?.abort();
  const controller = new AbortController();
  calc.controller = controller;
  const seq = ++calc.seq;
  const req = requestFor(assetId, draft, base);
  try {
    if (req.demo.multi && isDemo()) throw Object.assign(new Error("Demo mode recorded one changed input at a time. Reset the others, or switch to Live to recalculate any combination."), { kind: "demo-unsupported" });
    const out = await api.recommend(req.inputs, { scenario: req.scenario, flipPoints: true, signal: controller.signal, demo: req.demo });
    if (seq !== calc.seq) return;
    calc.status = "ready";
    calc.out = { ...out, at: new Date().toISOString(), preset: draft.preset, assetId };
    if (draft.preset === "bear" || draft.preset === "bull") calc.presetInputs = out.inputs;
  } catch (e) {
    if (seq !== calc.seq || e.kind === "aborted") return;
    calc.status = "error";
    calc.error = e;
  }
  rerender();
}

function pickAsset(route, assets) {
  const want = route.query.asset || store.ws.focusAssetId;
  if (want && assets.some((a) => a.asset_id === want)) return want;
  const open = assets.find((a) => a.asset_id === "DEMO-SHAURYAA") || assets.find((a) => !["SOLD", "HARVESTED", "RECYCLED"].includes(a.state)) || assets[0];
  return open?.asset_id;
}

function control(key, value, { demoGridValues } = {}) {
  const s = INPUT_SPECS[key];
  const d = toDisplay(key, value);
  const id = `lab-${key}`;
  let min = s.slider ? s.slider[0] : s.min;
  let max = s.slider ? s.slider[1] : s.max;
  let step = s.step;
  if (s.scale) {
    min = +(min * s.scale).toFixed(4);
    max = +(max * s.scale).toFixed(4);
    step = +(step * s.scale).toFixed(4);
  }
  let disabled = false;
  if (demoGridValues) {
    const vals = demoGridValues.map((v) => toDisplay(key, v));
    min = Math.min(...vals);
    max = Math.max(...vals);
    step = +(vals[1] - vals[0]).toFixed(4);
  } else if (isDemo()) disabled = true;
  const out = Math.min(max, Math.max(min, d));
  return `<div class="control${disabled ? " disabled" : ""}"><label for="${id}"><span>${esc(s.label)}</span><b id="${id}-v">${formatInput(key, value)}</b></label><input type="range" id="${id}" data-input="${key}" min="${min}" max="${max}" step="${step}" value="${out}" ${disabled ? "disabled" : ""} aria-describedby="${id}-h" aria-valuetext="${esc(formatInput(key, value))}"><small id="${id}-h">${esc(s.help)}${d !== out ? ` Current value ${formatInput(key, value)} is outside this slider’s range.` : ""}</small></div>`;
}

function numberField(key, value) {
  const s = INPUT_SPECS[key];
  const id = `lab-${key}`;
  const disabled = isDemo();
  return `<label class="ctl" for="${id}"><span>${esc(s.label)} <small>${esc(s.scale ? "%" : s.unit)}</small></span><input type="number" id="${id}" data-input="${key}" data-number="1" value="${esc(toDisplay(key, value))}" step="${s.scale ? s.step * s.scale : s.step}" min="${s.scale ? s.min * s.scale : s.min}" max="${s.scale ? s.max * s.scale : s.max}" ${disabled ? "disabled" : ""}></label>`;
}

function verdict(a, out, stored) {
  const res = out.result;
  const resolved = { ...a.profileDefaults, ...out.inputs };
  const base = baselineOf(res, resolved);
  const value = res.base[res.route];
  const flipped = stored && stored.route !== res.route;
  return `<div class="lab-verdict"><div><span class="micro">The model would choose ${tag(isDemo() ? "demo" : "live")}</span><h2>${esc(routeInfo(res.route).label)}<span aria-hidden="true">${routeInfo(res.route).symbol}</span></h2><p>${
    res.route === base.route ? `This is the baseline route.` : `${signedMoney(value - base.value)} vs ${esc(routeInfo(base.route).label.toLowerCase())} at ${money(base.value)}.`
  } ${flipped ? `<b>Different from the stored recommendation (${esc(routeInfo(stored.route).label)}).</b>` : stored ? "Same route as the stored recommendation." : ""}</p></div><div><strong>${money(value)}</strong><small>modeled net value</small></div></div>`;
}

function comparison(a, out) {
  const rows = routeTable(out.result, { ...a.profileDefaults, ...out.inputs });
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value || 0)));
  return `<div class="route-comparison" role="list" aria-label="All seven routes under these inputs">${rows
    .map(
      (r, i) =>
        `<div class="route-option ${r.recommended ? "leading" : ""} ${r.eligible ? "" : "muted"}" role="listitem"><span>${String(i + 1).padStart(2, "0")}</span><div><h3><span aria-hidden="true">${r.info.symbol}</span> ${esc(r.info.label)}</h3><small>${r.recommended ? "Chosen by the model" : r.eligible ? (r.audit[0] ? esc(r.audit[0]) : "Eligible") : esc(r.reason)}</small><i class="route-bar" style="width:${r.eligible && r.value > 0 ? (r.value / max) * 100 : 0}%" aria-hidden="true"></i></div><strong>${r.value === null ? "—" : money(r.value)}${r.stress !== null && r.stress !== r.value ? `<small>stress ${money(r.stress)}</small>` : ""}</strong></div>`,
    )
    .join("")}</div>`;
}

function flips(out) {
  const c = out.decision_confidence;
  if (!c) return "";
  if (!c.level) return `<div class="confidence"><span class="micro">What would change the answer</span><p>${esc(c.note)}</p></div>`;
  const drivers = c.drivers.filter((d) => d.move !== null);
  const level = c.level ? c.level[0].toUpperCase() + c.level.slice(1).toLowerCase() : "";
  return `<div class="confidence ${esc(c.level.toLowerCase())}"><span class="micro">What would change the answer · ${esc(level)} confidence</span>${
    drivers.length
      ? `<ul class="plain flips">${drivers
          .map((d) => {
            const parts = [d.down && `down to ${formatInput(d.input, d.down.at)} → ${routeInfo(d.down.route).label}`, d.up && `up to ${formatInput(d.input, d.up.at)} → ${routeInfo(d.up.route).label}`].filter(Boolean);
            return `<li><b>${esc(d.label)}</b> now ${formatInput(d.input, d.now)}: ${esc(parts.join("; "))}</li>`;
          })
          .join("")}</ul>`
      : "<p>No single change, within the allowed range, changes this route.</p>"
  }<small>Confidence is how far one detail has to move before the recommended route changes.</small></div>`;
}

function results(a, stored) {
  if (calc.status === "error" && !calc.out)
    return errorBlock(calc.error, { title: calc.error?.kind === "demo-unsupported" ? "Not recorded in the demo." : "The model didn’t answer." }) + (calc.error?.kind === "demo-unsupported" ? "" : `<button class="btn secondary" data-action="lab-retry">Ask the model again</button>`);
  if (!calc.out || calc.out.assetId !== a.id) return loadingBlock("Asking the model…");
  const out = calc.out;
  const warn = (out.warnings || []).length ? `<div class="warnings" role="note">${out.warnings.map((w) => `<p><b>Check:</b> ${esc(w.message)}</p>`).join("")}</div>` : "";
  const res = out.result;
  return `<div class="lab-status" aria-live="polite">${calc.status === "loading" ? `<span class="spinner" aria-hidden="true"></span> Recalculating…` : calc.status === "error" ? `<span class="field-error">${esc(calc.error?.message)}</span> Showing the last answer.` : `Updated ${dateTime(out.at)}${out.scenario ? ` · ${esc(PRESETS[out.scenario][0])}` : ""}`}</div><div class="${calc.status === "loading" ? "is-stale" : ""}">${verdict(a, out, stored)}${warn}${comparison(a, out)}<div class="economic-equation"><span><b>${money(res.daily_compute_margin, { cents: true })}</b>daily compute margin</span><span><b>${res.breakeven_utilization === null ? "None ≤ 100%" : pct(res.breakeven_utilization, 1)}</b>break-even utilization</span><span><b>${res.breakeven_dwell_days === null ? "None ≤ 365 d" : `${res.breakeven_dwell_days} days`}</b>break-even wait for yield</span></div>${flips(out)}<details class="model-details"><summary>Why the model chose this</summary><ol class="audit">${res.audit.map((l) => `<li>${esc(l)}</li>`).join("")}</ol></details></div>`;
}

function savedList(assetsById) {
  const list = store.ws.scenarios;
  if (!list.length) return `<p class="subtle">Keep a comparison to find it here later. Saved scenarios stay on this device and keep the exact inputs and model answer.</p>`;
  return `<ul class="saved-list">${list
    .slice()
    .reverse()
    .map((s) => {
      const cur = assetsById.get(s.assetId);
      const stale = s.modelVersion !== (R.meta().data?.model_version || s.modelVersion);
      return `<li><div><b>${esc(s.name)}</b><small>${esc(s.assetId)} · ${esc(s.preset === "custom" ? `Custom (${(s.edited || []).map((k) => INPUT_SPECS[k]?.label || k).join(", ") || "edited"})` : PRESETS[s.preset]?.[0] || s.preset)} · ${dateTime(s.savedAt)}</small></div><div class="saved-result">${routeChip(s.result.route)} <b>${money(s.result.base[s.result.route])}</b>${stale ? tag("historical", "Saved earlier") : ""}${cur && cur.route && cur.route !== s.storedRoute ? tag("historical", "Asset changed since") : ""}</div><div class="saved-actions"><button class="textlink" data-action="reopen" data-id="${esc(s.id)}">Reopen</button><button class="textlink" data-action="delete-scenario" data-id="${esc(s.id)}" aria-label="Delete saved scenario ${esc(s.name)}">Delete</button></div></li>`;
    })
    .join("")}</ul>`;
}

function page(route) {
  const assetsR = R.assets();
  const meta = R.meta();
  if ((assetsR.status === "error" && !assetsR.data) || (meta.status === "error" && !meta.data))
    return errorBlock((assetsR.error || meta.error), { retryKeys: ["assets", "meta"] });
  if (!assetsR.data || !meta.data) return loadingBlock();
  const rows = assetsR.data.assets;
  if (!rows.length) return emptyBlock("◌", "No assets yet.", "Upload inventory from the Fleet page, then explore it here.", `<a class="textlink" href="#fleet">Go to the fleet ↗</a>`);
  const id = pickAsset(route, rows);
  const detail = R.asset(id);
  const hist = R.history(id);
  const failed = [detail, hist].find((e) => e.status === "error" && !e.data);
  const head = heading("What-if Lab", "A little curiosity.<br><em>A clearer decision.</em>", "Play out the possibilities before you commit. Every answer is calculated for the server in front of you.");
  const demo = isDemo();
  const featured = demo ? Object.keys(getTransport()._snap?.lab || {}) : null;
  const options = rows
    .map(adaptAssetRow)
    .map((x) => `<option value="${esc(x.id)}" ${x.id === id ? "selected" : ""} ${featured && !featured.includes(x.id) ? "disabled" : ""}>${esc(hardwareTitle(x))} · ${esc(x.id)}${featured && !featured.includes(x.id) ? " (Live only)" : ""}</option>`)
    .join("");
  const assetSelect = `<label for="labasset">Choose your asset</label><select id="labasset" data-lab-asset>${options}</select>`;
  if (failed) return head + `<div class="labgrid studio-lab"><section class="lab-controls">${assetSelect}</section><section class="lab-output">${errorBlock(failed.error, { retryKeys: [`asset:${id}`, `history:${id}`] })}</section></div>`;
  if (!detail.data || !hist.data) return head + `<div class="labgrid studio-lab"><section class="lab-controls">${assetSelect}</section><section class="lab-output">${loadingBlock(`Loading ${id}…`)}</section></div>`;

  const a = adaptAssetDetail(detail.data, { meta: meta.data, history: hist.data });
  const base = baseInputsFor(a, meta.data);
  const draft = draftFor(id, base);
  schedule(id, draft, base);
  const shown = draft.preset === "bear" || draft.preset === "bull" ? (calc.out?.assetId === id && calc.out.preset === draft.preset ? calc.out.inputs : base) : draft.inputs;
  const resolved = { ...a.profileDefaults, ...shown };
  const grid = demo ? getTransport()._snap?.lab?.[id]?.grids : null;
  const stored = a.recommendation ? { route: a.route, id: a.recommendation.id } : null;
  const changed = changedKeys(base, draft.inputs);
  const failedServer = resolved.health_pass === false;
  const assetsById = new Map(rows.map((r) => [r.asset_id, r]));

  return (
    contextStrip([`${esc(id)}`, a.recommendation ? `Stored recommendation #${a.recommendation.id}: ${esc(a.routeInfo.label)}` : "No stored recommendation"]) +
    head +
    `<div class="lab-presets" role="group" aria-label="Scenario preset"><span class="micro">Start with a possibility</span>${Object.entries(PRESETS)
      .map(([k, [label, help]]) => `<button data-action="preset" data-preset="${k}" aria-pressed="${draft.preset === k}" title="${esc(help)}">${label}</button>`)
      .join("")}<button aria-pressed="${draft.preset === "custom"}" disabled class="custom-indicator">${draft.preset === "custom" ? "Custom" : "Custom (edit any input)"}</button></div>
    <p class="preset-help">${esc(draft.preset === "custom" ? `Custom: ${changed.length ? changed.map((k) => INPUT_SPECS[k]?.label || k).join(", ") + " changed from the asset’s inputs." : "no inputs changed yet."}` : PRESETS[draft.preset][1])}${demo ? " In the demo, try one change at a time." : ""}</p>
    <div class="labgrid studio-lab"><section class="lab-controls"><span class="micro">The inputs / Your call</span>${assetSelect}<p class="lab-asset-note">${esc(a.model || "")} · ${esc(a.stateInfo.label)}${a.terminal ? " · final state: what-if only" : ""}</p>
    ${SLIDER_KEYS.map((k) => control(k, resolved[k], { demoGridValues: grid?.[k] ? Object.keys(grid[k]).map(Number) : null }))
      .join("")}
    <details class="model-details"><summary>More inputs</summary><div class="input-grid">${[...ADVANCED_KEYS, ...(failedServer ? REPAIR_KEYS : [])].map((k) => numberField(k, resolved[k])).join("")}</div><p id="lab-field-error" class="field-error" role="alert"></p></details>
    <div class="lab-buttons"><button class="btn" data-action="save-scenario" ${calc.out?.assetId === id && calc.status === "ready" ? "" : "disabled"}>Keep this comparison +</button><button class="btn secondary" data-action="reset-draft" ${draft.preset === "base" && !changed.length ? "disabled" : ""}>Back to the asset’s inputs</button></div>
    ${!a.terminal && draft.preset !== "base" ? `<button class="textlink" data-action="apply" ${demo ? "disabled" : ""}>Apply these inputs to ${esc(id)} ↗</button>${demo ? `<small class="subtle">Applying inputs needs Live mode.</small>` : ""}` : ""}
    <p class="subtle">Move a slider and the answer updates. Nothing is saved to the asset unless you apply it.</p></section>
    <section class="lab-output"><div id="labresults">${results(a, stored)}</div><section class="saved-comparisons" aria-labelledby="saved-h"><div class="panelhead"><h2 id="saved-h">Your saved possibilities</h2><small>On this device</small></div>${savedList(assetsById)}</section></section></div>`
  );
}

function ctx(route) {
  const rows = R.assets().data?.assets || [];
  const id = pickAsset(route, rows);
  const d = R.asset(id).data;
  const h = R.history(id).data;
  const meta = R.meta().data;
  if (!d || !h || !meta) return null;
  const a = adaptAssetDetail(d, { meta, history: h });
  const base = baseInputsFor(a, meta);
  return { id, a, base, draft: draftFor(id, base) };
}

function saveDraft(id, draft) {
  store.update((ws) => (ws.labDrafts[id] = { preset: draft.preset, inputs: draft.inputs, edited: draft.edited }));
}

const view = {
  title: "What-if Lab",
  render(route) {
    return page(route);
  },
  after(root, route) {
    const id = pickAsset(route, R.assets().data?.assets || []);
    if (id) store.ws.focusAssetId !== id && store.update((ws) => (ws.focusAssetId = id));
  },
  leave() {
    calc.controller?.abort();
    clearTimeout(calc.timer);
    calc.key = null;
  },
  actions: {
    preset: (el, e, route) => {
      const c = ctx(route);
      if (!c) return;
      const p = el.dataset.preset;
      saveDraft(c.id, { preset: p, inputs: {}, edited: [] });
      rerender();
    },
    "reset-draft": (el, e, route) => {
      const c = ctx(route);
      if (!c) return;
      store.update((ws) => delete ws.labDrafts[c.id]);
      rerender();
    },
    "save-scenario": (el, e, route) => {
      const c = ctx(route);
      if (!c || !calc.out) return;
      const out = calc.out;
      const name = `${routeInfo(out.result.route).label} · ${c.draft.preset === "custom" ? "Custom" : PRESETS[c.draft.preset][0]}`;
      store.update((ws) =>
        ws.scenarios.push({
          id: uid(),
          name,
          assetId: c.id,
          preset: c.draft.preset,
          edited: c.draft.edited,
          inputs: out.inputs,
          sentInputs: c.draft.preset === "custom" ? c.draft.inputs : c.base,
          scenario: out.scenario || null,
          result: out.result,
          decisionConfidence: out.decision_confidence || null,
          modelVersion: out.model_version,
          savedAt: new Date().toISOString(),
          recommendationId: c.a.recommendation?.id ?? null,
          storedRoute: c.a.route,
          mode: getTransport()?.mode,
        }),
      );
      toast(`Saved “${name}” on this device.`);
      rerender();
    },
    reopen: (el) => {
      const s = store.ws.scenarios.find((x) => x.id === el.dataset.id);
      if (!s) return;
      store.update((ws) => (ws.labDrafts[s.assetId] = s.preset === "custom" ? { preset: "custom", inputs: s.sentInputs, edited: s.edited } : { preset: s.preset, inputs: {}, edited: [] }));
      location.hash = `#lab?asset=${encodeURIComponent(s.assetId)}`;
      toast(`Reopened “${s.name}”. The model reruns on today’s version; the saved answer is kept as it was.`);
      rerender();
    },
    "lab-retry": () => {
      calc.key = null;
      rerender();
    },
    "delete-scenario": (el) => {
      store.update((ws) => (ws.scenarios = ws.scenarios.filter((x) => x.id !== el.dataset.id)));
      rerender();
    },
    apply: async (el, e, route) => {
      const c = ctx(route);
      if (!c || !calc.out) return;
      const target = calc.out.inputs;
      const changes = Object.fromEntries(changedKeys(c.base, target).filter((k) => k in target).map((k) => [k, target[k]]));
      if (!Object.keys(changes).length) return toast("These inputs match the asset already.");
      const { confirmed } = await confirmDialog({
        title: `Save these inputs to ${c.id}?`,
        body: `<p class="subtext">${esc(c.id)}’s saved inputs change and the model runs again. The current recommendation stays in history.</p><ul class="plain">${Object.entries(changes)
          .map(([k, v]) => `<li>${esc(INPUT_SPECS[k]?.label || k)}: ${formatInput(k, c.base[k] ?? c.a.resolved[k])} → <b>${formatInput(k, v)}</b></li>`)
          .join("")}</ul>${calc.out.scenario ? `<p class="choice-note">These are the ${esc(calc.out.scenario)}-scenario values. Saving them makes them the asset’s own inputs.</p>` : ""}`,
        confirmLabel: "Save and rerun",
      });
      if (!confirmed) return;
      const res = await patchInputs(c.id, changes);
      store.update((ws) => delete ws.labDrafts[c.id]);
      toast(`${c.id}: new recommendation #${res.recommendation.id}, ${routeInfo(res.route).label} at ${money(res.route_value)}.`);
    },
  },
  onInput(e, route) {
    const key = e.target.dataset?.input;
    if (!key || e.target.dataset.number) return;
    const label = document.querySelector(`#lab-${key}-v`);
    const v = fromDisplay(key, e.target.value);
    if (label) label.textContent = formatInput(key, v);
    e.target.setAttribute("aria-valuetext", formatInput(key, v));
    edit(route, key, v);
  },
  onChange(e, route) {
    if (e.target.matches("[data-lab-asset]")) {
      calc.out = null;
      location.hash = `#lab?asset=${encodeURIComponent(e.target.value)}`;
      return;
    }
    const key = e.target.dataset?.input;
    if (!key) return;
    const v = fromDisplay(key, e.target.value);
    const msg = e.target.value === "" ? `${INPUT_SPECS[key].label} is required` : validateInput(key, v);
    const err = document.querySelector("#lab-field-error");
    if (msg) {
      if (err) err.textContent = msg;
      e.target.setAttribute("aria-invalid", "true");
      return;
    }
    if (err) err.textContent = "";
    e.target.removeAttribute("aria-invalid");
    edit(route, key, v);
    rerender();
  },
};

function edit(route, key, v) {
    const c = ctx(route);
    if (!c) return;
    let draft = applyEdit(c.draft, key, v, calc.out?.assetId === c.id && calc.out.preset === c.draft.preset ? calc.out.inputs : null);
    if (isDemo()) draft = { preset: "custom", inputs: { ...c.base, [key]: v }, edited: [key] };
    saveDraft(c.id, draft);
    schedule(c.id, draft, c.base);
    const status = document.querySelector(".lab-status");
    if (status) status.innerHTML = `<span class="spinner" aria-hidden="true"></span> Recalculating…`;
}

export default view;
