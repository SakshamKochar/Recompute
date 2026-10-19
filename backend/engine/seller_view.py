"""Seller decision: the model run on inputs that come from the listing and its diagnostics."""
from recompute_model import resolve_defaults, recommend, flip_points, apply_scenario
from .pricing import round_step
from .grading import factors


def model_x(raw, asking, sp, grade, mi, rep=None):
    x = resolve_defaults(raw["asset_profile"]); x.update(raw.get("model_overrides", {}))
    rental = raw.get("rental") or {}
    x.update({
        "gpus": mi["working_gpus"],  # only GPUs that passed can earn rental income
        "server_kw": raw["system_power_kw"], "ownership": raw["ownership"],
        "health_pass": mi["health_pass"], "repairable": mi["repairable"],
        "harvest_value": mi["harvest_value"],
        "offer_today": round_step(asking * factors(grade)["best_offer_ratio"]), "market_price": asking,
        "dwell_days": sp["expected_days"],
        "utilization": rental.get("utilization", x["utilization"]),
        "first_month_utilization": rental.get("utilization", x["first_month_utilization"]) if rental.get("more_than_30_days") else x["first_month_utilization"],
    })
    if not mi["health_pass"]:
        x.update({"repair_parts_cost": mi["repair_parts_cost"], "repair_days": mi["repair_days"]})
        if rep:  # a failed server's prices only feed the repaired outcome, so use the post-repair grade's prices
            from .selling_power import selling_power
            x.update({"market_price": rep["repaired_price"],
                      "offer_today": round_step(rep["repaired_price"] * factors(rep["repaired_grade"])["best_offer_ratio"]),
                      "dwell_days": selling_power(rep["repaired_grade"])["expected_days"]})
    return x


def seller_view(raw, asking, sp, grade, mi, rep=None):
    x = model_x(raw, asking, sp, grade, mi, rep)
    out = {"model_inputs_used": {k: x[k] for k in ("gpus", "health_pass", "repairable", "harvest_value", "repair_parts_cost", "repair_days", "offer_today", "market_price", "dwell_days", "utilization")},
           "recommendation": recommend(x), "flip_points": flip_points(x), "scenarios": {}}
    for s in ("bear", "base", "bull"):
        out["scenarios"][s] = recommend(apply_scenario(x, s))
    return out
