/**
 * #pitch: the finals stage demo for SYN-003. One fixed 16:9 canvas, scaled to any screen.
 * Static: reads only the recorded fixture, never the API, so it works while Render sleeps.
 *
 * Step 1  $1.57 (Shauryaa)      host for 12 months leads
 * Step 2  $0.80 (Shauryaa)      hosting falls, list and wait wins
 * Step 3  $0.80 (Saksham)       optional: spotlight on the routes and the passport
 * Keys: → / Space / PageDown next, ← / PageUp back, 1 2 3 jump, R reset, F full screen.
 */
import { money, signedMoney } from "../lib/format.js";
import { esc } from "../lib/html.js";
import { CASE, RATE_COPY, stageModel } from "../pitch/stage.js";

const W = 1600;
const H = 900;
const MAX_BAR = 100000;

let step = 1;
let cleanup = [];

export const rateForStep = (s) => (s >= 2 ? "stage" : "index");

export function stepFromQuery(q = {}) {
  if (q.step && /^[123]$/.test(q.step)) return Number(q.step);
  if (q.rate === "0.80" || q.rate === "0.8") return 2;
  return 1;
}

const barPct = (v) => (v == null ? 0 : Math.max(2, Math.min(100, (v / MAX_BAR) * 100)));

function cardsHtml(m) {
  return m.cards
    .map(
      (c) => `<article class="pc-card${c.recommended ? " is-rec" : ""}" data-card="${c.route}">
        <span class="pc-badge">Recommended</span>
        <h3>${esc(c.title)}</h3>
        <strong class="pc-num" data-count="${c.value}">${money(c.value)}</strong>
        <p>${esc(c.note)}</p>
      </article>`,
    )
    .join("");
}

function ladderHtml(m) {
  return m.ladder
    .map(
      (l) => `<li class="pl-row tone-${l.tone}" data-ladder="${l.route}">
        <span class="pl-name">${esc(l.title)}</span>
        <span class="pl-track"><span class="pl-bar" style="width:${barPct(l.value)}%"></span></span>
        <span class="pl-val" ${l.value == null ? "" : `data-count="${l.value}"`}>${l.value == null ? "—" : money(l.value)}</span>
        <span class="pl-status">${esc(l.text)}</span>
      </li>`,
    )
    .join("");
}

function dl(rows) {
  return rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
}

function movedHtml(m) {
  if (!m.moved) return `<span class="pm-kicker">Watch one input</span><p>The rental assumption feeds the two compute routes. Everything else stays fixed.</p>`;
  const x = m.moved;
  return `<span class="pm-kicker">The assumption that moved the call</span>
    <p class="pm-line"><b>${esc(x.input)}</b> <s>${esc(x.from)}</s> → <em>${esc(x.to)}</em></p>
    <p class="pm-line">Hosting <s>${money(x.hostFrom)}</s> → <em>${money(x.hostTo)}</em> · Call <s>${esc(x.callFrom)}</s> → <em>${esc(x.callTo)}</em></p>`;
}

function callHtml(m) {
  return `<span class="pcall-kicker">ReCompute recommends</span>
    <h2 class="pcall-route">${esc(m.routeLabel)}</h2>
    <div class="pcall-figs"><strong class="pc-num" data-count="${m.value}">${money(m.value)}</strong><span>${signedMoney(m.gain)} vs selling now</span></div>
    <p class="pcall-why">${esc(m.why)}</p>
    ${m.cashNote ? `<p class="pcall-cash">${esc(m.cashNote)}</p>` : ""}`;
}

function resultHtml(m) {
  return `<span>Result</span><b>${esc(m.routeLabel)} · ${money(m.value)}</b><em>${signedMoney(m.gain)} vs selling now</em>`;
}

