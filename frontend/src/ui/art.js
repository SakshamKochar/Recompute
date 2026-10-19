import { esc } from "../lib/html.js";

/** The landing-page hardware illustration from the design prototype, with ambient motion. Decorative. */
let gpuSeq = 0;
export function gpuArt(label = "A100 / Next chapter") {
  gpuSeq += 1;
  const n = gpuSeq;
  let svg = `<svg viewBox="0 0 700 330" class="gpu-art" data-motion-svg aria-hidden="true" focusable="false"><defs><linearGradient id="metal" x2=".2" y2="1"><stop stop-color="#e3e3d9"/><stop offset=".45" stop-color="#a8aca3"/><stop offset="1" stop-color="#747c73"/></linearGradient><linearGradient id="edge" x2="0" y2="1"><stop stop-color="#464d43"/><stop offset="1" stop-color="#202a23"/></linearGradient><pattern id="ribs" width="9" height="9" patternUnits="userSpaceOnUse"><path d="M0 0V9" stroke="#3f493e" stroke-width="4"/></pattern><linearGradient id="sheen" x2="1"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><clipPath id="shroud"><path d="M0 0H510V180H0Z"/></clipPath><radialGradient id="fan"><stop stop-color="#66715e"/><stop offset=".28" stop-color="#243127"/><stop offset="1" stop-color="#101c16"/></radialGradient></defs><g><animateTransform attributeName="transform" type="translate" values="0 0;0 -7;0 0" dur="7s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1"/><g transform="translate(75 53) rotate(-7 270 110)"><path d="M0 15L510 15 545 38 545 204 35 204 0 180Z" fill="url(#edge)"/><path d="M0 0H510V180H0Z" fill="url(#metal)" stroke="#cbd0c2" stroke-width="2"/><path d="M18 16H490V163H18Z" fill="url(#ribs)"/><path d="M22 21H156L196 62V113L150 158H22Z M487 21H350L306 62V113L351 158H487Z" fill="#b6bdb0"/><path d="M178 23H320L285 58V124L322 159H175L210 122V61Z" fill="#d4d8cd"/><path d="M183 29H312L276 65V115L312 151H184L219 119V65Z" fill="#899783"/><text x="246" y="95" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#273d2c">Re.</text>${[94, 413]
    .map(
      (cx) =>
        `<g transform="translate(${cx} 90)"><circle r="64" fill="#606c5d"/><circle r="58" fill="url(#fan)"/><g><animateTransform attributeName="transform" type="rotate" from="0" to="${cx < 200 ? 360 : -360}" dur="${cx < 200 ? 3.2 : 3.6}s" repeatCount="indefinite"/>${Array.from(
          { length: 11 },
          (_, i) =>
            `<path d="M-5-15C-35-30-36-48-11-51C-18-34 7-27 11-14Z" fill="#6b7967" opacity=".8" transform="rotate(${(i * 360) / 11})"/>`,
        ).join("")}</g><circle r="19" fill="#344331" stroke="#91a082"/><circle r="9" fill="#52664a"/></g>`,
    )
    .join("")}<g clip-path="url(#shroud)"><rect x="-160" y="-20" width="110" height="230" fill="url(#sheen)" transform="skewX(-18)" opacity=".7"><animate attributeName="x" values="-160;-160;700" keyTimes="0;.55;1" dur="6.5s" repeatCount="indefinite" calcMode="spline" keySplines="0 0 1 1;.5 0 .3 1"/></rect></g><circle cx="497" cy="168" r="3.2" fill="#dcf587"><animate attributeName="opacity" values="1;.2;1" dur="2.4s" repeatCount="indefinite"/></circle><path d="M83 181V195H340V181" fill="#bbab66"/>${Array.from(
    { length: 25 },
    (_, i) => `<path d="M${88 + i * 10} 183v11" stroke="#e0d798" stroke-width="5"/>`,
  ).join("")}<path d="M510 0L537 21V201L510 180Z" fill="#535e50"/><text x="364" y="190" fill="#aeb8a4" font-family="Inter Variable, Inter, sans-serif" font-size="9" font-weight="500" letter-spacing="0.4">${esc(label)}</text></g></g><g class="gpu-particles"><circle r="2.2" fill="#dcf587"><animateMotion dur="5.5s" begin="-0s" repeatCount="indefinite" path="M160 90C170 40 200 10 230 -40"/><animate attributeName="opacity" values="0;.9;0" dur="5.5s" begin="-0s" repeatCount="indefinite"/></circle><circle r="1.6" fill="#b9ce91"><animateMotion dur="6.5s" begin="-2.1s" repeatCount="indefinite" path="M250 90C260 40 290 10 320 -40"/><animate attributeName="opacity" values="0;.9;0" dur="6.5s" begin="-2.1s" repeatCount="indefinite"/></circle><circle r="2.6" fill="#dcf587"><animateMotion dur="7s" begin="-3.6s" repeatCount="indefinite" path="M330 90C340 40 370 10 400 -40"/><animate attributeName="opacity" values="0;.9;0" dur="7s" begin="-3.6s" repeatCount="indefinite"/></circle><circle r="1.8" fill="#cca080"><animateMotion dur="6s" begin="-1.2s" repeatCount="indefinite" path="M420 90C430 40 460 10 490 -40"/><animate attributeName="opacity" values="0;.9;0" dur="6s" begin="-1.2s" repeatCount="indefinite"/></circle><circle r="2.0" fill="#b9ce91"><animateMotion dur="7.5s" begin="-4.4s" repeatCount="indefinite" path="M500 90C510 40 540 10 570 -40"/><animate attributeName="opacity" values="0;.9;0" dur="7.5s" begin="-4.4s" repeatCount="indefinite"/></circle><circle r="1.4" fill="#dcf587"><animateMotion dur="6.8s" begin="-5.3s" repeatCount="indefinite" path="M210 90C220 40 250 10 280 -40"/><animate attributeName="opacity" values="0;.9;0" dur="6.8s" begin="-5.3s" repeatCount="indefinite"/></circle></g></svg>`;
  for (const name of ["metal", "edge", "ribs", "sheen", "shroud", "fan"]) {
    svg = svg.replaceAll(`id="${name}"`, `id="${name}-${n}"`).replaceAll(`url(#${name})`, `url(#${name}-${n})`);
  }
  return svg;
}

/**
 * The asset board illustration from the prototype. One consistent meaning everywhere: it stands for the
 * whole server record, labelled with the last digits of its asset ID and its GPU type. Always decorative;
 * the surrounding control carries the accessible name.
 */
export function boardArt(asset, large = false) {
  const suffix = String(asset.id || "").split("-").pop() || "";
  const code = (suffix.length > 5 ? suffix.slice(0, 4) : suffix) || "—";
  const hw = asset.hardware;
  const model = hw ? `${hw.count ? hw.count + "× " : ""}${hw.gpu}` : "Server";
  return `<div class="board-art ${large ? "large" : ""}" aria-hidden="true"><div class="board-pins"></div><div class="board-plate"><span class="board-code">RE / ${esc(code)}</span><div class="board-vents"></div><div class="board-chip">Re<span>↗</span></div><span class="board-model">${esc(model)}</span></div></div>`;
}
