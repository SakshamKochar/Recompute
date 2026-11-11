/** Teaser tab in the studio's Demo mode: the ReCompute teaser, held at 1.25x (see ui/teaser.js). */
import { contextStrip, heading } from "../ui/components.js";
import { RATE, mountTeaser, playTeaser, teaserFrame, unmountTeaser } from "../ui/teaser.js";

export default {
  title: "Teaser",
  demoOnly: true,
  // The player must survive background refreshes, so this page is painted once per visit.
  keepAlive: true,
  render() {
    return (
      contextStrip(["ReCompute teaser", `Plays at ${RATE}×`]) +
      heading("Teaser", "Not done.<br><em>Just next.</em>", "Forty-five seconds on the next life of a GPU server.") +
      `<div class="teaser-tab">${teaserFrame()}</div>`
    );
  },
  after(root) {
    mountTeaser();
    // After the router's scroll-to-top: put the whole player on screen.
    setTimeout(() => root.querySelector(".teaser-frame")?.scrollIntoView({ behavior: "instant", block: "center" }), 60);
  },
  leave() {
    unmountTeaser();
  },
  actions: {
    "teaser-play": () => playTeaser(),
  },
};
