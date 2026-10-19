"""Repair cost and days by failed part, from data/sources/fault_costs.csv (the table the fleet and
the diagnostic engine read). Applied only to a failed server whose repair cost was not given."""
import csv
import re
from functools import lru_cache
from pathlib import Path

FAULT_COSTS = Path(__file__).resolve().parent.parent / "data" / "sources" / "fault_costs.csv"

ALIASES = {
    "gpu": "GPU", "gpu module": "GPU",
    "psu": "PSU", "power supply": "PSU", "power supply unit": "PSU",
    "fan": "Fan", "fan module": "Fan",
    "nvme drive": "NVMe drive", "nvme": "NVMe drive", "drive": "NVMe drive", "ssd": "NVMe drive", "disk": "NVMe drive",
    "nic": "NIC", "network card": "NIC", "network adapter": "NIC", "connectx": "NIC",
    "memory module": "Memory module", "memory": "Memory module", "dimm": "Memory module", "ram": "Memory module",
}


@lru_cache(maxsize=1)
def table():
    with open(FAULT_COSTS, newline="") as f:
        return {r["part"]: r for r in csv.DictReader(f)}


def part_key(failed_part):
    return ALIASES.get(re.sub(r"\s+", " ", (failed_part or "").strip().lower()))


def row_for(failed_part, profile="a100_8x", model=None):
    part = part_key(failed_part)
    if not part:
        return None
    h100 = profile == "h100_8x"
    if part == "GPU":
        name = "GPU H100 80GB" if h100 else ("GPU A100 40GB" if re.search(r"40\s*GB", model or "", re.I) else "GPU A100 80GB")
    elif part in ("NIC", "Memory module") and h100:
        name = f"{part} (H100 platform)"
    else:
        name = part
    return table().get(name)


def repair_inputs(inputs, failed_part, model=None):
    """The inputs the model runs on: given inputs plus repair cost and days from the table when the
    server failed, its part is known, and the caller did not set them. Returns (inputs, info)."""
    if inputs.get("health_pass", True) or not failed_part:
        return inputs, None
    if "repair_parts_cost" in inputs and "repair_days" in inputs:
        return inputs, {"failed_part": failed_part, "priced": True, "source": "inputs", "filled": {}}
    row = row_for(failed_part, inputs.get("asset_profile", "a100_8x"), model)
    if not row:
        return inputs, {"failed_part": failed_part, "priced": False,
                        "note": "no repair price for this part; the model's default (one GPU) is used"}
    out = dict(inputs)
    filled = {}
    if "repair_parts_cost" not in inputs:
        out["repair_parts_cost"] = filled["repair_parts_cost"] = float(row["cost_usd"])
    if "repair_days" not in inputs:
        out["repair_days"] = filled["repair_days"] = float(row["repair_days"])
    return out, {"failed_part": failed_part, "priced": True, "source": "fault_costs.csv", "table_row": row["part"], "status": row["status"],
                 "filled": filled}


A100_40GB_RENTAL = 1.26  # no 40GB index; Saksham's fleet and listings use $1.26 (HYPOTHESIS, docs/ASSUMPTIONS.csv)


def is_a100_40gb(model):
    return bool(re.search(r"\bA100\b.*?\b40\s*GB\b", model or "", re.I))


def model_adjustments(inputs, model):
    """Defaults that depend on the server's model text, not its profile. Only fills what the caller did not set."""
    if is_a100_40gb(model) and inputs.get("asset_profile", "a100_8x") == "a100_8x" and "rental_rate" not in inputs:
        return {**inputs, "rental_rate": A100_40GB_RENTAL}, {
            "rental_rate": A100_40GB_RENTAL,
            "basis": "A100 40GB has no rental index or model profile; team hypothesis $1.26 (Saksham, v0.9)"}
    return inputs, None


def effective_inputs(inputs, failed_part, model=None):
    """What the model actually runs on: model-specific defaults, then repair pricing by failed part."""
    inputs, adjusted = model_adjustments(inputs, model)
    inputs, repair = repair_inputs(inputs, failed_part, model)
    return inputs, adjusted, repair
