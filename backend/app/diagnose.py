"""Bridge to Saksham's diagnostic engine (engine/). The engine reads NVIDIA's own tool output and grades it;
this module turns the grade into model inputs the same way the demo listings do, and runs nothing on a GPU."""
import csv
import math
import re
import sys
from functools import lru_cache
from pathlib import Path

from . import recompute_model

sys.modules.setdefault("recompute_model", recompute_model)  # the engine imports the model by this name

from engine.diagnostics import ReportError, evaluate, model_inputs, repaired_projection  # noqa: E402
from engine.nvidia_reader import NvidiaInputError, load_capture  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "data"
# No model profile covers the A100 40GB; Saksham's fleet and listings rent it at $1.26 (HYPOTHESIS, recompute_fleet.py)
from .repairs import A100_40GB_RENTAL  # noqa: E402

GPU_MODEL_OVERRIDES = {"A100 40GB": {"rental_rate": A100_40GB_RENTAL}}
DEMO_SELLERS = {"saksham": "8x H100 80GB", "shauryaa": "8x A100 80GB", "swayam": "8x A100 80GB", "kabir": "8x A100 40GB"}


class DiagnoseError(ValueError):
    pass


@lru_cache(maxsize=1)
def grade_table():
    with open(DATA / "sources" / "grade_table.csv", newline="") as f:
        return {r["grade"]: r for r in csv.DictReader(f)}


def gpu_model_of(model):
    m = re.search(r"\b([AH]100)\b.*?\b(40|80)\s*GB\b", model or "", re.I)
    if not m:
        raise DiagnoseError(f"model must name the GPU and memory, like '8x A100 80GB' or '8x H100 80GB' (got {model!r})")
    return f"{m.group(1).upper()} {m.group(2)}GB"


def _round(v, step):
    return math.floor(v / step + 0.5) * step


def diagnose(report, model):
    """Grade a report and derive the model inputs. Returns (diagnostics, inputs)."""
    gpu_model = gpu_model_of(model)
    gpu_count = len(report.get("gpus") or [])
    if not gpu_count:
        raise DiagnoseError("the capture lists no GPUs")
    try:
        ev = evaluate(report, gpu_count)
        mi = model_inputs(ev, gpu_model, gpu_count, None)
        price_grade = ev["grade"] if mi["health_pass"] else evaluate(repaired_projection(report), gpu_count)["grade"]
    except ReportError as e:
        raise DiagnoseError(f"the report cannot be graded honestly: {e}")
    except StopIteration:
        raise DiagnoseError(f"no price build for {gpu_model}")
    g = grade_table()[price_grade]
    market = _round(mi["server_price_by_components"] * float(g["price_factor"]), 100)
    inputs = {
        "asset_profile": "h100_8x" if gpu_model.startswith("H100") else "a100_8x",
        "gpus": gpu_count,
        "health_pass": mi["health_pass"],
        "repairable": mi["repairable"],
        "harvest_value": mi["harvest_value"],
        "market_price": float(market),
        "offer_today": float(_round(market * float(g["best_offer_ratio"]), 100)),
        "dwell_days": float(_round(recompute_model.DEFAULTS["dwell_days"] * float(g["dwell_factor"]), 1)),
    }
    inputs.update(GPU_MODEL_OVERRIDES.get(gpu_model, {}))
    if not mi["health_pass"]:
        inputs.update(repair_parts_cost=mi["repair_parts_cost"], repair_days=float(mi["repair_days"]))
    diagnostics = {
        "grade": ev["grade"], "score": ev["score"], "evidence_confidence": ev["confidence"],
        "run_level": ev["run_level"], "priced_at_grade": price_grade,
        "failed_gpus": ev["failed_gpus"], "chassis_faults": ev["chassis_faults"],
        "unpriced_faults": mi["unpriced_faults"], "working_gpus": mi["working_gpus"],
        "findings": ev["findings"], "actions": ev["actions"], "gpu_verdicts": ev["gpu_verdicts"],
        "caps": ev["caps"], "cap_reason": ev["cap_reason"], "deductions": ev["deductions"],
        "tests_missing": ev["tests_missing"],
        "pricing": {"server_price_by_components": mi["server_price_by_components"], "grade_row": dict(g),
                    "basis": mi["basis"],
                    "rule": "market = components x price_factor, offer = market x best_offer_ratio, "
                            "dwell = 57 days x dwell_factor (grade_table.csv, team hypothesis); a failed server "
                            "is priced at the grade it would get after repair"},
    }
    return diagnostics, inputs


def diagnose_capture(path, model):
    """A .tar.gz from tools/capture_nvidia.sh, or a folder of the same files."""
    try:
        report, provenance = load_capture(path)
        diagnostics, inputs = diagnose(report, model)
    except DiagnoseError:
        raise
    except NvidiaInputError as e:
        raise DiagnoseError(f"could not read the NVIDIA files: {e}")
    except OSError as e:
        raise DiagnoseError(f"the capture could not be graded: {type(e).__name__}: {e.strerror} ({Path(e.filename or '').name})")
    except (ValueError, KeyError, TypeError, IndexError) as e:
        raise DiagnoseError(f"the capture could not be graded: {type(e).__name__}: {str(e).replace(str(path), '<capture>')}")
    diagnostics["provenance"] = provenance
    return diagnostics, inputs
