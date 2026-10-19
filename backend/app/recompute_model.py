"""
ReCompute route calculator, v0.9 (reference model)

Compares routes for one retired GPU server and recommends one.
Default numbers are a mix of sourced values and hypotheses. See
recompute_assumptions.csv for the value, status, and source of every input.

Routes modeled:
  SELL NOW          accept today's offer
  LIST AND WAIT     list at market price, sit idle until it sells
  YIELD WHILE LISTED list at market price, run rented compute until it sells
  HOST LONGER       keep it as rented compute for a horizon, then sell
  REPAIR            for servers that failed diagnostics: replace the part, retest,
                    then route it as a healthy server (covers repair and reconfigure)
  HARVEST / RECYCLE simple fallback values (entered directly)

Decision rule:
  The safest route (sell now) is the default. Riskier routes are tested in
  order: list and wait, yield while listed, host longer. Each one only takes
  over if it beats the current winner by the margin of safety in the base case
  AND still beats every safer route under its own stress case (its worst
  plausible case).
"""
from copy import deepcopy
import math

DEFAULTS = {
    # server type: swaps a bundle of default numbers, see PROFILES below
    "asset_profile": "a100_8x",  # a100_8x or h100_8x
    # asset
    "gpus": 8,                 # GPUs per server
    "server_kw": 6.5,          # server power draw under load, kW
    "health_pass": True,       # passed diagnostics
    "ownership": "owned",      # owned | client_approved | consigned
    # physical market
    "offer_today": 80000.0,    # sourced: low end of used DGX A100 $80k-120k (JarvisLabs), v0.8
    "market_price": 100000.0,  # sourced: used DGX A100 $80k-120k midpoint (JarvisLabs), v0.8
    "sell_fee_pct": 0.136,     # eBay final value fee 13.6% + $0.40 (Swayam Price Build, v0.9)
    "logistics": 400.0,        # outbound logistics per sale, $
    "price_drift_pct_mo": 0.0185,# H100 value curve yr 3 to 4 (Mercatus), Swayam Price Build, v0.9
    "dwell_days": 57.0,        # expected days until a buyer appears (team research: 45 to 70)
    "buyer_window_days": 9.0,  # LTL transit 4-7 business days + 1 day buffer (Swayam Price Build, v0.9)
    # compute market
    "rental_rate": 1.57,       # customer price per GPU-hour, $ (A100, Silicon Data SDA100RT)
    "platform_fee_pct": 0.20,  # marketplace cut
    "utilization": 0.60,       # steady-state share of hours actually billed
    "first_month_utilization": 0.35,  # new listings start slow
    "ramp_util_days": 30,      # days spent at first-month utilization
    "ramp_days": 3.0,          # days from racked to earning
    "exit_days": 3.0,          # days to drain, wipe, ship once a buyer appears
    # operating cost
    "elec_per_kwh": 0.0858,    # $/kWh, electricity passed through by the colo
    "pue": 1.4,                # data center overhead multiplier on power
    "colo_per_kw_mo": 196.0,   # colo base fee per kW per month, before electricity
    "maint_per_day": 3.29,     # 4 incidents/yr x 2 hrs x $150/hr, per day (Swayam Price Build, v0.9)
    "activation_cost": 700.0,  # freight in + 2 hrs install at $150/hr (Swayam Price Build, v0.9)
    "exit_cost": 300.0,        # erase 10 drives + 1 hr de-rack at $150/hr (Swayam Price Build, v0.9)
    # host longer
    "horizon_months": 12,      # how long to host before selling
    "market_decay_pct_mo": 0.01, # monthly decline in BOTH rental rate and resale value
    "discount_rate_yr": 0.0971,# Damodaran Jan 2026, Computers/Peripherals (Swayam Price Build, v0.9)
    # fallbacks
    "harvest_value": 68444.56, # 7 working GPUs + parts, net of the 13.6% fee, teardown, logistics (Swayam Price Build, v0.9)
    # repair (only for servers that failed diagnostics)
    "repairable": True,        # diagnostics found a replaceable failed part
    "repair_parts_cost": 10829.0,  # one replacement GPU at the sourced model price (Swayam Price Build, v0.8)
    "repair_labor_cost": 600.0,    # technician time, $
    "repair_test_cost": 300.0,     # rerun diagnostics, $
    "repair_days": 10.0,           # days out of the market while repairing
    "repair_success": 0.85,        # chance the server passes after repair
    "recycle_value": 128.75,   # A100: circuit-board scrap rate, net of freight and erasure (Swayam Price Build, v0.9)
    # decision rule
    "margin_abs": 1000.0,      # margin of safety, dollars
    "margin_pct": 0.02,        # margin of safety, share of best safe value
    # stress case adjustments
    "bear_util_mult": 0.75,
    "bear_dwell_short_mult": 45 / 57,  # early buyer: low end of the 45-70 day range
    "bear_dwell_long_mult": 70 / 57,   # slow buyer: high end of the 45-70 day range
    "bear_repair_mult": 0.8,           # stress: repair success rate x 0.8
    "bear_decay_mult": 1.5,
}