function render(route) {
  step = stepFromQuery(route.query);
  const m = stageModel(rateForStep(step));
  const id = CASE.identity;
  return `<div class="pitch-viewport" data-step="${step}">
  <div class="pitch-stage" style="width:${W}px;height:${H}px">
    <div class="ps-top">
      <a class="exp-logo" href="#teaser" title="Back to the teaser">ReCompute<span>®</span></a>
      <div class="ps-id"><span class="ps-chip">Asset passport</span><b>${esc(CASE.asset_id)}</b><span>8× A100 80 GB · Grade ${esc(id.grade)} · ${esc(id.age_months)} months · ${esc(id.site)}</span></div>
      <div class="ps-flags"><span>Simulated fleet</span><span>Synthetic server</span><span>Model v${esc(CASE.model_version)}</span>
        <button type="button" class="ps-fs" data-action="pitch-fullscreen" aria-label="Full screen" title="Full screen (F)">⤢</button></div>
    </div>

    <div class="ps-control">
      <div class="ps-rate">
        <span class="ps-kicker">Rental assumption, per GPU-hour</span>
        <div class="ps-toggle" role="group" aria-label="Rental assumption">
          ${["index", "stage"]
            .map((k) => {
              const r = CASE.cases[k].rental_rate;
              return `<button type="button" class="ps-opt" data-action="pitch-rate" data-rate="${k}" aria-pressed="${rateForStep(step) === k}"><b>$${r.toFixed(2)}</b><small>${esc(RATE_COPY[k].short)}</small></button>`;
            })
            .join("")}
        </div>
        <p class="ps-rate-note" data-slot="rate-note">${esc(RATE_COPY[rateForStep(step)].note)}</p>
      </div>
      <div class="ps-moved" data-slot="moved">${movedHtml(m)}</div>
    </div>

    <div class="ps-head">
      <div class="ps-cards" data-slot="cards">${cardsHtml(m)}</div>
      <div class="ps-call" data-slot="call">${callHtml(m)}</div>
    </div>

    <div class="ps-detail">
      <div class="ps-ladder">
        <div class="ps-sec-head"><h4>Seven routes, one server</h4><span>Net value on the model’s own timeline</span></div>
        <ol data-slot="ladder">${ladderHtml(m)}</ol>
        <p class="ps-rule" data-slot="rule">${esc(m.rule)}</p>
      </div>
      <div class="ps-passport">
        <div class="ps-sec-head"><h4>The passport</h4><span>Condition, assumptions and result, kept together</span></div>
        <div class="pp-cols">
          <div class="pp-col"><h5>Condition</h5><dl>${dl(m.condition)}</dl>
            <h5>Inputs</h5><p class="pp-inputs"><span class="ok">✓ Inventory record</span><span class="na">NVIDIA diagnostic report: used when a capture exists. None on this record.</span></p></div>
          <div class="pp-col"><h5>Assumptions</h5><dl data-slot="assumptions">${dl(m.assumptions)}</dl></div>
        </div>
        <div class="pp-result"><p class="pp-result-line" data-slot="result">${resultHtml(m)}</p>
          <p>One call per server, costs and assumptions attached. Carried out with the provider the owner chooses.</p></div>
      </div>
    </div>

    <div class="ps-foot"><span>One server from a simulated fleet. Figures recorded from the ReCompute v${esc(CASE.model_version)} model, not live prices and not a realized result.</span><span class="ps-keys" data-slot="keys">${keysHtml()}</span></div>
  </div>
</div>`;
}

function keysHtml() {
  return [1, 2, 3].map((n) => `<button type="button" class="ps-dot${n === step ? " on" : ""}" data-action="pitch-step" data-step="${n}" aria-label="Step ${n}">${n}</button>`).join("");
}

/* ---------------------------------------------------------------- live updates */

