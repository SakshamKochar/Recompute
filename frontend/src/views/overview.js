import { R } from "../state/data.js";
import { adaptAssetRow, hardwareTitle } from "../lib/adapters.js";
import { compactMoney, dateTime, money, pad2, signedMoney } from "../lib/format.js";
import { esc } from "../lib/html.js";
import { eventInfo, STATE_ORDER, stateInfo } from "../lib/lifecycle.js";
import { ROUTE_ORDER, routeInfo } from "../lib/routes.js";
import { boardArt } from "../ui/art.js";
import { contextStrip, emptyBlock, heading, isDemo, journey, routeChip, withData } from "../ui/components.js";

const ACTION_KIND = {
  sale_at_risk: ["Sale at risk", "Draining takes longer than the buyer allows."],
  route_changed: ["Recommendation changed", "On compute, but the latest recommendation no longer is."],
  overridden: ["Went against the model", "The last move was an override."],
  awaiting_decision: ["Awaiting a decision", "New server still in RECEIVED."],
};

/** Open assets where the model's route beats the simple default, most uplift first; awaiting-decision first. */
export function opportunities(rows) {
  return rows
    .filter((a) => !a.terminal && a.route && a.route !== a.baselineRoute && a.gain > 0)
    .sort((a, b) => (b.state === "RECEIVED") - (a.state === "RECEIVED") || b.gain - a.gain);
}

function featured(a, total) {
  const r = a.routeInfo;
  const next = a.allowedEvents[0];
  return `<section class="feature-decision" aria-labelledby="feature-title"><div class="feature-top"><span class="micro">THE NEXT WORTHWHILE MOVE</span><span class="pill">01 / ${pad2(total)} above baseline</span></div><div class="feature-content"><div><span class="route-eyebrow">${r.symbol} ${esc(a.route)} / ${esc(r.lane === "recover" ? "RECOVER VALUE" : r.lane === "earn" ? "KEEP EARNING" : "EXIT WELL")}</span><h2 id="feature-title">${esc(r.headline[0])}<br><em>${esc(r.headline[1])}</em></h2><p>${esc(a.id)} is a ${esc(a.model || "server")}${a.site ? ` in ${esc(a.site)}` : ""}. The model recommends <b>${esc(r.label.toLowerCase())}</b> at ${money(a.routeValue)}, ${money(a.gain)} more than the ${esc(routeInfo(a.baselineRoute).label.toLowerCase())} baseline of ${money(a.baselineValue)}.${a.route === "REPAIR" && a.afterRepair ? ` Once repaired it would ${esc(routeInfo(a.afterRepair).label.toLowerCase())}.` : ""}</p><a class="btn" href="#passport/${encodeURIComponent(a.id)}">See the thinking <span>↗</span></a></div><div class="asset-stage">${boardArt(a, true)}<div class="asset-stage-caption"><span>${esc(a.id)} / ${esc(a.model || "")}</span><b>${esc(a.stateInfo.long)}</b></div></div></div><div class="decision-bottom"><span><i></i> ${next ? `Next step allowed now: ${esc(eventInfo(next).label)}` : "No step available without an override"}</span><span>Model estimate, not a quote</span></div></section>`;
}

function noFeatured() {
  return `<section class="feature-decision" aria-labelledby="feature-title"><div class="feature-top"><span class="micro">THE NEXT WORTHWHILE MOVE</span><span class="pill">00 above baseline</span></div><div class="feature-content"><div><span class="route-eyebrow">↗ NOTHING TO REDIRECT</span><h2 id="feature-title">Every open asset<br><em>is on its simplest route.</em></h2><p>No open server has a recommended route worth more than its baseline (sell now, or harvest or recycle if it failed). Upload inventory or change model inputs to find the next move.</p><a class="btn" href="#fleet">Meet your fleet <span>↗</span></a></div></div><div class="decision-bottom"><span><i></i> From the ReCompute API</span><span>Model estimate, not a quote</span></div></section>`;
}

