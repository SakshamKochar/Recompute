from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .batches import SEED_BATCH, new_batch
from .db import Asset, Batch, Recommendation, Transition, get_session
from .fleet import DESCRIPTIVE, asset_values, load_fleet
from .lifecycle import STATES, TERMINAL, TransitionError, available_events, check
from .output import MODEL_ERROR, checked_recommend
from .checks import decision_confidence
from .repairs import effective_inputs
from .schema import CONFLICT, MODEL_VERSION, NOT_FOUND, AssetInputs, error

router = APIRouter(prefix="/assets", tags=["assets"])
seed_router = APIRouter(tags=["assets"])

ROUTES = ("SELL NOW", "LIST AND WAIT", "YIELD WHILE LISTED", "HOST LONGER", "REPAIR", "HARVEST", "RECYCLE")
StateFilter = Optional[Literal[tuple(STATES)]]
RouteFilter = Optional[Literal[ROUTES]]
AssetId = Annotated[str, Path(openapi_examples={"SYN-001": {"value": "SYN-001"}})]


class AssetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    model: Optional[str] = None
    grade: Optional[str] = None
    age_months: Optional[int] = Field(None, ge=0, le=600)
    site: Optional[str] = None
    failed_part: Optional[str] = None
    synthetic: bool = False
    inputs: AssetInputs = Field(default_factory=AssetInputs)


class EventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event: str
    note: Optional[str] = None
    override: bool = False


def latest(asset):
    return asset.recommendations[-1] if asset.recommendations else None


def asset_out(asset, full=True, confidence=False):
    rec = latest(asset)
    allowed, override = available_events(asset.state, rec.inputs if rec else asset.inputs, rec.result if rec else None)
    out = {
        "asset_id": asset.asset_id, "model": asset.model, "grade": asset.grade,
        "age_months": asset.age_months, "site": asset.site, "failed_part": asset.failed_part,
        "synthetic": asset.synthetic, "batch_id": asset.batch_id, "state": asset.state,
        **asset_values(asset),
        "allowed_events": allowed,
        "override_events": override,
        "updated_at": asset.updated_at,
    }
    if full:
        out["inputs"] = asset.inputs
        _, out["model_adjustments"], out["repair_pricing"] = effective_inputs(asset.inputs, asset.failed_part, asset.model)
        out["diagnostics"] = asset.diagnostics
        if confidence:
            out["decision_confidence"] = decision_confidence(rec.inputs) if rec else None
        out["recommendation"] = rec and {
            "id": rec.id, "model_version": rec.model_version, "created_at": rec.created_at, "result": rec.result}
    return out


def add_recommendation(session, asset):
    inputs, _, _ = effective_inputs(asset.inputs, asset.failed_part, asset.model)
    result = checked_recommend(inputs)
    rec = Recommendation(asset_id=asset.asset_id, model_version=MODEL_VERSION,
                         inputs=dict(inputs), route=result["route"], result=result)
    asset.recommendations.append(rec)
    return rec


def create_asset(session, body: AssetCreate, batch_id=None, diagnostics=None):
    asset = Asset(**body.model_dump(exclude={"inputs"}), inputs=body.inputs.to_model(), state="RECEIVED",
                  batch_id=batch_id, diagnostics=diagnostics)
    session.add(asset)
    rec = add_recommendation(session, asset)
    asset.transitions.append(Transition(event="received", from_state=None, to_state="RECEIVED",
                                        route_at_time=rec.route))
    return asset


def get_asset(session, asset_id):
    asset = session.get(Asset, asset_id)
    if not asset:
        raise HTTPException(404, f"no asset {asset_id}")
    return asset


@router.post("", status_code=201, responses={**MODEL_ERROR, 409: error("An asset with this ID already exists", "asset SRV-1 already exists")})
def post_asset(body: AssetCreate, session: Session = Depends(get_session)):
    if session.get(Asset, body.asset_id):
        raise HTTPException(409, f"asset {body.asset_id} already exists")
    asset = create_asset(session, body)
    session.commit()
    return asset_out(asset)


