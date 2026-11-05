"""Cross-field input warnings and decision confidence. Neither changes the model's nine-field output."""
from copy import deepcopy
from functools import lru_cache
import json
from threading import RLock

from .recompute_model import flip_points, resolve_defaults

CONFIDENCE_THRESHOLDS = {"low_below": 0.05, "high_from": 0.20}
CONFIDENCE_BASIS = ("Team hypothesis thresholds (Saksham, v0.9): the smallest change to one input that flips the route, "
                    "as a share of its current value. Under 5% = Low, 5% to 20% = Medium, 20% or more = High.")


def _resolved(inputs):
    x = resolve_defaults(inputs.get("asset_profile", "a100_8x"))
    x.update(inputs)
    return x


def warnings(inputs):
    """Combinations that pass every range check but look wrong. Warnings, not errors (Saksham, v0.9)."""
    x = _resolved(inputs)
    out = []
    if x["first_month_utilization"] > x["utilization"]:
        out.append({"code": "first_month_above_steady",
                    "message": f"First month utilization ({x['first_month_utilization']:.0%}) is above steady state "
                               f"({x['utilization']:.0%}). The first month is the ramp and should not beat steady state."})
    if x["offer_today"] > x["market_price"]:
        out.append({"code": "offer_above_market",
                    "message": f"Today's offer (${x['offer_today']:,.0f}) is above the listed market price "
                               f"(${x['market_price']:,.0f}). Rare but possible in a hot market; worth checking."})
    if x["harvest_value"] > x["market_price"]:
        out.append({"code": "harvest_above_market",
                    "message": f"Harvest value (${x['harvest_value']:,.0f}) is above the market price of the working server "
                               f"(${x['market_price']:,.0f}). Parts should not be worth more than the whole server."})
    return out


_confidence_lock = RLock()


def decision_confidence(inputs):
    """Reuse deterministic calculations for identical resolved inputs, never mutable asset records.

    The bounded process-local cache resets on deployment. Copy results so callers cannot
    corrupt later answers. Serializing misses also prevents duplicate CPU work when a
    passport and the lab request the same calculation concurrently.
    """
    key = json.dumps(_resolved(inputs), sort_keys=True, separators=(",", ":"), allow_nan=False)
    with _confidence_lock:
        return deepcopy(_cached_confidence(key))


@lru_cache(maxsize=128)
def _cached_confidence(key):
    return _compute_confidence(json.loads(key))


def _compute_confidence(inputs):
    """How robust the route is, from flip_points(). Failed servers are skipped: the flip drivers are
    compute and sale inputs, which do not move a repair, harvest or recycle decision."""
    if not _resolved(inputs)["health_pass"]:
        return {"level": None, "smallest_move": None, "drivers": [], "basis": CONFIDENCE_BASIS,
                "note": "Not computed for a failed server: the flip drivers only cover healthy routes."}
    fp = flip_points(inputs)
    moves = [d["move"] for d in fp["drivers"] if d["move"] is not None]
    smallest = min(moves) if moves else None
    if smallest is None or smallest >= CONFIDENCE_THRESHOLDS["high_from"]:
        level = "High"
    elif smallest >= CONFIDENCE_THRESHOLDS["low_below"]:
        level = "Medium"
    else:
        level = "Low"
    return {"level": level, "smallest_move": smallest, "drivers": fp["drivers"], "basis": CONFIDENCE_BASIS,
            "note": None if moves else "No driver changes the route anywhere in its range."}