DAYS_PER_MONTH = 30.4


def _disc_day(x, p):
    return (1 + x["discount_rate_yr"]) ** (-days_to_years(p))


def days_to_years(d):
    return d / 365.0


def colo_per_mo(x):
    return x["colo_per_kw_mo"] * x["server_kw"]


def daily_compute_margin(x, utilization=None):
    u = x["utilization"] if utilization is None else utilization
    revenue = x["gpus"] * 24 * x["rental_rate"] * (1 - x["platform_fee_pct"]) * u
    power = x["server_kw"] * 24 * x["pue"] * x["elec_per_kwh"]
    fixed = colo_per_mo(x) / DAYS_PER_MONTH + x["maint_per_day"]
    return revenue - power - fixed, revenue, power, fixed


def compute_earnings(x, earning_days):
    """Net compute profit over the earning days, slow first month then steady."""
    slow = min(earning_days, x["ramp_util_days"])
    fast = max(0.0, earning_days - x["ramp_util_days"])
    return (daily_compute_margin(x, x["first_month_utilization"])[0] * slow
            + daily_compute_margin(x)[0] * fast)


def sale_value(x, price, days_until_paid):
    drifted = price * max(0.0, 1 - x["price_drift_pct_mo"] * days_until_paid / DAYS_PER_MONTH)
    net = drifted * (1 - x["sell_fee_pct"]) - x["logistics"]
    return net * _disc_day(x, days_until_paid)


def v_sell_now(x):
    return x["offer_today"] * (1 - x["sell_fee_pct"]) - x["logistics"]


def v_list_wait(x):
    return sale_value(x, x["market_price"], x["dwell_days"])


def v_yield(x):
    ramp_cost = x["ramp_days"] * (colo_per_mo(x) / DAYS_PER_MONTH + x["maint_per_day"])
    earning_days = max(0.0, x["dwell_days"] - x["ramp_days"])
    sale = sale_value(x, x["market_price"], x["dwell_days"] + x["exit_days"])
    return sale + compute_earnings(x, earning_days) - x["activation_cost"] - x["exit_cost"] - ramp_cost


def v_host_longer(x):
    r_mo = (1 + x["discount_rate_yr"]) ** (1 / 12) - 1
    hours = 24 * DAYS_PER_MONTH
    power_mo = x["server_kw"] * hours * x["pue"] * x["elec_per_kwh"]
    fixed_mo = colo_per_mo(x) + x["maint_per_day"] * DAYS_PER_MONTH
    total = -x["activation_cost"]
    for t in range(int(x["horizon_months"])):
        rate = x["rental_rate"] * (1 - x["market_decay_pct_mo"]) ** t
        # first month is slow, same ramp as yield (assumes ramp_util_days ~ one month)
        u = x["first_month_utilization"] if t == 0 else x["utilization"]
        rev = x["gpus"] * hours * rate * (1 - x["platform_fee_pct"]) * u
        total += (rev - power_mo - fixed_mo) / (1 + r_mo) ** (t + 1)
    h = int(x["horizon_months"])
    terminal_price = x["market_price"] * (1 - x["market_decay_pct_mo"]) ** h
    terminal = (terminal_price * (1 - x["sell_fee_pct"]) - x["logistics"] - x["exit_cost"])
    total += terminal / (1 + r_mo) ** h
    return total