function countTo(el, to, animate) {
  const from = Number(el.dataset.cur ?? el.dataset.count ?? to);
  el.dataset.cur = String(to);
  el.dataset.count = String(to);
  if (!animate || from === to || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = money(to);
    return;
  }
  const t0 = performance.now();
  const dur = 900;
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - (1 - k) ** 3;
    el.textContent = money(from + (to - from) * e);
    if (k < 1 && el.isConnected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function paint(root, animate = true) {
  const vp = root.querySelector(".pitch-viewport");
  if (!vp) return;
  const rateKey = rateForStep(step);
  const m = stageModel(rateKey);
  vp.dataset.step = String(step);
  vp.dataset.rate = rateKey;
  root.querySelectorAll(".ps-opt").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.rate === rateKey)));
  root.querySelector('[data-slot="rate-note"]').textContent = RATE_COPY[rateKey].note;
  root.querySelector('[data-slot="keys"]').innerHTML = keysHtml();

  const moved = root.querySelector('[data-slot="moved"]');
  const movedNow = moved.dataset.rate;
  if (movedNow !== rateKey) {
    moved.innerHTML = movedHtml(m);
    moved.dataset.rate = rateKey;
    moved.classList.toggle("is-moved", !!m.moved);
  }

  for (const c of m.cards) {
    const card = root.querySelector(`[data-card="${c.route}"]`);
    card.classList.toggle("is-rec", c.recommended);
    countTo(card.querySelector(".pc-num"), c.value, animate);
  }

  const call = root.querySelector('[data-slot="call"]');
  if (call.dataset.route !== m.route) {
    const prev = call.querySelector(".pc-num");
    const from = prev ? Number(prev.dataset.cur ?? prev.dataset.count) : m.value;
    call.innerHTML = callHtml(m);
    call.dataset.route = m.route;
    const num = call.querySelector(".pc-num");
    num.dataset.cur = String(from);
    countTo(num, m.value, animate);
    if (animate) {
      call.classList.remove("flip");
      void call.offsetWidth;
      call.classList.add("flip");
    }
  }

  for (const l of m.ladder) {
    const row = root.querySelector(`[data-ladder="${l.route}"]`);
    row.className = `pl-row tone-${l.tone}`;
    row.querySelector(".pl-bar").style.width = `${barPct(l.value)}%`;
    row.querySelector(".pl-status").textContent = l.text;
    const v = row.querySelector(".pl-val");
    if (l.value != null) countTo(v, l.value, animate);
  }
  root.querySelector('[data-slot="assumptions"]').innerHTML = dl(m.assumptions);
  root.querySelector('[data-slot="result"]').innerHTML = resultHtml(m);
}

function setStep(n, root) {
  const next = Math.max(1, Math.min(3, n));
  if (next === step) return;
  step = next;
  const q = step === 1 ? "" : `?step=${step}`;
  history.replaceState(null, "", `#pitch${q}`);
  paint(root || document.querySelector("#experience"));
}

function fit(root) {
  const stage = root.querySelector(".pitch-stage");
  if (!stage) return;
  const s = Math.min(innerWidth / W, innerHeight / H);
  stage.style.transform = `translate(${(innerWidth - W * s) / 2}px, ${(innerHeight - H * s) / 2}px) scale(${s})`;
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

function after(root) {
  leave();
  const vp = root.querySelector(".pitch-viewport");
  vp.dataset.rate = rateForStep(step);
  const moved = root.querySelector('[data-slot="moved"]');
  moved.dataset.rate = rateForStep(step);
  moved.classList.toggle("is-moved", step >= 2);
  root.querySelector('[data-slot="call"]').dataset.route = stageModel(rateForStep(step)).route;
  root.querySelectorAll("[data-count]").forEach((el) => (el.dataset.cur = el.dataset.count));

  const onResize = () => fit(root);
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.("input,textarea,select")) return;
    const k = e.key;
    // A focused button handles its own Space and Enter; don't advance twice.
    if ((k === " " || k === "Enter") && e.target.closest?.("button,a")) return;
    if (k === "ArrowRight" || k === "PageDown" || k === " " || k === "Enter") setStep(step + 1, root);
    else if (k === "ArrowLeft" || k === "PageUp" || k === "Backspace") setStep(step - 1, root);
    else if (k === "1" || k === "2" || k === "3") setStep(Number(k), root);
    else if (k === "r" || k === "R" || k === "Home" || k === "0") setStep(1, root);
    else if (k === "f" || k === "F") toggleFullscreen();
    else return;
    e.preventDefault();
  };
  addEventListener("resize", onResize);
  addEventListener("keydown", onKey);
  document.addEventListener("fullscreenchange", onResize);
  cleanup = [
    () => removeEventListener("resize", onResize),
    () => removeEventListener("keydown", onKey),
    () => document.removeEventListener("fullscreenchange", onResize),
  ];
  fit(root);
  // Kabir's click lands on a page that is already painted; nothing waits on the network.
  document.activeElement?.blur?.();
}

function leave() {
  cleanup.forEach((f) => f());
  cleanup = [];
}

export default {
  title: "SYN-003 stage demo",
  static: true,
  render,
  after,
  leave,
  actions: {
    "pitch-rate": (el) => {
      el.blur();
      setStep(el.dataset.rate === "stage" ? Math.max(2, step) : 1);
    },
    "pitch-step": (el) => {
      el.blur();
      setStep(Number(el.dataset.step));
    },
    "pitch-fullscreen": () => toggleFullscreen(),
  },
};
