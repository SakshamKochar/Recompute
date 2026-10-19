import { beforeEach, describe, expect, it } from "vitest";
import { store } from "../../src/state/store.js";
import { adaptAssetDetail, adaptAssetRow } from "../../src/lib/adapters.js";
import { fleetRows } from "../../src/views/fleet.js";
import { opportunities } from "../../src/views/overview.js";
import { moveFor, strategyRoute } from "../../src/views/command.js";
import { applyEdit, baseInputsFor, draftFor } from "../../src/views/lab.js";
import { flipTarget } from "../../src/views/replay.js";
import { laneSignals } from "../../src/views/market.js";
import { assetRows, detail, history, meta, responses } from "./fixtures.js";

beforeEach(() => store._reset());

describe("fleet rows", () => {
  it("filters by search, route, state and batch", () => {
    expect(fleetRows(assetRows, { query: "shauryaa" }).map((a) => a.id)).toEqual(["DEMO-SHAURYAA"]);
    const repair = fleetRows(assetRows, { route: "REPAIR" });
    expect(repair.length).toBe(responses["GET /dashboard"].by_route.REPAIR);
    expect(fleetRows(assetRows, { batch: "DEMO-SELLERS" })).toHaveLength(4);
    expect(fleetRows(assetRows, { state: "SOLD" }).every((a) => a.state === "SOLD")).toBe(true);
  });
  it("sorts by gain, then ID", () => {
    const rows = fleetRows(assetRows, { sort: "gain" });
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].gain >= rows[i].gain).toBe(true);
  });
  it("overlays a bear scenario with the batch endpoint's own values", () => {
    const bear = responses["GET /batches/SYN-FLEET?scenario=bear"];
    const rows = fleetRows(assetRows, { batch: "SYN-FLEET" }, { ...bear, scenario: "bear" });
    const one = rows.find((r) => r.id === bear.assets[0].asset_id);
    expect(one.routeValue).toBe(bear.assets[0].route_value);
    expect(one.route).toBe(bear.assets[0].route);
    expect(one.base.routeValue).toBe(assetRows.find((r) => r.asset_id === one.id).route_value);
  });
});

describe("overview opportunities", () => {
  it("only lists open assets that beat their baseline, awaiting-decision first", () => {
    const opp = opportunities(assetRows.map(adaptAssetRow));
    expect(opp.length).toBeGreaterThan(0);
    expect(opp.every((a) => !a.terminal && a.route !== a.baselineRoute && a.gain > 0)).toBe(true);
    const firstNonReceived = opp.findIndex((a) => a.state !== "RECEIVED");
    if (firstNonReceived >= 0) expect(opp.slice(firstNonReceived).every((a) => a.state !== "RECEIVED")).toBe(true);
  });
  it("is empty when nothing beats the baseline", () => {
    expect(opportunities([])).toEqual([]);
  });
});

describe("fleet command strategies", () => {
  const shauryaa = adaptAssetRow(assetRows.find((r) => r.asset_id === "DEMO-SHAURYAA"));
  const kabirRow = assetRows.find((r) => r.asset_id === "SYN-031") || assetRows.find((r) => r.route === "REPAIR");
  it("follows the model or the baseline without computing values", () => {
    expect(strategyRoute(shauryaa, "model")).toEqual({ route: "SELL NOW", value: shauryaa.routeValue });
    const k = adaptAssetRow(kabirRow);
    expect(strategyRoute(k, "capital")).toEqual({ route: k.baselineRoute, value: k.baselineValue });
  });
  it("keeps earning only on an eligible compute route, using that route's model value", () => {
    const d = detail("DEMO-SHAURYAA");
    const pick = strategyRoute(shauryaa, "earn", d);
    expect(d.recommendation.result.eligible).toContain(pick.route);
    expect(pick.value).toBe(d.recommendation.result.base[pick.route]);
    expect(strategyRoute(shauryaa, "earn", null)).toMatchObject({ pending: true });
  });
  it("classifies moves by the backend's allowed and override events", () => {
    const a = { allowedEvents: ["list"], overrideEvents: ["harvest", "recycle"] };
    expect(moveFor(a, "HOST LONGER")).toEqual({ event: "list", kind: "allowed" });
    expect(moveFor(a, "HARVEST")).toEqual({ event: "harvest", kind: "override" });
    expect(moveFor(a, "REPAIR")).toEqual({ event: "repair", kind: "blocked" });
  });
});

