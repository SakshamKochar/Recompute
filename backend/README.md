# ReCompute API

FastAPI backend for the ReCompute decision model, v0.9.
`app/recompute_model.py` is Saksham's v0.9 master, unchanged. `engine/` is his diagnostic engine (Oct 4 update: a GPU that falls off the bus, Xid 79, fails and is priced as a re-seat), unchanged, reading `data/sources/`. `data/fleet_uplift_v09.json` is his published fleet uplift; a test checks the backend against every number in it. Replace it when the model version changes, then update `MODEL_VERSION` in `app/schema.py`.

## Updating the model

1. Replace `app/recompute_model.py` with the new file.
2. Set `MODEL_VERSION` in `app/schema.py`.
3. Run `pytest -q`. Tests that fail show exactly which routes or values moved.
4. Update the expected routes in `tests/test_api.py` from the new Presets tab, and refresh `data/recompute_assumptions.csv` from the Inputs tab.
5. If routes moved, refresh the result columns of `data/recompute_synthetic_fleet.csv`. Its input columns are Saksham's synthetic data and stay as they are.

## Run

```
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000/docs to try every endpoint in the browser.
For demo data, call `POST /demo/reset`: it clears everything and loads the 100 test servers (`SYN-FLEET`) and the four demo sellers (`DEMO-SELLERS`). Call it before every demo run so it always starts from the same state.

## Hosting

`render.yaml` sets up a free Render web service from the GitHub repo: Python 3.11, `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, health check on `/health`.

| Setting | What it does |
|---|---|
| `SEED_ON_START=true` | Loads the demo data when the database is empty. Free hosts wipe the disk on every restart, so the demo data comes back on its own |
| `DEMO_RESET_TOKEN` | Render generates one. `POST /demo/reset` then needs it in the `X-Demo-Token` header, so strangers can't wipe the demo. Find it under the service's Environment tab |
| `DATABASE_URL` | Optional. Point it at Postgres to keep uploads across restarts (see Database) |
| `CORS_ORIGINS` | Comma-separated browser origins allowed to call the API. Defaults to the local web app (`http://127.0.0.1:5274,http://localhost:5274`). Set it to the deployed web app's origin; never `*` |

On the free plan the server sleeps when idle and the first request after that is slow. Uploaded batches are lost when it restarts unless `DATABASE_URL` points at a real database.

## Test

```
pytest -q
```

172 tests: Saksham's original 152, plus 20 in `tests/test_integration_extensions.py` for the endpoints added during the frontend integration (scenario recommend, selected route, outcomes, market evidence, CORS). The original 152 check every route on finance's Presets tab (defaults and presets A to E, A100 and H100), check sale, harvest, recycle and repair values by hand, pin the full A100 default result to the cent, reject bad input, confirm all 100 fleet servers match `recompute_synthetic_fleet.csv` and the bear/base/bull totals match Saksham's, price repairs by failed part, grade the four demo sellers from their NVIDIA files, walk assets through the lifecycle, check CSV uploads, batches and the dashboard, confirm broken model output is caught, and cover every finding from the pre-push review (unsafe or oversized captures, huge numbers, repaired servers, error codes).

## Database

By default the API uses a local SQLite file, `recompute.db`, created on first start. Nothing to set up.

For Postgres or Supabase, install a driver and set `DATABASE_URL` before starting:

```
pip install "psycopg[binary]"
export DATABASE_URL="postgresql+psycopg://USER:PASSWORD@HOST:5432/postgres"
```

Three tables:

| Table | Holds |
|---|---|
| `assets` | One row per server: descriptive fields, model inputs, current state |
| `recommendations` | Every model run for an asset: version, inputs, route and full result |
| `transitions` | Every state change: event, from and to state, the route at that moment, override flag, note, details (including the `selected_route`, when one was sent) |
| `outcomes` | Realized values recorded after an asset reached a final state, linked to that final transition. Append-only: a correction is a new row |

Nothing is ever overwritten. Changing inputs adds a new recommendation, and every state change adds a transition, so `/assets/{id}/history` is the full audit trail.

## Asset lifecycle

When a repaired server is listed (`list` from REPAIRING), it is treated as healthy: `health_pass` becomes true and the model reruns, so its route, baseline and buttons are those of a working server. Its uplift is then measured against SELL NOW, and it no longer counts as failed in batch totals.

