import { navigate, rerender } from "../app.js";
import { loadSnapshot } from "../api/demo.js";
import { resource } from "../state/resources.js";
import { store } from "../state/store.js";
import { adaptAssetDetail, adaptDiagnostics } from "../lib/adapters.js";
import { money } from "../lib/format.js";
import { esc } from "../lib/html.js";
import { ROUTE_ORDER, routeInfo } from "../lib/routes.js";
import { boardArt, gpuArt } from "../ui/art.js";

export const STORY_ASSET = "DEMO-SHAURYAA";
const STORY_ROUTES = [
  ["SELL NOW", "Sell it now", "Today’s offer, net of fees. A clean next step."],
  ["HOST LONGER", "Keep it working", "Twelve months of rented compute, then a sale."],
  ["YIELD WHILE LISTED", "Earn while it’s listed", "Rented compute until a buyer appears."],
];

let chapter = 0;
let storyRoute = "SELL NOW";
let storyUtil = null;
let previewMode = "understand";

function story() {
  const entry = resource("snapshot", () => loadSnapshot());
  const snap = entry.data;
  if (!snap) return { ready: false, error: entry.error };
  const detail = snap.responses[`GET /assets/${STORY_ASSET}`];
  const lab = snap.lab[STORY_ASSET];
  const asset = adaptAssetDetail(detail, { meta: snap.responses["GET /meta"], history: snap.responses[`GET /assets/${STORY_ASSET}/history`] });
  const baseUtil = asset.resolved.utilization;
  if (storyUtil === null) storyUtil = baseUtil;
  const grid = lab.grids.utilization;
  const key = String(Math.round(storyUtil * 100) / 100);
  const run = grid[key] || { result: asset.recommendation.result };
  return { ready: true, snap, asset, diag: adaptDiagnostics(detail.diagnostics), run: run.result, baseUtil, grid };
}

function utilLabel(u) {
  return `${Math.round(u * 100)}%`;
}

