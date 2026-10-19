import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { adaptAssetDetail, adaptAssetRow, adaptHistory, baselineOf, decisionStates, parseHardware, resolveInputs, routeTable } from "../../src/lib/adapters.js";
import { ROUTE_ORDER, ROUTES, routeInfo } from "../../src/lib/routes.js";
import { changedKeys, fromDisplay, INPUT_SPECS, toDisplay, validateInput } from "../../src/lib/inputs.js";
import { assetRows, detail, history, meta } from "./fixtures.js";

describe("routes", () => {
  it("covers exactly the backend's seven routes", () => {
    expect(ROUTE_ORDER).toEqual(["SELL NOW", "LIST AND WAIT", "YIELD WHILE LISTED", "HOST LONGER", "REPAIR", "HARVEST", "RECYCLE"]);
    expect(Object.keys(ROUTES).sort()).toEqual([...ROUTE_ORDER].sort());
  });
  it("maps each route to the backend's first lifecycle event", () => {
    expect(ROUTE_ORDER.map((r) => routeInfo(r).firstEvent)).toEqual(["list", "list", "list", "list", "repair", "harvest", "recycle"]);
  });
  it("falls back for unknown routes without inventing one", () => {
    expect(routeInfo(null).label).toBe("Not assessed");
    expect(routeInfo("NEW ROUTE").firstEvent).toBeNull();
  });
});

describe("hardware parsing", () => {
  it("reads count, GPU and memory", () => {
    expect(parseHardware("8x A100 80GB")).toEqual({ count: 8, gpu: "A100", memory: "80GB" });
    expect(parseHardware("NVIDIA H100")).toEqual({ count: null, gpu: "H100", memory: null });
    expect(parseHardware(null)).toBeNull();
  });
});

describe("asset adapters", () => {
  it("keeps backend values exactly", () => {
    const row = assetRows.find((r) => r.asset_id === "DEMO-SHAURYAA");
    const a = adaptAssetRow(row);
    expect(a.routeValue).toBe(row.route_value);
    expect(a.gain).toBe(row.gain_vs_baseline);
    expect(a.allowedEvents).toEqual(row.allowed_events);
  });
  it("builds a seven-route table from the model result, recommended first", () => {
    const d = detail("DEMO-SHAURYAA");
    const t = routeTable(d.recommendation.result, { health_pass: true }, { baselineRoute: "SELL NOW" });
    expect(t).toHaveLength(7);
    expect(t[0].recommended).toBe(true);
    expect(t[0].value).toBe(d.recommendation.result.base[t[0].route]);
    for (const r of t) expect(r.eligible).toBe(d.recommendation.result.eligible.includes(r.route));
    expect(t.filter((r) => !r.eligible).every((r) => r.reason)).toBe(true);
  });
  it("computes the baseline the way fleet.summarize does", () => {
    const res = { base: { "SELL NOW": 10, HARVEST: 5, RECYCLE: 7 } };
    expect(baselineOf(res, { health_pass: true })).toEqual({ route: "SELL NOW", value: 10 });
    expect(baselineOf(res, { health_pass: false })).toEqual({ route: "RECYCLE", value: 7 });
  });
  it("labels input provenance", () => {
    const d = detail("DEMO-SHAURYAA");
    const { source, resolved } = resolveInputs(d.inputs, meta, d);
    expect(source.offer_today).toBe("recorded");
    expect(source.utilization).toBe("default");
    expect(resolved.utilization).toBe(meta.profiles.a100_8x.utilization);
  });
  it("never invents diagnostics for an asset without a capture", () => {
    const syn = adaptAssetDetail(detail("SYN-003"), { meta, history: history("SYN-003") });
    expect(syn.diagnostics).toEqual({ assessed: false });
    const demo = adaptAssetDetail(detail("DEMO-SHAURYAA"), { meta, history: history("DEMO-SHAURYAA") });
    expect(demo.diagnostics.assessed).toBe(true);
    expect(demo.diagnostics.simulated).toBe(true);
  });
});

