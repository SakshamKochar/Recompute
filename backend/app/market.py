"""Market evidence: the dated observations in data/sources that the model's defaults were built from.
These are files in the repository, not a live feed; every row keeps its own status, source and retrieval date."""
import csv
from functools import lru_cache

from fastapi import APIRouter

from .fleet import DATA
from .schema import MODEL_VERSION

router = APIRouter(tags=["market"])

SOURCES = {
    "rental_index": ("rental_index_history.csv", "GPU rental index readings, USD per GPU-hour"),
    "resale": ("resale_evidence.csv", "Observed used-hardware prices and asking prices"),
    "electricity": ("eia_state_rates.csv", "Electricity rates, cents per kWh"),
    "grades": ("grade_table.csv", "How a diagnostic grade moves price, wait and offer (team hypothesis)"),
    "repair_costs": ("fault_costs.csv", "Repair part cost and days by failed part"),
}
NUMERIC = {"usd_per_gpu_hr", "price_usd", "cents_per_kwh", "cost_usd", "repair_days", "min_score",
           "price_factor", "dwell_factor", "best_offer_ratio", "warranty_days"}


def _cell(k, v):
    if k in NUMERIC and v not in (None, ""):
        try:
            return float(v)
        except ValueError:
            return v
    return v


@lru_cache(maxsize=1)
def load_evidence():
    out = {}
    for key, (name, title) in SOURCES.items():
        with open(DATA / "sources" / name, newline="") as f:
            rows = [{k: _cell(k, v) for k, v in r.items()} for r in csv.DictReader(f)]
        out[key] = {"file": f"data/sources/{name}", "title": title, "rows": rows}
    return out


@router.get("/market/evidence")
def market_evidence():
    return {
        "model_version": MODEL_VERSION,
        "live": False,
        "note": "Dated observations shipped with the model in data/sources. Not a live market feed. "
                "Each row carries its own status (SOURCED, DERIVED, HYPOTHESIS, TO_VERIFY) and retrieval date.",
        "sources": load_evidence(),
    }
