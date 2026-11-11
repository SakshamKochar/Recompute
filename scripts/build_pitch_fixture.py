"""Record the SYN-003 stage case for the finals pitch view (#pitch).

Runs the real v0.9 model in-process on SYN-003 from Saksham's synthetic fleet, once at the
dated A100 rental index ($1.57) and once at the stage hypothetical ($0.80). Every dollar the
pitch view shows comes from this file, so the stage demo never waits on the API.

Run from the repo root:  backend/.venv/bin/python scripts/build_pitch_fixture.py
Writes:                  frontend/src/pitch/syn003.json
"""
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app import recompute_model as model  # noqa: E402
from app.fleet import asset_inputs  # noqa: E402

ASSET = "SYN-003"
RATES = {"index": 1.57, "stage": 0.80}
OUT = ROOT / "frontend" / "src" / "pitch" / "syn003.json"
ASSUMPTION_KEYS = [
    "offer_today", "market_price", "sell_fee_pct", "logistics", "dwell_days", "rental_rate",
    "platform_fee_pct", "utilization", "first_month_utilization", "horizon_months",
    "market_decay_pct_mo", "elec_per_kwh", "pue", "colo_per_kw_mo", "maint_per_day",
    "activation_cost", "exit_cost", "discount_rate_yr", "margin_abs", "margin_pct", "gpus", "server_kw",
]


def row_for(asset_id):
    with open(ROOT / "backend" / "data" / "recompute_synthetic_fleet.csv", newline="") as f:
        for row in csv.DictReader(f):
            if row["asset_id"] == asset_id:
                return row
    raise SystemExit(f"{asset_id} not in the synthetic fleet")


def main():
    row = row_for(ASSET)
    inputs = asset_inputs(row)
    if abs(inputs["rental_rate"] - RATES["index"]) > 1e-9:
        raise SystemExit(f"{ASSET} rental_rate is {inputs['rental_rate']}, expected {RATES['index']}")
    cases = {}
    for key, rate in RATES.items():
        x = {**inputs, "rental_rate": rate}
        resolved = model.resolve_defaults(x["asset_profile"])
        resolved.update(x)
        cases[key] = {
            "rental_rate": rate,
            "result": model.recommend(x),
            "assumptions": {k: resolved[k] for k in ASSUMPTION_KEYS},
        }
    out = {
        "asset_id": ASSET,
        "model_version": "0.9",
        "synthetic": True,
        "identity": {k: row[k] for k in ["model", "grade", "age_months", "site", "ownership", "gpus"]},
        "diagnostic_capture": None,
        "inputs": inputs,
        "cases": cases,
        "source": "Recorded in-process from backend/app/recompute_model.py v0.9 by scripts/build_pitch_fixture.py",
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    for key, c in cases.items():
        b = c["result"]["base"]
        print(key, c["rental_rate"], c["result"]["route"], {r: round(v) for r, v in b.items() if v is not None})


if __name__ == "__main__":
    main()
