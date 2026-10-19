import { app } from "../app.js";
import { getTransport } from "../api/backend.js";
import { esc } from "../lib/html.js";
import { heading, journey } from "../ui/components.js";

export default {
  title: "About",
  render() {
    const t = getTransport();
    return (
      heading("About", "Value isn’t finished.<br><em>It’s waiting to be redirected.</em>", "ReCompute brings a longer view to the life of compute.") +
      `<section class="about-statement"><span aria-hidden="true">Re.</span><div><h2>Built for the moment<br>between <em>what was</em><br>and <em>what’s next.</em></h2><p>Hardware outlives workloads. We believe its next chapter deserves the same care as its first: clear evidence, thoughtful economics, and a decision you can explain.</p></div></section>${journey()}<section class="about-principles">${[
        ["01", "Understand before acting.", "A passport connects condition, history and valuation, and says where each fact came from."],
        ["02", "Make the trade-off visible.", "Every route, its stress case, and the one change that would flip the answer."],
        ["03", "Learn from the next chapter.", "Record what actually happened, losses included, and compare it with what the model expected."],
      ]
        .map((x) => `<div><span class="micro">${x[0]} / OUR APPROACH</span><h3>${x[1]}</h3><p>${x[2]}</p></div>`)
        .join("")}</section>
      <section class="panel-card about-facts" aria-labelledby="ab-h"><div class="panelhead"><h2 id="ab-h">What this build is, plainly</h2><small>${esc(t?.mode === "demo" ? "DEMO MODE" : "LIVE MODE")}${app.health?.version ? ` · MODEL v${esc(app.health.version)}` : ""}</small></div><ul class="plain about-list">
        <li><b>Decisions come from Saksham Kochar’s ReCompute model</b> (FastAPI, model v${esc(app.health?.version || "0.9")}). The interface never computes a route or a value of its own.</li>
        <li><b>Live mode</b> talks to the ReCompute API at <code>${esc(t?.mode === "demo" ? "(not in use)" : t?.base)}</code>. If it is unreachable, screens say so; nothing falls back to demo data.</li>
        <li><b>Demo mode</b> replays responses recorded from the same backend on synthetic servers and simulated NVIDIA diagnostics. It is read-only.</li>
        <li><b>No sign-in and no multi-tenancy.</b> Anyone who can reach the app and API can read every asset and record lifecycle moves. Passport links are not private. Run it on a trusted network only.</li>
        <li><b>Lifecycle moves are records, not transactions.</b> Nothing is listed, sold, hosted or shipped by this software.</li>
        <li><b>Market figures are dated observations</b> shipped with the model, not a live feed.</li>
        <li><b>Drafts, saved scenarios and plans</b> live in this browser only, separately for Live and Demo.</li>
      </ul></section>
      <p class="studio-footnote">Every asset has a next chapter. Not done. Just next.</p>`
    );
  },
};