describe("what-if lab drafts", () => {
  const a = adaptAssetDetail(detail("DEMO-SHAURYAA"), { meta, history: history("DEMO-SHAURYAA") });
  const base = baseInputsFor(a, meta);
  it("sends only inputs the API accepts", () => {
    const allowed = new Set(["asset_profile", ...Object.keys(meta.profiles.a100_8x)]);
    expect(Object.keys(base).every((k) => allowed.has(k))).toBe(true);
    expect(base.offer_today).toBe(detail("DEMO-SHAURYAA").inputs.offer_today);
  });
  it("switches a preset to Custom on the first edit, keeping the preset's inputs", () => {
    const bear = { preset: "bear", inputs: base, edited: [] };
    const bearInputs = { ...base, utilization: 0.4, elec_per_kwh: 0.1354 };
    const next = applyEdit(bear, "dwell_days", 90, bearInputs);
    expect(next.preset).toBe("custom");
    expect(next.inputs).toMatchObject({ utilization: 0.4, elec_per_kwh: 0.1354, dwell_days: 90 });
    expect(next.edited).toEqual(["dwell_days"]);
    expect(applyEdit(next, "utilization", 0.5).edited).toEqual(["dwell_days", "utilization"]);
  });
  it("restores a saved draft per mode", () => {
    store.setMode("live");
    store.update((ws) => (ws.labDrafts["DEMO-SHAURYAA"] = { preset: "custom", inputs: { utilization: 0.8 }, edited: ["utilization"] }));
    expect(draftFor("DEMO-SHAURYAA", base)).toMatchObject({ preset: "custom", inputs: { utilization: 0.8 } });
    store.setMode("demo");
    expect(draftFor("DEMO-SHAURYAA", base).preset).toBe("base");
  });
});

describe("workspace store", () => {
  it("keeps Live and Demo work apart and survives a reload", async () => {
    store.setMode("live");
    store.update((ws) => ws.scenarios.push({ id: "x" }));
    store.setMode("demo");
    expect(store.ws.scenarios).toEqual([]);
    store.setMode("live");
    const saved = JSON.parse(localStorage.getItem("recompute.workspace.v2"));
    expect(saved.live.scenarios).toEqual([{ id: "x" }]);
    store.clearWorkspace();
    expect(store.ws.scenarios).toEqual([]);
  });
});

describe("decision replay", () => {
  it("targets the nearer flip point, snapped to recorded values in Demo", () => {
    const d = { input: "utilization", now: 0.6, down: null, up: { at: 0.718, route: "HOST LONGER" } };
    expect(flipTarget(d)).toEqual({ value: 0.718, route: "HOST LONGER", dir: 1 });
    expect(flipTarget(d, [0.6, 0.65, 0.7, 0.75, 0.8])).toMatchObject({ value: 0.75, snapped: true });
    expect(flipTarget({ input: "x", now: 1, down: null, up: null })).toBeNull();
  });
});

describe("market signals", () => {
  it("picks the biggest open uplift per lane, from model values only", () => {
    const rows = assetRows.map(adaptAssetRow);
    const sig = laneSignals(rows);
    expect(sig.map((s) => s.lane.key)).toEqual(["earn", "exit", "recover"]);
    for (const s of sig) if (s.asset) expect(s.lane.routes).toContain(s.asset.route);
  });
});
