/**
 * #teaser: the ReCompute teaser, embedded from YouTube and held at 1.25× whenever it plays.
 * Static: the player is created once and kept alive across app re-renders.
 * Keys: Space or K play/pause, M mute, D open the stage demo in a new tab, F full screen.
 */
import { esc } from "../lib/html.js";

export const VIDEO_ID = "Rvnbdqqfllk";
export const RATE = 1.25;
const DEMO_URL = "/#pitch";

let player = null;
let ready = false;
let pendingPlay = false;
let cleanup = [];

function loadApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    if (!document.querySelector('script[data-yt-api]')) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      s.dataset.ytApi = "1";
      s.onerror = () => reject(new Error("YouTube could not be reached"));
      document.head.appendChild(s);
    }
    setTimeout(() => reject(new Error("YouTube took too long to answer")), 12000);
  });
}

/** Hold the rate at 1.25×, whatever the YouTube menu or a key press asks for. */
export function enforceRate(p) {
  try {
    if (p.getPlaybackRate() !== RATE) p.setPlaybackRate(RATE);
  } catch {
    /* player not ready */
  }
}

function render() {
  return `<div class="teaser-page">
  <div class="teaser-nav"><a class="exp-logo" href="#home">ReCompute<span>®</span></a>
    <div><span class="teaser-chip">Teaser · ${RATE}×</span><a class="teaser-demo-link" href="${DEMO_URL}" target="_blank" rel="noopener" data-action="open-demo">Open the SYN-003 demo ↗</a></div></div>
  <div class="teaser-main">
    <div class="teaser-frame" data-state="idle">
      <div id="teaser-player" class="teaser-player"></div>
      <button type="button" class="teaser-poster" data-action="teaser-play" aria-label="Play the ReCompute teaser at ${RATE} times speed">
        <span class="teaser-poster-title">Not done. <i>Just next.</i></span>
        <span class="teaser-play"><svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg></span>
        <span class="teaser-play-label">Play the teaser <small>${RATE}×</small></span>
      </button>
      <div class="teaser-end" role="group" aria-label="Teaser finished">
        <p>Value, redirected.</p>
        <a class="experience-button" href="${DEMO_URL}" target="_blank" rel="noopener" data-action="open-demo">Open the SYN-003 demo <span>↗</span></a>
        <button type="button" class="teaser-replay" data-action="teaser-replay">↺ Replay</button>
      </div>
      <p class="teaser-error" role="alert" hidden></p>
    </div>
    <p class="teaser-hint">${esc("Space play or pause · M mute · D open the demo in a new tab · F full screen")}</p>
  </div>
</div>`;
}

function frame() {
  return document.querySelector(".teaser-frame");
}

function setState(s) {
  const f = frame();
  if (f) f.dataset.state = s;
}

function showError(msg) {
  const el = document.querySelector(".teaser-error");
  if (!el) return;
  el.hidden = false;
  el.innerHTML = `${esc(msg)}. <a href="${DEMO_URL}" target="_blank" rel="noopener">Open the demo ↗</a>`;
}

function play() {
  if (!ready) {
    pendingPlay = true;
    setState("loading");
    return;
  }
  enforceRate(player);
  player.playVideo();
}

function togglePlay() {
  if (!ready) return play();
  const s = player.getPlayerState();
  if (s === 1 || s === 3) player.pauseVideo();
  else play();
}

function openDemo() {
  if (ready && player.getPlayerState() === 1) player.pauseVideo();
  window.open(DEMO_URL, "_blank", "noopener");
}

async function mountPlayer() {
  try {
    const YT = await loadApi();
    if (!document.querySelector("#teaser-player")) return;
    player = new YT.Player("teaser-player", {
      videoId: VIDEO_ID,
      width: "100%",
      height: "100%",
      playerVars: { rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, controls: 1, fs: 1, origin: location.origin },
      events: {
        onReady: () => {
          ready = true;
          enforceRate(player);
          if (pendingPlay) {
            pendingPlay = false;
            play();
          } else setState("idle");
        },
        onStateChange: (e) => {
          // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
          if (e.data === 1) {
            enforceRate(player);
            setState("playing");
          } else if (e.data === 3) setState("playing");
          else if (e.data === 2) setState("paused");
          else if (e.data === 0) setState("ended");
        },
        onPlaybackRateChange: () => enforceRate(player),
        onError: () => showError("The teaser could not play here"),
      },
    });
  } catch (e) {
    showError(e.message);
  }
}

function after() {
  leave();
  ready = false;
  pendingPlay = false;
  mountPlayer();
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if ((k === " " || k === "enter") && e.target.closest?.("button,a")) return;
    if (k === " " || k === "k") togglePlay();
    else if (k === "m" && ready) player.isMuted() ? player.unMute() : player.mute();
    else if (k === "d") openDemo();
    else if (k === "f") document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.().catch(() => {});
    else return;
    e.preventDefault();
  };
  // Switching to the demo tab must not leave the teaser talking in the background.
  const onHide = () => {
    if (document.hidden && ready && player.getPlayerState() === 1) player.pauseVideo();
  };
  addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onHide);
  cleanup = [() => removeEventListener("keydown", onKey), () => document.removeEventListener("visibilitychange", onHide)];
}

function leave() {
  cleanup.forEach((f) => f());
  cleanup = [];
  try {
    player?.destroy();
  } catch {
    /* already gone */
  }
  player = null;
  ready = false;
}

export default {
  title: "Teaser",
  static: true,
  render,
  after,
  leave,
  actions: {
    "teaser-play": () => play(),
    "teaser-replay": () => {
      if (!ready) return;
      player.seekTo(0, true);
      play();
    },
    "open-demo": () => openDemo(),
  },
};
