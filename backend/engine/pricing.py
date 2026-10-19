"""Listing pricing, delivery, repair and order calculations."""
import csv, hashlib
from decimal import Decimal, ROUND_HALF_UP
from datetime import timedelta
from pathlib import Path
from .constants import REF_DATE
from .grading import factors
from recompute_model import resolve_defaults, recommend
ROOT=Path(__file__).resolve().parents[1]
CONSTANTS={"insurance_pct":0.005,"transit_days":3,"inspection_days":7}
def round_step(v,step=100): return int((Decimal(str(v))/Decimal(step)).quantize(Decimal("1"),rounding=ROUND_HALF_UP)*Decimal(step))
def asking_price(base,grade): return round_step(base*factors(grade)["price_factor"])
def buyer_total(asking,freight):
    ins=int(Decimal(str(asking*CONSTANTS["insurance_pct"])).quantize(Decimal("1"),rounding=ROUND_HALF_UP)); return asking+freight+ins,ins
def seller_net(asking,sell_fee_pct,logistics): return asking*(1-sell_fee_pct)-logistics
def delivery(currently_rented,exit_days):
    ship=exit_days if currently_rented else 0; return REF_DATE+timedelta(days=ship+CONSTANTS["transit_days"]),ship

def fault_row(part):
    with open(ROOT/"data/sources/fault_costs.csv",newline="",encoding="utf-8") as f:
        return next(r for r in csv.DictReader(f) if r["part"]==part)
def repair_option(raw, ev, mi, base, asis_price):
    """Buyer's repaired option, priced at the grade the server earns after the repair and retest."""
    if mi["health_pass"] or not mi["repairable"]:
        return None
    from .diagnostics import repaired_projection, evaluate
    rev = evaluate(repaired_projection(raw["report"]), raw["gpu_count"])
    repaired = asking_price(base, rev["grade"])
    x = resolve_defaults(raw["asset_profile"])
    reseat = set(ev.get("reseat_only_gpus", []))
    parts = [f["part"] for f in ev["chassis_faults"]] + [(f"re-seat GPU {g}" if g in reseat else f"GPU {g}") for g in ev["failed_gpus"]]
    cost = mi["repair_parts_cost"] + x["repair_labor_cost"] + x["repair_test_cost"]
    return {"parts": parts, "repaired_score": rev["score"], "repaired_grade": rev["grade"], "repaired_price": repaired,
            "buyer_premium": repaired - asis_price, "repair_cost": cost, "repair_days": mi["repair_days"],
            "status": "COMPUTED"}
def order_id(listing_id,option): return "RC-"+hashlib.sha256((listing_id+"|"+option).encode()).hexdigest()[:8]
