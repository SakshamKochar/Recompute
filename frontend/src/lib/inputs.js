/**
 * The model inputs the What-if Lab exposes, in backend units. Ranges mirror AssetInputs in
 * backend/app/schema.py so a control can never produce a value the API would reject; the API still
 * validates every request. `scale` converts backend units to display units (e.g. 0.6 -> 60%).
 */
export const INPUT_SPECS = {
  utilization: { label: "Steady-state utilization", unit: "%", scale: 100, min: 0, max: 1, step: 0.01, slider: [0.1, 1], group: "demand",
    help: "Share of hours actually billed once ramped up." },
  first_month_utilization: { label: "First-month utilization", unit: "%", scale: 100, min: 0, max: 1, step: 0.01, slider: [0, 1], group: "demand",
    help: "New listings start slow. Should not exceed steady state." },
  rental_rate: { label: "Rental price", unit: "$/GPU-hr", prefix: "$", min: 0, max: 20, step: 0.01, slider: [0.5, 5], group: "demand",
    help: "Customer price per GPU-hour, before the marketplace cut." },
  elec_per_kwh: { label: "Electricity", unit: "/kWh", prefix: "$", min: 0, max: 1, step: 0.0025, slider: [0.03, 0.3], group: "cost",
    help: "Passed through by the colo, before the PUE multiplier." },
  colo_per_kw_mo: { label: "Colo fee", unit: "/kW-mo", prefix: "$", min: 0, max: 1000, step: 1, slider: [50, 500], group: "cost",
    help: "Base colocation fee per kW per month, before electricity." },
  market_decay_pct_mo: { label: "Monthly value decline", unit: "%", scale: 100, min: 0, max: 0.2, step: 0.001, slider: [0, 0.06], group: "market",
    help: "Applied to both rental rate and resale value while hosting longer." },
  price_drift_pct_mo: { label: "Resale price drift", unit: "%/mo", scale: 100, min: 0, max: 0.2, step: 0.0005, slider: [0, 0.06], group: "market",
    help: "How fast the sale price drifts while waiting for a buyer." },
  dwell_days: { label: "Days until a buyer", unit: "days", min: 0, max: 365, step: 1, slider: [0, 180], group: "market",
    help: "Expected wait for a buyer at the market price." },
  horizon_months: { label: "Hosting horizon", unit: "months", min: 1, max: 60, step: 1, slider: [1, 36], group: "market", integer: true,
    help: "How long Host longer keeps the server before selling." },
  offer_today: { label: "Today’s offer", unit: "USD", prefix: "$", min: 0, max: 1e9, step: 100, group: "price", number: true,
    help: "The best firm offer available now." },
  market_price: { label: "Market price", unit: "USD", prefix: "$", min: 0, max: 1e9, step: 100, group: "price", number: true,
    help: "Listed price for the whole server." },
  activation_cost: { label: "Activation cost", unit: "USD", prefix: "$", min: 0, max: 1e9, step: 10, group: "price", number: true,
    help: "Freight in and installation before compute can start." },
  repair_parts_cost: { label: "Repair parts", unit: "USD", prefix: "$", min: 0, max: 1e9, step: 10, group: "repair", number: true,
    help: "Replacement part cost." },
  repair_days: { label: "Repair days", unit: "days", min: 0, max: 120, step: 1, group: "repair", number: true,
    help: "Days out of the market while repairing." },
  repair_success: { label: "Repair success rate", unit: "%", scale: 100, min: 0, max: 1, step: 0.01, slider: [0.3, 1], group: "repair",
    help: "Chance the server passes diagnostics after repair." },
};

export const SLIDER_KEYS = ["utilization", "rental_rate", "elec_per_kwh", "market_decay_pct_mo", "dwell_days", "horizon_months"];
export const ADVANCED_KEYS = ["first_month_utilization", "colo_per_kw_mo", "price_drift_pct_mo", "offer_today", "market_price", "activation_cost"];
export const REPAIR_KEYS = ["repair_parts_cost", "repair_days", "repair_success"];

export function toDisplay(key, v) {
  const s = INPUT_SPECS[key];
  if (v === undefined || v === null) return "";
  const d = s?.scale ? v * s.scale : v;
  return Math.round(d * 10000) / 10000;
}

export function fromDisplay(key, d) {
  const s = INPUT_SPECS[key];
  const v = s?.scale ? Number(d) / s.scale : Number(d);
  return s?.integer ? Math.round(v) : v;
}

export function formatInput(key, v) {
  const s = INPUT_SPECS[key];
  if (v === undefined || v === null || Number.isNaN(v)) return "—";
  if (!s) return String(v);
  if (s.scale) return `${(v * s.scale).toFixed(key === "market_decay_pct_mo" || key === "price_drift_pct_mo" ? 1 : 0)}${s.unit === "%/mo" ? "%/mo" : "%"}`;
  if (s.unit === "USD") return `$${Math.round(v).toLocaleString("en-US")}`;
  if (s.prefix === "$") return `$${v.toFixed(key === "elec_per_kwh" ? 4 : 2).replace(/0+$/, "").replace(/\.$/, "")} ${s.unit}`;
  return `${v.toLocaleString("en-US")} ${s.unit}`;
}

/** Returns an error message, or null when the value is valid for the backend schema. */
export function validateInput(key, v) {
  const s = INPUT_SPECS[key];
  if (!s) return null;
  if (typeof v !== "number" || Number.isNaN(v)) return `${s.label} must be a number`;
  if (v < s.min || v > s.max) return `${s.label} must be between ${formatInput(key, s.min)} and ${formatInput(key, s.max)}`;
  if (s.integer && !Number.isInteger(v)) return `${s.label} must be a whole number`;
  return null;
}

/** The keys whose values differ between two input objects (used for Custom detection and diffs). */
export function changedKeys(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => {
    const x = a[k];
    const y = b[k];
    if (typeof x === "number" && typeof y === "number") return Math.abs(x - y) > 1e-9;
    return x !== y;
  });
}
