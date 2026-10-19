from .output import resolve_defaults

STATES = [
    "RECEIVED", "LISTED", "ACTIVATING", "COMPUTING", "DRAINING", "SANITIZING",
    "REPAIRING", "SOLD", "HARVESTED", "RECYCLED",
]
TERMINAL = {"SOLD", "HARVESTED", "RECYCLED"}

EVENTS = {
    "list": ({"RECEIVED", "REPAIRING", "SANITIZING"}, "LISTED"),
    "activate": ({"LISTED"}, "ACTIVATING"),
    "start_compute": ({"ACTIVATING"}, "COMPUTING"),
    "buyer_found": ({"COMPUTING"}, "DRAINING"),
    "drained": ({"DRAINING"}, "SANITIZING"),
    "sell": ({"LISTED", "SANITIZING"}, "SOLD"),
    "repair": ({"RECEIVED", "LISTED"}, "REPAIRING"),
    "harvest": ({"RECEIVED", "LISTED", "REPAIRING"}, "HARVESTED"),
    "recycle": ({"RECEIVED", "LISTED", "REPAIRING", "HARVESTED"}, "RECYCLED"),
}

COMPUTE_ROUTES = {"YIELD WHILE LISTED", "HOST LONGER"}
EXPECTED_ROUTE = {
    "activate": COMPUTE_ROUTES,
    "repair": {"REPAIR"},
    "harvest": {"HARVEST"},
    "recycle": {"RECYCLE"},
}


class TransitionError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def resolved(inputs):
    x = resolve_defaults(inputs.get("asset_profile", "a100_8x"))
    x.update(inputs)
    return x


def available_events(state, inputs, result):
    allowed, override = [], []
    for e, (sources, _) in EVENTS.items():
        if state not in sources:
            continue
        try:
            check(e, state, inputs, result, False, None)
            allowed.append(e)
        except TransitionError:
            try:
                check(e, state, inputs, result, True, "check")
                override.append(e)
            except TransitionError:
                pass
    return allowed, override


def check(event, state, inputs, result, override, note):
    if event not in EVENTS:
        raise TransitionError(422, f"unknown event {event!r}; use one of {sorted(EVENTS)}")
    sources, target = EVENTS[event]
    if state not in sources:
        raise TransitionError(409, f"cannot {event} from {state}; allowed from {sorted(sources)}")

    route = result["route"] if result else None
    eligible = set(result["eligible"]) if result else set()
    x = resolved(inputs)

    if event == "activate" and not (eligible & COMPUTE_ROUTES):
        raise TransitionError(409, "compute routes are not eligible for this asset "
                                   f"(ownership {x['ownership']}, health_pass {x['health_pass']}); override not allowed")
    if event == "repair" and "REPAIR" not in eligible:
        raise TransitionError(409, "repair is not eligible: the asset passed diagnostics or has no replaceable part")
    if event == "list" and state == "RECEIVED" and not x["health_pass"] and not override:
        raise TransitionError(409, "asset failed diagnostics; repair it first or send override with a note")

    expected = EXPECTED_ROUTE.get(event)
    if expected and route not in expected and not override:
        raise TransitionError(409, f"recommended route is {route}, not {' or '.join(sorted(expected))}; "
                                   "send override=true with a note to proceed anyway")
    if override and not (note and note.strip()):
        raise TransitionError(422, "an override needs a note explaining why")

    return target, details(event, x, result)


def details(event, x, result):
    if event == "activate":
        return {"ramp_days": x["ramp_days"], "activation_cost": x["activation_cost"]}
    if event == "start_compute":
        return {"daily_compute_margin": result["daily_compute_margin"] if result else None,
                "utilization": x["utilization"], "first_month_utilization": x["first_month_utilization"]}
    if event == "buyer_found":
        return {"exit_days": x["exit_days"], "buyer_window_days": x["buyer_window_days"],
                "exit_cost": x["exit_cost"], "at_risk": x["exit_days"] > x["buyer_window_days"]}
    if event == "repair":
        return {"repair_days": x["repair_days"], "repair_success": x["repair_success"],
                "repair_cost": x["repair_parts_cost"] + x["repair_labor_cost"] + x["repair_test_cost"]}
    return {}
