/**
 * Ambient illustrations and the small runtime that keeps them smooth.
 *
 * Views re-render by replacing innerHTML, so every illustration is re-created often. To avoid visible
 * restarts, SMIL timelines are fast-forwarded to the page clock and CSS animations get a matching
 * negative delay. Entrance reveals play once per illustration key per page load. Everything off-screen
 * is paused, and prefers-reduced-motion freezes all of it on a composed still frame.
 */

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealed = new Set();
let observer = null;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const f = (n) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------------ lifecycle orbit (landing) */

const LANES = [
  { label: "Keep earning", rx: 150, ry: 54, tilt: -18, dur: 14, color: "#a9c46f" },
  { label: "Exit well", rx: 124, ry: 92, tilt: 32, dur: 19, color: "#c98a5f" },
  { label: "Recover value", rx: 96, ry: 140, tilt: 74, dur: 24, color: "#d8cf8f" },
];

function ellipsePath(rx, ry) {
  return `M${-rx} 0A${rx} ${ry} 0 1 1 ${rx} 0A${rx} ${ry} 0 1 1 ${-rx} 0Z`;
}

export function orbitArt() {
  const orbits = LANES.map((l, i) => {
    const id = `orbit-p${i}`;
    return `<g transform="rotate(${l.tilt})"><path id="${id}" class="draw" pathLength="1" d="${ellipsePath(l.rx, l.ry)}" style="--d:${0.15 + i * 0.22}s"/>
      <g class="comet"><circle r="9" fill="${l.color}" opacity=".18"/><circle r="4.2" fill="${l.color}"/><animateMotion dur="${l.dur}s" repeatCount="indefinite" rotate="auto"><mpath href="#${id}"/></animateMotion></g>
      <g class="comet faint"><circle r="2.4" fill="${l.color}" opacity=".7"/><animateMotion dur="${l.dur}s" begin="-${(l.dur * 0.5).toFixed(1)}s" repeatCount="indefinite"><mpath href="#${id}"/></animateMotion></g></g>`;
  }).join("");
  const labels = [
    [-176, -86, LANES[0]],
    [118, -128, LANES[1]],
    [70, 160, LANES[2]],
  ]
    .map(([x, y, l], i) => `<g class="orbit-label" style="--d:${0.9 + i * 0.18}s"><circle cx="${x}" cy="${y - 4}" r="3" fill="${l.color}"/><text x="${x + 9}" y="${y}">${l.label}</text></g>`)
    .join("");
  return `<div class="orbit-art" data-motion="orbit" aria-hidden="true"><svg viewBox="-210 -200 420 400" focusable="false"><defs><radialGradient id="orbit-core"><stop stop-color="#dcf587" stop-opacity=".55"/><stop offset="1" stop-color="#dcf587" stop-opacity="0"/></radialGradient></defs>
    <circle r="92" fill="url(#orbit-core)" class="core-glow"><animate attributeName="r" values="78;98;78" dur="7s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1"/></circle>
    <g class="orbits">${orbits}</g>
    <g class="orbit-chip"><rect x="-34" y="-34" width="68" height="68" rx="12" fill="#263d2e"/><rect x="-25" y="-25" width="50" height="50" rx="7" fill="none" stroke="#dcf587" stroke-opacity=".35"/>${[-16, -5.5, 5.5, 16]
      .map((p) => `<path d="M${p} -34v-9M${p} 34v9M-34 ${p}h-9M34 ${p}h9" stroke="#263d2e" stroke-width="2.4" stroke-linecap="round"/>`)
      .join("")}<text y="7" text-anchor="middle" class="chip-mark">Re.</text></g>
    ${labels}</svg></div>`;
}

/* ------------------------------------------------------------------ fleet constellation (landing finale) */

