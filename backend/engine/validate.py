"""Model input validation."""
from recompute_model import DEFAULTS,PROFILES
SHARES={"sell_fee_pct":.5,"platform_fee_pct":.9,"utilization":1,"first_month_utilization":1,"repair_success":1,"margin_pct":.5}
DAYS={"dwell_days":365,"repair_days":120,"buyer_window_days":60,"ramp_util_days":90,"ramp_days":365,"exit_days":365}
MONEY={"offer_today","market_price","logistics","rental_rate","colo_per_kw_mo","maint_per_day","activation_cost","exit_cost","harvest_value","repair_parts_cost","repair_labor_cost","repair_test_cost","recycle_value","margin_abs"}
KNOWN=set(DEFAULTS)|{"asset_profile"}
def validate_inputs(x):
 e=[]
 for k,v in x.items():
  if k not in KNOWN:e.append(f"unknown key: {k}");continue
  if k in ("health_pass","repairable") and type(v) is not bool:e.append(f"{k} must be bool")
  if k=="asset_profile" and v not in PROFILES:e.append("asset_profile invalid")
  if k=="ownership" and v not in ("owned","client_approved","consigned"):e.append("ownership invalid")
  if k=="gpus" and not (isinstance(v,int) and 1<=v<=16):e.append("gpus out of range")
  if k=="server_kw" and not .5<=v<=15:e.append("server_kw out of range")
  if k in SHARES and not 0<=v<=SHARES[k]:e.append(f"{k} out of range")
  if k in ("price_drift_pct_mo","market_decay_pct_mo") and not -.05<=v<=.2:e.append(f"{k} out of range")
  if k in DAYS and not 0<=v<=DAYS[k]:e.append(f"{k} out of range")
  if k in MONEY and v<0:e.append(f"{k} must be nonnegative")
  if k=="pue" and not 1<=v<=3:e.append("pue out of range")
  if k=="elec_per_kwh" and not 0<=v<=1:e.append("elec_per_kwh out of range")
  if k=="horizon_months" and not (isinstance(v,int) and 1<=v<=60):e.append("horizon_months out of range")
 return e
def validate_or_raise(x):
 e=validate_inputs(x)
 if e:raise ValueError("; ".join(e))
