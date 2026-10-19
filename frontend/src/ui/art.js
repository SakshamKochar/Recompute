import { esc } from "../lib/html.js";

/** The landing-page hardware illustration, unchanged from the design prototype. Decorative. */
export function gpuArt(label = "A100 / NEXT CHAPTER") {
  return `<svg viewBox="0 0 700 330" class="gpu-art" aria-hidden="true" focusable="false"><defs><linearGradient id="metal" x2=".2" y2="1"><stop stop-color="#e3e3d9"/><stop offset=".45" stop-color="#a8aca3"/><stop offset="1" stop-color="#747c73"/></linearGradient><linearGradient id="edge" x2="0" y2="1"><stop stop-color="#464d43"/><stop offset="1" stop-color="#202a23"/></linearGradient><pattern id="ribs" width="9" height="9" patternUnits="userSpaceOnUse"><path d="M0 0V9" stroke="#3f493e" stroke-width="4"/></pattern><radialGradient id="fan"><stop stop-color="#66715e"/><stop offset=".28" stop-color="#243127"/><stop offset="1" stop-color="#101c16"/></radialGradient></defs><g transform="translate(75 53) rotate(-7 270 110)"><path d="M0 15L510 15 545 38 545 204 35 204 0 180Z" fill="url(#edge)"/><path d="M0 0H510V180H0Z" fill="url(#metal)" stroke="#cbd0c2" stroke-width="2"/><path d="M18 16H490V163H18Z" fill="url(#ribs)"/><path d="M22 21H156L196 62V113L150 158H22Z M487 21H350L306 62V113L351 158H487Z" fill="#b6bdb0"/><path d="M178 23H320L285 58V124L322 159H175L210 122V61Z" fill="#d4d8cd"/><path d="M183 29H312L276 65V115L312 151H184L219 119V65Z" fill="#899783"/><text x="246" y="95" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#273d2c">Re.</text>${[94, 413]
    .map(
      (cx) =>
        `<g transform="translate(${cx} 90)"><circle r="64" fill="#606c5d"/><circle r="58" fill="url(#fan)"/>${Array.from(
          { length: 11 },
          (_, i) =>
            `<path d="M-5-15C-35-30-36-48-11-51C-18-34 7-27 11-14Z" fill="#6b7967" opacity=".8" transform="rotate(${(i * 360) / 11})"/>`,
        ).join("")}<circle r="19" fill="#344331" stroke="#91a082"/><circle r="9" fill="#52664a"/></g>`,
    )
    .join("")}<path d="M83 181V195H340V181" fill="#bbab66"/>${Array.from(
    { length: 25 },
    (_, i) => `<path d="M${88 + i * 10} 183v11" stroke="#e0d798" stroke-width="5"/>`,
  ).join("")}<path d="M510 0L537 21V201L510 180Z" fill="#535e50"/><text x="364" y="190" fill="#aeb8a4" font-family="monospace" font-size="8" letter-spacing="3">${esc(label)}</text></g></svg>`;
}

/**
 * The asset board illustration from the prototype. One consistent meaning everywhere: it stands for the
 * whole server record, labelled with the last digits of its asset ID and its GPU type. Always decorative;
 * the surrounding control carries the accessible name.
 */
export function boardArt(asset, large = false) {
  const code = String(asset.id || "").replace(/^.*?-/, "").slice(-4) || "—";
  const hw = asset.hardware;
  const model = hw ? `${hw.count ? hw.count + "× " : ""}${hw.gpu}` : "Server";
  return `<div class="board-art ${large ? "large" : ""}" aria-hidden="true"><div class="board-pins"></div><div class="board-plate"><span class="board-code">RE / ${esc(code)}</span><div class="board-vents"></div><div class="board-chip">Re<span>↗</span></div><span class="board-model">${esc(model)}</span></div></div>`;
}
