import { describe, expect, it, vi } from "vitest";
import { CASE, stageModel } from "../../src/pitch/stage.js";
import pitch, { rateForStep, stepFromQuery } from "../../src/views/pitch.js";
import teaser, { RATE, VIDEO_ID, enforceRate } from "../../src/views/teaser.js";

const round = (n) => Math.round(n);

describe("SYN-003 stage case matches the finals script", () => {
  it("$1.57: sell now $69,325, list and wait $78,016, host $96,117, hosting leads", () => {
    const m = stageModel("index");
    const v = Object.fromEntries(m.cards.map((c) => [c.route, round(c.value)]));
    expect(v).toEqual({ "SELL NOW": 69325, "LIST AND WAIT": 78016, "HOST LONGER": 96117 });
    expect(m.route).toBe("HOST LONGER");
    expect(m.rate).toBe(1.57);
    expect(round(m.gain)).toBe(26792);
  });

  it("$0.80: hosting falls to $70,064 and list and wait wins", () => {
    const m = stageModel("stage");
    expect(m.rate).toBe(0.8);
    expect(round(m.cards.find((c) => c.route === "HOST LONGER").value)).toBe(70064);
    expect(m.route).toBe("LIST AND WAIT");
    expect(m.moved).toMatchObject({ from: "$1.57", to: "$0.80", callTo: "List and wait" });
    expect(m.cashNote).toContain("$69,325");
  });

  it("is Grade A on the inventory, has no diagnostic capture, and excludes repair", () => {
    expect(CASE.identity.grade).toBe("A");
    expect(CASE.diagnostic_capture).toBeNull();
    for (const key of ["index", "stage"]) {
      const ladder = stageModel(key).ladder;
      expect(ladder).toHaveLength(7);
      const repair = ladder.find((l) => l.route === "REPAIR");
      expect(repair.value).toBeNull();
      expect(repair.text).toMatch(/no diagnostic capture/);
    }
  });

  it("the yield route is shown as rejected by its stress case at $1.57", () => {
    const y = stageModel("index").ladder.find((l) => l.route === "YIELD WHILE LISTED");
    expect(y.tone).toBe("rej");
    expect(y.text).toMatch(/stress case/);
  });
});

describe("stage wording respects the cue sheet", () => {
  const NEVER = [/customer/i, /pilot/i, /cxtec/i, /realized savings/i, /grade b\b/i, /\$?4\.1 ?m/i, /1\.5 ?m/i, /10 ?%/, /783/, /1\.52/, /certif/i, /probabilit/i, /confidence/i, /\bAI\b/];
  const text = (html) => html.replace(/<[^>]+>/g, " ");
  for (const step of [1, 2, 3]) {
    it(`step ${step} says none of the never-say phrases`, () => {
      const html = text(pitch.render({ query: { step: String(step) } }));
      for (const re of NEVER) expect(html, String(re)).not.toMatch(re);
    });
  }
  it("teaser page says none of them either", () => {
    const html = text(teaser.render());
    for (const re of NEVER) expect(html, String(re)).not.toMatch(re);
  });
});

describe("stage controls", () => {
  it("maps steps to the two rental cases", () => {
    expect([1, 2, 3].map(rateForStep)).toEqual(["index", "stage", "stage"]);
    expect(stepFromQuery({})).toBe(1);
    expect(stepFromQuery({ step: "3" })).toBe(3);
    expect(stepFromQuery({ rate: "0.80" })).toBe(2);
    expect(stepFromQuery({ step: "9" })).toBe(1);
  });
});

describe("teaser", () => {
  it("embeds the ReCompute teaser and holds it at 1.25x", () => {
    expect(VIDEO_ID).toBe("Rvnbdqqfllk");
    expect(RATE).toBe(1.25);
    const p = { getPlaybackRate: vi.fn(() => 1), setPlaybackRate: vi.fn() };
    enforceRate(p);
    expect(p.setPlaybackRate).toHaveBeenCalledWith(1.25);
    const q = { getPlaybackRate: vi.fn(() => 1.25), setPlaybackRate: vi.fn() };
    enforceRate(q);
    expect(q.setPlaybackRate).not.toHaveBeenCalled();
  });
});
