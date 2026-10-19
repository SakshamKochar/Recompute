import { R } from "../state/data.js";
import { dateTime, money, signedMoney } from "../lib/format.js";
import { esc } from "../lib/html.js";
import { eventInfo, stateInfo } from "../lib/lifecycle.js";
import { routeInfo } from "../lib/routes.js";
import { contextStrip, emptyBlock, heading, isDemo, routeChip, stateChip, tag, withData } from "../ui/components.js";
import { openOutcomeDialog } from "./passport.js";

const tone = (v) => (v > 0 ? "gain" : v < 0 ? "loss" : "");

function card(e) {
  const d = e.decision;
  const c = e.comparison;
  const last = e.events[e.events.length - 1];
  const basis = c?.basis === "selected_route" ? "your selected route" : "the recommended route";
  return `<article class="ledger-card"><div class="row"><span class="micro">${esc(e.asset_id)} / ${d ? dateTime(d.at) : ""}</span>${stateChip(e.state)}</div><h3><a href="#passport/${encodeURIComponent(e.asset_id)}">${esc(e.model || e.asset_id)}</a></h3>${
    d
      ? `<p class="ledger-decision">${d.selected_route ? `Chose ${routeChip(d.selected_route)}` : `First move ${esc(eventInfo(d.event).label.toLowerCase())}`} · model said ${esc(routeInfo(d.route_at_time).label.toLowerCase())}${d.override ? ` ${tag("hypothesis", "override")}` : ""}</p>`
      : ""
  }${e.recommendation_changed && !e.terminal ? `<p class="choice-note">The recommendation has changed since: now ${esc(routeInfo(e.current_recommendation?.route).label.toLowerCase())}.</p>` : ""}${
    e.terminal
      ? c
        ? `<div class="ledger-value"><span>Realized net value</span><strong class="${tone(c.realized_value)}">${money(c.realized_value)}</strong></div><p class="ledger-variance ${tone(c.variance)}">${signedMoney(c.variance)} vs ${money(c.modeled_value)} modeled for ${esc(basis)} (model v${esc(c.model_version)})</p>${e.outcome_corrections ? `<small class="subtle">${e.outcome_corrections} earlier ${e.outcome_corrections === 1 ? "entry" : "entries"} superseded by a correction</small>` : ""}${e.outcome?.note ? `<p class="tl-note">“${esc(e.outcome.note)}”</p>` : ""}<button class="textlink" data-action="record" data-id="${esc(e.asset_id)}" ${isDemo() ? "disabled" : ""}>Record a correction</button>`
        : `<div class="ledger-value"><span>Modeled at decision time</span><strong>${money(d?.selected_route_value ?? d?.recommendation?.route_value)}</strong></div><p class="subtle">${esc(stateInfo(e.state).label)} ${e.completed ? dateTime(e.completed.at) : ""}. No realized value yet.</p><button class="btn secondary" data-action="record" data-id="${esc(e.asset_id)}" ${isDemo() ? "disabled" : ""}>Record what happened ↗</button>`
      : `<div class="ledger-value"><span>Modeled at decision time</span><strong>${money(d?.selected_route_value ?? d?.recommendation?.route_value)}</strong></div><p class="subtle">Latest: ${last ? `${esc(eventInfo(last.event).verb)} ${dateTime(last.at)}` : "—"}. An outcome can be recorded once it reaches a final state.</p>`
  }</article>`;
}

function body(data) {
  const s = data.summary;
  const open = data.entries.filter((e) => !e.terminal);
  const done = data.entries.filter((e) => e.terminal);
  const lane = (list, title, sub, empty) =>
    `<section class="ledger-lane" aria-label="${esc(title)}"><div class="lane-title"><div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div><span>${list.length}</span></div>${list.map(card).join("") || empty}</section>`;
  return (
    contextStrip([`${s.in_motion} in motion`, `${s.completed} complete`, `${s.with_outcome} with a realized value`]) +
    heading("Outcomes", "Every next chapter.<br><em>Accounted for.</em>", "A decision is a beginning. The outcome tells you what to learn.", `<a class="btn secondary" href="#command">Build a new plan ↗</a>`) +
    `<div class="outcome-score"><div><span class="micro">REALIZED VALUE</span><strong class="${tone(s.realized_total)}">${s.with_outcome ? money(s.realized_total) : "—"}</strong><p>${s.with_outcome} recorded ${s.with_outcome === 1 ? "outcome" : "outcomes"} of ${s.completed} completed</p></div><div><span class="micro">AGAINST THE MODEL</span><strong class="${tone(s.variance_total)}">${s.with_outcome ? signedMoney(s.variance_total) : "—"}</strong><p>${s.with_outcome ? `vs ${money(s.modeled_total_for_recorded)} modeled for the same decisions` : "Variance appears once an outcome is recorded"}</p></div><div class="score-story"><span aria-hidden="true">↗</span><p>The more you close the loop,<br><em>the clearer the next move.</em></p></div></div>
    <p class="figure-note">Realized values are what people recorded, after every cost; they can be negative. The model value is the one stored when the first move was made, for the selected route if one was chosen. ${isDemo() ? "Demo outcomes are illustrative entries recorded by the snapshot script." : ""}</p>
    ${
      data.entries.length
        ? `<div class="ledger-board">${lane(open, "In motion", "The next chapters already under way.", emptyBlock("↗", "Room for your next move.", "Take a first lifecycle step from a passport or Fleet Command.", `<a href="#command" class="textlink">Open Fleet Command ↗</a>`))}${lane(done, "Complete", "What actually happened.", emptyBlock("◎", "The story is still unfolding.", "Completed assets appear here, ready for their realized value."))}</div>`
        : emptyBlock("↗", "No decisions in motion yet.", "Outcomes start when an asset takes its first lifecycle step. Open a passport or build a plan in Fleet Command.", `<a href="#fleet" class="textlink">Meet your fleet ↗</a>`)
    }`
  );
}

export default {
  title: "Outcomes",
  render() {
    return withData([R.outcomes()], body, { retryKeys: ["outcomes"] });
  },
  actions: {
    record: (el) => {
      const e = R.outcomes().data?.entries.find((x) => x.asset_id === el.dataset.id);
      if (!e) return;
      const route = e.decision?.selected_route || e.current_recommendation?.route;
      openOutcomeDialog({
        id: e.asset_id,
        model: e.model,
        state: e.state,
        routeValue: e.decision?.selected_route_value ?? e.current_recommendation?.route_value,
        routeInfo: routeInfo(route),
      });
    },
  },
};