function storyContent(s) {
  if (!s.ready) {
    return s.error
      ? `<div class="story-card"><p class="story-aside">The story data could not be loaded (${esc(s.error.message)}).</p></div>`
      : `<div class="story-card"><p class="story-aside" role="status">Loading the demo asset…</p></div>`;
  }
  const { asset, diag, run } = s;
  const v = (r) => run.base[r];
  if (chapter === 0)
    return `<div class="story-card meet-card"><div class="story-object">${gpuArt()}<span class="object-id">${esc(asset.id)} / DEMO SELLERS</span></div><div class="story-copy"><span class="chapter-label">01 / MEET IT</span><h3>Still powerful.<br>Just between jobs.</h3><p>An eight-GPU A100 server that has done its first job. The workload moved on. The hardware hasn’t lost its potential.</p><div class="human-stats"><div><strong>8 × 80 GB</strong><span>A100 GPUs</span></div><div><strong>Grade ${esc(diag.grade)}</strong><span>${esc(diag.score)} / 100 · simulated diagnostics</span></div></div><button class="experience-button" data-action="story-next">Look a little closer <span>→</span></button></div></div>`;
  if (chapter === 1) {
    const info = diag.findings.filter((f) => f.severity === "INFO").length;
    const critical = diag.findings.filter((f) => f.severity === "CRITICAL").length;
    return `<div class="story-card"><div class="editorial-passport"><div class="row"><span>RECOMPUTE / ASSET PASSPORT</span><span>↗</span></div><h4>8× NVIDIA A100</h4><p>Every asset deserves to be understood.</p><div class="passport-lines"><div><span>Condition</span><b>Grade ${esc(diag.grade)} · ${esc(diag.score)} / 100</b></div><div><span>Findings</span><b>${critical} critical · ${info} routine self-repair</b></div><div><span>Evidence confidence</span><b>${esc(diag.evidenceConfidence)} · run level ${esc(diag.runLevel)}</b></div><div><span>Model recommends</span><b>${esc(routeInfo(asset.route).label)} · ${money(asset.routeValue)}</b></div></div><div class="passport-stamp">${esc(asset.id)} <span>SIMULATED DIAGNOSTICS</span></div></div><div class="story-copy"><span class="chapter-label">02 / UNDERSTAND IT</span><h3>A passport.<br>Not just a price tag.</h3><p>Condition, evidence, repairability and economics. A useful decision starts with the whole asset, not a number in a spreadsheet.</p><p class="story-aside">This one passed every test. No repair is needed. So the real question is: earn more from it, or move on?</p><button class="experience-button" data-action="story-next">Explore its futures <span>→</span></button></div></div>`;
  }
  if (chapter === 2)
    return `<div class="story-card futures-card"><div class="future-options"><span class="chapter-label">THREE POSSIBLE NEXT CHAPTERS</span>${STORY_ROUTES.map(
      ([r, title, sub]) =>
        `<button class="future-option ${storyRoute === r ? "chosen" : ""}" data-action="story-route" data-route="${r}" aria-pressed="${storyRoute === r}"><span class="option-ring"></span><span><b>${title}${run.route === r ? ` <em class="model-pick">model’s pick</em>` : ""}</b><small>${sub}</small></span><strong>${money(v(r))}</strong></button>`,
    ).join(
      "",
    )}<p class="model-note">Net value of each route from the ReCompute v0.9 model, recorded in the demo snapshot. Estimates, not quotes.</p></div><div class="story-copy"><span class="chapter-label">03 / EXPLORE ITS FUTURES</span><h3>The answer changes.<br><em>Try changing the question.</em></h3><p>How busy could you keep this server? Move the slider and watch the recommendation respond.</p><label class="story-slider" for="storyUtil"><span>Expected utilization <b id="story-util-value">${utilLabel(storyUtil)}</b></span><input id="storyUtil" type="range" min="20" max="100" step="5" value="${Math.round(storyUtil * 100)}" aria-valuetext="${utilLabel(storyUtil)} utilization"></label><p class="story-aside" id="story-why" aria-live="polite">${storyWhy(s)}</p><button class="experience-button" data-action="story-next">Choose this next chapter <span>→</span></button></div></div>`;
  const chosen = routeInfo(storyRoute);
  return `<div class="story-card decision-card"><div class="decision-poster"><span>THE NEXT CHAPTER / ${esc(asset.id)}</span><div class="decision-symbol">${chosen.symbol}</div><h4>${esc(chosen.promise)}</h4><span>VALUE, REDIRECTED.</span></div><div class="story-copy"><span class="chapter-label">04 / MAKE A MOVE</span><h3>Your decision.<br>With the why behind it.</h3><p>You chose <strong>${esc(chosen.label.toLowerCase())}</strong>. At ${utilLabel(storyUtil)} utilization the model values it at <strong>${money(v(storyRoute))}</strong>${
    run.route === storyRoute ? ", and it is the model’s own recommendation." : `. The model itself recommends <strong>${esc(routeInfo(run.route).label.toLowerCase())}</strong> at ${money(v(run.route))}.`
  }</p><p class="story-aside">${run.audit.map(esc).slice(-1)[0] || ""} Next, open the passport to see the evidence, then make the move in the workspace.</p><button class="experience-button" data-action="story-save">Open its passport <span>↗</span></button><button class="story-back" data-action="story-chapter" data-chapter="2">← Revisit the possibilities</button><small class="model-note">Your choice is kept as a draft. Nothing is listed, sold or hosted.</small></div></div>`;
}

function storyWhy(s) {
  const { run } = s;
  const host = run.base["HOST LONGER"];
  const sell = run.base["SELL NOW"];
  if (run.route === "HOST LONGER")
    return `At ${utilLabel(storyUtil)} the model recommends hosting longer: it beats selling by ${money(host - sell)} and still wins in its stress case.`;
  if (host > sell)
    return `Hosting looks ${money(host - sell)} better on paper, but the model rejects it: in its stress case (weaker demand, faster decline) it loses. So it recommends ${routeInfo(run.route).label.toLowerCase()}.`;
  return `At ${utilLabel(storyUtil)} hosting earns less than selling today, so the model recommends ${routeInfo(run.route).label.toLowerCase()}.`;
}

function refreshStory(root = document) {
  const el = root.querySelector("#story-content");
  if (!el) return;
  el.innerHTML = storyContent(story());
  root.querySelectorAll("[data-chapter]").forEach((b) => {
    const cur = +b.dataset.chapter === chapter;
    b.classList.toggle("current", cur);
    if (cur) b.setAttribute("aria-current", "step");
    else b.removeAttribute("aria-current");
  });
}

