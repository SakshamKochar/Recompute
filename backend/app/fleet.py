import csv
from collections import Counter
from functools import lru_cache
from math import fsum
from pathlib import Path

from .checks import warnings
from .output import checked_recommend
from .schema import AssetInputs

DATA = Path(__file__).resolve().parent.parent / "data"

DESCRIPTIVE = ["asset_id", "synthetic", "model", "grade", "age_months", "site", "failed_part"]
BOOL_INPUTS = {"health_pass", "repairable"}
INT_INPUTS = {"gpus"}
TEXT_INPUTS = {"asset_profile", "ownership"}
MODEL_INPUTS = [
    "asset_profile", "ownership", "health_pass", "repairable", "gpus", "server_kw",
    "rental_rate", "market_price", "offer_today", "dwell_days", "utilization",
    "first_month_utilization", "harvest_value", "recycle_value", "repair_parts_cost", "repair_days",
]


def _parse(key, raw):
    if key in BOOL_INPUTS:
        return raw.strip().lower() == "true"
    if key in INT_INPUTS:
        return int(float(raw))
    if key in TEXT_INPUTS:
        return raw
    return float(raw)


def asset_inputs(row):
    return AssetInputs(**{k: _parse(k, row[k]) for k in MODEL_INPUTS}).to_model()


def summarize(inputs, result):
    route = result["route"]
    base = result["base"]
    if inputs.get("health_pass", True):
        baseline_route = "SELL NOW"
    else:
        baseline_route = "HARVEST" if base["HARVEST"] >= base["RECYCLE"] else "RECYCLE"
    baseline = base[baseline_route]
    value = base[route]
    return {
        "asset_profile": inputs.get("asset_profile", "a100_8x"),
        "failed": not inputs.get("health_pass", True),
        "route": route,
        "after_repair": result["after_repair_route"],
        "baseline_route": baseline_route,
        "route_value": value,
        "sell_now_value": baseline,
        "gain_vs_baseline": value - baseline,
        "warnings": warnings(inputs),
    }


@lru_cache(maxsize=1)
def load_fleet():
    with open(DATA / "recompute_synthetic_fleet.csv", newline="") as f:
        rows = list(csv.DictReader(f))
    fleet = []
    for row in rows:
        inputs = asset_inputs(row)
        result = checked_recommend(inputs)
        fleet.append({
            "asset": {k: row[k] for k in DESCRIPTIVE} | {"synthetic": row["synthetic"] == "True"},
            "inputs": inputs,
            "result": result,
            "summary": summarize(inputs, result),
            "expected": {k: row[k] for k in ("route", "after_repair", "route_value", "sell_now_value", "gain_vs_baseline")},
        })
    return fleet


@lru_cache(maxsize=1)
def load_assumptions():
    with open(DATA / "recompute_assumptions.csv", newline="") as f:
        return list(csv.DictReader(f))


FEE_RATE = 0.10
VALUE_FIELDS = ("asset_profile", "failed", "route", "after_repair", "baseline_route", "route_value", "sell_now_value", "gain_vs_baseline", "warnings")


def asset_values(asset):
    rec = asset.recommendations[-1] if asset.recommendations else None
    return summarize(rec.inputs, rec.result) if rec else dict.fromkeys(VALUE_FIELDS)


def _sums(rows):
    value = round(fsum(r["route_value"] for r in rows), 2)
    baseline = round(fsum(r["sell_now_value"] for r in rows), 2)
    gain = round(value - baseline, 2)
    return {
        "count": len(rows),
        "recommended_value": value,
        "baseline_value": baseline,
        "gain_vs_baseline": gain,
        "avg_gain_per_server": round(gain / len(rows), 2) if rows else None,
    }


def totals(rows):
    out = _sums(rows)
    failed = sum(bool(r["failed"]) for r in rows)
    out.update({
        "routes": dict(Counter(r["route"] for r in rows)),
        "changed_from_baseline": sum(r["route"] != r["baseline_route"] for r in rows),
        "gain_pct": round(out["gain_vs_baseline"] / out["baseline_value"], 4) if out["baseline_value"] else None,
        "failed_count": failed,
        "failed_share": round(failed / len(rows), 4) if rows else None,
        "fee_rate": FEE_RATE,
        "projected_fee_if_every_recommendation_followed": round(out["gain_vs_baseline"] * FEE_RATE, 2),
        "by_profile": {p: _sums([r for r in rows if r["asset_profile"] == p])
                       for p in sorted({r["asset_profile"] for r in rows})},
    })
    return out
