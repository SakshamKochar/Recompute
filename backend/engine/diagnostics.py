"""Diagnostic engine (v2): turns a server test report into per-GPU verdicts, a health score,
a grade, buyer-facing findings, and the inputs the decision model needs.

Grounding (all checked Sep-Oct 2026):
- DCGM 4.6 `dcgmi diag` suites: level 1 runs the software deployment checks; level 2 adds
  memory and pcie; level 3 adds diagnostic, memory_bandwidth, targeted_stress, targeted_power
  and, where available, nvbandwidth; level 4 adds memtest and pulse_test. context_create runs
  only when named. https://docs.nvidia.com/datacenter/dcgm/latest/reference/command-line-reference/dcgmi/dcgmi-diag.html
- Clock-event reasons DCGM reports: HW_SLOWDOWN, SW_THERMAL, HW_THERMAL, HW_POWER_BRAKE (same page).
- A100/H100 memory errors use row remapping, not page retirement. Xid 48 uncorrectable ECC,
  94 contained, 95 uncontained, 63 remap recorded, 64 remap recording failed, 160 memory marked
  for repair; nvidia-smi reports remap "pending" and "failure" flags.
  https://docs.nvidia.com/deploy/a100-gpu-mem-error-mgmt/latest/user-visible-statistics.html
  A remapping failure means the GPU should not keep running workloads (Crusoe support guide).

Everything that is a judgement (points, caps, thresholds) is a CONSTANT labelled HYPOTHESIS in
docs/ASSUMPTIONS.csv. The engine never invents a fact about a GPU: every finding cites the field
it came from.
"""
import csv
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@lru_cache(maxsize=1)
def resolve_defaults_cached():
    """The A100 default inputs, including the live sell_fee_pct the harvest formula must match."""
    from recompute_model import resolve_defaults
    return resolve_defaults("a100_8x")

# ---------------------------------------------------------------- sourced facts
DCGM_SUITES = {  # tests each level ADDS; each level includes the previous ones
    1: ["software"],
    2: ["memory", "pcie"],
    3: ["diagnostic", "memory_bandwidth", "targeted_stress", "targeted_power"],
    4: ["memtest", "pulse_test"],
}
DCGM_CONDITIONAL = {3: ["nvbandwidth"]}  # level-3 test that runs only where its plugin is available
DCGM_TEST_LABELS = {
    "software": "Software deployment checks", "memory": "GPU memory", "pcie": "PCIe bandwidth",
    "diagnostic": "Compute diagnostic", "memory_bandwidth": "Memory bandwidth",
    "targeted_stress": "Targeted stress", "targeted_power": "Targeted power",
    "nvbandwidth": "NVLink bandwidth (NVBandwidth)", "memtest": "Memtest", "pulse_test": "Pulse test",
}
CLOCK_EVENTS = ("HW_SLOWDOWN", "SW_THERMAL", "HW_THERMAL", "HW_POWER_BRAKE")
XID = {
    48: "uncorrectable ECC memory error",
    63: "bad memory row remapped to a spare (self-repair succeeded)",
    64: "row remapping failed to record; spare rows exhausted",
    74: "NVLink error",
    92: "high single-bit ECC error rate",
    94: "contained ECC error (only one program affected)",
    95: "uncontained ECC error (corruption may have spread)",
    160: "GPU memory marked for repair",
}

# ---------------------------------------------------------------- team rubric (HYPOTHESIS)
CONSTANTS = {
    "warn_result": 4, "warn_cap": 16,
    "uncorrectable_remap_row": 6, "uncorrectable_remap_cap": 18,
    "correctable_remap_row": 1, "correctable_remap_cap": 8,
    "correctable_ecc_bucket": 50, "correctable_ecc_cap": 8,
    "uncontained_xid95": 10,
    "hist_low_bank": 2, "hist_low_cap": 8, "hist_none_bank": 6, "hist_none_cap": 18,
    "xid48_unremapped": 8, "xid79": 10, "reset_class_xid": 3, "reset_class_cap": 9,
    "clock_event_points": {"HW_SLOWDOWN": 3, "HW_THERMAL": 3, "HW_POWER_BRAKE": 3, "SW_THERMAL": 1},
    "clock_event_cap": 12,
    "nvlink_error_bucket": 100, "nvlink_error_cap": 6, "nvlink_xid74": 5,
    "pcie_replay_bucket": 100, "pcie_replay_cap": 4,
    "hours_threshold": 8760, "hours_bucket": 2000, "hours_cap": 15,
    "cosmetic": {"like_new": 0, "good": 2, "fair": 5, "worn": 10},
    "level_points": {4: 0, 3: 2, 2: 6, 1: 12, 0: 30},
    "missing_expected_test": 2,
    "skipped_result": 1, "skipped_cap": 8,
    "chassis_fault": 12,
    "max_gpu_swaps_repairable": 2,
    "reseat_days": 2,  # HYPOTHESIS: re-seat plus a level-3 retest  # more failed GPUs than this suggests a baseboard problem
    "loose_gpu_discount": 0.10, "teardown_cost": 1650,  # Swayam Price Build
}
SEVERITY_ORDER = ["HEALTHY", "WATCH", "DEGRADED", "FAIL"]
GRADES = ["A+", "A", "B", "C", "D"]


