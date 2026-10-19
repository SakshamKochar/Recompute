import csv
import io
import secrets
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .db import Asset, Batch, get_session
from .fleet import asset_values, summarize, totals
from .output import checked_recommend
from .recompute_model import COMBINED_SCENARIOS, SCENARIO_DIALS, apply_scenario
from .schema import MODEL_VERSION, NOT_FOUND

router = APIRouter(prefix="/batches", tags=["batches"])

SEED_BATCH = "SYN-FLEET"
BatchId = Annotated[str, Path(openapi_examples={"SYN-FLEET": {"value": SEED_BATCH}})]
SORTS = {
    "gain": lambda r: (-r["gain_vs_baseline"], r["asset_id"]),
    "value": lambda r: (-r["route_value"], r["asset_id"]),
    "asset_id": lambda r: r["asset_id"],
    "route": lambda r: (r["route"], r["asset_id"]),
}
CSV_COLUMNS = ["asset_id", "model", "asset_profile", "site", "failed", "failed_part", "state", "route", "after_repair",
               "baseline_route", "route_value", "sell_now_value", "gain_vs_baseline", "warnings"]


def new_batch(session, source, filename=None, batch_id=None):
    batch = Batch(batch_id=batch_id or f"UP-{secrets.token_hex(4).upper()}", source=source, filename=filename)
    session.add(batch)
    return batch


Scenario = Literal[tuple(COMBINED_SCENARIOS)]
SCENARIO_NOTE = ("Saksham's v0.9 market scenarios applied to each server's latest inputs. Bear: low utilization, "
                 "slow buyers, expensive power, fast value decline, low resale. Bull is the mirror image.")


def asset_row(a, scenario="base"):
    values = asset_values(a)
    rec = a.recommendations[-1] if a.recommendations else None
    if scenario != "base" and rec:
        values = summarize(rec.inputs, checked_recommend(apply_scenario(rec.inputs, scenario), light=True))
    return {"asset_id": a.asset_id, "model": a.model, "asset_profile": a.inputs.get("asset_profile", "a100_8x"),
            "site": a.site, "failed_part": a.failed_part, "state": a.state, **values}


def load(session, batch_id):
    batch = session.scalars(select(Batch).where(Batch.batch_id == batch_id)
                            .options(selectinload(Batch.assets).selectinload(Asset.recommendations))).first()
    if not batch:
        raise HTTPException(404, f"no batch {batch_id}")
    return batch


def batch_out(batch, rows):
    return {"batch_id": batch.batch_id, "source": batch.source, "filename": batch.filename,
            "created_at": batch.created_at, "model_version": MODEL_VERSION, "totals": totals(rows)}


@router.get("")
def list_batches(session: Session = Depends(get_session)):
    q = (select(Batch).order_by(Batch.created_at.desc(), Batch.batch_id)
         .options(selectinload(Batch.assets).selectinload(Asset.recommendations)))
    return {"batches": [batch_out(b, [asset_row(a) for a in b.assets]) for b in session.scalars(q)]}


@router.get("/{batch_id}", responses=NOT_FOUND)
def read_batch(batch_id: BatchId, sort: Literal[tuple(SORTS)] = Query("gain"),
               scenario: Scenario = Query("base", description="bear, base or bull"),
               session: Session = Depends(get_session)):
    batch = load(session, batch_id)
    rows = sorted((asset_row(a, scenario) for a in batch.assets), key=SORTS[sort])
    return batch_out(batch, rows) | {"scenario": scenario, "assets": rows}


@router.get("/{batch_id}/scenarios", responses=NOT_FOUND)
def batch_scenarios(batch_id: BatchId, session: Session = Depends(get_session)):
    """Totals for the batch under bear, base and bull, side by side."""
    batch = load(session, batch_id)
    return {"batch_id": batch.batch_id, "model_version": MODEL_VERSION, "note": SCENARIO_NOTE,
            "dials": {d: {lv: dict(changes) for lv, (_, changes) in levels.items()} for d, levels in SCENARIO_DIALS.items()},
            "combined": COMBINED_SCENARIOS,
            "scenarios": {s: totals([asset_row(a, s) for a in batch.assets]) for s in ("bear", "base", "bull")}}


@router.get("/{batch_id}/results.csv", responses=NOT_FOUND, response_class=Response)
def batch_csv(batch_id: BatchId, scenario: Scenario = Query("base"), session: Session = Depends(get_session)):
    batch = load(session, batch_id)
    out = io.StringIO()
    w = csv.DictWriter(out, fieldnames=CSV_COLUMNS, extrasaction="ignore")
    w.writeheader()
    for r in sorted((asset_row(a, scenario) for a in batch.assets), key=SORTS["gain"]):
        r = {**r, "warnings": "; ".join(x["code"] for x in r["warnings"] or [])}
        w.writerow({k: round(v, 2) if isinstance(v, float) else ("" if v is None else v) for k, v in r.items()})
    return Response(out.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{batch_id}-{scenario}-results.csv"'})