function bridgePreview(s) {
  const p = {
    understand: ["01 / UNDERSTAND", "A whole asset.<br>A clearer picture.", "Explore the fleet", "#fleet",
      "See beyond a model number. Diagnostics, repairability and economics belong together."],
    explore: ["02 / EXPLORE", "What changes<br>when you change the inputs?", "Open the What-if Lab", "#lab",
      "Change demand, power and timing assumptions. The decision model recalculates every route."],
    act: ["03 / ACT", "A considered decision.<br>A plan you can follow.", "Build a fleet plan", "#command",
      "Review each recommendation, choose your route, then commit the first lifecycle step and track the outcome."],
  }[previewMode];
  const a = s.ready ? s.asset : null;
  let object = "";
  if (previewMode === "understand")
    object = a
      ? `<div class="mini-passport"><div class="row"><span class="micro">ASSET PASSPORT</span><span class="micro">${esc(a.id)}</span></div>${boardArt(a)}<h4>A100 <small>80 GB · 8 GPUs</small></h4><div class="row"><span>Grade ${esc(s.diag.grade)} · ${esc(s.diag.score)}/100</span><b>${money(a.routeValue)}</b></div><div class="mini-status">● ${esc(routeInfo(a.route).label)} recommended</div></div>`
      : "";
  else if (previewMode === "explore") {
    const base = a?.recommendation?.result?.base;
    object = `<div class="mini-scenario"><span class="micro">ONE ASSET. DIFFERENT FUTURES.</span><h4>What if <em>it keeps earning?</em></h4><div class="mini-plot"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="row"><span>Sell now</span><b>${money(base?.["SELL NOW"])}</b></div><div class="row"><span>Host longer</span><b>${money(base?.["HOST LONGER"])}</b></div><small>Recorded v0.9 model output · demo asset</small></div>`;
  } else
    object = `<div class="mini-plan"><span class="micro">A PLAN WITH A PURPOSE</span>${[
      ["H100", "Earn", "≈"],
      ["A100", "Exit", "↗"],
      ["A100 40GB", "Recover", "＋"],
    ]
      .map((x) => `<div><span>${x[2]}</span><b>${x[0]}</b><small>${x[1]}</small></div>`)
      .join("")}<p>One fleet. Several new beginnings.</p></div>`;
  return `<div class="bridge-copy"><span class="micro">${p[0]}</span><h3>${p[1]}</h3><p>${p[4]}</p><a class="btn" href="${p[3]}">${p[2]} ↗</a></div><div class="bridge-object">${object}</div>`;
}

function studioBridge(s) {
  return `<section class="studio-bridge"><div class="bridge-heading"><div><span class="section-index">THE EXPERIENCE DOESN’T END AT THE DEMO</span><h2>Curiosity, meet<br><em>your decision studio.</em></h2></div><p>A place to understand, explore, and act.<br>Built around the next move—not just the numbers.</p></div><div class="bridge-tabs">${[
    ["understand", "Understand the asset"],
    ["explore", "Explore the possibilities"],
    ["act", "Make a plan"],
  ]
    .map(([k, t]) => `<button data-action="bridge" data-bridge="${k}" aria-pressed="${previewMode === k}">${t}</button>`)
    .join("")}</div><div id="bridge-preview" class="bridge-preview">${bridgePreview(s)}</div></section>`;
}