def _csv(name):
    with open(ROOT / "data/sources" / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def expected_tests(level):
    """Tests a run at this level must contain (conditional tests are allowed, not required)."""
    out = []
    for lv in range(1, (level or 0) + 1):
        out += DCGM_SUITES[lv]
    return out


def allowed_tests(level):
    out = set(expected_tests(level)) | {"context_create"}
    for lv, tests in DCGM_CONDITIONAL.items():
        if (level or 0) >= lv:
            out |= set(tests)
    return out


def _worse(a, b):
    return a if SEVERITY_ORDER.index(a) >= SEVERITY_ORDER.index(b) else b


class _Score:
    def __init__(self):
        self.items = []

    def add(self, category, name, count, points_each, cap=None, evidence=""):
        raw = count * points_each
        used = min(raw, cap) if cap is not None else raw
        if used:
            self.items.append({"category": category, "name": name, "count": count, "points": used,
                               "cap_applied": cap is not None and raw > cap, "evidence": evidence})
        return used

    def total(self):
        return sum(i["points"] for i in self.items)


def _n(v):
    """Unknown (None) counts as zero only for arithmetic; the engine discloses it separately."""
    return v or 0


@lru_cache(maxsize=1)
def _xid_rows():
    with open(ROOT / "data/sources/nvidia_xid_catalog.csv", newline="", encoding="utf-8") as f:
        return {int(r["xid"]): r for r in csv.DictReader(f)}


XID_NAMES = {48: "uncorrectable memory error", 62: "internal micro-controller halt", 63: "memory row remapped",
             64: "row remapping failure", 74: "NVLink error", 79: "GPU fell off the bus", 92: "high single-bit error rate",
             94: "contained memory error", 95: "uncontained memory error", 109: "context switch timeout",
             119: "GSP firmware timeout", 120: "GSP firmware error", 140: "unrecovered memory error", 154: "GPU recovery action changed"}
RESET_ACTIONS = {"RESET_GPU", "RESTART_BM", "XID_154", "CHECK_MECHANICALS", "CONTACT_SUPPORT", "UPDATE_SWFW",
                 "WORKFLOW_NVLINK_ERR", "WORKFLOW_NVLINK5_ERR", "WORKFLOW_XID_48"}


def xid_action(x):
    return _xid_rows().get(int(x), {}).get("immediate_action", "")


def xid_class(x):
    """NVIDIA Xid Catalog immediate action -> 'reset' (GPU-level: needs a reset and a retest) or 'app'
    (IGNORE, RESTART_APP, RESTART_VM and similar: software or workload, not a hardware fault).
    An Xid missing from the catalogue is treated as 'reset' so it is never silently ignored."""
    a = xid_action(x)
    if x not in _xid_rows():
        return "reset"
    return "reset" if a in RESET_ACTIONS else "app"


class ReportError(ValueError):
    """A test report that cannot be graded honestly. Lists every problem found."""


RESULT_WORDS = {"pass", "warn", "fail", "skip"}
GPU_INT_FIELDS = ("ecc_correctable_30d", "remapped_rows_correctable", "remapped_rows_uncorrectable", "nvlink_errors", "pcie_replays")


def validate_report(report, gpu_count=8):
    """Reject anything that would let a server be graded on missing or impossible evidence."""
    p = []
    if not isinstance(report, dict):
        raise ReportError(["report must be an object"])
    for key in ("run_level", "tests", "gpus", "chassis"):
        if key not in report:
            p.append(f"missing '{key}'")
    if p:
        raise ReportError(p)
    if not isinstance(report["tests"], dict) or not isinstance(report["gpus"], list) or not isinstance(report["chassis"], dict):
        raise ReportError(["tests must be an object, gpus a list, chassis an object"])
    lv = report["run_level"]
    if not isinstance(lv, int) or isinstance(lv, bool) or not 0 <= lv <= 4:
        p.append(f"run_level must be a whole number 0 to 4, got {lv!r}")
    for name, res in report["tests"].items():
        if name not in DCGM_TEST_LABELS and name != "context_create":
            p.append(f"unknown test '{name}'")
        if name == "software":
            if not isinstance(res, str) or res not in RESULT_WORDS:
                p.append(f"software result must be one of {sorted(RESULT_WORDS)}, got {res!r}")
            continue
        if not isinstance(res, list) or len(res) != gpu_count:
            p.append(f"test '{name}' must list one result per GPU ({gpu_count}), got {len(res) if isinstance(res, list) else type(res).__name__}")
        elif any(not isinstance(r, str) or r not in RESULT_WORDS for r in res):
            p.append(f"test '{name}' has a result outside {sorted(RESULT_WORDS)}")
    if not all(isinstance(g, dict) for g in report["gpus"]):
        raise ReportError(p + ["every entry in gpus must be an object"])
    idx = [g.get("index") for g in report["gpus"]]
    if sorted((i for i in idx if isinstance(i, int) and not isinstance(i, bool)), key=int) != list(range(gpu_count)) or len(idx) != gpu_count:
        p.append(f"gpus must cover indexes 0 to {gpu_count - 1} exactly once")
    for g in report["gpus"]:
        for f in GPU_INT_FIELDS:
            v = g.get(f, 0)
            if v is None:
                continue  # unknown (for example nvidia-smi printed N/A inside a VM): allowed, never read as zero
            if not isinstance(v, int) or isinstance(v, bool) or v < 0:
                p.append(f"GPU {g.get('index')}: {f} must be a whole number of at least 0, got {v!r}")
        for f in ("remap_pending", "remap_failure"):
            if g.get(f) is not None and not isinstance(g.get(f), bool):
                p.append(f"GPU {g.get('index')}: {f} must be true, false or unknown")
        h = g.get("remap_histogram")
        if h is not None and (not isinstance(h, dict) or any(k not in ("max", "high", "partial", "low", "none") or
                                                               (v is not None and (not isinstance(v, int) or isinstance(v, bool) or v < 0)) for k, v in h.items())):
            p.append(f"GPU {g.get('index')}: remap_histogram must map max/high/partial/low/none to bank counts")
        if g.get("untested_reason") is not None and not isinstance(g.get("untested_reason"), str):
            p.append(f"GPU {g.get('index')}: untested_reason must be text")
        if g.get("memory_telemetry") not in (None, "ok", "na", "missing"):
            p.append(f"GPU {g.get('index')}: memory_telemetry must be ok, na or missing")
        ol = g.get("nvlink_outlier_links", [])
        if not isinstance(ol, list) or any(not isinstance(x, int) or isinstance(x, bool) or x < 0 for x in ol):
            p.append(f"GPU {g.get('index')}: nvlink_outlier_links must be a list of link numbers")
        if not isinstance(g.get("dcgm_warnings", []), list) or any(not isinstance(w, dict) for w in g.get("dcgm_warnings", [])):
            p.append(f"GPU {g.get('index')}: dcgm_warnings must be a list of objects")
        if not isinstance(g.get("clock_events", {}), dict) or not isinstance(g.get("xids", []), list):
            p.append(f"GPU {g.get('index')}: clock_events must be an object and xids a list"); continue
        for e, v in g.get("clock_events", {}).items():
            if e not in CLOCK_EVENTS:
                p.append(f"GPU {g.get('index')}: unknown clock event '{e}'")
            elif not isinstance(v, int) or isinstance(v, bool) or v < 0:
                p.append(f"GPU {g.get('index')}: {e} count must be a whole number of at least 0")
        if not all(isinstance(x, int) and not isinstance(x, bool) for x in g.get("xids", [])):
            p.append(f"GPU {g.get('index')}: xids must be whole numbers")
    ch = report["chassis"]
    if not isinstance(ch.get("cosmetic", "like_new"), str) or ch.get("cosmetic", "like_new") not in CONSTANTS["cosmetic"]:
        p.append(f"cosmetic must be one of {sorted(CONSTANTS['cosmetic'])}, got {ch.get('cosmetic')!r}")
    h = ch.get("power_on_hours", 0)
    if not isinstance(h, int) or isinstance(h, bool) or h < 0:
        p.append(f"power_on_hours must be a whole number of at least 0, got {h!r}")
    if not isinstance(ch.get("faults", []), list) or any(not isinstance(f, dict) or not f.get("part") for f in ch.get("faults", [])):
        p.append("every chassis fault needs a 'part'")
    st = report.get("skipped_tests", [])
    if not isinstance(st, list) or any(not isinstance(x, dict) or x.get("test") not in DCGM_TEST_LABELS for x in st):
        p.append("skipped_tests must list known test names")
    if p:
        raise ReportError(p)


def evaluate(report, gpu_count=8):
    """Full evaluation of one server's test report. Pure function of its input.
    Raises ReportError for a report that cannot be graded honestly."""
    validate_report(report, gpu_count)
    C = CONSTANTS
    level = report.get("run_level") or 0
    tests = report.get("tests", {})
    gpus = report.get("gpus", [])
    findings, actions, s = [], [], _Score()

    # ---- 1. coverage: is the report internally consistent with its declared level?
    exp = expected_tests(level)
    missing = [t for t in exp if t not in tests]
    unexpected = [t for t in tests if t not in allowed_tests(level)]
    if unexpected:
        findings.append({"severity": "ERROR", "gpu": None, "text": f"Report lists tests not run at level {level}: {', '.join(unexpected)}. Report rejected as inconsistent.", "evidence": "tests"})
    s.add("coverage", "diagnostic run level", 1, C["level_points"][level], evidence=f"run_level={level}")
    s.add("coverage", "expected test missing from report", len(missing), C["missing_expected_test"], evidence=", ".join(missing))
    sk = report.get("skipped_tests", [])
    s.add("coverage", "test NVIDIA skipped on every GPU", len(sk), C["missing_expected_test"], evidence=", ".join(x["test"] for x in sk))
    for x in sk:
        findings.append({"severity": "INFO", "gpu": None, "text": f"{DCGM_TEST_LABELS[x['test']]} did not run on any GPU. NVIDIA: {x['reason'].rstrip('.')}.", "evidence": "dcgmi diag"})
    if level < 4:
        not_run = [DCGM_TEST_LABELS[t] for lv in range(level + 1, 5) for t in DCGM_SUITES[lv]]
        findings.append({"severity": "INFO", "gpu": None, "text": f"Not tested (requires level {level + 1}+): {', '.join(not_run)}.", "evidence": "run_level"})

    # ---- 2. per-GPU verdicts
    verdicts = []
    for g in range(gpu_count):
        t = next((x for x in gpus if x.get("index") == g), {})
        status, reasons = "HEALTHY", []
        for name, res in tests.items():
            r = res if isinstance(res, str) else (res[g] if g < len(res) else "skip")
            if r == "fail":
                status = "FAIL"; reasons.append(f"failed {DCGM_TEST_LABELS.get(name, name)}")
            elif r == "warn":
                status = _worse(status, "WATCH"); reasons.append(f"warning in {DCGM_TEST_LABELS.get(name, name)}")
        xids = set(t.get("xids", []))
        notes = []
        if t.get("remap_failure") or 64 in xids:
            status = "FAIL"; reasons.append("row remapping failed, which NVIDIA describes as unrecoverable memory hardware damage; this meets NVIDIA's row-remap RMA criterion once its field diagnostic confirms it")
        if xids & {95, 140}:
            status = _worse(status, "DEGRADED"); reasons.append("uncontained or escaped memory error on record (Xid " + ", ".join(str(x) for x in sorted(xids & {95, 140})) + ")")
        if 79 in xids:  # DCGM classes FALLEN_OFF_BUS as ISOLATE: cannot perform workload until re-seated and re-tested
            status = "FAIL"; reasons.append("GPU fell off the bus (Xid 79); NVIDIA classes this as unable to run work until it is re-seated and re-tested")
            actions.append(f"Re-seat GPU {g}, check its power and cooling, then rerun diagnostics.")
        if _n(t.get("remapped_rows_uncorrectable")):
            status = _worse(status, "DEGRADED"); reasons.append(f"{t['remapped_rows_uncorrectable']} uncorrectable error(s) repaired by row remapping")
        hist = t.get("remap_histogram") or {}
        if _n(hist.get("none")):
            status = _worse(status, "DEGRADED"); reasons.append(f"{hist['none']} memory bank(s) have no spare rows left, so the next uncorrectable error there cannot be repaired")
        elif _n(hist.get("low")):
            status = _worse(status, "WATCH"); reasons.append(f"{hist['low']} memory bank(s) have only one spare row left")
        for x in sorted(xids - {64, 95, 140, 79, 74, 48, 63, 94}):
            cls = xid_class(x)
            if cls == "reset":
                status = _worse(status, "WATCH"); reasons.append(f"Xid {x} ({XID_NAMES.get(x, 'GPU error')}): NVIDIA's action is {xid_action(x)}")
                actions.append(f"Reset GPU {g} and rerun diagnostics to confirm Xid {x} does not recur.")
            else:
                notes.append(f"Xid {x} ({XID_NAMES.get(x, 'GPU error')}) on record; NVIDIA classes it as {xid_action(x) or 'informational'}, not a hardware fault")
        if 48 in xids and not (xids & {63, 64}) and not _n(t.get("remapped_rows_uncorrectable")):
            status = _worse(status, "DEGRADED"); reasons.append("uncorrectable memory error (Xid 48) with no matching row remap; NVIDIA's workflow is reset the GPU, then a field diagnostic")
            actions.append(f"Reset GPU {g} and run NVIDIA's field diagnostic to confirm the memory error was repaired.")
        if 94 in xids:
            notes.append("a contained memory error (Xid 94) was isolated to one program; NVIDIA's action is restart the application")
        if t.get("nvlink_outlier_links"):
            status = _worse(status, "WATCH")
            reasons.append("NVLink link " + ", ".join(str(l) for l in t["nvlink_outlier_links"]) + " has far more errors than its sibling links, which usually points to a connector, cable or bridge")
            actions.append(f"Reseat GPU {g}'s NVLink connection, then recheck its per-link error counters.")
        if t.get("untested_reason"):
            notes.append(f"NVIDIA's diagnostic skipped this GPU because of a {t['untested_reason']}; it is untested")
            actions.append(f"Reset GPU {g} and rerun diagnostics: NVIDIA skipped it because of a {t['untested_reason']}.")
        for w in t.get("dcgm_warnings", []):
            if w.get("severity_name") == "ISOLATE":  # NVIDIA: cannot perform workload, isolate the GPU
                status = "FAIL"
        for w in t.get("dcgm_warnings", []):
            if w.get("code") == 55:  # DCGM_FR_ECC_DISABLED
                status = _worse(status, "WATCH")
                reasons.append("ECC memory protection is switched off, so memory errors were neither corrected nor counted")
                actions.append(f"Enable ECC on GPU {g} (nvidia-smi -i {g} -e 1, then reboot) and rerun the memory tests.")
            elif w.get("message") and w.get("severity_name") not in ("CONFIG", "UNKNOWN"):
                (reasons if w.get("severity_name") in ("ISOLATE", "RESET", "TRIAGE") else notes).append(f"NVIDIA: {w['message'].rstrip('.')}")
        ce = t.get("clock_events", {})
        if ce.get("HW_POWER_BRAKE", 0) or ce.get("HW_SLOWDOWN", 0) or ce.get("HW_THERMAL", 0):
            status = _worse(status, "WATCH"); reasons.append("hardware slowdown events under load")
        if _n(t.get("remapped_rows_correctable")):
            notes.append(f"{t['remapped_rows_correctable']} memory row(s) remapped to spares after correctable errors (normal self-repair)")
        if _n(t.get("ecc_correctable_30d")) >= C["correctable_ecc_bucket"]:
            notes.append(f"{t['ecc_correctable_30d']} correctable memory errors in the last 30 days, all fixed automatically")
        if ce.get("SW_THERMAL", 0):
            notes.append(f"{ce['SW_THERMAL']} software thermal slowdown(s) under load")
        if t.get("remap_pending"):
            notes.append("a row remap is pending and applies at the next GPU reset")
            actions.append(f"Reset GPU {g} before shipping so its pending row remap takes effect.")
        psu_fault = any(f["part"] == "PSU" for f in report.get("chassis", {}).get("faults", []))
        power_warn = any(w.get("category") == "HARDWARE_POWER" for w in t.get("dcgm_warnings", []))
        if psu_fault and (ce.get("HW_POWER_BRAKE", 0) or power_warn):
            reasons = [r if r != "hardware slowdown events under load" else "hardware power-brake slowdowns under load, consistent with the failed power supply" for r in reasons]
            if power_warn:
                notes.append("the power warning is consistent with the failed power supply")

        reasons = list(dict.fromkeys(reasons)); notes = [n for n in dict.fromkeys(notes) if n not in reasons]
        verdicts.append({"gpu": g, "status": status, "reasons": reasons, "notes": notes, "telemetry": t})

    # ---- 3. score from telemetry
    all_results = [(res if isinstance(res, str) else r) for res in tests.values()
                   for r in ([res] if isinstance(res, str) else res)]
    s.add("tests", "warning result", sum(x == "warn" for x in all_results), C["warn_result"], C["warn_cap"])
    skips = [(name, i) for name, res in tests.items() if isinstance(res, list) for i, r in enumerate(res) if r == "skip"]
    s.add("coverage", "test skipped on a GPU", len(skips), C["skipped_result"], C["skipped_cap"])
    if skips:
        findings.append({"severity": "INFO", "gpu": None, "text": "Skipped, so not verified: " + ", ".join(f"{DCGM_TEST_LABELS.get(n, n)} on GPU {i}" for n, i in skips) + ".", "evidence": "tests"})
    unc = sum(_n(t.get("remapped_rows_uncorrectable")) for t in gpus)
    s.add("memory", "uncorrectable error repaired by row remap", unc, C["uncorrectable_remap_row"], C["uncorrectable_remap_cap"])
    s.add("memory", "correctable error repaired by row remap", sum(_n(t.get("remapped_rows_correctable")) for t in gpus), C["correctable_remap_row"], C["correctable_remap_cap"])
    s.add("memory", "correctable ECC errors (per 50, last 30 days)", sum(_n(t.get("ecc_correctable_30d")) for t in gpus) // C["correctable_ecc_bucket"], 1, C["correctable_ecc_cap"])
    s.add("memory", "uncontained or escaped memory error (Xid 95, 140)", sum(bool(set(t.get("xids", [])) & {95, 140}) for t in gpus), C["uncontained_xid95"])
    s.add("memory", "memory bank with one spare row left", sum(_n((t.get("remap_histogram") or {}).get("low")) for t in gpus), C["hist_low_bank"], C["hist_low_cap"])
    s.add("memory", "memory bank with no spare rows left", sum(_n((t.get("remap_histogram") or {}).get("none")) for t in gpus), C["hist_none_bank"], C["hist_none_cap"])
    s.add("memory", "uncorrectable error without a row remap (Xid 48)", sum(48 in t.get("xids", []) and not (set(t.get("xids", [])) & {63, 64}) and not _n(t.get("remapped_rows_uncorrectable")) for t in gpus), C["xid48_unremapped"])
    s.add("stability", "GPU fell off the bus (Xid 79)", sum(79 in t.get("xids", []) for t in gpus), C["xid79"])
    s.add("stability", "GPU event NVIDIA says needs a reset", sum(any(xid_class(x) == "reset" for x in set(t.get("xids", [])) - {64, 95, 140, 79, 74, 48, 63, 94}) for t in gpus), C["reset_class_xid"], C["reset_class_cap"])
    clock_pts = sum(t.get("clock_events", {}).get(e, 0) * C["clock_event_points"][e] for t in gpus for e in CLOCK_EVENTS)
    s.add("thermal and power", "clock slowdown events under load", 1, min(clock_pts, C["clock_event_cap"]),
          evidence=", ".join(f"{e} x{sum(t.get('clock_events', {}).get(e, 0) for t in gpus)}" for e in CLOCK_EVENTS if any(t.get("clock_events", {}).get(e, 0) for t in gpus)))
    s.add("interconnect", "NVLink errors (per 100)", sum(_n(t.get("nvlink_errors")) for t in gpus) // C["nvlink_error_bucket"], 1, C["nvlink_error_cap"])
    s.add("interconnect", "NVLink error event (Xid 74)", sum(74 in t.get("xids", []) for t in gpus), C["nvlink_xid74"])
    s.add("interconnect", "PCIe replays (per 100)", sum(_n(t.get("pcie_replays")) for t in gpus) // C["pcie_replay_bucket"], 1, C["pcie_replay_cap"])
    hours = report.get("chassis", {}).get("power_on_hours", 0)
    s.add("wear", "power-on hours above one year", max(0, hours - C["hours_threshold"]) // C["hours_bucket"], 1, C["hours_cap"], evidence=f"{hours:,} hours")
    cos = report.get("chassis", {}).get("cosmetic", "like_new")
    s.add("wear", f"cosmetic condition ({cos.replace('_', ' ')})", 1, C["cosmetic"][cos])
    faults = report.get("chassis", {}).get("faults", [])
    s.add("chassis", "hardware fault outside the GPUs", len(faults), C["chassis_fault"], evidence=", ".join(f["part"] for f in faults))
    score = max(0, 100 - s.total())

    # ---- 4. grade with hard caps
    table = _csv("grade_table.csv")
    uncapped = next(r["grade"] for r in table if score >= float(r["min_score"]))
    caps = []
    failed = [v for v in verdicts if v["status"] == "FAIL"]
    if failed: caps.append(("D", f"{len(failed)} GPU(s) failed"))
    if faults: caps.append(("C", "hardware fault outside the GPUs: " + ", ".join(f["part"] for f in faults)))
    if any(set(t.get("xids", [])) & {95, 140} for t in gpus): caps.append(("C", "uncontained or escaped memory error on record"))
    if any(79 in t.get("xids", []) for t in gpus): caps.append(("C", "a GPU fell off the bus"))
    if any(_n((t.get("remap_histogram") or {}).get("none")) for t in gpus): caps.append(("B", "a memory bank has no spare rows left"))
    if unc: caps.append(("B", "uncorrectable memory error on record (repaired by row remapping)"))
    if unexpected: caps.append(("D", "inconsistent test report"))
    if level == 0: caps.append(("D", "no diagnostics run: sold as untested"))
    grade, cap_reason = uncapped, None
    for cap, why in caps:
        if GRADES.index(grade) < GRADES.index(cap):
            grade, cap_reason = cap, why
    caps_all = [{"max_grade": c, "reason": w, "binding": GRADES.index(uncapped) < GRADES.index(c)} for c, w in caps]
    confidence = {4: "High", 3: "Good", 2: "Limited", 1: "Low", 0: "None"}[level]
    ladder = ["None", "Low", "Limited", "Good", "High"]
    if any(t.get(f) is None for t in gpus for f in ("remapped_rows_correctable", "remapped_rows_uncorrectable")):
        confidence = ladder[min(ladder.index(confidence), ladder.index("Good"))]
    if any(t.get("untested_reason") for t in gpus):
        confidence = ladder[min(ladder.index(confidence), ladder.index("Limited"))]

    # ---- 5. buyer-facing findings
    for v in verdicts:
        if v["status"] != "HEALTHY":
            sev = {"WATCH": "WATCH", "DEGRADED": "WARNING", "FAIL": "CRITICAL"}[v["status"]]
            findings.append({"severity": sev, "gpu": v["gpu"], "text": f"GPU {v['gpu']}: " + "; ".join(v["reasons"] + v["notes"]) + ".", "evidence": "gpus/tests"})
        elif v["notes"]:
            findings.append({"severity": "INFO", "gpu": v["gpu"], "text": f"GPU {v['gpu']}: " + "; ".join(v["notes"]) + ".", "evidence": "gpus"})
    for f in faults:
        findings.append({"severity": "CRITICAL", "gpu": None, "text": f"{f['part']} fault: {f.get('detail', 'reported by the baseboard controller')}.", "evidence": "chassis.faults"})
    unknown_mem = [t.get("index") for t in gpus if any(t.get(f) is None for f in ("remapped_rows_correctable", "remapped_rows_uncorrectable"))]
    if unknown_mem:
        kinds = {t.get("memory_telemetry") for t in gpus if t.get("index") in unknown_mem}
        why = ("no nvidia-smi output was provided" if kinds == {"missing"} else
               "nvidia-smi reported N/A, which is common inside virtual machines" if kinds == {"na"} else
               "it was not provided or not reported")
        who = "all GPUs" if len(unknown_mem) == gpu_count else "GPU " + ", ".join(str(i) for i in unknown_mem)
        findings.append({"severity": "INFO", "gpu": None, "text": f"Memory self-repair history is unknown for {who}: {why}. Unknown is not treated as clean.", "evidence": "gpus"})
    attention = [v for v in verdicts if v["status"] != "HEALTHY"]
    noted = [v for v in verdicts if v["notes"]]
    if not attention and not faults and not noted:
        findings.insert(0, {"severity": "OK", "gpu": None, "text": f"All {gpu_count} GPUs passed every test that was run, with clean memory and power telemetry.", "evidence": "tests, gpus"})
    elif not attention and not faults:
        findings.insert(0, {"severity": "OK", "gpu": None, "text": f"All {gpu_count} GPUs passed every test that was run. Routine self-repair on record is listed below.", "evidence": "tests, gpus"})
    elif not failed and not faults:
        findings.insert(0, {"severity": "OK", "gpu": None, "text": f"No GPU failed a test. {len(attention)} of {gpu_count} GPU(s) show something a buyer should know, listed below.", "evidence": "tests, gpus"})

    actions = list(dict.fromkeys(actions))
    return {"score": score, "deductions": s.items, "grade": grade, "uncapped_grade": uncapped,
            "cap_reason": cap_reason, "caps": caps_all, "confidence": confidence, "run_level": level,
            "tests_missing": missing, "tests_unexpected": unexpected,
            "gpu_verdicts": [{k: v[k] for k in ("gpu", "status", "reasons", "notes")} for v in verdicts],
            "failed_gpus": [v["gpu"] for v in failed], "chassis_faults": faults,
            "reseat_only_gpus": [v["gpu"] for v in failed if 79 in set(v["telemetry"].get("xids", []))
                                 and not v["telemetry"].get("remap_failure") and 64 not in set(v["telemetry"].get("xids", []))
                                 and not any(r.startswith("failed ") for r in v["reasons"])],
            "findings": findings, "actions": actions}


def model_inputs(ev, gpu_model, gpu_count, profile_repair_gpu_cost):
    """Bridge from diagnostics to the decision model. Every value is derived, never typed in."""
    C = CONSTANTS
    build = next(r for r in _csv("harvest_build.csv") if r["gpu_model"] == gpu_model)
    gpu_price, parts = float(build["used_gpu_price"]), float(build["platform_parts_value"])
    fc = {r["part"]: r for r in _csv("fault_costs.csv")}
    n_failed = len(ev["failed_gpus"])
    working = gpu_count - n_failed
    known = [f for f in ev["chassis_faults"] if f["part"] in fc]
    unknown = [f["part"] for f in ev["chassis_faults"] if f["part"] not in fc]  # no sourced cost: cannot price a repair
    reseat = len(ev.get("reseat_only_gpus", []))  # re-seat and re-test: labor and the retest, no new part
    swaps = n_failed - reseat
    parts_cost = swaps * gpu_price + sum(float(fc[f["part"]]["cost_usd"]) for f in known)
    days = max([10] * bool(swaps) + [C["reseat_days"]] * bool(reseat) + [int(fc[f["part"]]["repair_days"]) for f in known] or [0])
    sell_fee = resolve_defaults_cached()["sell_fee_pct"]
    repairable = (n_failed + len(ev["chassis_faults"]) > 0 and n_failed <= C["max_gpu_swaps_repairable"] and not unknown)
    harvest = (working * gpu_price * (1 - C["loose_gpu_discount"]) + parts) * (1 - sell_fee) - C["teardown_cost"] - 400
    return {"health_pass": n_failed == 0 and not ev["chassis_faults"],
            "repairable": repairable,
            "working_gpus": working,
            "repair_parts_cost": round(parts_cost, 2),
            "repair_days": days,
            "harvest_value": round(harvest, 2),
            "server_price_by_components": round(gpu_count * gpu_price + parts, 2),
            "unpriced_faults": unknown,
            "basis": {"used_gpu_price": gpu_price, "platform_parts_value": parts, "status": build["status"]}}


def repaired_projection(report):
    """The report expected after a repair: faulted parts replaced, failed GPUs swapped, slowdown
    events caused by the failed PSU cleared, and a full level-4 retest (covered by repair_test_cost).
    HYPOTHESIS: a repair restores the affected parts to a clean result; it does not erase wear."""
    rep = {**report, "chassis": {**report.get("chassis", {}), "faults": []}}
    psu = any(f["part"] == "PSU" for f in report.get("chassis", {}).get("faults", []))
    gpus = []
    for t in report.get("gpus", []):
        t = dict(t)
        if t.get("remap_failure") or 64 in t.get("xids", []):
            t = {"index": t["index"]}  # GPU module swapped for a tested replacement
        elif 79 in t.get("xids", []):
            t["xids"] = [x for x in t["xids"] if x != 79]  # re-seated and re-tested
        if psu:
            t["clock_events"] = {k: v for k, v in t.get("clock_events", {}).items() if k != "HW_POWER_BRAKE"}
            t["dcgm_warnings"] = [w for w in t.get("dcgm_warnings", []) if w.get("category") != "HARDWARE_POWER"]
        gpus.append(t)
    power_tests = {(w.get("test"), t["index"]) for t in report.get("gpus", []) for w in t.get("dcgm_warnings", [])
                   if w.get("category") == "HARDWARE_POWER"} if psu else set()
    rep["gpus"] = gpus
    swapped = {t["index"] for t in report.get("gpus", []) if t.get("remap_failure") or 64 in t.get("xids", []) or 79 in t.get("xids", [])}
    tests = {}
    for name, res in report.get("tests", {}).items():
        if isinstance(res, str):
            tests[name] = "pass" if res == "fail" else res
        else:  # only a swapped GPU or a failed result gets a fresh pass; warnings elsewhere stay
            tests[name] = ["pass" if (i in swapped or r == "fail" or (r == "warn" and (name, i) in power_tests)) else r for i, r in enumerate(res)]
    n = max([len(r) for r in tests.values() if isinstance(r, list)] or [8])
    for name in expected_tests(4):  # the post-repair retest runs the full level 4 suite
        tests.setdefault(name, "pass" if name == "software" else ["pass"] * n)
    rep["tests"] = tests
    rep["run_level"] = 4
    return rep


def diagnose_listing(raw):
    """Evaluation plus model inputs for one seed listing."""
    ev = evaluate(raw["report"], raw["gpu_count"])
    mi = model_inputs(ev, f'{raw["gpu_model"]} {raw["gpu_memory_gb"]}GB', raw["gpu_count"], None)
    return ev, mi
