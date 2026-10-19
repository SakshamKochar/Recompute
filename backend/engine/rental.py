"""Rental history economics."""
from recompute_model import resolve_defaults,daily_compute_margin,colo_per_mo,DAYS_PER_MONTH
def rental_history(raw):
 if not raw.get("rental"): return None
 x=resolve_defaults(raw["asset_profile"]); x.update(raw.get("model_overrides",{})); u=raw["rental"]["utilization"]
 if raw["rental"].get("more_than_30_days"): x["first_month_utilization"]=u
 x["utilization"]=u; net,revenue,power,fixed=daily_compute_margin(x,u); gross=x["gpus"]*24*30*x["rental_rate"]*u
 return {"utilization":u,"gross_rental":gross,"marketplace_cut":gross*x["platform_fee_pct"],"net_revenue":revenue*30,"power_cost":power*30,"colo_upkeep_cost":fixed*30,"net_profit":net*30,"drain_days":x["exit_days"],"daily_net":net}