def bear(x, challenger):
    """Stress test: the worst case for the route being tested (the challenger).
    Waiting is hurt by a longer wait; yielding by a buyer arriving early;
    hosting by weaker demand and faster value decay."""
    b = deepcopy(x)
    b["price_drift_pct_mo"] *= x["bear_decay_mult"]
    if challenger == "LIST AND WAIT":
        b["dwell_days"] *= x["bear_dwell_long_mult"]
    elif challenger == "YIELD WHILE LISTED":
        b["dwell_days"] *= x["bear_dwell_short_mult"]
        b["utilization"] *= x["bear_util_mult"]
        b["first_month_utilization"] *= x["bear_util_mult"]
    elif challenger == "HOST LONGER":
        b["utilization"] *= x["bear_util_mult"]
        b["first_month_utilization"] *= x["bear_util_mult"]
        b["market_decay_pct_mo"] *= x["bear_decay_mult"]
    return b


def route_values(x):
    return {
        "SELL NOW": v_sell_now(x),
        "LIST AND WAIT": v_list_wait(x),
        "YIELD WHILE LISTED": v_yield(x),
        "HOST LONGER": v_host_longer(x),
        "HARVEST": x["harvest_value"],
        "RECYCLE": x["recycle_value"],
    }


def breakeven_dwell(x):
    """Fewest dwell days at which yielding beats listing idle (before margin)."""
    y = deepcopy(x)
    for d in range(0, 366):
        y["dwell_days"] = d
        if v_yield(y) >= v_list_wait(y):
            return d
    return None


def breakeven_utilization(x):
    """Lowest utilization at which hosting longer beats the best sale route."""
    y = deepcopy(x)
    best_sale = max(v_sell_now(y), v_list_wait(y))
    for i in range(0, 201):
        y["utilization"] = i / 200
        if v_host_longer(y) >= best_sale:
            return y["utilization"]
    return None


ORDER = ["SELL NOW", "LIST AND WAIT", "YIELD WHILE LISTED", "HOST LONGER"]


def repair_cost(x):
    return x["repair_parts_cost"] + x["repair_labor_cost"] + x["repair_test_cost"]


def v_repair(x, stress=False):
    """Expected value of repairing: if it passes, route it as a healthy server
    (after the repair delay); if it fails, fall back to harvest or recycle."""
    healthy = deepcopy(x)
    healthy["health_pass"] = True
    r = _recommend(healthy, light=True)
    after = r["route"]
    d = x["repair_days"]
    delay = (1 + x["discount_rate_yr"]) ** (-d / 365) * max(0.0, 1 - x["price_drift_pct_mo"] * d / DAYS_PER_MONTH)
    p = x["repair_success"] * (x["bear_repair_mult"] if stress else 1.0)
    fallback = max(x["harvest_value"], x["recycle_value"])
    value = p * r["base"][after] * delay + (1 - p) * fallback - repair_cost(x)
    return value, after


def usd(v):
    return f"-${-v:,.0f}" if v < 0 else f"${v:,.0f}"


