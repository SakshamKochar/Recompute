import { rerender } from "../app.js";
import { R } from "../state/data.js";
import { adaptAssetRow, hardwareTitle } from "../lib/adapters.js";
import { compactMoney, isNum, money, pad2, signedMoney } from "../lib/format.js";
import { esc } from "../lib/html.js";
import { LANES, routeInfo } from "../lib/routes.js";
import { contextStrip, emptyBlock, errorBlock, heading, isDemo, loadingBlock, routeChip, tag } from "../ui/components.js";

let statusFilter = "all";
let openSource = null;

const LANE_COPY = {
  earn: ["Opportunity to earn", "Idle doesn’t have to mean unproductive."],
  exit: ["A timing question", "The cost of waiting is worth a look."],
  recover: ["A recovery opportunity", "One repair could rewrite the outcome."],
};

/** The best open opportunity in each lane: the asset whose recommended route beats its baseline by the most. */
export function laneSignals(rows) {
  return LANES.map((lane) => {
    const pick = rows
      .filter((a) => !a.terminal && lane.routes.includes(a.route) && a.gain > 0)
      .sort((x, y) => (y.state === "RECEIVED") - (x.state === "RECEIVED") || y.gain - x.gain)[0];
    return { lane, asset: pick || null };
  });
}

function evidenceFor(lane, a, ev) {
  const gpu = a.hardware?.gpu;
  const s = ev.sources;
  if (lane === "earn") {
    const rows = (s.rental_index?.rows || []).filter((r) => r.gpu === gpu).sort((x, y) => String(y.date).localeCompare(String(x.date)));
    const r = rows[0];
    return r
      ? { label: `${gpu} rental index, ${r.date}`, value: `$${r.usd_per_gpu_hr.toFixed(2)} / GPU-hr`, status: r.status, src: r.source_title, url: r.url }
      : { label: "Rental index", value: `No ${gpu || ""} reading on file`, status: null };
  }
  if (lane === "exit") {
    const rows = (s.resale?.rows || []).filter((r) => r.gpu_model === gpu);
    const r = rows[0];
    return r
      ? { label: `${gpu} ${r.config}, ${r.condition}, ${r.date}`, value: money(r.price_usd), status: r.status, src: r.source_title, url: r.url }
      : { label: "Resale observations", value: `No ${gpu || ""} price on file`, status: null };
  }
  const part = (a.failedPart || "").toLowerCase();
  const r = (s.repair_costs?.rows || []).find((x) => part && part.includes(String(x.part).toLowerCase()));
  return r
    ? { label: `Repair table: ${r.part}`, value: `${money(r.cost_usd)} · ${r.repair_days} days`, status: r.status, src: r.basis }
    : { label: "Repair table", value: a.failedPart ? `No row for “${a.failedPart}”` : "No failed part recorded", status: null };
}

const STATUS_LABEL = { SOURCED: "Cited", DERIVED: "Calculated", HYPOTHESIS: "Assumption", TO_VERIFY: "To confirm" };
const statusTag = (st) =>
  st ? `<span class="evidence-status ${esc(String(st).toLowerCase().replace(/[^a-z]+/g, "-"))}">${esc(STATUS_LABEL[st] || st)}</span>` : "";

function radar(signals) {
  return `<section class="radar-visual"><span class="micro">Opportunity radar / From your fleet</span><div class="radar-map" data-motion="radar"><div class="radar-sweep" aria-hidden="true"></div><div class="radar-ring r1"></div><div class="radar-ring r2"></div><div class="radar-ring r3"></div><span class="radar-center" aria-hidden="true">Re.</span>${signals
    .map((s, i) =>
      s.asset
        ? `<a class="radar-node n${i + 1}" href="#passport/${encodeURIComponent(s.asset.id)}" aria-label="${esc(s.lane.label)}: ${esc(s.asset.id)}, ${esc(s.asset.routeInfo.label)}">${pad2(i + 1)}<span>${esc(s.lane.label)}</span></a>`
        : `<span class="radar-node n${i + 1} empty" aria-label="${esc(s.lane.label)}: no opportunity">${pad2(i + 1)}<span>${esc(s.lane.label)}</span></span>`,
    )
    .join("")}</div><h2>${signals.filter((s) => s.asset).length} signals.<br><em>Your next move?</em></h2><p>Each node is the open asset whose recommended route beats its baseline by the most in that lane.</p></section>`;
}

