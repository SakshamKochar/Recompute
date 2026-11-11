/**
 * The SYN-003 stage case for the finals pitch, as plain display data.
 * Every dollar comes from syn003.json, recorded from the v0.9 model by scripts/build_pitch_fixture.py.
 * Nothing here computes a financial value; it only picks, labels and words what the model returned.
 */
import fixture from "./syn003.json";
import { money, pct } from "../lib/format.js";

export const CASE = fixture;
export const RATE_KEYS = ["index", "stage"];

export const RATE_COPY = {
  index: { short: "Dated index", note: "Silicon Data A100 rental index, Sep 29, 2026. Not the owner’s payout." },
  stage: { short: "Stage hypothetical", note: "What-if for tonight. Not the index, not a host payout." },
};

const LABEL = {
  "SELL NOW": "Sell now",
  "LIST AND WAIT": "List and wait",
  "YIELD WHILE LISTED": "Yield while listed",
  "HOST LONGER": "Host for 12 months",
  REPAIR: "Repair",
  HARVEST: "Harvest parts",
  RECYCLE: "Recycle",
};
export const LADDER = ["SELL NOW", "LIST AND WAIT", "YIELD WHILE LISTED", "HOST LONGER", "REPAIR", "HARVEST", "RECYCLE"];
export const HEADLINE = ["SELL NOW", "LIST AND WAIT", "HOST LONGER"];
export const routeName = (r) => LABEL[r] || r;

const rateText = (r) => `$${r.toFixed(2)}`;

function cardNote(route, a) {
  if (route === "SELL NOW") return `Gross offer ${money(a.offer_today)}, after the assumed ${pct(a.sell_fee_pct, 1)} fee and ${money(a.logistics)} shipping`;
  if (route === "LIST AND WAIT") return `Listed at ${money(a.market_price)}, a buyer in about ${Math.round(a.dwell_days)} days, discounted for the wait`;
  return `After power, space, fees and maintenance, including the resale at the end`;
}

/** Status of one route in the ladder, read from the model's own audit lines and eligibility list. */
function ladderStatus(route, result) {
  if (!result.eligible.includes(route)) {
    if (route === "REPAIR") return { tone: "out", text: "Excluded: no diagnostic capture on record" };
    return { tone: "out", text: "Not in play: the server is healthy" };
  }
  if (route === result.route) return { tone: "rec", text: "Recommended" };
  if (route === "SELL NOW") return { tone: "base", text: "Safe default" };
  const line = result.audit.find((l) => l.startsWith(route)) || "";
  if (/stress case, so rejected/.test(line)) return { tone: "rej", text: "Higher on paper, fails its stress case" };
  if (/below the .* margin/.test(line)) return { tone: "rej", text: "Below the safety margin" };
  if (/still wins/.test(line)) return { tone: "ok", text: "Clears the rule, then overtaken" };
  return { tone: "base", text: "Compared" };
}

export function stageModel(rateKey = "index") {
  const c = CASE.cases[rateKey] || CASE.cases.index;
  const other = CASE.cases[rateKey === "index" ? "stage" : "index"];
  const r = c.result;
  const a = c.assumptions;
  const base = r.base;
  const sell = base["SELL NOW"];
  const value = base[r.route];
  const host = base["HOST LONGER"];
  const list = base["LIST AND WAIT"];

  const why =
    r.route === "HOST LONGER"
      ? `On these assumptions, hosting leads. It beats list and wait by ${money(host - list)} and still wins in its own stress case.`
      : `Hosting falls to ${money(host)}. Listing is ahead, so ReCompute recommends list and wait.`;

  const moved =
    rateKey === "stage"
      ? {
          input: "Rental price per GPU-hour",
          from: rateText(other.rental_rate),
          to: rateText(c.rental_rate),
          hostFrom: other.result.base["HOST LONGER"],
          hostTo: host,
          callFrom: routeName(other.result.route),
          callTo: routeName(r.route),
        }
      : null;

  return {
    rateKey,
    rate: c.rental_rate,
    rateLabel: rateText(c.rental_rate),
    route: r.route,
    routeLabel: routeName(r.route),
    value,
    sell,
    gain: value - sell,
    why,
    cashNote: r.route === "SELL NOW" ? "" : `Need the cash today? Selling now still nets ${money(sell)}.`,
    moved,
    cards: HEADLINE.map((route) => ({ route, title: routeName(route), value: base[route], note: cardNote(route, a), recommended: route === r.route })),
    ladder: LADDER.map((route) => ({
      route,
      title: routeName(route),
      value: r.eligible.includes(route) ? base[route] : null,
      ...ladderStatus(route, r),
    })),
    condition: [
      ["Inventory grade", `Grade ${CASE.identity.grade}`],
      ["NVIDIA diagnostic capture", "None on record"],
      ["Repair route", "Excluded"],
    ],
    assumptions: [
      ["Offer today (gross)", money(a.offer_today)],
      ["Listing price", `${money(a.market_price)} · ~${Math.round(a.dwell_days)} days`],
      ["Rental, per GPU-hour", `${rateText(a.rental_rate)} · ${RATE_COPY[rateKey].short.toLowerCase()}`],
      ["Utilization (assumed)", `${pct(a.utilization)} steady · ${pct(a.first_month_utilization)} month one`],
      ["Hosting horizon", `${a.horizon_months} months, then resale`],
      ["Selling cost", `${pct(a.sell_fee_pct, 1)} fee + ${money(a.logistics)} shipping`],
      ["Operating cost", `Power, colo, upkeep · ${pct(a.platform_fee_pct)} platform cut`],
    ],
    rule: `A riskier route must beat the safer one by ${money(a.margin_abs)} or ${pct(a.margin_pct)}, whichever is larger, and still win in its own stress case.`,
  };
}