# Profiles only swap default numbers. Any input you pass explicitly still wins.
# Only the H100 power draw (10.2 kW) and rental price (Silicon Data H100 index, $2.53)
# are sourced. The H100 prices and part costs are PLACEHOLDERS until resale data arrives.
PROFILES = {
    "a100_8x": {},
    "h100_8x": {
        "server_kw": 10.2,          # NVIDIA DGX H100 maximum system power
        "rental_rate": 2.72,        # Silicon Data H100 Rental Index (SDH100RT), Sep 28 2026 headline
        "offer_today": 235700.0,    # sourced Price Build, low end of range (Swayam, v0.9)
        "market_price": 255700.0,   # sourced: used H100 SXM5 $22k-27k/GPU (Compute Exchange) + parts (Swayam, v0.9)
        "harvest_value": 182889.20, # 7 working GPUs + parts, net of the 13.6% fee, teardown, shipping (Swayam, v0.9)
        "repair_parts_cost": 24500.0,  # one replacement GPU at the sourced model price (Swayam, v0.9)
        "recycle_value": 169.0,     # circuit-board scrap rate, net of freight and erasure (Swayam, v0.9)
    },
}


def resolve_defaults(profile):
    if profile not in PROFILES:
        raise ValueError(f"unknown asset_profile {profile!r}; use one of {sorted(PROFILES)}")
    x = deepcopy(DEFAULTS)
    x.update(PROFILES[profile])
    x["asset_profile"] = profile
    return x


def recommend(inputs=None):
    return _recommend(inputs, light=False)


def _recommend(inputs=None, light=False):
    """light=True skips the two break-even searches; used where only the route is needed."""
    inputs = dict(inputs or {})
    x = resolve_defaults(inputs.get("asset_profile", DEFAULTS["asset_profile"]))
    x.update(inputs)
    base = route_values(x)
    bears = {r: route_values(bear(x, r)) for r in ["LIST AND WAIT", "YIELD WHILE LISTED", "HOST LONGER"]}
    audit = []

    if not x["health_pass"]:
        best = "HARVEST" if base["HARVEST"] >= base["RECYCLE"] else "RECYCLE"
        eligible = ["HARVEST", "RECYCLE"]
        if not x["repairable"]:
            audit.append("Failed diagnostics with no replaceable part, so only harvest or recycle are allowed.")
            return _out(best, base, bears, x, audit, eligible, light)
        eligible.append("REPAIR")
        rep, after = v_repair(x)
        rep_bear, _ = v_repair(x, stress=True)
        base["REPAIR"] = rep
        margin = max(x["margin_abs"], x["margin_pct"] * base[best])
        gain, gain_bear = rep - base[best], rep_bear - base[best]
        audit.append(f"Failed diagnostics. Repair costs {usd(repair_cost(x))}, succeeds "
                     f"{x['repair_success']:.0%} of the time, and a repaired server would {after}.")
        if gain >= margin and gain_bear > 0:
            audit.append(f"REPAIR beats {best} by {usd(gain)} (needs {usd(margin)}) "
                         f"and still wins in its stress case by {usd(gain_bear)}.")
            best = "REPAIR"
        elif gain >= margin:
            audit.append(f"REPAIR beats {best} by {usd(gain)} in the base case "
                         f"but loses {usd(-gain_bear)} in its stress case, so rejected.")
        else:
            audit.append(f"REPAIR vs {best}: {usd(gain)}, below the {usd(margin)} margin, so rejected.")
        out = _out(best, base, bears, x, audit, eligible, light)
        out["after_repair_route"] = after
        out["stress"]["REPAIR"] = rep_bear
        return out

    eligible = ["SELL NOW", "LIST AND WAIT", "YIELD WHILE LISTED", "HOST LONGER"]
    if x["ownership"] == "consigned":
        eligible = ["SELL NOW", "LIST AND WAIT"]
        audit.append("Consigned asset, so compute routes are not allowed.")
    if "YIELD WHILE LISTED" in eligible and x["exit_days"] > x["buyer_window_days"]:
        eligible.remove("YIELD WHILE LISTED")
        audit.append(
            f"Exit takes {x['exit_days']:.0f} days but buyers allow {x['buyer_window_days']:.0f}, "
            "so yielding could lose the sale.")

    # ladder: each riskier route must clear the margin over the current winner
    best = "SELL NOW"
    for r in ["LIST AND WAIT", "YIELD WHILE LISTED", "HOST LONGER"]:
        if r not in eligible:
            continue
        margin = max(x["margin_abs"], x["margin_pct"] * base[best])
        gain = base[r] - base[best]
        # stress: must beat EVERY safer eligible route under its own worst case,
        # not just the current winner (avoids path dependence in the ladder)
        safer = [q for q in ["SELL NOW", "LIST AND WAIT", "YIELD WHILE LISTED"]
                 if q in eligible and ORDER.index(q) < ORDER.index(r)]
        gain_bear = bears[r][r] - max(bears[r][q] for q in safer)
        if gain >= margin and gain_bear > 0:
            audit.append(f"{r} beats {best} by {usd(gain)} (needs {usd(margin)}) "
                         f"and still wins in its stress case by {usd(gain_bear)}.")
            best = r
        elif gain >= margin:
            audit.append(f"{r} beats {best} by {usd(gain)} in the base case "
                         f"but loses {usd(-gain_bear)} in its stress case, so rejected.")
        else:
            audit.append(f"{r} vs {best}: {usd(gain)}, below the {usd(margin)} margin, so rejected.")
    return _out(best, base, bears, x, audit, eligible, light)


