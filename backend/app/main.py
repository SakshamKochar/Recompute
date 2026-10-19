import os
from collections import Counter
from typing import Literal, Optional
from math import fsum
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Path, Query
from fastapi.middleware.cors import CORSMiddleware

from .assets import router as assets_router
from .checks import decision_confidence, warnings
from .assets import seed_router
from .batches import router as batches_router
from .dashboard import router as dashboard_router
from .demo import router as demo_router
from .demo import seed_if_empty
from .diagnostics_api import router as diagnostics_router
from .db import init_db
from .fleet import load_assumptions, load_fleet
from .output import MODEL_ERROR, ModelOutputError, checked_recommend, model_output_handler, resolve_defaults
from .market import router as market_router
from .outcomes import router as outcomes_router
from .batches import SCENARIO_NOTE
from .recompute_model import COMBINED_SCENARIOS, PROFILES, SCENARIO_DIALS, apply_scenario
from .schema import MODEL_VERSION, NOT_FOUND, AssetInputs
from .spa import StripApiPrefix
from .upload import router as upload_router


@asynccontextmanager
async def lifespan(app):
    init_db()
    if os.getenv("SEED_ON_START", "").lower() in ("1", "true", "yes"):
        seed_if_empty()
    yield


DEFAULT_CORS_ORIGINS = "http://127.0.0.1:5274,http://localhost:5274"


def cors_origins():
    """Comma-separated CORS_ORIGINS; local frontend dev origins when unset. '*' must be set explicitly."""
    return [o.strip() for o in os.getenv("CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",") if o.strip()]


app = FastAPI(title="ReCompute API", version=MODEL_VERSION, lifespan=lifespan)
app.add_exception_handler(ModelOutputError, model_output_handler)
app.add_middleware(CORSMiddleware, allow_origins=cors_origins(), allow_methods=["GET", "POST", "PATCH"],
                   allow_headers=["Content-Type"])
# Added last so it runs first and the API sees paths with `/api` removed.
app.add_middleware(StripApiPrefix)


@app.get("/health")
def health():
    return {"ok": True, "model_version": MODEL_VERSION}


@app.get("/meta")
def meta():
    return {
        "model_version": MODEL_VERSION,
        "profiles": {p: resolve_defaults(p) for p in PROFILES},
        "assumptions": load_assumptions(),
        "scenarios": {
            "note": SCENARIO_NOTE,
            "dials": {d: {lv: {"kind": kind, "changes": dict(changes)} for lv, (kind, changes) in levels.items()}
                      for d, levels in SCENARIO_DIALS.items()},
            "combined": COMBINED_SCENARIOS,
        },
    }


@app.post("/recommend", responses=MODEL_ERROR)
def post_recommend(body: AssetInputs,
                   flip_points: bool = Query(False, description="Also return decision confidence and what flips the answer (about 0.2 s)"),
                   scenario: Optional[Literal[tuple(COMBINED_SCENARIOS)]] = Query(
                       None, description="Apply Saksham's bear, base or bull market scenario to the inputs first. "
                                         "The returned inputs are the scenario-adjusted ones.")):
    inputs = body.to_model()
    if scenario:
        inputs = apply_scenario(inputs, scenario)
    out = {"model_version": MODEL_VERSION, "inputs": inputs, "result": checked_recommend(inputs),
           "warnings": warnings(inputs)}
    if scenario:
        out["scenario"] = scenario
    if flip_points:
        out["decision_confidence"] = decision_confidence(inputs)
    return out


@app.get("/fleet", responses=MODEL_ERROR)
def get_fleet():
    fleet = load_fleet()
    assets = [a["asset"] | a["summary"] for a in fleet]
    return {
        "model_version": MODEL_VERSION,
        "count": len(assets),
        "routes": dict(Counter(a["route"] for a in assets)),
        "total_gain_vs_baseline": round(fsum(a["gain_vs_baseline"] for a in assets), 2),
        "assets": assets,
    }


@app.get("/fleet/{asset_id}", responses=NOT_FOUND)
def get_asset(asset_id: str = Path(openapi_examples={"SYN-001": {"value": "SYN-001"}})):
    for a in load_fleet():
        if a["asset"]["asset_id"] == asset_id:
            return {"model_version": MODEL_VERSION, **{k: a[k] for k in ("asset", "inputs", "result", "summary")}}
    raise HTTPException(404, f"no asset {asset_id}")


app.include_router(demo_router)
app.include_router(diagnostics_router)
app.include_router(upload_router)
app.include_router(assets_router)
app.include_router(seed_router)
app.include_router(dashboard_router)
app.include_router(batches_router)
app.include_router(outcomes_router)
app.include_router(market_router)

if os.getenv("SERVE_WEB", "").lower() in ("1", "true", "yes"):
    from .spa import mount_web

    mount_web(app, os.getenv("WEB_DIST", "/app/web"))
