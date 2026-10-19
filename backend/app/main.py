import os
from collections import Counter
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
from .recompute_model import PROFILES
from .schema import MODEL_VERSION, NOT_FOUND, AssetInputs
from .upload import router as upload_router


@asynccontextmanager
async def lifespan(app):
    init_db()
    if os.getenv("SEED_ON_START", "").lower() in ("1", "true", "yes"):
        seed_if_empty()
    yield


app = FastAPI(title="ReCompute API", version=MODEL_VERSION, lifespan=lifespan)
app.add_exception_handler(ModelOutputError, model_output_handler)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    return {"ok": True, "model_version": MODEL_VERSION}


@app.get("/meta")
def meta():
    return {
        "model_version": MODEL_VERSION,
        "profiles": {p: resolve_defaults(p) for p in PROFILES},
        "assumptions": load_assumptions(),
    }


@app.post("/recommend", responses=MODEL_ERROR)
def post_recommend(body: AssetInputs, flip_points: bool = Query(False, description="Also return decision confidence and what flips the answer (about 0.2 s)")):
    inputs = body.to_model()
    out = {"model_version": MODEL_VERSION, "inputs": inputs, "result": checked_recommend(inputs),
           "warnings": warnings(inputs)}
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