describe("decision states", () => {
  it("keeps recommended, selected, executed and completed distinct", () => {
    const a = adaptAssetDetail(detail("DEMO-SHAURYAA"), { meta, history: history("DEMO-SHAURYAA") });
    const fresh = decisionStates(a, history("DEMO-SHAURYAA"));
    expect(fresh.recommended.route).toBe("SELL NOW");
    expect(fresh.selected).toBeNull();
    expect(fresh.executed).toBeNull();
    expect(fresh.completed).toBeNull();
    const draft = decisionStates(a, history("DEMO-SHAURYAA"), "HOST LONGER");
    expect(draft.selected).toEqual({ route: "HOST LONGER", recorded: false });
    expect(draft.executed).toBeNull();
  });
  it("reads an override and a completed sale from history", () => {
    const sold = adaptAssetRow(assetRows.find((r) => r.state === "SOLD"));
    const ds = decisionStates({ ...sold, recommendation: null }, history(sold.id));
    expect(ds.completed.state).toBe("SOLD");
    expect(ds.executed.event).toBe("sell");
    const overridden = assetRows.find((r) => r.state === "ACTIVATING");
    const h = history(overridden.asset_id);
    const ods = decisionStates(adaptAssetRow(overridden), h);
    expect(ods.executed.override).toBe(true);
    expect(ods.selected).toMatchObject({ recorded: true });
  });
  it("marks route changes between recommendations", () => {
    const h = { events: [
      { type: "recommendation", id: 1, route: "SELL NOW", inputs: { utilization: 0.6 } },
      { type: "recommendation", id: 2, route: "HOST LONGER", inputs: { utilization: 0.8 } },
    ] };
    const out = adaptHistory(h);
    expect(out[1]).toMatchObject({ routeChanged: true, previousRoute: "SELL NOW", changedInputs: ["utilization"] });
  });
});

describe("input conversion", () => {
  it("round-trips display units", () => {
    expect(toDisplay("utilization", 0.6)).toBe(60);
    expect(fromDisplay("utilization", 60)).toBeCloseTo(0.6);
    expect(fromDisplay("horizon_months", 12.4)).toBe(12);
    expect(toDisplay("dwell_days", 43)).toBe(43);
  });
  it("validates against the backend schema ranges", () => {
    expect(validateInput("utilization", 1.2)).toMatch(/between/);
    expect(validateInput("utilization", 0.5)).toBeNull();
    expect(validateInput("horizon_months", 2.5)).toMatch(/whole/);
    expect(validateInput("dwell_days", NaN)).toMatch(/number/);
  });
  it("mirrors every range declared in backend/app/schema.py", () => {
    const schema = readFileSync(resolve(process.cwd(), "../backend/app/schema.py"), "utf8");
    const moneyMax = Number(schema.match(/^MONEY_MAX = ([\d.e_]+)/m)[1].replace(/_/g, ""));
    let checked = 0;
    for (const [key, spec] of Object.entries(INPUT_SPECS)) {
      const m = schema.match(new RegExp(`^\\s+${key}: (?:Optional\\[\\w+\\]|Money) = Field\\(None(?:, ge=([\\d.e]+))?(?:, le=([\\w.]+))?`, "m"));
      if (m?.[2] === "MONEY_MAX") m[2] = String(moneyMax);
      expect(m, `${key} in schema.py`).not.toBeNull();
      if (m[1] !== undefined) expect(spec.min, `${key} min`).toBe(Number(m[1]));
      if (m[2] !== undefined) expect(spec.max, `${key} max`).toBe(Number(m[2]));
      checked++;
    }
    expect(checked).toBe(Object.keys(INPUT_SPECS).length);
  });
  it("detects changed keys with float tolerance", () => {
    expect(changedKeys({ a: 0.1 + 0.2, b: "x" }, { a: 0.3, b: "y" })).toEqual(["b"]);
  });
});