export default {
  title: "Home",
  render() {
    const s = story();
    return `<nav class="exp-nav" aria-label="Landing"><a href="#home" class="exp-logo">ReCompute<span>®</span></a><div><a href="#story" data-action="start-story" data-idea>The idea</a><a href="#story" data-action="start-story">Try the experience</a><a class="exp-nav-cta" href="#overview">Enter the studio ↗</a></div></nav><main class="exp-main"><section class="exp-hero"><div class="hero-kicker"><span></span> A NEW WAY TO SEE WHAT’S NEXT</div><h1>Not done.<br><span>Just <i>next.</i></span></h1><div class="hero-note"><span class="tiny-number">01 / A DIFFERENT PERSPECTIVE</span><p>Yesterday’s breakthrough.<br>Tomorrow’s possibility.</p><p class="muted-copy">Your GPU servers have more than one future.<br>ReCompute helps you find the one worth more.</p><button class="experience-button" data-action="start-story">Find its next life <span>↗</span></button><small>A 60-second exploration. No setup.</small></div><div class="hardware-scene">${gpuArt()}<div class="hardware-caption"><span>MEET OUR DEMO ASSET</span><b>NVIDIA A100 <i>80 GB × 8</i></b><span>Graded from simulated NVIDIA diagnostics.</span></div><div class="spec-sticker">NOT<br>OBSOLETE.<span>RE:COMPUTE / 001</span></div></div><div class="hero-bottom"><span>THE NEXT LIFE OF COMPUTE</span><a href="#story" data-action="start-story">Scroll into possibility ↓</a><span>VALUE, REDIRECTED.</span></div></section><section class="manifesto"><span class="section-index">THE SHIFT / 01</span><div><h2>A GPU isn’t finished<br>when <em>one job is.</em></h2><p>Maybe it earns for another year. Maybe it finds a new owner. Maybe one repair changes everything. The hard part isn’t having options. It’s knowing which one makes sense.</p><p class="manifesto-end">That’s where ReCompute comes in. <span>↘</span></p></div></section><section class="story-section" id="story"><div class="story-heading"><div><span class="section-index">A SMALL DEMO. A DIFFERENT WAY TO DECIDE.</span><h2>One asset.<br><em>What happens next?</em></h2></div><p>Take this A100 server through its next chapter.<br>You’re in control. The model shows its thinking.</p></div><div class="chapter-nav" role="group" aria-label="Demo chapters">${["Meet it", "Understand it", "Explore its futures", "Make a move"]
      .map(
        (t, i) =>
          `<button data-action="story-chapter" data-chapter="${i}" class="${chapter === i ? "current" : ""}" ${chapter === i ? 'aria-current="step"' : ""}><span>0${i + 1}</span>${t}</button>`,
      )
      .join("")}</div><div id="story-content">${storyContent(s)}</div></section>${studioBridge(s)}<section class="possibilities"><div><span class="section-index">SEVEN ROUTES. NO ONE-SIZE-FITS-ALL ANSWER.</span><h2>There’s more than<br>one way <em>forward.</em></h2></div><div class="route-list">${ROUTE_ORDER.map(
      (r, i) => `<div><span>0${i + 1}</span><h3>${esc(routeInfo(r).label)}</h3><p>${esc(routeInfo(r).promise)}</p></div>`,
    ).join(
      "",
    )}</div></section><section class="exp-finale"><span class="section-index">FROM ONE ASSET TO THE WHOLE PICTURE</span><h2>Now imagine<br><em>your entire fleet.</em></h2><p>Every passport. Every possibility. One place to see the next move.</p><a class="experience-button" href="#overview">Explore the Decision Studio <span>↗</span></a><div class="finale-features"><span>Asset passports</span><span>Fleet Command</span><span>What-if Lab</span><span>Decision Replay</span></div></section></main><footer class="exp-footer"><a href="#home" class="exp-logo">ReCompute®</a><span>Value, redirected.</span><small>Story uses recorded v0.9 model output on a simulated asset · No real transactions</small></footer>`;
  },
  actions: {
    "start-story": (el) => {
      document.querySelector(el.hasAttribute("data-idea") ? ".manifesto" : "#story")?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
    },
    "story-chapter": (el) => {
      chapter = +el.dataset.chapter;
      refreshStory();
    },
    "story-next": () => {
      chapter = Math.min(3, chapter + 1);
      refreshStory();
      document.querySelector("#story-content button, #story-content input")?.focus({ preventScroll: true });
    },
    "story-route": (el) => {
      storyRoute = el.dataset.route;
      refreshStory();
      document.querySelector(`[data-route="${CSS.escape(storyRoute)}"]`)?.focus();
    },
    "story-save": () => {
      store.update((ws) => {
        ws.selections[STORY_ASSET] = storyRoute;
        ws.focusAssetId = STORY_ASSET;
      });
      navigate(`#passport/${STORY_ASSET}`);
    },
    bridge: (el) => {
      previewMode = el.dataset.bridge;
      document.querySelectorAll("[data-bridge]").forEach((b) => b.setAttribute("aria-pressed", b === el));
      document.querySelector("#bridge-preview").innerHTML = bridgePreview(story());
    },
  },
  onInput(e) {
    if (e.target.id !== "storyUtil") return;
    storyUtil = +e.target.value / 100;
    const s = story();
    if (!s.ready) return;
    document.querySelector("#story-util-value").textContent = utilLabel(storyUtil);
    e.target.setAttribute("aria-valuetext", `${utilLabel(storyUtil)} utilization`);
    document.querySelectorAll(".future-option").forEach((b) => {
      const r = b.dataset.route;
      b.querySelector("strong").textContent = money(s.run.base[r]);
      const title = b.querySelector("b");
      const label = STORY_ROUTES.find((x) => x[0] === r)[1];
      title.innerHTML = `${label}${s.run.route === r ? ` <em class="model-pick">model’s pick</em>` : ""}`;
    });
    document.querySelector("#story-why").textContent = storyWhy(s);
  },
  rerender,
};
