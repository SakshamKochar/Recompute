#!/usr/bin/env bash
# Start the ReCompute API and the web app together. Ctrl-C stops both.
#   API  http://127.0.0.1:${RECOMPUTE_API_PORT:-8000}
#   Web  http://127.0.0.1:${RECOMPUTE_WEB_PORT:-5274}  (proxies /api to the API)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_PORT="${RECOMPUTE_API_PORT:-8000}"
WEB_PORT="${RECOMPUTE_WEB_PORT:-5274}"

if [ ! -x "$ROOT/backend/.venv/bin/uvicorn" ]; then
  echo "Setting up the backend virtualenv…"
  python3 -m venv "$ROOT/backend/.venv"
  "$ROOT/backend/.venv/bin/pip" install -q -r "$ROOT/backend/requirements.txt"
fi
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "Installing frontend dependencies…"
  (cd "$ROOT/frontend" && npm install --no-audit --no-fund)
fi

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(
  cd "$ROOT/backend"
  SEED_ON_START="${SEED_ON_START:-true}" \
  CORS_ORIGINS="${CORS_ORIGINS:-http://127.0.0.1:$WEB_PORT,http://localhost:$WEB_PORT}" \
  exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" --reload
) &

(
  cd "$ROOT/frontend"
  RECOMPUTE_WEB_PORT="$WEB_PORT" RECOMPUTE_API_PROXY_TARGET="http://127.0.0.1:$API_PORT" exec npx vite
) &

wait
