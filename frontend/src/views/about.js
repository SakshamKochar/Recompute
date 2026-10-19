import { getTransport } from "../api/backend.js";
import { heading, journey } from "../ui/components.js";
import { aboutArt } from "../ui/motion.js";

export default {
  title: "About",
  render() {
    const t = getTransport();
    return (
      heading("About", "Value isn’t finished.<br><em>It’s waiting to be redirected.</em>", "ReCompute brings a longer view to the life of compute.") +
      `<section class="about-statement"><span aria-hidden="true">Re.</span><div><h2>Built for the moment<br>between <em>what was</em><br>and <em>what’s next.</em></h2><p>A server outlasts the job it was bought for. The next chapter should be decided with the same care as the purchase: the evidence, the money, and a reason you can explain.</p></div></section>${journey()}<section class="about-principles">${[
        ["01", "Understand before acting.", "A passport brings together condition, history and value, and says where each fact came from."],
        ["02", "Make the trade-off visible.", "Every route, what happens if the market turns, and the one change that would lead somewhere else."],
        ["03", "Learn from the next chapter.", "Record what actually happened, losses included, and set it next to what was expected."],
      ]
        .map((x) => `<div><span class="micro">${x[0]} / Our approach</span><h3>${x[1]}</h3><p>${x[2]}</p></div>`)
        .join("")}</section>
      <section class="panel-card about-facts" aria-labelledby="ab-h"><div class="panelhead"><h2 id="ab-h">What to expect</h2><small>${t?.mode === "demo" ? "You’re exploring the demo" : "Your live fleet"}</small></div>${aboutArt()}<ul class="plain about-list">
        <li><b>The figures come from the asset.</b> Condition, history and the market decide the route and the value. The screen does not invent a number to make a case look better.</li>
        <li><b>If the connection drops, we say so.</b> Your fleet stays blank until it comes back. Sample numbers never stand in for yours.</li>
        <li><b>The demo is a sample fleet.</b> The servers and the NVIDIA diagnostics are simulated. Nothing in it is bought, sold or moved.</li>
        <li><b>A move is a record you keep.</b> Listing, selling or hosting is written down here. The deal itself still happens with your buyer or partner.</li>
        <li><b>The strip at the top is the rental market.</b> It shows what hosts are asking for GPUs right now, refreshed about once a minute. Those are asking prices, so valuations use steadier dated readings.</li>
        <li><b>This preview has no sign-in.</b> Anyone with the link can view the fleet and record moves. Share it with people you trust.</li>
        <li><b>Drafts stay in this browser.</b> Saved scenarios and plans are kept separately for live and demo.</li>
      </ul></section>
      <p class="studio-footnote">Every asset has a next chapter. Not done. Just next.</p>`
    );
  },
};
