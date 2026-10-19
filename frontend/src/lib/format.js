const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const isNum = (n) => typeof n === "number" && Number.isFinite(n);

export function money(n, { cents = false } = {}) {
  if (!isNum(n)) return "—";
  return (cents ? usd2 : usd0).format(n);
}

export function signedMoney(n) {
  if (!isNum(n)) return "—";
  const rounded = Math.round(n);
  if (rounded === 0) return "$0";
  return `${rounded > 0 ? "+" : "−"}${usd0.format(Math.abs(n))}`;
}

export function compactMoney(n) {
  if (!isNum(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`;
  if (abs >= 1e4) return `${sign}$${Math.round(abs / 1e3)}k`;
  return `${sign}${usd0.format(abs)}`;
}

export function pct(n, digits = 0) {
  if (!isNum(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function num(n, digits = 0) {
  if (!isNum(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function dateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function dateOnly(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { dateStyle: "medium" });
}