| Event | From | To | Rule |
|---|---|---|---|
| `list` | RECEIVED, REPAIRING, SANITIZING | LISTED | A failed server needs `override` to list without repair |
| `activate` | LISTED | ACTIVATING | Route must be YIELD WHILE LISTED or HOST LONGER, or `override` with a note. Never allowed when compute routes are ineligible (consigned) |
| `start_compute` | ACTIVATING | COMPUTING | |
| `buyer_found` | COMPUTING | DRAINING | Logs exit days, buyer window and whether the sale is at risk |
| `drained` | DRAINING | SANITIZING | |
| `sell` | LISTED, SANITIZING | SOLD | Final |
| `repair` | RECEIVED, LISTED | REPAIRING | Only for a failed, repairable server. Route must be REPAIR, or `override` with a note |
| `harvest` | RECEIVED, LISTED, REPAIRING | HARVESTED | Final. Route must be HARVEST, or `override` |
| `recycle` | RECEIVED, LISTED, REPAIRING, HARVESTED | RECYCLED | Final. Route must be RECYCLE, or `override` |

Every asset response includes two lists for the frontend:

- `allowed_events`: events that will go through right now. Show these as normal buttons.
- `override_events`: events that go against the recommendation and need `override: true` plus a note. Show these behind a confirm step.

Events that are blocked outright (for example `repair` on a healthy server, or `activate` on a consigned one) appear in neither list.

Wrong state returns 409. Unknown event returns 422. An override without a note returns 422.
Once an asset is SOLD, HARVESTED or RECYCLED, its inputs are locked.

## Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `ok` and the model version |
| GET | `/meta` | Defaults for each profile, the assumptions sheet with sources, and the scenario dials (`scenarios`) |
| POST | `/recommend` | `{model_version, inputs, result, warnings}`. `result` is the spec's nine output fields, unchanged. `?flip_points=true` adds `decision_confidence`. `?scenario=bear`, `base` or `bull` applies Saksham's scenario to the inputs first and returns the adjusted inputs plus `scenario`. Stateless |
| GET | `/fleet` | All 100 synthetic servers with route, value, baseline and gain, plus route counts. Stateless |
| GET | `/fleet/{asset_id}` | One synthetic server's inputs and full result. Stateless |
| POST | `/fleet/seed` | Loads the synthetic fleet into the database. Safe to call twice |
| POST | `/assets` | Creates an asset, runs the model, state RECEIVED |
| GET | `/assets` | All assets with route and values. Optional `?state=`, `?route=` and `?batch_id=` filters |
| GET | `/assets/{id}` | The passport: asset, inputs, latest recommendation, warnings, diagnostics, repair pricing, decision confidence and the events allowed next. `?confidence=false` skips the confidence (about 0.2 s) |
| PATCH | `/assets/{id}/inputs` | Merges new inputs, reruns the model |
| POST | `/assets/{id}/events` | `{event, note, override, selected_route}`. Moves the asset to its next state. `selected_route` is optional and must be in the latest recommendation's eligible list (409 otherwise); it is stored on the transition and returned as the asset's `selected_route` |
| POST | `/assets/{id}/outcomes` | `{realized_value, note}`. Records what actually happened, after every cost; may be negative. Only in SOLD, HARVESTED or RECYCLED (409 otherwise). Returns 201 |
| GET | `/outcomes` | Every asset with a decision: decision-time recommendation and selected route, events, current recommendation, latest outcome and its variance against the modeled value. `?state=open` or `completed` |
| GET | `/market/evidence` | The dated source files in `data/sources` (rental index, resale, electricity, grades, repair costs) as JSON. Not a live feed: `live` is always false |
| GET | `/market/live` | On-demand GPU rental asks from Vast.ai's public bundles API (no key). Median, low, high and a short in-memory history per GPU, cached about 60 seconds. `live` is false when `MARKET_LIVE_FEED=off` or Vast.ai did not answer and nothing is cached. These are hosts' listed prices, not completed rentals, and the model's rental rates are not changed |
| GET | `/assets/{id}/history` | Every recommendation and transition, in order |
| POST | `/assets/upload` | Uploads a CSV of servers as a new batch. Returns every server's route and values, plus totals. Options: `?dry_run=true`, `?skip_existing=true` |
| GET | `/assets/upload/template` | A starter CSV with the most common columns and two example rows |
| GET | `/batches` | Every upload (and the seeded fleet) with its totals, newest first |
| GET | `/batches/{id}` | One batch: totals plus every server's route and values. `?sort=gain` (default), `value`, `asset_id` or `route`; `?scenario=bear`, `base` (default) or `bull` |
| GET | `/batches/{id}/results.csv` | The same rows as a CSV download. Takes `?scenario=` too |
| GET | `/batches/{id}/scenarios` | Batch totals under bear, base and bull, side by side |
| POST | `/assets/diagnose` | Grades a capture from `tools/capture_nvidia.sh` and creates the asset from it. Form fields `file`, `asset_id`, `model`, optional `site`, `ownership`. `?dry_run=true` grades without saving |
| POST | `/demo/reset` | Clears everything and reloads `SYN-FLEET` and `DEMO-SELLERS`. Needs `X-Demo-Token` when `DEMO_RESET_TOKEN` is set |
| POST | `/demo/sellers` | Loads the four demo sellers from simulated NVIDIA files as batch `DEMO-SELLERS`. Safe to call twice |
| GET | `/dashboard` | Fleet summary for the main screen. Options: `?include_synthetic=false`, `?include_awaiting=true`, `?recent=10` |