def _out(best, base, bears, x, audit, eligible, light=False):
    base.setdefault("REPAIR", None)
    return {
        "route": best,
        "base": base,
        "stress": {r: bears[r][r] for r in bears},
        "eligible": eligible,
        "breakeven_dwell_days": None if light else breakeven_dwell(x),
        "breakeven_utilization": None if light else breakeven_utilization(x),
        "daily_compute_margin": daily_compute_margin(x)[0],
        "after_repair_route": None,
        "audit": audit,
    }


PRESETS = {
    "A: fast sale, strong offer": {
        "offer_today": 65500, "market_price": 66000, "dwell_days": 5},
    "B: 60-day wait, cheap setup, weak outlook": {
        "dwell_days": 60, "activation_cost": 400, "first_month_utilization": 0.60,
        "market_decay_pct_mo": 0.02},
    "C: weak resale, strong compute": {
        "offer_today": 42000, "market_price": 45000, "utilization": 0.80,
        "rental_rate": 1.80, "dwell_days": 30},
    "D: failed GPU, repairable": {
        "health_pass": False, "repairable": True},
    "E: retail colo at $300 per kW": {
        "colo_per_kw_mo": 300},
}

# Presets are written for the A100. On the H100 they scale so a scenario keeps its meaning:
# sale prices by the H100 to A100 listed-price ratio (to the nearest $100), rental rate by
# the rental-rate ratio (to the cent). Everything else is copied as is.
_PRICE_KEYS = ("offer_today", "market_price")
_RENTAL_KEYS = ("rental_rate",)


def _round_half_up(v, step):
    from math import floor
    return floor(v / step + 0.5) * step


# v0.8: presets scale from fixed reference values (the A100 numbers they were written
# against), so changing a profile default can never silently break a preset.
PRESET_REF_MARKET_PRICE = 66000.0
PRESET_REF_RENTAL_RATE = 1.57


def preset_for(name, profile="a100_8x"):
    base = PRESETS[name]
    h = resolve_defaults(profile)
    if h["market_price"] == PRESET_REF_MARKET_PRICE and h["rental_rate"] == PRESET_REF_RENTAL_RATE:
        return dict(base)
    out = {}
    for k, v in base.items():
        if k in _PRICE_KEYS:
            out[k] = _round_half_up(v * h["market_price"] / PRESET_REF_MARKET_PRICE, 100)
        elif k in _RENTAL_KEYS:
            out[k] = _round_half_up(v * h["rental_rate"] / PRESET_REF_RENTAL_RATE, 0.01)
            out[k] = round(out[k], 2)
        else:
            out[k] = v
    return out

