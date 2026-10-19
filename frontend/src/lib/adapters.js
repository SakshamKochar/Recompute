/**
 * Adapters from backend responses to view models. They rename and group fields and attach provenance
 * labels; they never compute a route, a value or an eligibility rule of their own.
 */
import { ROUTE_ORDER, routeInfo } from "./routes.js";
import { isInMotion, isTerminal, stateInfo } from "./lifecycle.js";

const PROFILE_LABEL = { a100_8x: "8× A100 server profile", h100_8x: "8× H100 server profile" };

/** "8x A100 80GB" -> { count: 8, gpu: "A100", memory: "80GB" }. Returns null when the text doesn't say. */
export function parseHardware(model) {
  if (!model) return null;
  const m = String(model).match(/(?:(\d+)\s*[x×]\s*)?(?:NVIDIA\s+)?([A-Z]{0,4}\d{2,4}[A-Z]?)\s*(\d+\s*GB)?/i);
  if (!m) return null;
  return {
    count: m[1] ? Number(m[1]) : null,
    gpu: m[2].toUpperCase(),
    memory: m[3] ? m[3].replace(/\s+/g, "").toUpperCase() : null,
  };
}

export function hardwareTitle(asset) {
  const hw = asset.hardware;
  if (!hw) return asset.model || "Unnamed server";
  return [hw.gpu, hw.memory].filter(Boolean).join(" ");
}

export function profileLabel(p) {
  return PROFILE_LABEL[p] || p || "Unknown profile";
}

export function adaptAssetRow(row) {
  return {
    id: row.asset_id,
    model: row.model,
    hardware: parseHardware(row.model),
    grade: row.grade ?? null,
    ageMonths: row.age_months ?? null,
    site: row.site ?? null,
    failedPart: row.failed_part ?? null,
    synthetic: !!row.synthetic,
    batchId: row.batch_id ?? null,
    state: row.state,
    stateInfo: stateInfo(row.state),
    terminal: isTerminal(row.state),
    inMotion: isInMotion(row.state),
    profile: row.asset_profile,
    failed: !!row.failed,
    route: row.route,
    routeInfo: routeInfo(row.route),
    afterRepair: row.after_repair ?? null,
    baselineRoute: row.baseline_route,
    routeValue: row.route_value,
    baselineValue: row.sell_now_value,
    gain: row.gain_vs_baseline,
    warnings: row.warnings || [],
    allowedEvents: row.allowed_events || [],
    overrideEvents: row.override_events || [],
    selectedRoute: row.selected_route ?? null,
    updatedAt: row.updated_at,
  };
}

/** Which audit line explains each route, matched by the route name that starts the line. */
export function auditByRoute(audit = []) {
  const out = {};
  for (const line of audit) {
    for (const r of ROUTE_ORDER) {
      if (line.startsWith(r + " ") || line.startsWith(r + ":")) (out[r] ||= []).push(line);
    }
  }
  return out;
}

/** Why a route is not in the model's eligible set, from the audit trail and the documented model rules. */
export function ineligibleReason(route, result, resolved) {
  const audit = result?.audit || [];
  const find = (needle) => audit.find((l) => l.includes(needle));
  const failed = resolved && resolved.health_pass === false;
  if (failed) {
    if (route === "REPAIR") return find("no replaceable part") || "No replaceable part was identified, so repair is not modeled.";
    if (["SELL NOW", "LIST AND WAIT", "YIELD WHILE LISTED", "HOST LONGER"].includes(route))
      return "The server failed diagnostics, so the model only weighs repair, harvest and recycle. A repaired server is routed again as healthy.";
  } else {
    if (route === "REPAIR") return "Repair is only modeled for a server that failed diagnostics.";
    if (route === "HARVEST" || route === "RECYCLE")
      return "A fallback for failed hardware. A server that passed diagnostics is routed among sale and compute routes.";
    if (route === "YIELD WHILE LISTED" || route === "HOST LONGER") {
      const consigned = find("Consigned");
      if (consigned) return consigned;
      if (route === "YIELD WHILE LISTED") return find("could lose the sale") || "Not eligible under the current inputs.";
    }
  }
  return "Not in the model’s eligible set for these inputs.";
}

/** All seven routes from one model result, ranked eligible-first by value. */
export function routeTable(result, resolved, { baselineRoute } = {}) {
  if (!result) return [];
  const eligible = new Set(result.eligible || []);
  const audits = auditByRoute(result.audit);
  const rows = ROUTE_ORDER.map((r) => ({
    route: r,
    info: routeInfo(r),
    value: result.base?.[r] ?? null,
    stress: result.stress?.[r] ?? null,
    eligible: eligible.has(r),
    recommended: result.route === r,
    baseline: baselineRoute === r,
    audit: audits[r] || [],
    reason: eligible.has(r) ? null : ineligibleReason(r, result, resolved),
  }));
  return rows.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    return (b.value ?? -Infinity) - (a.value ?? -Infinity);
  });
}

/** Baseline route exactly as app/fleet.py summarize() defines it, for results that come back without one. */
export function baselineOf(result, resolved) {
  if (!result) return null;
  if (resolved?.health_pass === false) {
    const route = result.base.HARVEST >= result.base.RECYCLE ? "HARVEST" : "RECYCLE";
    return { route, value: result.base[route] };
  }
  return { route: "SELL NOW", value: result.base["SELL NOW"] };
}

