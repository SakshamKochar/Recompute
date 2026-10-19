from collections import Counter

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .db import Asset, Transition, get_session
from .fleet import summarize
from .lifecycle import COMPUTE_ROUTES, STATES, TERMINAL, resolved
from .schema import MODEL_VERSION

router = APIRouter(tags=["dashboard"])

ON_COMPUTE = {"ACTIVATING", "COMPUTING", "DRAINING"}
PRIORITY = {"sale_at_risk": 0, "route_changed": 1, "overridden": 2, "awaiting_decision": 3}


def action_items(asset, rec):
    items = []
    route = rec.route if rec else None
    last = asset.transitions[-1] if asset.transitions else None
    if asset.state == "RECEIVED":
        items.append(("awaiting_decision", f"new asset, recommended {route}"))
    if asset.state in ON_COMPUTE and route not in COMPUTE_ROUTES:
        items.append(("route_changed", f"on compute but the latest recommendation is {route}"))
    if asset.state in {"COMPUTING", "DRAINING"}:
        x = resolved(asset.inputs)
        if x["exit_days"] > x["buyer_window_days"]:
            items.append(("sale_at_risk", f"exit takes {x['exit_days']:g} days, buyer allows {x['buyer_window_days']:g}"))
    if last and last.override and asset.state not in TERMINAL:
        items.append(("overridden", f"{last.event} went against {last.route_at_time}: {last.note}"))
    return items


@router.get("/dashboard")
def dashboard(include_synthetic: bool = Query(True), include_awaiting: bool = Query(False),
              recent: int = Query(10, ge=0, le=100),
              session: Session = Depends(get_session)):
    q = select(Asset).options(selectinload(Asset.recommendations), selectinload(Asset.transitions))
    if not include_synthetic:
        q = q.where(Asset.synthetic.is_(False))
    assets = list(session.scalars(q))

    by_state = {s: 0 for s in STATES} | dict(Counter(a.state for a in assets))
    by_route, by_profile = Counter(), Counter()
    value = baseline = 0.0
    actions = []
    for a in assets:
        rec = a.recommendations[-1] if a.recommendations else None
        by_profile[a.inputs.get("asset_profile", "a100_8x")] += 1
        if rec:
            by_route[rec.route] += 1
            s = summarize(rec.inputs, rec.result)
            if a.state not in TERMINAL:
                value += s["route_value"]
                baseline += s["sell_now_value"]
        for kind, reason in action_items(a, rec):
            actions.append({"asset_id": a.asset_id, "state": a.state, "route": rec.route if rec else None,
                            "kind": kind, "reason": reason})

    kinds = Counter(i["kind"] for i in actions)
    actions.sort(key=lambda i: (PRIORITY[i["kind"]], i["asset_id"]))
    if not include_awaiting:
        actions = [i for i in actions if i["kind"] != "awaiting_decision"]
    ids = [a.asset_id for a in assets]
    activity = []
    if recent and ids:
        tq = (select(Transition).where(Transition.asset_id.in_(ids))
              .order_by(Transition.created_at.desc(), Transition.id.desc()).limit(recent))
        activity = [{"asset_id": t.asset_id, "event": t.event, "from_state": t.from_state, "to_state": t.to_state,
                     "override": t.override, "note": t.note, "at": t.created_at} for t in session.scalars(tq)]

    return {
        "model_version": MODEL_VERSION,
        "total_assets": len(assets),
        "open_assets": sum(1 for a in assets if a.state not in TERMINAL),
        "by_state": by_state,
        "by_route": dict(by_route),
        "by_profile": dict(by_profile),
        "open_value": {"recommended": round(value, 2), "baseline": round(baseline, 2),
                       "gain_vs_baseline": round(value - baseline, 2)},
        "action_counts": dict(kinds),
        "action_items": actions,
        "recent_activity": activity,
    }
