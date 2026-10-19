/**
 * The rental tape along the top of every page.
 * Live mode polls GET /market/live (Vast.ai asks, via our API). Demo mode, and any live
 * failure, shows the dated rental index from GET /market/evidence and says so.
 * The track is updated in place so the marquee does not jump on each reading.
 */
import { api, getTransport } from "../api/backend.js";
import { esc } from "../lib/html.js";

const POLL_FALLBACK_MS = 62_000;
let timer = 0;
let seq = 0;
let listening = false;

export function formatAsk(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatChange(pct) {
  if (typeof pct !== "number" || !Number.isFinite(pct) || Math.abs(pct) < 0.05) return { text: pct === 0 || (typeof pct === "number" && Math.abs(pct) < 0.05) ? "0.0%" : "—", dir: "flat" };
  const dir = pct > 0 ? "up" : "down";
  return { text: `${dir === "up" ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`, dir };
}

/** Latest dated rental-index row per GPU, oldest → newest, for Demo mode and the live fallback. */
export function quotesFromEvidence(evidence) {
  const rows = evidence?.sources?.rental_index?.rows || [];
  const by = new Map();
  for (const row of rows) {
    if (!row || row.usd_per_gpu_hr == null || row.gpu == null) continue;
    const list = by.get(row.gpu) || [];
    list.push(row);
    by.set(row.gpu, list);
  }
  const order = ["H100", "A100"];
  return [...by.entries()]
    .map(([gpu, list]) => {
      list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const last = list[list.length - 1];
      const prev = list.length > 1 ? list[list.length - 2] : null;
      const median = Number(last.usd_per_gpu_hr);
      const previous = prev ? Number(prev.usd_per_gpu_hr) : null;
      const change = previous ? Math.round(((median - previous) / previous) * 10000) / 100 : null;
      return {
        key: String(gpu).toLowerCase(),
        label: String(gpu),
        median,
        previous,
        change_pct: change,
        history: list.map((r) => Number(r.usd_per_gpu_hr)),
        in_model: true,
        model_rental_rate: median,
        as_of: last.date || null,
        unit: "USD/GPU-hr",
      };
    })
    .sort((a, b) => (order.indexOf(a.label) + 1 || 99) - (order.indexOf(b.label) + 1 || 99));
}

export function sparkline(values, dir) {
  const w = 56;
  const h = 16;
  const stroke = dir === "down" ? "#e7b09a" : dir === "up" ? "#d6ef86" : "#c5d0b8";
  if (!values || values.length < 2) {
    return `<svg class="tape-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><circle cx="${w - 4}" cy="${h / 2}" r="1.7" fill="${stroke}"/></svg>`;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = 1 + (i / (values.length - 1)) * (w - 2);
    const y = h - 2 - ((v - min) / span) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `<svg class="tape-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="${stroke}" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round" points="${pts.join(" ")}"/></svg>`;
}

function clock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function itemHtml(q, showModel) {
  const ch = formatChange(q.change_pct);
  const model = showModel && q.in_model && typeof q.model_rental_rate === "number"
    ? `<em class="tape-model">model ${esc(formatAsk(q.model_rental_rate))}</em>`
    : "";
  const spoken = `${q.label}, ${formatAsk(q.median)} per GPU-hour, ${ch.text}. Open market.`;
  return `<a class="tape-item" data-quote="${esc(q.key)}" href="#market" aria-label="${esc(spoken)}"><span class="tape-name">${esc(q.label)}</span><span class="tape-px" data-n="${esc(String(q.median))}">${esc(formatAsk(q.median))}</span><span class="tape-unit">/hr</span><span class="tape-chg ${ch.dir}">${esc(ch.text)}</span>${sparkline(q.history, ch.dir)}${model}</a>`;
}

function summaryText(state) {
  if (!state.quotes?.length) return state.sub || "Rental tape unavailable.";
  const bits = state.quotes.map((q) => `${q.label} ${formatAsk(q.median)}`).join(", ");
  return `${state.kicker}. ${bits}.`;
}

function shell(state) {
  const items = state.quotes.map((q) => itemHtml(q, state.showModel)).join("");
  const group = items || `<span class="tape-item tape-empty"><span class="tape-name">${esc(state.empty || "Reading the book")}</span></span>`;
  const dur = Math.max(56, Math.max(state.quotes.length, 4) * 9);
  const clone = group.replaceAll("<a ", '<a tabindex="-1" ');
  return `<a class="tape-mark" href="#market"><span class="tape-dot" aria-hidden="true"></span><span class="tape-kicker"><span class="tape-kicker-long">${esc(state.kicker)}</span><span class="tape-kicker-short">${esc(state.kickerShort)}</span></span></a><div class="tape-viewport"><div class="tape-track" style="--tape-dur:${dur}s"><div class="tape-group">${group}</div><div class="tape-group tape-clone" aria-hidden="true">${clone}</div></div></div><a class="tape-status" href="#market"><b>${esc(state.status)}</b><small>${esc(state.sub)}</small></a><p class="sr-only" aria-live="polite"></p>`;
}

function applyState(root, state) {
  const signature = `${state.mode}|${state.showModel}|${state.quotes.map((q) => q.key).join(",")}`;
  root.className = `market-tape ${state.mode}`;
  root.dataset.mode = state.mode;
  if (root.dataset.sig !== signature) {
    root.dataset.sig = signature;
    root.innerHTML = shell(state);
  } else {
    root.querySelector(".tape-kicker-long").textContent = state.kicker;
    root.querySelector(".tape-kicker-short").textContent = state.kickerShort;
    root.querySelector(".tape-status b").textContent = state.status;
    root.querySelector(".tape-status small").textContent = state.sub;
    for (const q of state.quotes) {
      const ch = formatChange(q.change_pct);
      for (const node of root.querySelectorAll(`[data-quote="${q.key}"]`)) {
        const px = node.querySelector(".tape-px");
        if (px.dataset.n && px.dataset.n !== String(q.median)) {
          node.classList.remove("flash");
          void node.offsetWidth;
          node.classList.add("flash");
        }
        px.dataset.n = String(q.median);
        px.textContent = formatAsk(q.median);
        const chEl = node.querySelector(".tape-chg");
        chEl.className = `tape-chg ${ch.dir}`;
        chEl.textContent = ch.text;
        const hist = (q.history || []).join(",");
        if (node.dataset.hist !== hist) {
          node.dataset.hist = hist;
          const svg = node.querySelector(".tape-spark");
          if (svg) svg.outerHTML = sparkline(q.history, ch.dir);
        }
        node.setAttribute("aria-label", `${q.label}, ${formatAsk(q.median)} per GPU-hour, ${ch.text}. Open market.`);
      }
    }
  }
  const spoken = summaryText(state);
  const live = root.querySelector("[aria-live]");
  if (live && live.textContent !== spoken) live.textContent = spoken;
}

function viewFromLive(body) {
  return {
    mode: body.stale ? "stale" : "live",
    kicker: "Rental asks",
    kickerShort: "Asks",
    status: body.stale ? "Held" : "Live",
    sub: body.stale ? "Last reading" : `Vast.ai · ${clock(body.fetched_at)}`,
    showModel: true,
    quotes: body.quotes || [],
    ttl: body.ttl_seconds,
    empty: "No asks in this reading",
  };
}

function viewFromEvidence(evidence, { reason, stale = false } = {}) {
  const quotes = quotesFromEvidence(evidence);
  const asOf = quotes.map((q) => q.as_of).filter(Boolean).sort().at(-1) || "";
  return {
    mode: "dated",
    kicker: "Dated index",
    kickerShort: "Index",
    status: "Not live",
    sub: asOf ? `As of ${asOf}` : reason || "Dated index",
    showModel: false,
    quotes,
    ttl: stale ? 20 : 120,
    empty: reason || "Dated index unavailable",
  };
}

async function load() {
  const demo = getTransport()?.mode === "demo";
  if (demo) {
    const evidence = await api.marketEvidence();
    return viewFromEvidence(evidence, { reason: "Demo mode" });
  }
  const live = await api.marketLive();
  if (live?.live && live.quotes?.length) return viewFromLive(live);
  try {
    const evidence = await api.marketEvidence();
    return viewFromEvidence(evidence, { reason: live?.error || live?.note, stale: true });
  } catch {
    return {
      mode: "offline",
      kicker: "Rental asks",
      kickerShort: "Asks",
      status: "Offline",
      sub: "API unreachable",
      showModel: false,
      quotes: [],
      ttl: 20,
      empty: "Live asks unavailable",
    };
  }
}

function schedule(ms) {
  clearTimeout(timer);
  if (document.hidden) return;
  timer = setTimeout(() => refresh(), ms);
}

async function refresh() {
  const root = document.querySelector("#ticker");
  if (!root) return;
  const my = ++seq;
  try {
    const state = await load();
    if (my !== seq || !document.querySelector("#ticker")) return;
    applyState(root, state);
    const wait = state.mode === "live" ? ((state.ttl || 60) + 2) * 1000 : state.mode === "stale" || state.mode === "offline" ? 20_000 : POLL_FALLBACK_MS;
    schedule(wait);
  } catch {
    if (my !== seq) return;
    applyState(root, {
      mode: "offline",
      kicker: "Rental asks",
      kickerShort: "Asks",
      status: "Offline",
      sub: "Could not load",
      showModel: false,
      quotes: [],
      empty: "Rental tape unavailable",
    });
    schedule(20_000);
  }
}

export function startTicker() {
  const root = document.querySelector("#ticker");
  if (!root) return;
  if (!listening) {
    listening = true;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) clearTimeout(timer);
      else refresh();
    });
  }
  refresh();
}
