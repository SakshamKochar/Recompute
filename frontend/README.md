# ReCompute — design prototype

Local design review build. Do not deploy until design approval and backend integration.

## Run

From this folder: `python3 -m http.server 4173 --directory dist`

Open http://localhost:4173. No package installation or build step is required.

## Working interactions

- Seven navigation views: Overview, Fleet, Fleet Command, What-if Lab, Market Intelligence, Outcome Tracking, About.
- Fleet search, route filtering, and CSV export.
- Individual asset passports with condition, valuation, security status, route selection, and economics.
- Multi-asset selection and action plans with duplicate active-decision prevention.
- Scenario model with utilization, energy cost, time horizon, and depreciation controls. Saved scenario comparisons.
- Decision ledger, actual net proceeds entry, and planned-versus-realized variance.
- Browser-local persistence and explicit demo reset.
- Responsive layouts, keyboard controls, modal focus handling, reduced-motion and contrast preferences.

## Demo boundaries

Eight fictional assets, prices, diagnostic results, recommendations, and market signals are illustrative. The overview trend is an illustrative graphic. No live AI, market feeds, hardware telemetry, authentication, transactions, hosting, or repair integrations exist. Local storage is browser-specific, not a backend database. Hosting calculations include idle power, a 12% platform fee, a 5% sale fee, and compounded depreciation; they exclude tax, financing, downtime and discounting.

## Backend handoff

`dist/demo-data.js` holds assets, route names and the deterministic calculation function. `dist/app.js` handles rendering and local decision/scenario persistence. `dist/style.css` holds design tokens and responsive styles. `dist/index.html` is the application shell.

On backend delivery, map its actual schemas and endpoints to asset lists, passport diagnostics/history, valuation estimates, recommendation explanations, market signals, scenario results, plans and outcomes. Replace local persistence with authenticated server records and add loading/error states based on the real API. Do not expose API secrets in browser code. Preserve the interface while integration details are finalized.

## Verification

Browser-checked asset passport, decision creation, actual outcome recording, scenario slider recalculation, saved comparison, persistence after reload, combined search/route filtering, and selected-asset fleet planning. Reviewed desktop and 390px mobile rendering; no document-level horizontal overflow at 390px. Browser console had no errors. JavaScript syntax and model arithmetic/sensitivity checks passed.

Publication is intentionally deferred. A private unpublished Sites registration was reserved before the request to delay deployment; no source was pushed or deployed.

## Story-first redesign

The default entry point is now `#home`: an editorial landing page in warm ivory, forest green and terracotta. `dist/experience.js` implements a four-chapter guided asset story, passport reveal, interactive economics and a decision handoff into the existing workspace. Utilization-adjusted values are retained in the saved plan. The full workspace remains available through Enter workspace; its brand link returns home.

Verified the guided flow through passport, scenario adjustment, route selection and saved outcome-ledger handoff. Reviewed the new 390px mobile landing composition and confirmed no document overflow. Publication remains deferred.

## Decision Studio redesign — October 19

All seven workspace screens now use the same editorial identity as the landing experience. The old sidebar and old screen renderers were removed. `studio.js` provides the new views and `studio.css` defines the workspace visual system.

- Overview: next useful decision, fleet context, four-step journey, opportunity cards.
- Fleet: illustrated asset gallery, card/list switching, search/filter and export.
- Passport: split cover/detail view, diagnostic context, economics disclosure, route choice, scenario handoff.
- Fleet Command: balanced, liquidity and earning strategies, Earn/Exit/Recover lanes, selection and plan review.
- What-if Lab: scenario presets, live model trajectory, ranked routes, transparent value equation and saved comparisons.
- Opportunity Radar: interactive signals opening relevant asset passports.
- Outcomes: planned/realized lanes, actual net values, variance and undo after decision removal.
- About: brand principles and lifecycle journey.
- Landing: interactive Understand/Explore/Act studio previews connect the story to the product.

Final checks: desktop gallery, filters, passport and scenario handoff, preset recalculation, strategy-driven route selection and persistence, radar links and deletion undo. All seven workspace sections checked at 390px with no document overflow. Mobile passport identity verified. No browser console errors in final review. Syntax checks passed. Demo model data remains illustrative and no deployment has occurred.
