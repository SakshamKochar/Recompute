/**
 * Display vocabulary for the backend's seven routes. The identifiers are the exact strings in
 * app/recompute_model.py and app/output.py; descriptions paraphrase that module's docstring.
 * Nothing here decides eligibility or value: those come from each model result.
 */
export const ROUTE_ORDER = [
  "SELL NOW",
  "LIST AND WAIT",
  "YIELD WHILE LISTED",
  "HOST LONGER",
  "REPAIR",
  "HARVEST",
  "RECYCLE",
];

export const ROUTES = {
  "SELL NOW": {
    label: "Sell now",
    symbol: "↗",
    lane: "exit",
    tone: "clay",
    firstEvent: "list",
    promise: "Turn today’s value into your next opportunity.",
    headline: ["Cash today.", "A clean next step."],
    model: "Accept today’s offer, net of the selling fee and logistics.",
  },
  "LIST AND WAIT": {
    label: "List and wait",
    symbol: "◷",
    lane: "exit",
    tone: "sand",
    firstEvent: "list",
    promise: "Give the right buyer a little time.",
    headline: ["Timing is part", "of the value."],
    model: "List at the market price and sit idle until a buyer appears, discounted for the wait and price drift.",
  },
  "YIELD WHILE LISTED": {
    label: "Yield while listed",
    symbol: "⇄",
    lane: "earn",
    tone: "sage",
    firstEvent: "list",
    promise: "Earn while the next owner finds you.",
    headline: ["Earn before", "the handover."],
    model: "List at the market price and run rented compute until it sells, then drain, wipe and ship.",
  },
  "HOST LONGER": {
    label: "Host longer",
    symbol: "≈",
    lane: "earn",
    tone: "sage",
    firstEvent: "list",
    promise: "Keep useful compute doing useful work.",
    headline: ["More work.", "More possibility."],
    model: "Keep it as rented compute for the hosting horizon, then sell at the decayed price.",
  },
  REPAIR: {
    label: "Repair",
    symbol: "＋",
    lane: "recover",
    tone: "clay",
    firstEvent: "repair",
    promise: "A small intervention. A longer story.",
    headline: ["A small repair.", "A longer story."],
    model: "Replace the failed part, retest, then route it as a healthy server. Weighted by the repair success rate.",
  },
  HARVEST: {
    label: "Harvest",
    symbol: "✳",
    lane: "recover",
    tone: "ink",
    firstEvent: "harvest",
    promise: "Let the parts carry the value forward.",
    headline: ["Let the parts", "carry it forward."],
    model: "Sell working GPUs and parts, net of fees, teardown and logistics (an entered fallback value).",
  },
  RECYCLE: {
    label: "Recycle",
    symbol: "◌",
    lane: "recover",
    tone: "ink",
    firstEvent: "recycle",
    promise: "Close the loop, responsibly.",
    headline: ["Close the loop.", "Responsibly."],
    model: "Circuit-board scrap value net of freight and erasure (an entered fallback value).",
  },
};

export const LANES = [
  { key: "earn", label: "Earn", routes: ["YIELD WHILE LISTED", "HOST LONGER"] },
  { key: "exit", label: "Exit", routes: ["SELL NOW", "LIST AND WAIT"] },
  { key: "recover", label: "Recover", routes: ["REPAIR", "HARVEST", "RECYCLE"] },
];

export const COMPUTE_ROUTES = ["YIELD WHILE LISTED", "HOST LONGER"];

export function routeInfo(route) {
  return (
    ROUTES[route] || {
      label: route ? String(route).toLowerCase() : "Not assessed",
      symbol: "·",
      lane: null,
      tone: "",
      firstEvent: null,
      promise: "",
      headline: ["No recommendation", "yet."],
      model: "",
    }
  );
}

export const routeLabel = (r) => routeInfo(r).label;