# ---------------------------------------------------------------------------
# Scenario engine (v0.6). A scenario is a named transform of the inputs, applied
# before recommend(). It adds no input field, so the output shape is unchanged.
#   "scale": multiply the asset's own value (so it works for every fleet server)
#   "set":   replace the value
# Every range and its source is in recompute_scenarios.csv.
SCENARIO_DIALS = {
    "utilization": {  # vendor guide: enterprise cards 60 to 70% steady state; ends are hypotheses
        "low":  ("scale", {"utilization": 0.40 / 0.60, "first_month_utilization": 0.40 / 0.60}),
        "high": ("scale", {"utilization": 0.75 / 0.60, "first_month_utilization": 0.75 / 0.60}),
    },
    "wait": {  # team research: 45 to 70 days, source pending
        "low":  ("scale", {"dwell_days": 45 / 57}),
        "high": ("scale", {"dwell_days": 70 / 57}),
    },
    "electricity": {  # EIA: KY industrial 2024 (6.50 cents); US commercial May 2026 (13.54 cents)
        "low":  ("set", {"elec_per_kwh": 0.0650}),
        "high": ("set", {"elec_per_kwh": 0.1354}),
    },
    "decline": {  # Silicon Data index history: A100 flat to rising in 2026; H100 -2.7%/month in 2024-25
        "low":  ("set", {"market_decay_pct_mo": 0.0}),
        "high": ("set", {"market_decay_pct_mo": 0.027}),
    },
    "resale": {  # hypothesis until resale data arrives
        "low":  ("scale", {"offer_today": 0.8, "market_price": 0.8}),
        "high": ("scale", {"offer_today": 1.2, "market_price": 1.2}),
    },
}
SCENARIO_LEVELS = ("low", "base", "high")

# Combined market scenarios. Bear = weak market: low utilization, slow buyers,
# expensive power, fast value decline, low resale. Bull is the mirror image.
COMBINED_SCENARIOS = {
    "bear": {"utilization": "low", "wait": "high", "electricity": "high", "decline": "high", "resale": "low"},
    "base": {},
    "bull": {"utilization": "high", "wait": "low", "electricity": "low", "decline": "low", "resale": "high"},
}


def _round_scaled(key, v):
    if key in ("utilization", "first_month_utilization"):
        return min(1.0, _round_half_up(v, 0.0001))
    if key == "dwell_days":
        return _round_half_up(v, 1)
    if key in ("offer_today", "market_price"):
        return _round_half_up(v, 100)
    raise KeyError(key)


def scenario_levels(combined="base", **dials):
    """The level of each dial: the combined scenario, then any single dial on top."""
    if combined not in COMBINED_SCENARIOS:
        raise ValueError(f"unknown scenario {combined!r}; use one of {sorted(COMBINED_SCENARIOS)}")
    levels = {d: "base" for d in SCENARIO_DIALS}
    levels.update(COMBINED_SCENARIOS[combined])
    for d, lv in dials.items():
        if d not in SCENARIO_DIALS:
            raise ValueError(f"unknown dial {d!r}; use one of {sorted(SCENARIO_DIALS)}")
        if lv not in SCENARIO_LEVELS:
            raise ValueError(f"unknown level {lv!r} for {d}; use low, base or high")
        levels[d] = lv
    return levels


def apply_scenario(inputs=None, combined="base", **dials):
    """Return the inputs with a scenario applied. Pass the result to recommend()."""
    inputs = dict(inputs or {})
    x = resolve_defaults(inputs.get("asset_profile", DEFAULTS["asset_profile"]))
    x.update(inputs)
    out = dict(inputs)
    for dial, level in scenario_levels(combined, **dials).items():
        if level == "base":
            continue
        kind, changes = SCENARIO_DIALS[dial][level]
        for k, f in changes.items():
            out[k] = f if kind == "set" else _round_scaled(k, x[k] * f)
    return out


