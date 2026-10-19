import { describe, expect, it } from "vitest";
import { formatAsk, formatChange, quotesFromEvidence, sparkline } from "../../src/ui/ticker.js";
import { snapshot } from "./fixtures.js";

describe("rental tape", () => {
  it("formats asks and changes", () => {
    expect(formatAsk(2.2)).toBe("$2.20");
    expect(formatAsk(null)).toBe("—");
    expect(formatChange(null)).toEqual({ text: "—", dir: "flat" });
    expect(formatChange(0)).toEqual({ text: "0.0%", dir: "flat" });
    expect(formatChange(1.24).dir).toBe("up");
    expect(formatChange(-1.2).text).toBe("▼ 1.2%");
  });

  it("builds the dated index from the recorded evidence, newest reading last", () => {
    const quotes = quotesFromEvidence(snapshot.responses["GET /market/evidence"]);
    expect(quotes.map((q) => q.label)).toEqual(["H100", "A100"]);
    const h100 = quotes[0];
    expect(h100.median).toBe(2.72);
    expect(h100.as_of).toBe("2026-09-28");
    expect(h100.history.at(-1)).toBe(2.72);
    expect(h100.history.length).toBeGreaterThan(2);
    expect(h100.change_pct).toBeCloseTo(((2.72 - 2.75) / 2.75) * 100, 2);
    expect(sparkline(h100.history, "down")).toContain("polyline");
    expect(sparkline([2.72], "flat")).toContain("circle");
  });
});