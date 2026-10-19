# ReCompute

**Value, redirected.** ReCompute finds the next best life for every GPU server: sell it now, list and wait, rent it out while it's listed, host it longer, repair it, harvest the parts or recycle it.

This repository joins two pieces into one working application:

| Folder | What it is |
|---|---|
| `backend/` | Saksham Kochar's ReCompute API and decision model (FastAPI, SQLAlchemy, SQLite), from [SakshamKochar/Recompute](https://github.com/SakshamKochar/Recompute). The model is unchanged; four small endpoints were added for the integration |
| `frontend/` | The ReCompute Decision Studio: the original design prototype rebuilt on the API (Vite, plain ES modules, no framework) |
| `scripts/` | `dev.sh` starts both; `build_demo_snapshot.py` records Demo-mode data from the real API |

## Quick start

```bash
./scripts/dev.sh
```

Open http://127.0.0.1:5274. Full instructions, tests and configuration: [RUN_LOCAL.md](RUN_LOCAL.md).

## What's in the studio

- **Overview**: the next worthwhile move, the open fleet's modeled value, assets by state and route, and what needs a person. All from `GET /dashboard` and `GET /assets`.
- **Fleet**: search, filter, sort, cards or table, batches with bear/base/bull comparison, CSV export, and CSV upload with a dry run.
- **Asset Passport** (`#passport/{id}`): identity, condition (real diagnostics only), all seven routes with stress cases, the model's reasoning and confidence, the lifecycle steps the backend allows, and full history. Recommended, Selected, Executed and Completed are kept separate.
- **What-if Lab**: change inputs and the backend model answers, debounced and cancellable. Bear, Base and Bull presets, Custom once you edit, flip points, and saved scenarios you can reopen.
- **Fleet Command**: three policies (follow the model, free up capital, keep earning), lanes, a draft plan, and an explicit review-and-commit step that reports every accepted and rejected move.
- **Decision Replay**: the evidence, the stored call, the one change that would have flipped it (before and after), and a step-through of the asset's history.
- **Market Intelligence**: opportunities from your own fleet, matched to the dated evidence files, fleet scenarios, and every model default with its source. Clearly marked as not live.
- **Outcomes**: decisions in motion and completed, realized values (losses included) and the variance against what was modeled.

**Live mode** uses the API. **Demo mode** replays responses recorded from the same API on synthetic servers and is read-only. The header always shows which one you're in, and Live mode never falls back to demo data.

## Before you put it on a network

There is no sign-in and no tenant isolation. Anyone who can reach the app and API can read every asset and record lifecycle moves and outcomes. Run it locally or on a trusted network. See [INTEGRATION_REPORT.md](INTEGRATION_REPORT.md) for security notes, test results and known limitations.