function stories(signals, ev) {
  return `<div class="signal-editorial">${signals
    .map((s, i) => {
      const [kicker, title] = LANE_COPY[s.lane.key];
      if (!s.asset) return `<article class="signal-story"><span class="signal-number">${pad2(i + 1)}</span><div><span class="micro">${esc(kicker)}</span><h2>Nothing here right now.</h2><p>No open asset’s recommended ${esc(s.lane.label.toLowerCase())} route beats its baseline.</p></div></article>`;
      const a = s.asset;
      const e = evidenceFor(s.lane.key, a, ev);
      return `<article class="signal-story"><span class="signal-number">${pad2(i + 1)}</span><div><span class="micro">${esc(kicker)}</span><h2>${esc(title)}</h2><p>${esc(a.id)} (${esc(a.model || "server")}) is recommended to <b>${esc(a.routeInfo.label.toLowerCase())}</b>: ${money(a.routeValue)}, ${signedMoney(a.gain)} vs ${esc(routeInfo(a.baselineRoute).label.toLowerCase())}.</p><div class="signal-evidence"><span>${esc(e.label)}</span><b>${esc(e.value)}</b>${statusTag(e.status)}</div>${e.src ? `<small class="signal-src">${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.src)} ↗</a>` : esc(e.src)}</small>` : ""}<a class="textlink" href="#passport/${encodeURIComponent(a.id)}">Explore ${esc(hardwareTitle(a))} · ${esc(a.id)} ↗</a></div></article>`;
    })
    .join("")}</div>`;
}

function scenarioBlock(batches) {
  const b = batches.batches.find((x) => x.batch_id === "SYN-FLEET") || batches.batches[0];
  if (!b) return "";
  const sc = R.batchScenarios(b.batch_id);
  if (sc.status === "error" && !sc.data) return errorBlock(sc.error, { retryKeys: [`scenarios:${b.batch_id}`] });
  if (!sc.data) return loadingBlock("Running the bear, base and bull scenarios…");
  const s = sc.data.scenarios;
  return `<section class="panel-card scenario-panel" aria-labelledby="sc-h"><div class="panelhead"><h2 id="sc-h">If the market turns: ${esc(b.batch_id)}</h2><small>${s.base?.count ?? b.totals.count} servers</small></div><div class="scenario-cols">${["bear", "base", "bull"]
    .map((k) => {
      const t = s[k];
      if (!t) return "";
      const top = Object.entries(t.routes).sort((x, y) => y[1] - x[1]);
      return `<div class="scenario-col ${k}"><span class="micro">${k[0].toUpperCase() + k.slice(1)}</span><strong>${compactMoney(t.recommended_value)}</strong><small>${signedMoney(t.gain_vs_baseline)} vs baseline · ${t.changed_from_baseline} change route</small><ul class="plain">${top.map(([r, n]) => `<li>${routeChip(r)} ${n}</li>`).join("")}</ul></div>`;
    })
    .join("")}</div><p class="pp-note">${esc(sc.data.note)} Values are each server’s modeled route value under that scenario, summed. Not a forecast.</p><a class="textlink" href="#fleet?batch=${encodeURIComponent(b.batch_id)}&scenario=bear">See which assets change in the bear case ↗</a></section>`;
}

function assumptions(meta) {
  const all = meta.assumptions || [];
  const statuses = [...new Set(all.map((a) => a.status).filter(Boolean))];
  const rows = statusFilter === "all" ? all : all.filter((a) => a.status === statusFilter);
  return `<section class="panel-card" aria-labelledby="as-h"><div class="panelhead"><h2 id="as-h">Every default, and where it came from</h2><small>${all.length} Model inputs</small></div><div class="filter-chips" role="group" aria-label="Filter by status"><button data-action="status" data-status="all" aria-pressed="${statusFilter === "all"}">All ${all.length}</button>${statuses
    .map((s) => `<button data-action="status" data-status="${esc(s)}" aria-pressed="${statusFilter === s}">${esc(s)} ${all.filter((a) => a.status === s).length}</button>`)
    .join("")}</div><div class="tablewrap compact"><table><thead><tr><th scope="col">Input</th><th scope="col">Default</th><th scope="col">Status</th><th scope="col">Owner</th><th scope="col">Source and note</th></tr></thead><tbody>${rows
    .map(
      (a) =>
        `<tr><th scope="row">${esc(a.label)}<small><code>${esc(a.input)}</code></small></th><td>${esc(a.value)} ${esc(a.unit)}</td><td>${statusTag(a.status)}</td><td>${esc(a.owner || "—")}</td><td>${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.source)} ↗</a>` : esc(a.source || "—")}${a.note ? `<small>${esc(a.note)}</small>` : ""}</td></tr>`,
    )
    .join("")}</tbody></table></div><p class="pp-note">Defaults for the A100 profile that ReCompute starts from. An asset’s own inputs always override them.</p></section>`;
}

