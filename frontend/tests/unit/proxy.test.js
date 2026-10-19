import { describe, expect, it } from "vitest";
import { apiTarget } from "../../../functions/api/[[path]].js";

describe("Pages API proxy", () => {
  it("strips /api and keeps the query", () => {
    const url = apiTarget("https://recompute.xyz/api/assets?limit=10", "https://recompute-api.onrender.com");
    expect(url.href).toBe("https://recompute-api.onrender.com/assets?limit=10");
  });

  it("maps /api/health to /health", () => {
    const url = apiTarget("https://recompute.xyz/api/health", "https://recompute-api.onrender.com/");
    expect(url.pathname).toBe("/health");
    expect(url.origin).toBe("https://recompute-api.onrender.com");
  });
});