export function constellationArt() {
  const r = rng(7);
  const W = 1200;
  const H = 520;
  const nodes = [];
  for (let gy = 0; gy < 7; gy++) {
    for (let gx = 0; gx < 15; gx++) {
      const x = 40 + gx * 80 + (r() - 0.5) * 46;
      const y = 40 + gy * 74 + (r() - 0.5) * 40;
      const dx = (x - W / 2) / (W / 2);
      const dy = (y - H / 2) / (H / 2);
      if (dx * dx * 1.4 + dy * dy * 1.1 < 0.42 && r() < 0.85) continue;
      nodes.push({ x: f(x), y: f(y), lit: r() < 0.16, d: f(r() * 9) });
    }
  }
  const edges = [];
  nodes.forEach((a, i) => {
    const near = nodes
      .map((b, j) => ({ j, d: (a.x - b.x) ** 2 + (a.y - b.y) ** 2 }))
      .filter((o) => o.j > i && o.d < 105 ** 2)
      .sort((p, q) => p.d - q.d)
      .slice(0, 2);
    near.forEach((o) => edges.push([a, nodes[o.j]]));
  });
  const lines = edges.map(([a, b]) => `M${a.x} ${a.y}L${b.x} ${b.y}`).join("");
  const routes = [];
  const pr = rng(19);
  for (let k = 0; k < 9; k++) {
    let cur = nodes[Math.floor(pr() * nodes.length)];
    let d = `M${cur.x} ${cur.y}`;
    for (let step = 0; step < 5; step++) {
      const opts = edges.filter(([a, b]) => a === cur || b === cur);
      if (!opts.length) break;
      const [a, b] = opts[Math.floor(pr() * opts.length)];
      cur = a === cur ? b : a;
      d += `L${cur.x} ${cur.y}`;
    }
    routes.push({ d, dur: f(5 + pr() * 6), begin: f(-pr() * 10) });
  }
  return `<div class="constellation-art" data-motion="constellation" aria-hidden="true"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" focusable="false">
    <path d="${lines}" class="c-edges"/>
    ${routes
      .map(
        (p, i) =>
          `<path id="c-route${i}" d="${p.d}" fill="none"/><g><circle r="2.6" fill="#dcf587"/><circle r="8" fill="#dcf587" opacity=".14"/><animateMotion dur="${p.dur}s" begin="${p.begin}s" repeatCount="indefinite" calcMode="linear"><mpath href="#c-route${i}"/></animateMotion><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.12;.85;1" dur="${p.dur}s" begin="${p.begin}s" repeatCount="indefinite"/></g>`,
      )
      .join("")}
    ${nodes
      .map(
        (n) =>
          `<rect x="${f(n.x - 7)}" y="${f(n.y - 5)}" width="14" height="10" rx="2.5" class="c-node${n.lit ? " lit" : ""}">${
            n.lit ? `<animate attributeName="opacity" values=".35;1;.35" dur="${f(4 + (n.d % 4))}s" begin="-${n.d}s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1"/>` : ""
          }</rect>`,
      )
      .join("")}</svg></div>`;
}

/* ------------------------------------------------------------------ value flow (about) */

export function aboutArt() {
  const ends = [
    { y: 46, label: "Keep earning", sub: "Rent or host it longer", color: "#8fae5a" },
    { y: 110, label: "Exit well", sub: "Sell it at the right moment", color: "#c47a4f" },
    { y: 174, label: "Recover value", sub: "Repair, harvest or recycle", color: "#bfb36a" },
  ];
  const paths = ends.map((e, i) => {
    const id = `flow-p${i}`;
    return `<path id="${id}" class="draw flow-line" pathLength="1" d="M150 110C300 110 330 ${e.y} 470 ${e.y}" style="--d:${0.25 + i * 0.15}s;stroke:${e.color}"/>${[0, 1, 2]
      .map(
        (k) =>
          `<circle r="3.4" fill="${e.color}"><animateMotion dur="3.6s" begin="-${f(k * 1.2 + i * 0.4)}s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines=".4 0 .6 1"><mpath href="#${id}"/></animateMotion><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.15;.8;1" dur="3.6s" begin="-${f(k * 1.2 + i * 0.4)}s" repeatCount="indefinite"/></circle>`,
      )
      .join("")}<g class="flow-end" style="--d:${0.7 + i * 0.15}s"><circle cx="484" cy="${e.y}" r="7" fill="${e.color}"/><circle cx="484" cy="${e.y}" r="7" fill="none" stroke="${e.color}" class="ping"><animate attributeName="r" values="7;17" dur="2.4s" begin="-${i * 0.8}s" repeatCount="indefinite"/><animate attributeName="opacity" values=".6;0" dur="2.4s" begin="-${i * 0.8}s" repeatCount="indefinite"/></circle><text x="504" y="${e.y - 2}" class="flow-label">${e.label}</text><text x="504" y="${e.y + 15}" class="flow-sub">${e.sub}</text></g>`;
  }).join("");
  return `<div class="flow-art" data-motion="flow" aria-hidden="true"><svg viewBox="0 0 720 220" focusable="false">
    <g class="flow-source"><rect x="38" y="70" width="112" height="80" rx="12" fill="#263d2e"/><rect x="50" y="82" width="88" height="56" rx="7" fill="none" stroke="#dcf587" stroke-opacity=".3"/>${Array.from({ length: 6 }, (_, i) => `<path d="M${58 + i * 14} 150v9" stroke="#263d2e" stroke-width="3" stroke-linecap="round"/>`).join("")}<text x="94" y="116" text-anchor="middle" class="chip-mark">Re.</text><circle cx="132" cy="90" r="3" fill="#dcf587"><animate attributeName="opacity" values="1;.25;1" dur="2.2s" repeatCount="indefinite"/></circle><text x="94" y="186" text-anchor="middle" class="flow-sub">Your GPU server</text></g>
    ${paths}</svg></div>`;
}

/* ------------------------------------------------------------------ runtime */

function clockMs() {
  return performance.now();
}

function setActive(el, on) {
  el.classList.toggle("in-view", on);
  if (on && !el.classList.contains("revealed")) {
    el.classList.add("revealed");
    revealed.add(el.dataset.motion);
  }
  el.querySelectorAll("svg").forEach((svg) => {
    if (reduced()) return svg.pauseAnimations?.();
    if (on) svg.unpauseAnimations?.();
    else svg.pauseAnimations?.();
  });
}

/** Call after every render with the root that was replaced. */
export function mountMotion(root) {
  if (!root) return;
  if (!observer && "IntersectionObserver" in window) {
    observer = new IntersectionObserver((entries) => entries.forEach((e) => setActive(e.target, e.isIntersecting)), { rootMargin: "80px" });
  }
  const now = clockMs();
  root.querySelectorAll("[data-motion]").forEach((el) => {
    if (el.dataset.mounted) return;
    el.dataset.mounted = "1";
    el.style.setProperty("--motion-delay", `-${Math.round(now)}ms`);
    if (revealed.has(el.dataset.motion)) el.classList.add("revealed", "no-enter");
    el.querySelectorAll("svg").forEach((svg) => {
      try {
        svg.setCurrentTime?.(reduced() ? 2.5 : now / 1000);
      } catch {
        /* SMIL unsupported */
      }
      svg.pauseAnimations?.();
    });
    if (observer) observer.observe(el);
    else setActive(el, true);
  });
  mountTilt(root);
}

function mountTilt(root) {
  const scene = root.querySelector(".hardware-scene");
  if (!scene || scene.dataset.tilt || reduced() || !matchMedia("(hover: hover)").matches) return;
  scene.dataset.tilt = "1";
  let frame = 0;
  scene.addEventListener("pointermove", (ev) => {
    const b = scene.getBoundingClientRect();
    const x = (ev.clientX - b.left) / b.width - 0.5;
    const y = (ev.clientY - b.top) / b.height - 0.5;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      scene.style.setProperty("--tilt-x", `${f(y * -7)}deg`);
      scene.style.setProperty("--tilt-y", `${f(x * 9)}deg`);
      scene.style.setProperty("--glow-x", `${f((x + 0.5) * 100)}%`);
    });
  });
  scene.addEventListener("pointerleave", () => {
    cancelAnimationFrame(frame);
    scene.style.setProperty("--tilt-x", "0deg");
    scene.style.setProperty("--tilt-y", "0deg");
  });
}