@router.get("")
def list_assets(state: StateFilter = Query(None), route: RouteFilter = Query(None),
                batch_id: Optional[str] = Query(None), session: Session = Depends(get_session)):
    q = select(Asset).order_by(Asset.asset_id)
    if state:
        q = q.where(Asset.state == state)
    if batch_id:
        q = q.where(Asset.batch_id == batch_id)
    assets = [asset_out(a, full=False) for a in session.scalars(q)]
    if route:
        assets = [a for a in assets if a["route"] == route]
    return {"count": len(assets), "assets": assets}


@router.get("/{asset_id}", responses=NOT_FOUND)
def read_asset(asset_id: AssetId, confidence: bool = Query(True, description="Include decision confidence (about 0.2 s)"),
               session: Session = Depends(get_session)):
    return asset_out(get_asset(session, asset_id), confidence=confidence)


@router.patch("/{asset_id}/inputs", responses={**NOT_FOUND, **MODEL_ERROR, 409: error("Asset is SOLD, HARVESTED or RECYCLED", "asset is SOLD; inputs are locked")})
def patch_inputs(asset_id: AssetId, body: AssetInputs, session: Session = Depends(get_session)):
    asset = get_asset(session, asset_id)
    if asset.state in TERMINAL:
        raise HTTPException(409, f"asset is {asset.state}; inputs are locked")
    asset.inputs = AssetInputs(**(asset.inputs | body.to_model())).to_model()
    add_recommendation(session, asset)
    session.commit()
    return asset_out(asset)


@router.post("/{asset_id}/events", responses={**NOT_FOUND, **CONFLICT})
def post_event(asset_id: AssetId, body: EventIn, session: Session = Depends(get_session)):
    asset = get_asset(session, asset_id)
    rec = latest(asset)
    inputs = rec.inputs if rec else asset.inputs
    try:
        target, details = check(body.event, asset.state, inputs, rec and rec.result, body.override, body.note)
    except TransitionError as e:
        raise HTTPException(e.status, e.message)
    override = body.override and not _allowed_without_override(body.event, asset.state, inputs, rec)
    t = Transition(event=body.event, from_state=asset.state, to_state=target,
                   route_at_time=rec.route if rec else None, override=override,
                   note=body.note, details=details)
    asset.transitions.append(t)
    from_state, asset.state = asset.state, target
    if body.event == "list" and from_state == "REPAIRING":
        asset.inputs = {**asset.inputs, "health_pass": True}
        add_recommendation(session, asset)
    session.commit()
    return {"asset": asset_out(asset), "transition": transition_out(t)}


def _allowed_without_override(event, state, inputs, rec):
    try:
        check(event, state, inputs, rec and rec.result, False, None)
        return True
    except TransitionError:
        return False


def transition_out(t):
    return {"type": "transition", "id": t.id, "event": t.event, "from_state": t.from_state,
            "to_state": t.to_state, "route_at_time": t.route_at_time, "override": t.override,
            "note": t.note, "details": t.details, "at": t.created_at}


@router.get("/{asset_id}/history", responses=NOT_FOUND)
def history(asset_id: AssetId, session: Session = Depends(get_session)):
    asset = get_asset(session, asset_id)
    items = [transition_out(t) for t in asset.transitions] + [
        {"type": "recommendation", "id": r.id, "route": r.route, "model_version": r.model_version,
         "inputs": r.inputs, "audit": r.result["audit"], "at": r.created_at}
        for r in asset.recommendations]
    items.sort(key=lambda i: (i["at"], 0 if i["type"] == "recommendation" else 1, i["id"]))
    return {"asset_id": asset_id, "state": asset.state, "events": items}


@seed_router.post("/fleet/seed", responses=MODEL_ERROR)
def seed_fleet(session: Session = Depends(get_session)):
    added, skipped = 0, 0
    if not session.get(Batch, SEED_BATCH):
        new_batch(session, "seed", "recompute_synthetic_fleet.csv", SEED_BATCH)
    for a in load_fleet():
        d = a["asset"]
        if session.get(Asset, d["asset_id"]):
            skipped += 1
            continue
        body = AssetCreate(**{k: d[k] for k in DESCRIPTIVE if k not in ("age_months", "failed_part")},
                           age_months=int(d["age_months"]), failed_part=d["failed_part"] or None,
                           inputs=AssetInputs(**a["inputs"]))
        create_asset(session, body, SEED_BATCH)
        added += 1
    session.commit()
    return {"added": added, "skipped": skipped, "batch_id": SEED_BATCH}