## Example: renting while listed, start to finish

```
POST /assets  {"asset_id": "Y1", "inputs": {"dwell_days": 60, "activation_cost": 400,
               "first_month_utilization": 0.6, "market_decay_pct_mo": 0.02}}
POST /assets/Y1/events  {"event": "list"}
POST /assets/Y1/events  {"event": "activate"}
POST /assets/Y1/events  {"event": "start_compute"}
POST /assets/Y1/events  {"event": "buyer_found"}
POST /assets/Y1/events  {"event": "drained"}
POST /assets/Y1/events  {"event": "sell"}
GET  /assets/Y1/history
```

## Dashboard

`GET /dashboard` is one call with everything the main screen needs:

| Field | What it is |
|---|---|
| `total_assets`, `open_assets` | All servers, and the ones not yet SOLD, HARVESTED or RECYCLED |
| `by_state`, `by_route`, `by_profile` | Counts for each state (zeros included), recommended route and server type |
| `open_value` | For open servers: value of the recommended routes, value of the baseline (sell now, or harvest/recycle if failed), and the gain between them |
| `action_counts`, `action_items` | Servers that need a person, with a reason |
| `recent_activity` | The latest state changes across the fleet, newest first |

Action items are sorted most urgent first, in this order. `awaiting_decision` is only counted unless you send `?include_awaiting=true`, so new servers don't bury real alerts.

1. `sale_at_risk`: computing or draining, and pulling it off takes longer than the buyer allows
2. `route_changed`: on compute, but the latest recommendation no longer says to be
3. `overridden`: its last move went against the model
4. `awaiting_decision`: a new server still in RECEIVED

All times in every response are UTC and end in `+00:00`.

## Fleet view (batches)

Every upload becomes a batch with its own ID, like `UP-43928A7A`. `POST /fleet/seed` puts the 100 synthetic servers in a batch called `SYN-FLEET`. The fleet screen is one call, `GET /batches/{id}`.

Each server row has:

| Field | What it is |
|---|---|
| `route` | The recommended route |
| `route_value` | What the recommended route is worth |
| `baseline_route` | The simple default: SELL NOW for a healthy server, HARVEST or RECYCLE (whichever is worth more) for a failed one |
| `sell_now_value` | What the baseline is worth. For a failed server this is the harvest or recycle value, not a sale |
| `gain_vs_baseline` | `route_value` minus `sell_now_value` |
| `after_repair` | For REPAIR, the route the server takes once fixed |

`totals` adds them up for the batch:

| Field | What it is |
|---|---|
| `count`, `routes` | Servers in the batch, and how many get each route |
| `changed_from_baseline` | Servers where the model beats the default |
| `recommended_value`, `baseline_value` | Sum of route values, and sum of default values |
| `gain_vs_baseline`, `gain_pct` | Total uplift, in dollars and as a share of the default |
| `avg_gain_per_server` | Total uplift divided by every server in the batch. Servers whose route doesn't change count as $0 |
| `failed_count`, `failed_share` | Servers that failed diagnostics |
| `fee_rate`, `projected_fee_if_every_recommendation_followed` | 10% of total uplift. Assumes every recommendation is carried out; the financials apply an executed share on top |
| `by_profile` | `count`, values, uplift and average uplift for each server type (A100 and H100) |

Totals are rounded to the cent on every endpoint. Values on a single server row are not; format them in the UI.

Values always come from each server's latest recommendation, so changing a server's inputs updates its batch totals. A dry run upload returns the same rows and totals without saving anything or creating a batch.

The headline number is `totals.gain_vs_baseline`: the projected value above taking the simple default for every server.

If your `recompute.db` was made before batches existed, delete it once so the new table and column are created.

## Diagnostics

ReCompute runs no GPU tests. `tools/capture_nvidia.sh` runs NVIDIA's own tools on a server (`sudo bash capture_nvidia.sh 3`, 15 to 30 minutes with the GPUs idle) and writes a `.tar.gz`. `POST /assets/diagnose` reads it with Saksham's engine, which grades the server (A+ to D), lists findings, and works out evidence confidence, the failed parts, the repair bill and the harvest value. See `docs/DIAGNOSTICS.md`.

