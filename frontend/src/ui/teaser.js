/**
 * The ReCompute teaser on the landing page, embedded from YouTube and held at 1.25× whenever it plays.
 * The player is created once per visit to the landing page and survives the page's in-place refreshes.
 */
export const VIDEO_ID = "Rvnbdqqfllk";
export const RATE = 1.25;

let player = null;
let ready = false;
let pendingPlay = false;
let onHide = null;

/** The player frame on its own (the studio's Teaser tab); the landing page wraps it in a section. */
export function teaserFrame() {
  return `<div class="teaser-frame" data-state="idle"><div id="teaser-player"></div><button type="button" class="teaser-poster" data-action="teaser-play" aria-label="Play the ReCompute teaser"><span class="experience-button" aria-hidden="true">Play the teaser <span>▶</span></span></button><p class="teaser-error" role="alert" hidden></p></div>`;
}

export function teaserSection() {
  return `<section class="teaser-section" id="teaser" aria-labelledby="teaser-h"><div class="teaser-head"><div><span class="section-index">The teaser / 45 seconds</span><h2 id="teaser-h">Watch a server find<br><em>its next life.</em></h2></div><p>Plays at ${RATE}×.</p></div>${teaserFrame()}</section>`;
}

/** Hold the rate at 1.25×, whatever the YouTube menu asks for. */
export function enforceRate(p) {
  try {
    if (p.getPlaybackRate() !== RATE) p.setPlaybackRate(RATE);
  } catch {
    /* player not ready */
  }
}

function loadApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    if (!document.querySelector("script[data-yt-api]")) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      s.dataset.ytApi = "1";
      s.onerror = () => reject(new Error("The teaser could not reach YouTube"));
      document.head.appendChild(s);
    }
    setTimeout(() => reject(new Error("The teaser could not reach YouTube")), 12000);
  });
}

const setState = (s) => {
  const f = document.querySelector(".teaser-frame");
  if (f) f.dataset.state = s;
};

export function playTeaser() {
  if (!ready) {
    pendingPlay = true;
    return;
  }
  enforceRate(player);
  player.playVideo();
}

export async function mountTeaser() {
  const el = document.querySelector("#teaser-player");
  if (!el || player) return;
  try {
    const YT = await loadApi();
    if (!document.querySelector("#teaser-player") || player) return;
    player = new YT.Player("teaser-player", {
      videoId: VIDEO_ID,
      width: "100%",
      height: "100%",
      playerVars: { rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, origin: location.origin },
      events: {
        onReady: () => {
          ready = true;
          enforceRate(player);
          if (pendingPlay) {
            pendingPlay = false;
            playTeaser();
          }
        },
        onStateChange: (e) => {
          if (e.data === 1) enforceRate(player);
          if (e.data === 1 || e.data === 3) setState("playing");
        },
        onPlaybackRateChange: () => enforceRate(player),
      },
    });
  } catch (e) {
    const err = document.querySelector(".teaser-error");
    if (err) {
      err.hidden = false;
      err.textContent = e.message;
    }
  }
  // Switching to the studio tab must not leave the teaser talking in the background.
  onHide = () => {
    if (document.hidden && ready && player.getPlayerState() === 1) player.pauseVideo();
  };
  document.addEventListener("visibilitychange", onHide);
}

export function unmountTeaser() {
  if (onHide) document.removeEventListener("visibilitychange", onHide);
  onHide = null;
  try {
    player?.destroy();
  } catch {
    /* already gone */
  }
  player = null;
  ready = false;
  pendingPlay = false;
}
