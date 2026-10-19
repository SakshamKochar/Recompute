# Integration report

The ReCompute design prototype and Saksham Kochar's ReCompute API (model v0.9, [SakshamKochar/Recompute](https://github.com/SakshamKochar/Recompute) at `72d09b4`) now run as one application. This report covers what was built, what the backend gained, what was tested, and what is still missing.

The backend source was treated as authoritative. `app/recompute_model.py`, `app/output.py`, `app/fleet.py`, `app/checks.py` and the other model modules are unchanged; every financial value in the UI comes from an API response.

## 1. Features implemented

| Area | Status | Backed by |
|---|---|---|
| Landing story ("Not done. Just next.") | Done. The four chapters use recorded model runs for DEMO-SHAURYAA (8× A100 80GB) at 40–100% utilization. Labelled as a recorded demo | Demo snapshot |
| Overview | Done. Next worthwhile move, open-fleet value, health split, state and route counts (link to filtered Fleet), attention items, recent activity. The prototype's fictional $63,870 is gone | `GET /dashboard`, `/assets`, `/batches` |
| Fleet | Done. Search, route, state, batch and sort filters; cards and table; pagination ("Show more"); bear/base/bull overlay per batch; batch summary with backend CSV; CSV export of the current view; upload with dry run, field-error table, template download | `GET /assets`, `/batches`, `/batches/{id}?scenario=`, `/batches/{id}/scenarios`, `/batches/{id}/results.csv`, `POST /assets/upload`, `GET /assets/upload/template` |
| Asset Passport `#passport/{id}` | Done. Shareable URL. Identity with input provenance (on record, filled by API, profile default); condition from real diagnostics only, otherwise "Not yet assessed"; repair economics; all seven routes with base and stress values and eligibility reasons; assumptions; break-evens; audit trail; decision confidence; Recommended / Selected / Executed / Completed as four separate cells; lifecycle buttons from `allowed_events`, override buttons from `override_events` with a required note; edit inputs (PATCH); realized outcome; full history | `GET /assets/{id}`, `/assets/{id}/history`, `PATCH /assets/{id}/inputs`, `POST /assets/{id}/events`, `POST /assets/{id}/outcomes`, `GET /meta` |
| What-if Lab | Done. Six sliders and nine more inputs within schema ranges; 250 ms debounce; AbortController cancellation plus a sequence check so a slow answer never overwrites a newer one; Bear/Base/Bull presets via `?scenario=` that switch to Custom on edit; flip points; all seven routes; warnings; save a scenario (full inputs, result, model version, timestamp, stored recommendation id) and reopen it; marked historical when the model or the asset has changed since; apply inputs to the asset with confirmation | `POST /recommend?flip_points=true&scenario=`, `GET /meta` |
| Fleet Command | Done. Strategies "Follow the model", "Free up capital" (backend baseline) and "Keep earning" (best eligible compute route from each asset's model result); Earn / Exit / Recover lanes; draft plan saved in the browser; review dialog listing every move as allowed, override or skipped; a shared override note; explicit acknowledgement; sequential commit with per-asset accepted / rejected results; rejected assets stay selected. Copy says these are policies, not an optimizer, and that nothing is listed or sold | `GET /assets`, `GET /assets/{id}?confidence=false`, `POST /assets/{id}/events` |
| Decision Replay (new) | Done. Evidence, the stored call with its audit, "change one thing" over the model's own confidence drivers with before/after across all seven routes, propose the new route as a draft choice, save as a scenario, and a step-through of the asset's recorded history. Respects reduced motion | `GET /assets/{id}`, `/history`, `POST /recommend` |
| Market Intelligence | Done. A rental tape on every page: live on-demand asks from Vast.ai in Live mode (median per GPU-hour, labelled as asks, not trades), and the dated rental index in Demo or when the feed is off. Radar and stories from the top opportunity per lane, matched to dated evidence; SYN-FLEET bear/base/bull totals; assumptions; every source file; a table of live asks against the model's rental-rate assumption | `GET /assets`, `/meta`, `/market/evidence`, `/market/live`, `/batches/{id}/scenarios` |
| Outcomes | Done. In-motion and completed lanes; realized total and variance against the decision-time model value (selected route if one was chosen); losses shown as losses; corrections are new entries | `GET /outcomes`, `POST /assets/{id}/outcomes` |
| About | Done. Plain statement of what the build is and is not, including no sign-in and no multi-tenancy | — |
| Live / Demo modes | Done. Header switch with status dot, banner in Demo, "not connected" banner in Live with Retry and an explicit "Explore the demo instead". No silent fallback. Drafts are kept per mode | `GET /health`, demo snapshot |
| Accessibility | Done for the issues found: skip link, focus moved to the page on navigation and restored after dialogs and re-renders, labelled controls, `aria-pressed` toggles, `aria-live` status for recalculation, `role="alert"` for errors, minimum mono text raised from 8 px to 10 px, muted text darkened for contrast, visible focus ring, `prefers-reduced-motion`. No automated audit tool (such as axe) has been run |

## 2. Backend endpoints used

`GET /health`, `GET /meta`, `GET /dashboard`, `GET /assets`, `GET /assets/{id}` (with and without `?confidence=false`), `GET /assets/{id}/history`, `PATCH /assets/{id}/inputs`, `POST /assets/{id}/events`, `POST /assets/{id}/outcomes`*, `GET /outcomes`*, `POST /recommend` (with `?flip_points=true` and `?scenario=`*), `GET /batches`, `GET /batches/{id}?scenario=`, `GET /batches/{id}/scenarios`, `GET /batches/{id}/results.csv`, `POST /assets/upload` (`?dry_run`, `?skip_existing`), `GET /assets/upload/template`, `GET /market/evidence`*, `GET /market/live`*.

\* added during this integration.

Not used by the UI: `POST /assets` (single create), `POST /assets/diagnose` (NVIDIA capture upload), `GET /fleet`, `GET /fleet/{id}`, `POST /fleet/seed`, `POST /demo/sellers`, `POST /demo/reset` (deliberately never called by the browser).

## 3. Backend changes

All additive. The model, its inputs and its outputs are unchanged.

| Change | Files | Why |
|---|---|---|
| `selected_route` on `POST /assets/{id}/events`, validated against the latest recommendation's eligible list (409 otherwise), stored in the transition's details and returned on the asset | `app/assets.py` | "Selected" had nowhere to live: the backend only stored the recommendation and the move |
| `outcomes` table and `POST /assets/{id}/outcomes`: realized value (any sign, finite, ±1e9), optional note, only in a final state, linked to the final transition, append-only | `app/db.py`, `app/outcomes.py` | Outcome tracking needs a realized value, and it must allow losses |
| `GET /outcomes`: decision-time recommendation and selected route, events, current recommendation, latest outcome, variance and summary | `app/outcomes.py` | One read for the Outcomes ledger |
| `?scenario=bear|base|bull` on `POST /recommend`, using the existing `apply_scenario` | `app/main.py` | The Lab's presets are Saksham's scenarios for one asset; previously only batches could be run under a scenario |
| `scenarios` in `GET /meta` | `app/main.py` | Lets the UI describe each preset's dials |
| `GET /market/evidence`: the CSVs in `data/sources` as JSON with `live: false` | `app/market.py` | Market Intelligence shows the model's own dated evidence instead of invented signals |
| `GET /market/live`: Vast.ai public on-demand asks, server-side, cached ~60s, `MARKET_LIVE_FEED=off` disables it. Does not change model inputs | `app/market.py` | The rental tape. The browser never calls Vast.ai. Asks are labelled as listings, not completed rentals |
| CORS origins from `CORS_ORIGINS` (default: the local web app); methods GET, POST, PATCH; header `Content-Type` | `app/main.py`, `render.yaml`, `README.md` | Explicit origins instead of a hard-coded list |
| History includes outcome entries; the asset list loads recommendations and transitions in one query each | `app/assets.py` | History completeness; avoids one query per asset on `/assets` |

29 new tests cover these: 20 in `backend/tests/test_integration_extensions.py` and 9 in `backend/tests/test_market_live.py`. The live-feed tests replace the Vast.ai call, so they do not use the network.

## 4. Tests executed

All of these ran in this environment (Ubuntu 24.04, Python 3.12.3, Node 22.23.3, Chrome) on the final code.

| Suite | Command | Result |
|---|---|---|
| Backend, before any change (Saksham's code as uploaded) | `pytest -q` | 152 passed, 0 failed |
| Backend, after the changes | `pytest -q` | 181 passed, 0 failed (152 original + 29 new) |
| Frontend unit tests (Vitest, jsdom) | `npm test` | 49 passed, 0 failed, in 5 files |
| End-to-end (Playwright, Chrome, own API on a fresh seeded database, `MARKET_LIVE_FEED=off`) | `npm run test:e2e` | 13 passed, 0 failed |
| Production build | `npm run build` | Succeeds: 168 kB JS, 94 kB CSS before gzip |
| Page check in Live and Demo at 1440×900, 820×1180 and 390×844 | `node scripts/smoke.mjs` | Every route loads with no console errors and no horizontal overflow |

The unit tests cover error parsing, retries (GET only), timeouts, cancellation, the demo transport (read-only, recorded answers only), route and lifecycle vocabulary, adapters (values passed through exactly, provenance, no invented diagnostics), the four decision states, history diffs, input conversion, input ranges read from `backend/app/schema.py`, fleet filters and scenario overlay, overview opportunities, Fleet Command policies and move classification, Lab draft and Custom logic, per-mode storage, Replay flip targets, Market lane signals, and the rental tape’s dated-index quotes, price format and sparkline. They use real backend responses recorded in the demo snapshot.

End-to-end tests:

- A: Overview → Fleet → Passport → Lab. Values are checked against the API, and moving utilization to 80% flips DEMO-SHAURYAA from Sell now to Host longer, matching a direct `POST /recommend`. The rental tape is on the page: with `MARKET_LIVE_FEED=off` it shows the dated H100 index and the words “not live”, and the suite does not call Vast.ai.
- B: Passport → List for sale. Overrides refuse an empty note, the passport and history update, and the backend state is LISTED with `selected_route`.
- C: CSV dry run → upload → the new batch in Fleet → passport. A malformed file shows the field error and saves nothing.
- D: Bear preset → edit → Custom → save → reload → reopen.
- E: List → sell → record a −$1,250 outcome → passport and Outcomes show the loss.
- Fleet Command: strategy, the review gate (note and acknowledgement required), commit and per-asset results.
- Demo mode: labelled, lifecycle buttons disabled, back to Live (desktop, tablet, mobile).
- Every page renders without errors or overflow (desktop, tablet, mobile).
- API unreachable: Live mode shows the not-connected banner and no figures.

Not tested automatically: screen-reader behaviour, keyboard-only walkthroughs beyond focus handling, and Safari or Firefox.

## 5. Unsupported features

- **NVIDIA diagnostic upload.** `POST /assets/diagnose` exists but has no UI. Diagnostics appear only for the four DEMO-* sellers, graded from simulated files.
- **Creating one asset by hand.** There is no form for `POST /assets`; use CSV upload.
- **Later lifecycle steps in bulk.** Fleet Command only plans the first move from RECEIVED. Activation, compute, drain and sale happen one asset at a time from the passport.
- **Live market data.** Market Intelligence shows dated files shipped with the model. There is no price feed and no alerts.
- **Shared drafts.** Saved scenarios, the Fleet Command plan and unsent route choices live in one browser.
- **Recalculation in Demo mode.** Demo mode answers only from recorded runs: the three presets, plus one input at a time on recorded steps, for eight featured assets. Anything else asks you to switch to Live.

## 6. Known limitations

- "Keep earning" loads every RECEIVED asset's detail (`?confidence=false`), about 100 requests on the seeded fleet, to find which compute routes are eligible. It's fine locally; a bulk endpoint would be better at scale.
- Fleet and Overview totals add each asset's modeled value on its own timeline. They are not a same-date portfolio valuation, and the UI says so.
- Outcome variance compares against the value stored when the first move was made. If inputs were edited later, the current recommendation is shown separately.
- Demo mode's snapshot is a point-in-time recording (`scripts/build_demo_snapshot.py`). It has to be rebuilt after a model change.
- The hash router (`#passport/ID`) needs no server configuration, but links aren't crawlable or server-rendered.

## 7. Security considerations

- **No authentication and no multi-tenancy.** Anyone who can reach the web app or API can read every asset, upload batches, record lifecycle moves and outcomes, and edit inputs. Do not present or deploy this as safe for several independent customers.
- **Passport links are not private.** A shared `#passport/{id}` link opens that asset for anyone with network access to the app and API.
- **Demo reset.** The browser never calls `POST /demo/reset`, and no reset token exists anywhere in frontend code or config (`VITE_*` values end up in the bundle; none are secret). CORS doesn't allow the `X-Demo-Token` header, so a browser can't send it cross-origin. `scripts/dev.sh` doesn't set `DEMO_RESET_TOKEN`, so locally anyone who can reach the API, or the dev proxy at `/api/demo/reset`, can wipe the database. Set the token for any shared environment; `render.yaml` already generates one.
- **CORS** allows only the origins in `CORS_ORIGINS` (default: the local web app), methods GET, POST and PATCH, and the `Content-Type` header. In development the browser talks to the Vite proxy on the same origin, so CORS isn't involved.
- **No secrets** exist in client code. Database credentials stay in the API's `DATABASE_URL`.
- **Rendering.** All API text is HTML-escaped before rendering. External links use `rel="noopener noreferrer"`.
- **Uploads** are limited by the backend (5 MB, 5,000 rows, `extra="forbid"` on inputs).

## 8. Remaining production-readiness tasks

1. Authentication, and organisation-level tenancy on every query, including passport access.
2. Roles: who may commit lifecycle moves, overrides and outcomes.
3. Server-side storage for saved scenarios and plans.
4. A bulk eligibility or plan endpoint for Fleet Command, and an idempotency key for commits.
5. Postgres via `DATABASE_URL`, migrations (the new `outcomes` table is created by `create_all`) and backups.
6. Rate limiting and request size limits at the proxy.
7. UI for NVIDIA diagnostic upload (`POST /assets/diagnose`).
8. A live market feed with clear provenance, if one is wanted.
9. An accessibility audit (axe plus manual screen reader) and cross-browser testing.
10. CI running all three suites on every change.