# ---------------------------------------------------------------------------
# What flips the answer (v0.7). For each top driver, the nearest value below and
# above the current one at which the recommended route changes. Values sit on a
# fixed grid (value = k * mult / den) so Python and the web version agree exactly.
FLIP_DRIVERS = [
    # input, label, den, mult, k_min, k_max   (range = k_min..k_max on the grid)
    ("rental_rate", "Rental price per GPU-hour", 100, 1, 0, 1500),          # $0.00 to $15.00, to the cent
    ("utilization", "Share of hours rented", 1000, 1, 0, 1000),             # 0% to 100%, to 0.1%
    ("market_decay_pct_mo", "Value decline per month", 10000, 1, 0, 1000),  # 0% to 10%, to 0.01%
    ("platform_fee_pct", "Marketplace cut", 1000, 1, 0, 900),               # 0% to 90%, to 0.1%
    ("colo_per_kw_mo", "Colo fee per kW-month", 1, 1, 0, 1000),             # $0 to $1,000, to the dollar
    ("activation_cost", "One-time setup cost", 1, 10, 0, 2000),             # $0 to $20,000, to $10
    ("dwell_days", "Days until a buyer appears", 1, 1, 0, 365),             # 0 to 365 days
]
FLIP_SCAN_STEPS = 200


def route_only(inputs):
    """Just the recommended route, without the break-even searches."""
    return _recommend(inputs, light=True)["route"]


def flip_points(inputs=None):
    """For each driver: the nearest value below and above today's at which the route
    changes, and the route it changes to. None means no change inside the range.
    "move" is how far today's value must change to flip the answer, as a share of
    today's value; the drivers come back sorted by it, smallest first."""
    inputs = dict(inputs or {})
    x = resolve_defaults(inputs.get("asset_profile", DEFAULTS["asset_profile"]))
    x.update(inputs)
    now = route_only(inputs)
    out = []
    for key, label, den, mult, kmin, kmax in FLIP_DRIVERS:
        val = lambda k: (k * mult) / den
        def rt(k):
            return route_only({**inputs, key: val(k)})
        cur = x[key]
        step = max(1, (kmax - kmin) // FLIP_SCAN_STEPS)
        found = {}
        for direction in ("down", "up"):
            if direction == "down":
                k0 = min(kmax, math.floor(cur * den / mult))
                seq = list(range(k0, kmin - 1, -step))
                if seq and seq[-1] != kmin and k0 >= kmin:
                    seq.append(kmin)
            else:
                k0 = max(kmin, math.ceil(cur * den / mult))
                seq = list(range(k0, kmax + 1, step))
                if seq and seq[-1] != kmax and k0 <= kmax:
                    seq.append(kmax)
            same, diff = None, None
            for k in seq:
                if rt(k) != now:
                    diff = k
                    break
                same = k
            if diff is None:
                found[direction] = None
                continue
            if same is not None:
                while abs(same - diff) > 1:
                    mid = (same + diff) // 2
                    if rt(mid) == now:
                        same = mid
                    else:
                        diff = mid
            found[direction] = {"at": val(diff), "route": rt(diff)}
        # how far today's value must move, as a share of today's value
        # (1% of the range when today's value is 0, so a zero never divides)
        scale = max(abs(cur), 0.01 * (val(kmax) - val(kmin)))
        moves = [abs(found[d]["at"] - cur) / scale for d in ("down", "up") if found[d]]
        out.append({"input": key, "label": label, "now": cur,
                    "down": found["down"], "up": found["up"],
                    "move": min(moves) if moves else None})
    order = sorted(range(len(out)), key=lambda i: (out[i]["move"] is None, out[i]["move"] or 0, i))
    return {"route": now, "drivers": [out[i] for i in order]}


if __name__ == "__main__":
    for profile in PROFILES:
      for name, p in {"Defaults": {}, **{n: preset_for(n, profile) for n in PRESETS}}.items():
        r = recommend({**p, "asset_profile": profile})
        print(f"\n== [{profile}] {name} -> {r['route']}")
        for k, v in r["base"].items():
            if v is None:
                continue
            b = r['stress'].get(k)
            print(f"  {k:20s} base {usd(v):>10}" + (f"   stress {usd(b):>10}" if b is not None else ""))
        print(f"  daily compute margin ${r['daily_compute_margin']:,.2f}")
        print(f"  break-even dwell {r['breakeven_dwell_days']} days, "
              f"break-even utilization {r['breakeven_utilization']}")
        for a in r["audit"]:
            print("  -", a)