function bars(entries, total, { labelOf, hrefOf }) {
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return `<ul class="count-bars">${entries
    .map(
      ([k, n]) =>
        `<li class="${n ? "" : "zero"}"><a href="${hrefOf(k)}"><span class="count-label">${labelOf(k)}</span><span class="count-track" aria-hidden="true"><i style="width:${(n / max) * 100}%"></i></span><b>${n}</b><span class="sr-only"> of ${total}</span></a></li>`,
    )
    .join("")}</ul>`;
}

function body(dash, assetsResp, batchesResp) {
  const rows = assetsResp.assets.map(adaptAssetRow);
  const open = rows.filter((a) => !a.terminal);
  const passing = open.filter((a) => !a.failed).length;
  const failed = open.length - passing;
  const repairRoute = open.filter((a) => a.route === "REPAIR").length;
  const synthetic = rows.filter((a) => a.synthetic).length;
  const opp = opportunities(rows);
  const inMotion = STATE_ORDER.filter((s) => stateInfo(s).phase === "motion").reduce((n, s) => n + (dash.by_state[s] || 0), 0);
  const ov = dash.open_value;
  const attention = dash.action_items.length;
  const awaiting = dash.action_counts.awaiting_decision || 0;
  const pair = [];
  for (const a of opp.slice(1)) {
    if (pair.length === 2) break;
    if (!pair.some((p) => p.route === a.route) && a.route !== opp[0]?.route) pair.push(a);
  }
  for (const a of opp.slice(1)) if (pair.length < 2 && !pair.includes(a)) pair.push(a);

  return (
    contextStrip([
      `${pad2(dash.total_assets)} assets`,
      `${pad2(dash.open_assets)} open`,
      `${pad2(batchesResp.batches.length)} batches`,
      synthetic ? `${synthetic} synthetic or simulated` : null,
    ]) +
    heading(
      "Overview",
      "Good hardware.<br><em>Better next moves.</em>",
      "Start with one decision. See the whole fleet differently.",
      `<a href="#fleet" class="btn secondary">Meet your fleet <span>↗</span></a>`,
    ) +
    `<div class="studio-overview">${opp.length ? featured(opp[0], opp.length) : noFeatured()}<section class="fleet-snapshot" aria-label="Fleet summary"><span class="micro">THE BIG PICTURE · OPEN ASSETS</span><div class="snapshot-total"><small>Recommended routes, combined</small><strong>${compactMoney(ov.recommended)}</strong><span>Baseline ${compactMoney(ov.baseline)} · <b class="gain">${signedMoney(ov.gain_vs_baseline)}</b> vs baseline</span></div><div class="fleet-health-art"><div class="health-circle" style="--share:${open.length ? (passing / open.length) * 100 : 0}%"><span>${passing}<small>/ ${open.length}</small></span></div><div><b>${failed ? "Plenty of life left." : "Every open server passed."}</b><p>${passing} passed diagnostics.<br>${failed} failed${failed ? ` · ${repairRoute} worth repairing` : ""}.</p></div></div><div class="snapshot-bottom"><a href="#outcomes"><strong>${pad2(inMotion)}</strong><span>decisions in motion ↗</span></a><a href="#attention"><strong>${pad2(attention)}</strong><span>need attention ↗</span></a></div></section></div>
    <p class="figure-note">Sums of each open server’s modeled route value on its own timeline, from <code>GET /dashboard</code>. Not a same-date portfolio valuation or a quote.</p>
    <div class="overview-grid"><section class="panel-card" aria-labelledby="by-state"><div class="panelhead"><h2 id="by-state">Where every asset is</h2><small>LIFECYCLE STATE</small></div>${bars(
      STATE_ORDER.map((s) => [s, dash.by_state[s] || 0]),
      dash.total_assets,
      { labelOf: (s) => esc(stateInfo(s).label), hrefOf: (s) => `#fleet?state=${s}` },
    )}</section><section class="panel-card" aria-labelledby="by-route"><div class="panelhead"><h2 id="by-route">What the model recommends</h2><small>RECOMMENDED ROUTE</small></div>${bars(
      ROUTE_ORDER.map((r) => [r, dash.by_route[r] || 0]),
      dash.total_assets,
      { labelOf: (r) => `<span aria-hidden="true">${routeInfo(r).symbol}</span> ${esc(routeInfo(r).label)}`, hrefOf: (r) => `#fleet?route=${encodeURIComponent(r)}` },
    )}</section></div>
    <div class="sectiontitle" id="attention"><div><span class="micro">NEEDS A PERSON</span><h2>Assets needing attention.</h2></div><span class="subtle">${awaiting ? `${awaiting} more are awaiting a first decision.` : ""}</span></div>
    ${
      attention
        ? `<div class="attention-list">${dash.action_items
            .slice(0, 8)
            .map((i) => {
              const [label, sub] = ACTION_KIND[i.kind] || [i.kind, ""];
              return `<a class="attention-item ${esc(i.kind)}" href="#passport/${encodeURIComponent(i.asset_id)}"><span class="micro">${esc(label)}</span><b>${esc(i.asset_id)}</b><p>${esc(i.reason)}</p><small>${esc(stateInfo(i.state).label)} · ${esc(routeInfo(i.route).label)} recommended · ${esc(sub)}</small></a>`;
            })
            .join("")}</div>`
        : emptyBlock("◎", "Nothing urgent.", "No sale at risk, no compute asset whose recommendation changed, no open override.")
    }
    <div class="sectiontitle"><div><span class="micro">WHERE POSSIBILITY BECOMES A PLAN</span><h2>Your next chapter, in four moves.</h2></div><a href="#home" class="textlink">Revisit the guided story ↗</a></div>${journey()}
    <div class="sectiontitle"><h2>${pair.length ? "More possibilities worth a look." : "Recent activity."}</h2><a href="#market" class="textlink">Open Market Intelligence ↗</a></div>
    ${
      pair.length
        ? `<div class="opportunity-pair">${pair
            .map(
              (a) =>
                `<a class="opportunity-tile" href="#passport/${encodeURIComponent(a.id)}"><span class="tile-symbol" aria-hidden="true">${a.routeInfo.symbol}</span><div><small>${esc(a.id)} / ${esc(hardwareTitle(a))}</small><h3>${esc(a.routeInfo.headline.join(" "))}</h3><p>${esc(a.routeInfo.label)} is worth ${money(a.routeValue)}, ${money(a.gain)} above ${esc(routeInfo(a.baselineRoute).label.toLowerCase())}.</p></div><span aria-hidden="true">↗</span></a>`,
            )
            .join("")}</div>`
        : ""
    }
    <section class="panel-card activity" aria-labelledby="recent"><div class="panelhead"><h2 id="recent">Recent activity</h2><small>LATEST STATE CHANGES</small></div>${
      dash.recent_activity.length
        ? `<ol class="activity-list">${dash.recent_activity
            .map(
              (t) =>
                `<li><a href="#passport/${encodeURIComponent(t.asset_id)}"><b>${esc(t.asset_id)}</b> <span>${esc(eventInfo(t.event).verb)}</span>${t.from_state ? ` <small>${esc(stateInfo(t.from_state).label)} → ${esc(stateInfo(t.to_state).label)}</small>` : ""}${t.override ? ` <span class="prov-tag hypothesis">override</span>` : ""}</a><time datetime="${esc(t.at)}">${dateTime(t.at)}</time></li>`,
            )
            .join("")}</ol>`
        : `<p class="subtle">No lifecycle activity yet.</p>`
    }</section>`
  );
}

export default {
  title: "Overview",
  render() {
    return withData([R.dashboard(), R.assets(), R.batches()], body, {
      retryKeys: ["dashboard", "assets", "batches"],
      loadingLabel: isDemo() ? "Opening the demo snapshot…" : "Loading the fleet from the ReCompute API…",
    });
  },
};
