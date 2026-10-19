// User journeys A–E against a real backend (fresh seeded SQLite, see playwright.config.js).
import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8190";
const usd = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

let consoleErrors = [];

test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e")) {
      localStorage.setItem("recompute.workspace.v2", JSON.stringify({ version: 2, mode: "live", live: {}, demo: {} }));
      sessionStorage.setItem("e2e", "1");
    }
  });
});

test.afterEach(() => {
  const real = consoleErrors.filter((e) => !/status of 409|status of 422/.test(e));
  expect(real, "console errors").toEqual([]);
});

async function firstReceived(request, route) {
  const { assets } = await (await request.get(`${API}/assets`)).json();
  return assets.find((a) => a.state === "RECEIVED" && a.route === route && a.asset_id.startsWith("SYN-"));
}

test("A: Overview → Fleet → Passport → Lab → Recommendation", async ({ page, request }) => {
  const dash = await (await request.get(`${API}/dashboard`)).json();
  await page.goto("/#overview");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Good hardware.");
  await expect(page.locator("#ticker")).toContainText("H100");
  await expect(page.locator("#ticker")).toContainText(/not live/i);
  await expect(page.locator(".studio-context")).toContainText(`${dash.total_assets} assets`);

  await page.getByRole("navigation").getByRole("link", { name: "Fleet", exact: true }).click();
  await page.locator("#f-query").fill("DEMO-SHAURYAA");
  await page.getByRole("link", { name: /Open passport for DEMO-SHAURYAA/ }).click();
  await expect(page).toHaveURL(/#passport\/DEMO-SHAURYAA/);

  const detail = await (await request.get(`${API}/assets/DEMO-SHAURYAA`)).json();
  const states = page.locator(".decision-states");
  await expect(states).toContainText("Sell now");
  await expect(page.locator(".passport-recommendation")).toContainText(usd(detail.route_value));

  await page.getByRole("link", { name: /Explore what-if/ }).click();
  await expect(page).toHaveURL(/#lab\?asset=DEMO-SHAURYAA/);
  const verdict = page.locator(".lab-verdict");
  await expect(verdict).toContainText("Sell now");
  await expect(verdict).toContainText(usd(detail.route_value));

  await page.locator("#lab-utilization").fill("80");
  await expect(verdict).toContainText("Host longer");
  await expect(page.locator(".lab-presets button[aria-pressed=true]")).toHaveText("Custom");
  const check = await (await request.post(`${API}/recommend`, { data: { ...detail.inputs, utilization: 0.8 } })).json();
  expect(check.result.route).toBe("HOST LONGER");
  await expect(verdict).toContainText(usd(check.result.base["HOST LONGER"]));
});

test("B: Fleet → Asset → Lifecycle action → Updated passport", async ({ page, request }) => {
  const a = await firstReceived(request, "SELL NOW");
  await page.goto(`/#passport/${a.asset_id}`);
  await expect(page.locator(".decision-states")).toContainText("Nothing yet");

  // Override needs a note; the dialog refuses an empty one.
  const override = page.locator('[data-action="event"][data-override="1"]').first();
  if (await override.count()) {
    await override.click();
    await page.getByRole("button", { name: "Override and continue" }).click();
    await expect(page.locator("#confirm-note-error")).toContainText("Explain why");
    await page.getByRole("button", { name: "Cancel" }).click();
  }

  await page.getByRole("button", { name: "List for sale", exact: true }).click();
  await page.locator("#confirm-ok").click();
  await expect(page.locator(".decision-states")).toContainText("Listed");
  await expect(page.locator("#pp-history")).toContainText("Received → Listed");
  const after = await (await request.get(`${API}/assets/${a.asset_id}`)).json();
  expect(after.state).toBe("LISTED");
  expect(after.selected_route).toBe("SELL NOW");

  // A step the backend no longer allows from LISTED isn't offered.
  await expect(page.getByRole("button", { name: "List for sale", exact: true })).toHaveCount(0);
});

test("C: Upload CSV → Review batch → Inspect asset → Recommendation", async ({ page, request }) => {
  await page.goto("/#fleet");
  await page.getByRole("button", { name: /Upload CSV/ }).click();
  const csv = "asset_id,model,asset_profile,offer_today,market_price\nE2E-001,8x H100 80GB,h100_8x,230000,250000\nE2E-002,8x A100 80GB,a100_8x,70000,90000\n";
  await page.locator("#upload-file").setInputFiles({ name: "batch.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.locator("#upload-dry").click();
  await expect(page.locator("#upload-output")).toContainText("DRY RUN");
  await expect(page.locator("#upload-output")).toContainText("2 servers would be added");
  await page.locator("#upload-commit").click();
  await expect(page.locator("#toast")).toContainText("saved: 2 servers");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.locator(".asset-card")).toHaveCount(2);
  await page.getByRole("link", { name: /Open passport for E2E-001/ }).click();
  await expect(page).toHaveURL(/#passport\/E2E-001/);
  const d = await (await request.get(`${API}/assets/E2E-001`)).json();
  await expect(page.locator(".passport-recommendation")).toContainText(usd(d.route_value));
  await expect(page.locator(".not-assessed")).toContainText("NOT YET ASSESSED");

  // Malformed file: field errors come back from the API and nothing is saved.
  await page.goto("/#fleet");
  await page.getByRole("button", { name: /Upload CSV/ }).click();
  await page.locator("#upload-file").setInputFiles({ name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("asset_id,utilization\nE2E-BAD,7\n") });
  await page.locator("#upload-dry").click();
  await expect(page.locator("#upload-output")).toContainText("utilization");
  const missing = await request.get(`${API}/assets/E2E-BAD`);
  expect(missing.status()).toBe(404);
});

test("D: Lab → Modify inputs → Save scenario → Reopen scenario", async ({ page }) => {
  await page.goto("/#lab?asset=DEMO-SHAURYAA");
  await page.getByRole("button", { name: "Bear market" }).click();
  await expect(page.locator(".lab-status")).toContainText("Bear market");
  await page.locator("#lab-elec_per_kwh").fill("0.2");
  await expect(page.locator(".lab-presets button[aria-pressed=true]")).toHaveText("Custom");
  await expect(page.locator(".lab-status")).toContainText("Model v");
  const route = (await page.locator(".lab-verdict h2").innerText()).trim();
  await page.getByRole("button", { name: /Keep this comparison/ }).click();
  await expect(page.locator(".saved-list li")).toHaveCount(1);

  await page.reload();
  await page.goto("/#lab?asset=DEMO-SWAYAM");
  await expect(page.locator(".saved-list li")).toHaveCount(1);
  await page.getByRole("button", { name: "Reopen" }).click();
  await expect(page).toHaveURL(/asset=DEMO-SHAURYAA/);
  await expect(page.locator(".lab-presets button[aria-pressed=true]")).toHaveText("Custom");
  await expect(page.locator("#lab-elec_per_kwh-v")).toContainText("$0.2");
  await expect(page.locator(".lab-verdict h2")).toContainText(route.replace(/[^\w\s]/g, "").trim());
});

test("E: Asset → Decision → Lifecycle history → Outcome (a loss)", async ({ page, request }) => {
  const a = await firstReceived(request, "SELL NOW");
  await page.goto(`/#passport/${a.asset_id}`);
  await page.getByRole("button", { name: "List for sale", exact: true }).click();
  await page.locator("#confirm-ok").click();
  await expect(page.locator(".decision-states")).toContainText("Listed");
  await page.getByRole("button", { name: "Mark as sold", exact: true }).click();
  await page.locator("#confirm-ok").click();
  await expect(page.locator(".decision-states .dstate.done")).toContainText("Sold");

  await page.getByRole("button", { name: /Record what happened/ }).click();
  await page.locator("#actual").fill("-1250");
  await page.locator("#actual-note").fill("Buyer backed out; resold at a loss after freight.");
  await page.getByRole("button", { name: "Save outcome" }).click();
  await expect(page.locator(".outcome-block")).toContainText("-$1,250");
  await expect(page.locator("#pp-history")).toContainText("Outcome recorded");

  await page.getByRole("navigation").getByRole("link", { name: "Outcomes" }).click();
  const card = page.locator(".ledger-card", { hasText: a.asset_id });
  await expect(card).toContainText("-$1,250");
  await expect(card.locator(".ledger-variance")).toHaveClass(/loss/);
});

test("Fleet Command: strategy, review, explicit commit, per-asset results", async ({ page, request }) => {
  await page.goto("/#command");
  await page.getByRole("button", { name: "Free up capital" }).click();
  await expect(page.getByRole("button", { name: "Free up capital" })).toHaveAttribute("aria-pressed", "true");
  const boxes = page.locator('.command-lane input[type="checkbox"]');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await expect(page.locator(".plan-summary h2")).toContainText("2");
  await page.getByRole("button", { name: /Review 2 moves/ }).click();
  const submit = page.locator("#commitForm button[type=submit]");
  await submit.click();
  await expect(page.locator("#commit-error")).not.toBeEmpty();
  const note = page.locator("#commit-note");
  if (await note.count()) await note.fill("Treasury needs cash this quarter.");
  await page.locator("#commit-ack").check();
  await submit.click();
  await expect(page.locator(".run-report h2")).toContainText("of 2 moves recorded");
  const ok = await page.locator(".run-list li.ok").count();
  const { assets } = await (await request.get(`${API}/assets`)).json();
  expect(assets.filter((a) => a.state !== "RECEIVED").length).toBeGreaterThanOrEqual(ok);
  await page.getByRole("navigation").getByRole("link", { name: "Outcomes" }).click();
  await expect(page.locator(".ledger-lane").first()).not.toContainText("Room for your next move");
});

test("Demo mode is labelled, read-only, and never mixes with Live @responsive", async ({ page }) => {
  await page.goto("/#overview");
  await page.getByRole("button", { name: "Explore Demo" }).click();
  await expect(page.locator(".mode-banner.demo")).toContainText("DEMO MODE");
  await page.goto("/#passport/DEMO-SHAURYAA");
  await expect(page.locator(".passport-recommendation")).toBeVisible();
  for (const b of await page.locator('[data-action="event"]').all()) await expect(b).toBeDisabled();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  await page.getByRole("button", { name: "Use Live data" }).click();
  await expect(page.locator(".mode-banner.demo")).toHaveCount(0);
});

test("Every page renders without horizontal overflow @responsive", async ({ page }) => {
  for (const r of ["overview", "fleet", "passport/DEMO-KABIR", "command", "lab?asset=DEMO-SHAURYAA", "replay?asset=DEMO-SHAURYAA", "market", "outcomes", "about"]) {
    await page.goto(`/#${r}`);
    await expect(page.locator("#main h1, #main .passport-reading h2").first()).toBeVisible();
    await expect(page.locator("#main .async-state.loading")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator("#main .async-state.error")).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `overflow on ${r}`).toBeLessThanOrEqual(2);
  }
});

test("API unreachable: Live mode says so and shows no figures", async ({ page }) => {
  await page.route(/^http:\/\/127\.0\.0\.1:\d+\/api\//, (route) => route.abort("connectionrefused"));
  await page.goto("/#overview");
  await expect(page.locator(".mode-banner.offline")).toContainText("NOT CONNECTED");
  await expect(page.locator("#main")).not.toContainText("$");
  consoleErrors = [];
});
