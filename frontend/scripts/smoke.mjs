// Load every route in headless Chrome, report console errors, and save screenshots.
// Usage: node scripts/smoke.mjs [baseUrl] [outDir] [mode]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] || "http://127.0.0.1:5274";
const out = process.argv[3] || "/tmp/smoke";
const mode = process.argv[4] || "live";
mkdirSync(out, { recursive: true });

const routes = ["home", "overview", "fleet", "passport/DEMO-SHAURYAA", "passport/DEMO-KABIR", "command", "lab?asset=DEMO-SHAURYAA", "replay?asset=DEMO-SHAURYAA", "market", "outcomes", "about"];
const sizes = { desktop: { width: 1440, height: 900 }, tablet: { width: 820, height: 1180 }, mobile: { width: 390, height: 844 } };
const which = (process.env.SIZES || "desktop").split(",");

const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/local/bin/google-chrome", args: ["--no-sandbox"] });
let failures = 0;
for (const sizeName of which) {
  const ctx = await browser.newContext({ viewport: sizes[sizeName] });
  await ctx.addInitScript((m) => {
    if (!sessionStorage.getItem("smoke-init")) {
      localStorage.setItem("recompute.workspace.v2", JSON.stringify({ version: 2, mode: m, live: {}, demo: {} }));
      sessionStorage.setItem("smoke-init", "1");
    }
  }, mode);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  for (const r of routes) {
    errors.length = 0;
    await page.goto(`${base}/#${r}`);
    await page.waitForTimeout(r.startsWith("command") ? 2500 : 1500);
    const name = `${sizeName}-${mode}-${r.replace(/[^a-z0-9]+/gi, "_")}`;
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: process.env.FULL === "1" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const text = await page.evaluate(() => document.querySelector("#main")?.innerText.slice(0, 160).replace(/\s+/g, " "));
    if (errors.length || overflow > 2) failures++;
    console.log(`${errors.length ? "ERR " : "ok  "} ${name}${overflow > 2 ? ` OVERFLOW ${overflow}px` : ""} :: ${r === "home" ? "" : text}`);
    for (const e of errors) console.log("     ", e.slice(0, 300));
  }
  await ctx.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
