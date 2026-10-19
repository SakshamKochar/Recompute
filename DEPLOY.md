# Deploy ReCompute

This repository is the whole product: `frontend/` is the studio, `backend/` is the API. Push this repo to GitHub, then host it as two free services and a cheap domain.

| Piece | Where | Cost |
|---|---|---|
| Studio | Cloudflare Pages | $0 |
| API | Render free web service | $0 |
| Domain | Porkbun `recompute.life` | $2.57 first year, $34.50 renewal (checked 2026-10-19) |
| HTTPS | Cloudflare and Render | $0 |

Hosting can stay within free tiers for a small public demo. Cloudflare Functions have a daily request allowance; Render sleeps after inactivity and has monthly limits; Supabase Free pauses after a week of inactivity. Do not enable paid upgrades or overages for this budget.

There is no sign-in. Anyone with the link can view the fleet and record moves. The sample fleet is synthetic.

Render's free service sleeps after 15 minutes without a request and takes about a minute to wake. The studio shows "Connecting" while that happens. The free disk is wiped when the service sleeps or redeploys. Set `DATABASE_URL` to a Supabase Free Postgres session-pooler connection (port 5432) so fleet changes persist. Create the project with Data API disabled; the backend connects directly. Use the supplied username and host, URL-encode the password, and keep this URL only in Render environment secrets. `SEED_ON_START` loads samples only when the database is empty. Free Render Postgres expires after 30 days, so do not use it.

`fly.toml` and the `Dockerfile` are a different, paid, always-on option. Do not use them for this deploy.

## 1. GitHub

Push `main`. Both `frontend/` and `backend/` are in this same repository. Render and Cloudflare Pages both connect to that repo.

## 2. Render (API)

In the Render dashboard: New, Blueprint, connect the GitHub repo, apply the root `render.yaml`.

That file creates a free Python web service named `recompute-api`:

- Root directory `backend`
- Build: `pip install -r requirements.txt`
- Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health check: `/health`
- `SEED_ON_START=true`
- `DATABASE_URL`: the Supabase session-pooler URL, stored as a secret.
- `DISABLE_DEMO_RESET=true`: disables destructive public demo resets.

When the first deploy is live, copy the service URL, for example `https://recompute-api.onrender.com`.

Then set `CORS_ORIGINS` on that service to the site origins, comma-separated, once you know them:

```text
https://recompute.life,https://www.recompute.life,https://<pages-project>.pages.dev
```

## 3. Cloudflare Pages (studio)

Create a Pages project from the same GitHub repo.

| Setting | Value |
|---|---|
| Production branch | `main` |
| Build command | `npm ci --prefix frontend && npm run build --prefix frontend` |
| Build output directory | `frontend/dist-build` |
| Environment variable `API_ORIGIN` | the Render origin, with no path and no `/api`, for example `https://recompute-api.onrender.com` |

Do not set `VITE_API_BASE`. The studio calls `/api`, and `functions/api/[[path]].js` forwards that to Render. `frontend/public/_routes.json` keeps the function on `/api/*` only, so the static pages stay on the free unlimited tier.

Redeploy Pages after `API_ORIGIN` is saved. `https://<project>.pages.dev/api/health` should return `{"ok": true, ...}`. The first call after a quiet period can take about a minute.

## 4. Porkbun domain

Add `recompute.life` to Cloudflare's Free DNS plan. In Porkbun, replace its default nameservers with the exact two nameservers assigned by Cloudflare. Keep domain registration at Porkbun; no transfer is required.

In Pages, add `recompute.life` and `www.recompute.life` as custom domains. Wait for DNS activation and HTTPS issuance, then verify the website and `/api/health` on both hostnames.

## Direct-upload alternative

The initial launch may use the Cloudflare dashboard's direct-upload workflow. Build the frontend, then run `node scripts/package_pages.mjs` to create a Pages advanced-mode worker in the output directory. Upload the resulting directory or a ZIP of its contents and set `API_ORIGIN` to the Render HTTPS origin. `_routes.json` restricts the worker to API requests. This uses the same proxy implementation as Git-based builds.

Direct upload does not automatically deploy GitHub commits. Rebuild and upload for updates, or add a deliberate CI workflow later. Render deployments from a public repository also require manual deployment unless connected through Git integration or a Blueprint.

## Local check of the same build

```bash
cd frontend && VITE_API_BASE=/api npm run build
cd ../backend
SERVE_WEB=1 WEB_DIST=../frontend/dist-build SEED_ON_START=true \
  .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8766
```

Open http://127.0.0.1:8766. Day to day, use `./scripts/dev.sh` and http://127.0.0.1:5274.
