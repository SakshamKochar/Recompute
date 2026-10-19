# Run ReCompute locally

Tested on Ubuntu 24.04 with Python 3.12 and Node 22. Python 3.11+ and Node 20.19+ (or 22.12+) should work.

## One command

```bash
./scripts/dev.sh
```

The first run creates `backend/.venv` and installs `frontend/node_modules`. Then it starts:

| Service | URL | Notes |
|---|---|---|
| Web app | http://127.0.0.1:5274 | Vite dev server; `/api/*` is proxied to the API |
| ReCompute API | http://127.0.0.1:8000 | FastAPI; interactive docs at http://127.0.0.1:8000/docs |

Ctrl-C stops both. The API seeds 104 demo servers (`SYN-FLEET` and `DEMO-SELLERS`) into `backend/recompute.db` when the database is empty.

Change ports with `RECOMPUTE_WEB_PORT=6000 RECOMPUTE_API_PORT=9000 ./scripts/dev.sh`.

## Two terminals, step by step

```bash
# 1. API
cd backend
python3 -m venv .venv              # on Debian/Ubuntu you may need: sudo apt install python3-venv
.venv/bin/pip install -r requirements.txt
SEED_ON_START=true .venv/bin/uvicorn app.main:app --reload       # http://127.0.0.1:8000

# 2. Web app
cd frontend
npm install
npm run dev                         # http://127.0.0.1:5274
```

## Start again from a clean fleet

Lifecycle moves and outcomes are saved in `backend/recompute.db`. To start over, stop the API and delete that file; it is reseeded on the next start.

`POST /demo/reset` does the same while the API runs. The web app never calls it. If you set `DEMO_RESET_TOKEN`, call it yourself:

```bash
curl -X POST http://127.0.0.1:8000/demo/reset -H "X-Demo-Token: $DEMO_RESET_TOKEN"
```

Drafts, saved scenarios and the Fleet Command plan live in the browser. Clear them with the ↺ button in the header.

## Tests

```bash
# Backend: 172 tests (Saksham's 152 + 20 for the integration endpoints)
cd backend && .venv/bin/python -m pytest -q

# Frontend unit tests (Vitest, jsdom): 47 tests
cd frontend && npm test

# End-to-end journeys A–E plus responsive and offline checks (Playwright).
# Starts its own API on :8190 with a throwaway database and a web server on :5290.
cd frontend && npx playwright install chromium   # or set CHROME=/path/to/chrome
npm run test:e2e
```

## Configuration

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `VITE_API_BASE` | `frontend/.env.local` | `/api` | API base URL in the browser. Use the API's full origin for a static build |
| `VITE_API_TIMEOUT_MS` | `frontend/.env.local` | `15000` | Per-request timeout |
| `VITE_DEFAULT_MODE` | `frontend/.env.local` | `auto` | `auto`, `live` or `demo` |
| `RECOMPUTE_API_PROXY_TARGET` | env for `npm run dev` | `http://127.0.0.1:8000` | Where the dev proxy sends `/api` |
| `SEED_ON_START` | API env | unset | `true` seeds demo servers into an empty database |
| `DATABASE_URL` | API env | `sqlite:///./recompute.db` | Any SQLAlchemy URL |
| `CORS_ORIGINS` | API env | `http://127.0.0.1:5274,http://localhost:5274` | Browser origins allowed to call the API directly |
| `DEMO_RESET_TOKEN` | API env | unset | Protects `POST /demo/reset`. Never put it in frontend config |

## Production build of the web app

```bash
cd frontend
VITE_API_BASE=https://your-api.example.com npm run build    # output in frontend/dist-build
```

Serve `dist-build/` from any static host and add its origin to the API's `CORS_ORIGINS`.

## Rebuild the Demo-mode snapshot

Demo mode replays `frontend/public/demo/snapshot.json`, recorded from the real API. After a model change:

```bash
backend/.venv/bin/python scripts/build_demo_snapshot.py
```
