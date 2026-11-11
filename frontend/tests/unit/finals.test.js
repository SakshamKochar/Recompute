import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDemoTransport } from "../../src/api/demo.js";
import { RATE, VIDEO_ID, enforceRate, teaserSection } from "../../src/ui/teaser.js";

const snapshot = JSON.parse(readFileSync(resolve(__dirname, "../../public/demo/snapshot.json"), "utf8"));
const round = (b) => Object.fromEntries(Object.entries(b).filter(([, v]) => v !== null).map(([k, v]) => [k, Math.round(v)]));

describe("finals demo: SYN-003 in Demo mode answers the script's two cases without the API", () => {
  const t = createDemoTransport({ snapshot });
  const ask = (value) => t.request("POST", "/recommend", { demo: { assetId: "SYN-003", dial: "rental_rate", value } });

  it("$1.57: sell now $69,325, list and wait $78,016, host longer $96,117, and hosting is the call", async () => {
    const r = (await ask(1.57)).result;
    expect(r.route).toBe("HOST LONGER");
    expect(round(r.base)).toMatchObject({ "SELL NOW": 69325, "LIST AND WAIT": 78016, "HOST LONGER": 96117 });
  });

  it("$0.80: hosting falls to $70,064 and list and wait is the call", async () => {
    const r = (await ask(0.8)).result;
    expect(r.route).toBe("LIST AND WAIT");
    expect(round(r.base)).toMatchObject({ "SELL NOW": 69325, "LIST AND WAIT": 78016, "HOST LONGER": 70064 });
    expect(r.eligible).not.toContain("REPAIR");
  });

  it("only the two stage stops are recorded, so the slider snaps between $1.57 and $0.80", () => {
    expect(Object.keys(snapshot.lab["SYN-003"].grids.rental_rate).map(Number).sort()).toEqual([0.8, 1.57]);
  });
});

describe("landing teaser", () => {
  it("embeds the ReCompute teaser and holds it at 1.25x", () => {
    expect(VIDEO_ID).toBe("Rvnbdqqfllk");
    expect(RATE).toBe(1.25);
    expect(teaserSection()).toContain('id="teaser-player"');
    const p = { getPlaybackRate: vi.fn(() => 1), setPlaybackRate: vi.fn() };
    enforceRate(p);
    expect(p.setPlaybackRate).toHaveBeenCalledWith(1.25);
  });
});
