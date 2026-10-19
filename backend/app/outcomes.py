"""Outcome tracking: what a person says actually happened, next to what the model said at decision time.
Read-only over recommendations and transitions; the only new data is the realized value someone records."""
from math import fsum
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .assets import AssetId, get_asset, outcome_out, selected_route
from .db import Asset, Outcome, get_session
from .lifecycle import TERMINAL
from .schema import MODEL_VERSION, NOT_FOUND, error

router = APIRouter(tags=["outcomes"])

REALIZED_MAX = 1e9


class OutcomeIn(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    realized_value: float = Field(ge=-REALIZED_MAX, le=REALIZED_MAX,
                                  description="Net proceeds after every cost, USD. Negative when the decision lost money.")
    note: Optional[str] = Field(None, max_length=2000)


def _rec_at(asset, when):
    """The recommendation that was current at a moment: the latest one made at or before it."""
    recs = [r for r in asset.recommendations if r.created_at <= when]
    return recs[-1] if recs else (asset.recommendations[0] if asset.recommendations else None)


def _rec_out(rec):
    if not rec:
        return None
    return {"id": rec.id, "route": rec.route, "model_version": rec.model_version, "at": rec.created_at,
            "route_value": rec.result["base"].get(rec.route), "inputs": rec.inputs}


def ledger_entry(asset):
    moves = [t for t in asset.transitions if t.event != "received"]
    if not moves:
        return None
    first = moves[0]
    decision_rec = _rec_at(asset, first.created_at)
    chosen = selected_route(asset)
    terminal = asset.state in TERMINAL
    done = next((t for t in reversed(moves) if t.to_state == asset.state), None) if terminal else None
    latest_outcome = asset.outcomes[-1] if asset.outcomes else None
    latest_rec = asset.recommendations[-1] if asset.recommendations else None

    comparison = None
    if latest_outcome and decision_rec:
        basis = "selected_route" if chosen else "recommended_route"
        route = chosen or decision_rec.route
        modeled = decision_rec.result["base"].get(route)
        comparison = {"basis": basis, "route": route, "modeled_value": modeled,
                      "realized_value": latest_outcome.realized_value,
                      "variance": None if modeled is None else latest_outcome.realized_value - modeled,
                      "model_version": decision_rec.model_version}

    return {
        "asset_id": asset.asset_id, "model": asset.model, "batch_id": asset.batch_id, "state": asset.state,
        "terminal": terminal,
        "intake_recommendation": _rec_out(asset.recommendations[0] if asset.recommendations else None),
        "decision": {
            "transition_id": first.id, "event": first.event, "at": first.created_at,
            "route_at_time": first.route_at_time, "selected_route": chosen,
            "override": any(t.override for t in moves),
            "recommendation": _rec_out(decision_rec),
            "selected_route_value": decision_rec.result["base"].get(chosen) if (decision_rec and chosen) else None,
        },
        "current_recommendation": _rec_out(latest_rec),
        "recommendation_changed": bool(latest_rec and decision_rec and latest_rec.route != decision_rec.route),
        "events": [{"id": t.id, "event": t.event, "from_state": t.from_state, "to_state": t.to_state,
                    "override": t.override, "note": t.note, "at": t.created_at} for t in moves],
        "completed": done and {"event": done.event, "state": done.to_state, "at": done.created_at,
                               "transition_id": done.id},
        "outcome": latest_outcome and outcome_out(latest_outcome),
        "outcome_corrections": max(0, len(asset.outcomes) - 1),
        "comparison": comparison,
    }


@router.post("/assets/{asset_id}/outcomes", status_code=201, responses={
    **NOT_FOUND, 409: error("The asset has not reached SOLD, HARVESTED or RECYCLED", "asset is LISTED; ...")})
def post_outcome(asset_id: AssetId, body: OutcomeIn, session: Session = Depends(get_session)):
    """Record the realized net value of a completed asset. A second call records a correction; history keeps both."""
    asset = get_asset(session, asset_id)
    if asset.state not in TERMINAL:
        raise HTTPException(409, f"asset is {asset.state}; an outcome can only be recorded once it is "
                                 f"{', '.join(sorted(TERMINAL))}")
    done = next(t for t in reversed(asset.transitions) if t.to_state == asset.state)
    o = Outcome(asset_id=asset.asset_id, transition_id=done.id, realized_value=body.realized_value,
                note=(body.note or "").strip() or None)
    asset.outcomes.append(o)
    session.commit()
    return {"outcome": outcome_out(o), "entry": ledger_entry(asset)}


@router.get("/outcomes")
def list_outcomes(state: Optional[str] = Query(None, description="open (in motion) or completed"),
                  session: Session = Depends(get_session)):
    """Every asset that has moved past RECEIVED: the recommendation when the first move was made, what was selected,
    each lifecycle event, completion, and any recorded realized value. Modeled values are never labelled realized."""
    q = (select(Asset).order_by(Asset.asset_id)
         .options(selectinload(Asset.recommendations), selectinload(Asset.transitions), selectinload(Asset.outcomes)))
    entries = [e for e in (ledger_entry(a) for a in session.scalars(q)) if e]
    if state == "open":
        entries = [e for e in entries if not e["terminal"]]
    elif state == "completed":
        entries = [e for e in entries if e["terminal"]]
    compared = [e["comparison"] for e in entries if e["comparison"] and e["comparison"]["modeled_value"] is not None]
    return {
        "model_version": MODEL_VERSION,
        "summary": {
            "in_motion": sum(not e["terminal"] for e in entries),
            "completed": sum(e["terminal"] for e in entries),
            "with_outcome": sum(e["outcome"] is not None for e in entries),
            "realized_total": round(fsum(c["realized_value"] for c in compared), 2),
            "modeled_total_for_recorded": round(fsum(c["modeled_value"] for c in compared), 2),
            "variance_total": round(fsum(c["variance"] for c in compared), 2),
        },
        "entries": entries,
    }