export function adaptDiagnostics(d) {
  if (!d) return { assessed: false };
  const gpuCount = d.gpu_verdicts?.length ?? null;
  return {
    assessed: true,
    simulated: !!d.simulated,
    grade: d.grade,
    score: d.score,
    evidenceConfidence: d.evidence_confidence,
    runLevel: d.run_level,
    pricedAtGrade: d.priced_at_grade,
    workingGpus: d.working_gpus,
    totalGpus: gpuCount,
    failedGpus: d.failed_gpus || [],
    chassisFaults: d.chassis_faults || [],
    unpricedFaults: d.unpriced_faults || [],
    findings: d.findings || [],
    actions: d.actions || [],
    deductions: d.deductions || [],
    testsMissing: d.tests_missing || [],
    caps: d.caps || [],
    capReason: d.cap_reason,
    gpuVerdicts: d.gpu_verdicts || [],
    pricing: d.pricing || null,
    sources: d.provenance?.sources || [],
  };
}

/**
 * The inputs the model actually ran on for the latest recommendation, from history when available
 * (authoritative), otherwise the stored inputs plus the backend's own reported adjustments.
 */
export function effectiveInputs(detail, history) {
  const recs = (history?.events || []).filter((e) => e.type === "recommendation");
  if (recs.length) return { ...recs[recs.length - 1].inputs };
  const out = { ...(detail.inputs || {}) };
  if (detail.model_adjustments?.rental_rate !== undefined) out.rental_rate = detail.model_adjustments.rental_rate;
  Object.assign(out, detail.repair_pricing?.filled || {});
  return out;
}

/** Provenance of each resolved input: recorded on the asset, filled by the backend, or a profile default. */
export function resolveInputs(effective, meta, detail) {
  const profile = effective.asset_profile || "a100_8x";
  const defaults = meta?.profiles?.[profile] || {};
  const resolved = { ...defaults, ...effective };
  const recorded = detail?.inputs || {};
  const filled = { ...(detail?.repair_pricing?.filled || {}) };
  if (detail?.model_adjustments?.rental_rate !== undefined) filled.rental_rate = detail.model_adjustments.rental_rate;
  const source = {};
  for (const k of Object.keys(resolved)) {
    source[k] = k in recorded ? "recorded" : k in filled ? "backend" : k in effective ? "recorded" : "default";
  }
  return { resolved, source, profile, defaults };
}

export function adaptAssetDetail(detail, { meta = null, history = null } = {}) {
  const row = adaptAssetRow(detail);
  const effective = effectiveInputs(detail, history);
  const { resolved, source, defaults } = resolveInputs(effective, meta, detail);
  const rec = detail.recommendation;
  const result = rec?.result || null;
  return {
    ...row,
    recordedInputs: detail.inputs || {},
    effectiveInputs: effective,
    resolved,
    inputSource: source,
    profileDefaults: defaults,
    recommendation: rec ? { id: rec.id, modelVersion: rec.model_version, createdAt: rec.created_at, result } : null,
    routes: routeTable(result, resolved, { baselineRoute: row.baselineRoute }),
    confidence: detail.decision_confidence || null,
    diagnostics: adaptDiagnostics(detail.diagnostics),
    repairPricing: detail.repair_pricing || null,
    modelAdjustments: detail.model_adjustments || null,
    outcome: detail.outcome || null,
  };
}

/** Split history into typed, chronological entries, and mark each route change between recommendations. */
export function adaptHistory(history) {
  const events = history?.events || [];
  let prevRoute = null;
  let prevInputs = null;
  return events.map((e) => {
    if (e.type === "recommendation") {
      const changedRoute = prevRoute !== null && prevRoute !== e.route;
      const changedInputs = prevInputs
        ? Object.keys({ ...prevInputs, ...e.inputs }).filter((k) => JSON.stringify(prevInputs[k]) !== JSON.stringify(e.inputs[k]))
        : [];
      const out = { ...e, previousRoute: prevRoute, routeChanged: changedRoute, changedInputs };
      prevRoute = e.route;
      prevInputs = e.inputs;
      return out;
    }
    return { ...e };
  });
}

/**
 * Four distinct decision states. Recommended comes from the model, Selected only from what a person
 * recorded (or a clearly labelled local draft), Executed from transitions, Completed from a final state.
 */
export function decisionStates(asset, history, draftSelection = null) {
  const transitions = (history?.events || []).filter((e) => e.type === "transition" && e.event !== "received");
  const last = transitions[transitions.length - 1] || null;
  const completed = asset.terminal ? [...transitions].reverse().find((t) => t.to_state === asset.state) || null : null;
  return {
    recommended: asset.route ? { route: asset.route, value: asset.routeValue, recommendationId: asset.recommendation?.id } : null,
    selected: asset.selectedRoute
      ? { route: asset.selectedRoute, recorded: true }
      : draftSelection
        ? { route: draftSelection, recorded: false }
        : null,
    executed: last ? { event: last.event, state: last.to_state, at: last.at, override: last.override } : null,
    completed: completed ? { state: completed.to_state, at: completed.at } : null,
  };
}