function sources(ev) {
  return `<section class="panel-card" aria-labelledby="src-h"><div class="panelhead"><h2 id="src-h">The dated evidence</h2><small>Dated · Not live</small></div><p class="pp-note">${esc(ev.note)}</p>${Object.entries(ev.sources)
    .map(([k, s]) => {
      const cols = Object.keys(s.rows[0] || {}).filter((c) => !["url"].includes(c));
      return `<details class="model-details evidence" ${openSource === k ? "open" : ""} data-source="${esc(k)}"><summary>${esc(s.title)} <small>${s.rows.length} rows · <code>${esc(s.file)}</code></small></summary><div class="tablewrap compact"><table><thead><tr>${cols.map((c) => `<th scope="col">${esc(c.replace(/_/g, " "))}</th>`).join("")}</tr></thead><tbody>${s.rows
        .map((r) => `<tr>${cols.map((c) => `<td>${c === "status" ? statusTag(r[c]) : c === "source_title" && r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r[c])} ↗</a>` : esc(r[c])}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div></details>`;
    })
    .join("")}</section>`;
}

function signedCents(n) {
  if (!isNum(n)) return "—";
  const body = Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (Math.abs(n) < 0.005) return body;
  return `${n > 0 ? "+" : "−"}${body}`;
}

function asksPanel(entry) {
  if (!entry) return "";
  if (!entry.data && entry.status === "error") {
    return `<section class="panel-card tape-panel"><div class="panelhead"><h2>Live rental asks</h2><small>Vast.ai</small></div><p class="pp-note">${esc(entry.error?.message || "Live asks didn’t load.")} The dated evidence below is unchanged.</p></section>`;
  }
  if (!entry.data) {
    return `<section class="panel-card tape-panel"><div class="panelhead"><h2>Live rental asks</h2><small>Vast.ai</small></div><p class="pp-note">Reading the public listings…</p></section>`;
  }
  const live = entry.data;
  if (!live.live || !live.quotes?.length) {
    return `<section class="panel-card tape-panel"><div class="panelhead"><h2>Live rental asks</h2><small>Vast.ai</small></div><p class="pp-note">${esc(live.error || live.note || "No live asks right now.")} The dated evidence below is unchanged.</p></section>`;
  }
  const when = new Date(live.fetched_at);
  const stamp = Number.isNaN(when.getTime()) ? "" : when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const rows = live.quotes
    .map((q) => {
      const gap = q.in_model && isNum(q.median) && isNum(q.model_rental_rate) ? q.median - q.model_rental_rate : null;
      const profile = q.model_profile === "h100_8x" ? "H100 8×" : q.model_profile === "a100_8x" ? "A100 8×" : q.model_profile;
      return `<tr><th scope="row">${esc(q.label)}${profile ? `<small>${esc(profile)} assumption</small>` : ""}</th><td>${money(q.median, { cents: true })}</td><td>${money(q.low, { cents: true })} – ${money(q.high, { cents: true })}</td><td>${esc(q.offers)}${q.capped ? " · capped" : ""}</td><td>${q.in_model ? money(q.model_rental_rate, { cents: true }) : "—"}</td><td>${signedCents(gap)}</td></tr>`;
    })
    .join("");
  return `<section class="panel-card tape-panel" aria-labelledby="asks-h"><div class="panelhead"><h2 id="asks-h">What hosts are asking, next to the rate we use</h2><small>${live.stale ? "Last reading" : "Vast.ai"} · ${esc(stamp)}</small></div><div class="tablewrap compact"><table><thead><tr><th scope="col">GPU</th><th scope="col">Median ask</th><th scope="col">Low to high</th><th scope="col">Offers</th><th scope="col">Rate we use</th><th scope="col">Difference</th></tr></thead><tbody>${rows}</tbody></table></div><p class="pp-note">Median asking price per GPU-hour. Hosts set these prices. They are not completed rentals. The rate we use is the steadier figure behind each valuation.${live.source?.url ? ` <a href="${esc(live.source.url)}" target="_blank" rel="noopener noreferrer">${esc(live.source.name)} ↗</a>` : ""}</p></section>`;
}

function body(assetsResp, meta, ev, batches, liveEntry) {
  const rows = assetsResp.assets.map(adaptAssetRow);
  if (!rows.length) return emptyBlock("◌", "No assets to match against.", "Upload inventory to see signals for your own hardware.");
  const signals = laneSignals(rows);
  const demo = isDemo();
  const honesty = demo
    ? `${tag("historical", "Not live")} You’re in the demo. The strip shows a dated rental index, and the figures on this page come from that same sample.`
    : `<span class="prov-tag asks">On-demand asks</span> The strip at the top is live. It shows the median asking price to rent each GPU, refreshed about once a minute. Hosts set those prices. They are asking prices, not completed rentals. The values on this page use steadier, dated market readings.`;
  return (
    contextStrip([demo ? "Tape shows the dated index" : "Tape shows live asks"]) +
    heading("Market Intelligence", "A moving market.<br><em>A moment to act.</em>", "Signals become useful when they connect to hardware you actually own.") +
    `<div class="honesty-note" role="note">${honesty}</div>
    ${asksPanel(liveEntry)}
    <div class="radar-layout">${radar(signals)}${stories(signals, ev)}</div>${scenarioBlock(batches)}${assumptions(meta)}${sources(ev)}
    <p class="studio-footnote">Each source is marked cited, calculated, a working assumption, or still to confirm.${demo ? " The demo uses the same readings as the sample." : ""}</p>`
  );
}

export default {
  title: "Market",
  render() {
    const entries = [R.assets(), R.meta(), R.evidence(), R.batches()];
    const failed = entries.find((e) => e.status === "error" && !e.data);
    if (failed) return errorBlock(failed.error, { retryKeys: ["assets", "meta", "evidence", "batches"] });
    if (entries.some((e) => !e.data)) return loadingBlock();
    const live = isDemo() ? null : R.liveMarket();
    return body(...entries.map((e) => e.data), live);
  },
  actions: {
    status: (el) => {
      statusFilter = el.dataset.status;
      rerender();
    },
  },
  onChange() {},
};

document.addEventListener(
  "toggle",
  (e) => {
    const k = e.target?.dataset?.source;
    if (k) openSource = e.target.open ? k : openSource === k ? null : openSource;
  },
  true,
);
