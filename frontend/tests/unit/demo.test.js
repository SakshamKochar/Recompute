import { describe, expect, it } from "vitest";
import { createDemoTransport, snapshotKey } from "../../src/api/demo.js";
import { snapshot } from "./fixtures.js";

const t = () => createDemoTransport({ snapshot });

describe("demo transport", () => {
  it("maps requests to recorded keys", () => {
    expect(snapshotKey("/assets/SYN-001")).toBe("GET /assets/SYN-001");
    expect(snapshotKey("/batches/SYN-FLEET", { scenario: "bear" })).toBe("GET /batches/SYN-FLEET?scenario=bear");
    expect(snapshotKey("/batches/SYN-FLEET")).toBe("GET /batches/SYN-FLEET?scenario=base");
  });
  it("serves recorded responses as copies", async () => {
    const tr = t();
    const a = await tr.request("GET", "/dashboard");
    a.total_assets = -1;
    expect((await tr.request("GET", "/dashboard")).total_assets).toBe(snapshot.responses["GET /dashboard"].total_assets);
  });
  it("refuses every write", async () => {
    for (const [m, p] of [["POST", "/assets/SYN-001/events"], ["PATCH", "/assets/SYN-001/inputs"], ["POST", "/assets/upload"], ["POST", "/demo/reset"]]) {
      await expect(t().request(m, p)).rejects.toMatchObject({ kind: "demo-readonly" });
    }
  });
  it("404s unknown assets and flags unrecorded views", async () => {
    await expect(t().request("GET", "/assets/NOPE")).rejects.toMatchObject({ status: 404 });
    await expect(t().request("GET", "/fleet")).rejects.toMatchObject({ kind: "demo-unsupported" });
  });
  it("answers /recommend only from recorded model runs", async () => {
    const tr = t();
    const base = await tr.request("POST", "/recommend", { demo: { assetId: "DEMO-SHAURYAA", scenario: "base" } });
    expect(base.result.route).toBe("SELL NOW");
    const busy = await tr.request("POST", "/recommend", { demo: { assetId: "DEMO-SHAURYAA", dial: "utilization", value: 0.8 } });
    expect(busy.result.route).toBe("HOST LONGER");
    expect(busy.inputs.utilization).toBe(0.8);
    const days = await tr.request("POST", "/recommend", { demo: { assetId: "DEMO-SHAURYAA", dial: "dwell_days", value: 15 } });
    expect(days.result).toEqual(snapshot.lab["DEMO-SHAURYAA"].grids.dwell_days["15.0"].result);
    await expect(tr.request("POST", "/recommend", { demo: { assetId: "DEMO-SHAURYAA", dial: "utilization", value: 0.81 } })).rejects.toMatchObject({ kind: "demo-unsupported" });
    await expect(tr.request("POST", "/recommend", { demo: { assetId: "SYN-099", scenario: "base" } })).rejects.toMatchObject({ kind: "demo-unsupported" });
    await expect(tr.request("POST", "/recommend", {})).rejects.toMatchObject({ kind: "demo-unsupported" });
  });
});