The backend then sets the model inputs the same way the demo listings do:

| Input | From |
|---|---|
| `health_pass`, `repairable`, `harvest_value`, repair cost and days | The engine's `model_inputs()` |
| `market_price` | Component price × the grade's `price_factor`, to the nearest $100 |
| `offer_today` | Market price × the grade's `best_offer_ratio` |
| `dwell_days` | 57 days × the grade's `dwell_factor` |
| `rental_rate` | $1.26 for an A100 40GB (hypothesis from Saksham's fleet), otherwise the profile default |

A failed server is priced at the grade it would get after repair. Any A100 40GB server runs at $1.26 rental unless you send a `rental_rate` (team hypothesis; there is no 40GB index), shown under `model_adjustments` on the server. Captures are unpacked by the backend first: only regular files and folders, at most 500 entries and 50 MB unpacked, nothing outside the capture folder; anything else is a 422. The grade factors in `data/sources/grade_table.csv` are team hypotheses until CXtec data. `model` must name the GPU and memory, for example `8x A100 80GB`, because NVIDIA's output alone doesn't price the server.

## Repairs by failed part

For a failed server with a `failed_part` and no `repair_parts_cost`, the backend fills in the part cost and repair days from `data/sources/fault_costs.csv`, the same table the fleet and the diagnostic engine read. GPU cost follows the server type, and NIC and memory follow the platform. Values you send still win. An unknown part keeps the model default (one GPU) and is marked `priced: false` in `repair_pricing`. Repair success stays 85% for every part.

## Warnings and confidence

`warnings` flags combinations that pass the range checks but look wrong: first month utilization above steady state, today's offer above the market price, and harvest value above the market price. They never block a request.

`decision_confidence` says how robust the route is, from Saksham's `flip_points()`: the smallest change to one input that flips the route, as a share of its value. Under 5% is Low, 5% to 20% is Medium, 20% or more is High. The thresholds are a team hypothesis. It is not computed for failed servers, since the flip drivers only cover healthy routes. This is different from the diagnostics' `evidence_confidence`, which says how much test data the grade rests on.

## Scenarios

`?scenario=bear` or `bull` reruns each server in a batch with Saksham's `apply_scenario()`. Bear is low utilization, slow buyers, expensive power, fast value decline and low resale; bull is the mirror image. `GET /batches/{id}/scenarios` shows all three side by side. Three year projections belong to the financials workbook, not the app.

## Uploading inventory

`POST /assets/upload` takes a CSV file, one server per row. In the docs page, click "Try it out" and pick the file.

- `asset_id` is the only required column. Every other column is optional, and an empty cell means "use the default".
- Columns can be any of the descriptive fields (`model`, `grade`, `age_months`, `site`, `failed_part`, `synthetic`) or any of the 43 model inputs, using the exact spec names.
- True/false cells accept `true`, `false`, `yes`, `no`, `1`, `0`. Number cells accept `$` and commas, like `"$58,000"`.
- It's all or nothing. If any row has a problem, nothing is saved, and the response lists every problem with its spreadsheet row number and column.
- An unknown column name rejects the file, so a typo can't be silently ignored.
- `?dry_run=true` checks the file and shows each server's route without saving anything. Use it before a real upload.
- An `asset_id` that already exists is an error, unless you send `?skip_existing=true`.
- Result columns from Saksham's fleet CSV (`route`, `route_value` and so on) are ignored, so that file uploads as is.
- Limits: 5 MB and 5,000 rows per file, UTF-8 CSV (Excel's "CSV UTF-8" option).

Start from `GET /assets/upload/template`.

## Input rules

All 43 fields are optional. Anything left out takes the model default for its `asset_profile`.
Requests are rejected with a 422 if they contain:

- a field name that is not in the spec
- a value outside the spec's valid range
- the wrong type (for example `"false"` as text instead of `false`)
- a dollar amount above $1 billion, or `age_months` above 600 (keeps every total finite)

## Output rules

Every model result is checked before it is saved or returned, on every endpoint that runs the model. The result must have exactly the nine spec fields, and:

- `route` is one of the seven routes and is in `eligible`
- `base` has all seven routes, and the chosen route has a value
- every number is a real, finite number (not text, not NaN)
- `after_repair_route` is set exactly when REPAIR is eligible
- `audit` has at least one line

If a result breaks a rule, the API returns a 500 listing each problem, and nothing is saved:

```
{"detail": {"error": "model returned an invalid result", "model_version": "0.9",
            "problems": [{"field": "route", "problem": "Input should be 'SELL NOW', ..."}]}}
```

This only fires if the model file itself is wrong, for example a new version that renames a field. Bad input never reaches the model; it gets a 422 first.
