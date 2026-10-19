"""NVIDIA reader: converts NVIDIA's own tool output into the report engine/diagnostics.py grades.

ReCompute runs no GPU tests. It reads what NVIDIA's tools already produced:
  1. `dcgmi diag --json` (DCGM 4.x) or `dcgmi diag -j` (DCGM 2.x/3.x legacy layout)
  2. `nvidia-smi -q -x` (XML) and/or `nvidia-smi --query-gpu/--query-remapped-rows ... --format=csv`
  3. kernel log lines (`dmesg`, `journalctl -k`) containing `NVRM: Xid ...`
  4. chassis facts NVIDIA tools do not cover (power supplies, fans, hours, cosmetics), entered by the operator

Every rule below is taken from NVIDIA's own code or documentation (checked Oct 2 2026):
  - JSON layout and key names: NVIDIA/DCGM 4.6.1 dcgmi/Diag.cpp (HelperJsonBuildOutput) and
    nvvs/include/NvvsJsonStrings.h; official schema testing/python3/dcgm_diag_schema.json.
  - In JSON a WARN result is printed as "Fail" (HelperDisplayDiagResult defaults to DDR_NO_DISPLAY_WARN),
    so the real severity comes from each warning's error_id. NVIDIA's own test asserts a "Fail" result
    whose warning severity is DCGM_ERROR_MONITOR (testing/python3/tests/test_dcgm_diag.py).
  - error_id -> severity and category: dcgmlib/src/dcgm_errors.c (data/sources/nvidia_dcgm_error_catalog.csv).
  - Skips after memory conditions: nvvs/src/EntitySet.cpp UpdateSkippedEntities; exact skip messages.
  - After a hardware failure NVVS marks later tests failed (testing/python3/denylist_recommendations.py),
    so later failures on that GPU with no error of their own are a cascade, not new evidence.
  - Xid actions and A100/H100 applicability: NVIDIA Xid-Catalog.xlsx (data/sources/nvidia_xid_catalog.csv).
  - nvidia-smi XML field names, including the clocks_throttle_reasons -> clocks_event_reasons rename and
    "N/A" when a field is hidden (for example inside a VM): real captures in tests/fixtures/nvidia.
"""
import csv
import io
import json
import re
import xml.etree.ElementTree as ET
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# ---------------------------------------------------------------- NVIDIA catalogues (sourced data files)
SEVERITY = {0: "NONE", 1: "MONITOR", 2: "ISOLATE", 3: "UNKNOWN", 4: "TRIAGE", 5: "CONFIG", 6: "RESET"}


@lru_cache(maxsize=1)
def dcgm_errors():
    with open(ROOT / "data/sources/nvidia_dcgm_error_catalog.csv", newline="", encoding="utf-8") as f:
        return {int(r["code"]): r for r in csv.DictReader(f)}


@lru_cache(maxsize=1)
def xid_catalog():
    with open(ROOT / "data/sources/nvidia_xid_catalog.csv", newline="", encoding="utf-8") as f:
        return {int(r["xid"]): r for r in csv.DictReader(f)}


# DCGM error codes that are memory facts about a GPU, not test results (dcgm_errors.h)
CODE_ROW_REMAP_FAILURE = 80
CODE_UNCORRECTABLE_ROW_REMAP = 84
CODE_PENDING_ROW_REMAP = 85
CODE_UNCONTAINED = 81
CODE_FALLEN_OFF_BUS = 120
CODE_VOLATILE_DBE = 4

SKIP_REASONS = {  # nvvs EntitySet: exact messages NVIDIA writes when it skips a GPU for later tests
    "Skipping this test due to previously detected uncorrectable row remapping.": "uncorrectable row remap",
    "Skipping this test due to previously detected pending row remapping.": "pending row remap",
    "Skipping this test due to previously detected row remapping failure.": "row remap failure",
    "Skipping this test due to previously detected pending page retirements.": "pending page retirement",
    "Skipping this test due to previously detected unacceptable total page retirements.": "too many retired pages",
}

# Test names: DCGM 4.x canonical names, plus legacy names seen in real DCGM 2.x/3.x output
CANONICAL = {"software", "memory", "pcie", "diagnostic", "memory_bandwidth", "targeted_stress",
             "targeted_power", "nvbandwidth", "memtest", "pulse_test", "context_create"}
LEGACY_DEPLOYMENT = {"denylist", "blacklist", "nvml library", "cuda main library", "cuda toolkit library",
                     "cuda toolkit libraries", "permissions and os-related blocks", "persistence mode",
                     "environmental variables", "page retirement/row remap", "page retirement",
                     "graphics processes", "inforom", "fabric manager"}
ALIASES = {"memtest": "memtest", "pulse test": "pulse_test", "pulse_test": "pulse_test",
           "memory bandwidth": "memory_bandwidth", "targeted stress": "targeted_stress",
           "targeted power": "targeted_power", "pcie": "pcie", "pci-e": "pcie", "gpu memory": "memory",
           "context create": "context_create", "nvbandwidth": "nvbandwidth"}
EXTRA_TESTS = {"sm_stress", "sm stress", "eud", "cpu_eud", "production_testing"}  # recorded, not graded


class NvidiaInputError(ValueError):
    """Raised when a file is not recognisable NVIDIA tool output."""


MAX_GPUS = 64  # real servers carry 8, at most 16; a larger id means a corrupted file, never a huge allocation


def _gpu_index(v):
    if isinstance(v, bool) or not isinstance(v, (int, str)):
        raise NvidiaInputError(f"GPU id must be a whole number, got {v!r}")
    try:
        i = int(str(v).strip())
    except ValueError:
        raise NvidiaInputError(f"GPU id must be a whole number, got {v!r}")
    if not 0 <= i < MAX_GPUS:
        raise NvidiaInputError(f"GPU id {i} is outside 0 to {MAX_GPUS - 1}; the file is corrupted")
    return i


def _norm_test(name):
    n = " ".join(str(name).strip().lower().split())
    if n in CANONICAL:
        return n
    if n.replace(" ", "_") in CANONICAL:
        return n.replace(" ", "_")
    if n in ALIASES:
        return ALIASES[n]
    if n in LEGACY_DEPLOYMENT:
        return "software"
    return None


def _status_word(s):
    s = str(s or "").strip().lower()
    return {"pass": "pass", "fail": "fail", "warn": "warn", "warning": "warn", "skip": "skip",
            "not run": "not_run", "notrun": "not_run"}.get(s, "unknown")


def _gpu_ids(result):
    """DCGM 4.x: entity_group 'GPU' + entity_id. Legacy: gpu_ids '0,1,2,3' or gpu_id."""
    if "entity_id" in result:
        if str(result.get("entity_group", "GPU")).upper() not in ("GPU", ""):
            return []
        return [_gpu_index(result["entity_id"])]
    raw = result.get("gpu_ids", result.get("gpu_id"))
    if raw is None:
        return []
    return [_gpu_index(x) for x in str(raw).replace(" ", "").split(",") if x != ""]


def classify_warning(w):
    """Severity of one DCGM warning: catalogue by error_id first (codes are stable across versions);
    the severity printed in the report is kept and any disagreement is recorded."""
    code = w.get("error_id")
    cat = dcgm_errors().get(int(code)) if isinstance(code, int) else None
    reported = w.get("error_severity")
    if cat:
        sev = int(cat["severity"])
        mismatch = isinstance(reported, int) and reported != sev
        return {"code": int(code), "name": cat["name"], "severity": sev, "severity_name": SEVERITY[sev],
                "category": cat["category_name"], "message": w.get("warning", ""),
                "nvidia_next_step": cat["next_step"], "reported_severity": reported,
                "severity_mismatch": mismatch}
    sev = reported if isinstance(reported, int) and reported in SEVERITY else 3
    return {"code": code, "name": "UNLISTED", "severity": sev, "severity_name": SEVERITY[sev], "category": "",
            "message": w.get("warning", ""), "nvidia_next_step": "", "reported_severity": reported,
            "severity_mismatch": False}


def _is_gpu_hardware_fact(w):
    return str(w.get("category", "")).startswith("HARDWARE") or w.get("code") in (CODE_UNCONTAINED,)


def _result_to_engine(status, warns):
    """One DCGM per-GPU result -> engine result word, using NVIDIA's severity of its warnings.
    ISOLATE: the GPU cannot do work (fail). RESET: drain and reset; a row-remap failure is damage (fail),
    other reset items are a warning plus an action. MONITOR and TRIAGE: still works, needs attention (warn).
    CONFIG: the test environment, not the GPU, was the problem (treated as not tested, i.e. skip).
    A Fail with no warnings attached is kept as fail (conservative)."""
    st = _status_word(status)
    if st in ("pass", "skip", "not_run"):
        return "skip" if st == "not_run" else st
    if not warns:
        return "fail" if st == "fail" else ("warn" if st == "warn" else "fail")
    sevs = {w["severity"] for w in warns}
    if 2 in sevs or any(w["code"] == CODE_ROW_REMAP_FAILURE for w in warns):
        return "fail"
    if sevs <= {5}:
        return "skip"
    return "warn"


# ---------------------------------------------------------------- 1. dcgmi diag JSON
def parse_dcgm_json(doc):
    try:
        return _parse_dcgm_json(doc)
    except NvidiaInputError:
        raise
    except (KeyError, TypeError, ValueError, AttributeError, IndexError) as e:
        raise NvidiaInputError(f"malformed dcgmi diag JSON: {type(e).__name__}: {e}")


def _parse_dcgm_json(doc):
    """Returns {gpu_count, run_level, tests{name:[per-GPU word]}, gpu_facts{idx:{...}}, findings[], meta, extras}."""
    if isinstance(doc, (str, bytes)):
        try:
            doc = json.loads(doc)
        except json.JSONDecodeError as e:
            raise NvidiaInputError(f"dcgmi diag output is not valid JSON: {e}")
    if not isinstance(doc, dict):
        raise NvidiaInputError("dcgmi diag output must be a JSON object")
    root, layout = (doc["DCGM Diagnostic"], "dcgm4") if "DCGM Diagnostic" in doc else \
                   (doc.get("DCGM GPU Diagnostic"), "legacy")
    if not isinstance(root, dict):
        raise NvidiaInputError("not dcgmi diag JSON: no 'DCGM Diagnostic' or 'DCGM GPU Diagnostic' object")
    if root.get("runtime_error"):
        raise NvidiaInputError("DCGM reported a runtime error, so no results exist: " + str(root["runtime_error"]))

    serials, gpu_ids_seen = {}, set()
    for grp in doc.get("entity_groups", []):
        if str(grp.get("entity_group", "")).upper() == "GPU":
            for e in grp.get("entities", []):
                gpu_ids_seen.add(_gpu_index(e.get("entity_id")))
                if e.get("serial_num"):
                    serials[_gpu_index(e.get("entity_id"))] = str(e["serial_num"])
    raw = {}       # test -> {gpu: (word, [warnings])}
    extras, findings, facts = [], [], {}
    order = []
    for cat in root.get("test_categories", []):
        for t in cat.get("tests", []):
            name = _norm_test(t.get("name", ""))
            label = t.get("name", "")
            if name is None:
                extras.append({"test": label, "category": cat.get("category", ""),
                               "note": "recorded, not graded" if " ".join(label.lower().split()) in EXTRA_TESTS else "unrecognised test name, recorded, not graded"})
                continue
            if name not in raw:
                raw[name] = {}; order.append(name)
            for res in t.get("results", []):
                warns = [classify_warning(w) for w in res.get("warnings", [])]
                for g in _gpu_ids(res):
                    gpu_ids_seen.add(g)
                    skip_reason = next((SKIP_REASONS[w["message"].strip()] for w in warns if w["message"].strip() in SKIP_REASONS), None)
                    word = "skip" if skip_reason else _result_to_engine(res.get("status"), warns)
                    prev = raw[name].get(g)
                    if name == "software" and prev:  # several legacy deployment checks -> keep the worst
                        rank = {"pass": 0, "skip": 1, "warn": 2, "fail": 3}
                        word = word if rank[word] >= rank[prev[0]] else prev[0]
                        warns = prev[1] + warns
                    raw[name][g] = (word, warns, skip_reason)
                    f = facts.setdefault(g, {})
                    if skip_reason:
                        f.setdefault("skipped_for_memory_condition", skip_reason)
                    for w in warns:
                        if w["code"] == CODE_ROW_REMAP_FAILURE: f["remap_failure"] = True
                        if w["code"] == CODE_PENDING_ROW_REMAP: f["remap_pending"] = True
                        if w["code"] == CODE_UNCORRECTABLE_ROW_REMAP:
                            m = re.search(r"(\d+)\s+rows? were remapped", w["message"])
                            f["remapped_rows_uncorrectable_min"] = max(f.get("remapped_rows_uncorrectable_min", 1), int(m.group(1)) if m else 1)
                        if w["code"] == CODE_UNCONTAINED: f.setdefault("xids", set()).add(95)
                        if w["code"] == CODE_FALLEN_OFF_BUS: f.setdefault("xids", set()).add(79)
                        findings.append({"source": "dcgmi diag", "gpu": g, "test": name, **w})
    n = (max(gpu_ids_seen) + 1) if gpu_ids_seen else 0

    # cascade: after a GPU's first hardware fail, later fails with no error of their own add nothing new
    tests = {}
    for name in order:
        if name == "software":
            # A hardware fact about one GPU found during the deployment checks (row remap failure,
            # retired pages, uncontained error) belongs to that GPU, not to the whole system.
            # Only software, configuration or internal problems make the system-level result fail.
            rank = {"pass": 0, "skip": 1, "warn": 2, "fail": 3}
            words = []
            for g, (word, warns, _) in raw[name].items():
                if warns and all(_is_gpu_hardware_fact(w) for w in warns):
                    words.append("pass")
                else:
                    words.append(word)
            tests[name] = max(words, key=lambda w: rank[w]) if words else "skip"
            continue
        tests[name] = []
        for g in range(n):
            tests[name].append(raw[name].get(g, ("skip", [], None))[0])
    first_fail = {}
    for name in [x for x in order if x != "software"]:
        for g in range(n):
            word, warns, _ = raw[name].get(g, ("skip", [], None))
            if word == "fail":
                if g in first_fail and not warns:
                    tests[name][g] = "skip"
                    findings.append({"source": "dcgmi diag", "gpu": g, "test": name, "code": None, "name": "CASCADE",
                                     "severity": 0, "severity_name": "NONE", "category": "",
                                     "message": f"Result follows GPU {g}'s earlier failure in {first_fail[g]}; not counted again.",
                                     "nvidia_next_step": "", "reported_severity": None, "severity_mismatch": False})
                else:
                    first_fail.setdefault(g, name)

    # A test NVIDIA skipped on every GPU did not run: it is an evidence gap, not a result.
    skipped_entirely = []
    for name in list(tests):
        res = tests[name]
        words = [res] if isinstance(res, str) else res
        if words and all(w == "skip" for w in words):
            reasons = sorted({f["message"] for f in findings if f.get("test") == name and f.get("message")})
            skipped_entirely.append({"test": name, "reason": reasons[0] if reasons else "skipped by NVIDIA's diagnostic"})
            del tests[name]
    from .diagnostics import DCGM_SUITES  # run level = highest level whose added tests actually ran
    level = 0
    for lv in (1, 2, 3, 4):
        if set(tests) & set(DCGM_SUITES[lv]):
            level = lv
    for lv in range(level + 1, 5):  # tests above the level that ran cannot stay in a lower-level report
        for name in DCGM_SUITES[lv]:
            tests.pop(name, None)
    meta = {"layout": layout, "dcgm_version": (doc.get("metadata", {}) or {}).get("version") or root.get("version"),
            "driver_version": (doc.get("metadata", {}) or {}).get("Driver Version Detected") or doc.get("Driver Version Detected"),
            "serials": serials}
    return {"gpu_count": n, "run_level": level, "tests": tests, "gpu_facts": facts,
            "findings": findings, "meta": meta, "extras": extras, "skipped_entirely": skipped_entirely}


# ---------------------------------------------------------------- 2. nvidia-smi -q -x
def _int_or_none(v):
    """NVIDIA prints 'N/A' (or blanks) when a value is unavailable, for example inside a VM. That is unknown, not zero."""
    if v is None:
        return None
    s = str(v).strip().split(" ")[0]
    return int(s) if s.isdigit() else None


def _yes_no(v):
    s = str(v or "").strip().lower()
    return True if s == "yes" else False if s == "no" else None


def parse_smi_xml(text):
    try:
        return _parse_smi_xml(text)
    except NvidiaInputError:
        raise
    except (KeyError, TypeError, ValueError, AttributeError, IndexError) as e:
        raise NvidiaInputError(f"malformed nvidia-smi XML: {type(e).__name__}: {e}")


def _parse_smi_xml(text):
    """Returns {gpu_count, driver_version, gpus:[{index, product, serial, uuid, bus, memory telemetry...}]}"""
    try:
        root = ET.fromstring(text if isinstance(text, (str, bytes)) else str(text))
    except ET.ParseError as e:
        raise NvidiaInputError(f"not nvidia-smi XML: {e}")
    if root.tag != "nvidia_smi_log":
        raise NvidiaInputError("not nvidia-smi XML: root element is not nvidia_smi_log")
    gpus = []
    for i, g in enumerate(root.findall("gpu")):
        rr = g.find("remapped_rows")
        rr_av = rr is not None and len(rr) > 0
        hist = {}
        if rr_av and rr.find("row_remapper_histogram") is not None:
            for b in ("max", "high", "partial", "low", "none"):
                hist[b] = _int_or_none(rr.findtext(f"row_remapper_histogram/row_remapper_histogram_{b}"))
        ecc = g.find("ecc_errors")
        def ecc_val(scope, field):
            return _int_or_none(ecc.findtext(f"{scope}/{field}")) if ecc is not None else None
        reasons = g.find("clocks_event_reasons")
        prefix = "clocks_event_reason_"
        if reasons is None:
            reasons, prefix = g.find("clocks_throttle_reasons"), "clocks_throttle_reason_"
        active = []
        if reasons is not None:
            for k, name in (("hw_slowdown", "HW_SLOWDOWN"), ("hw_thermal_slowdown", "HW_THERMAL"),
                            ("hw_power_brake_slowdown", "HW_POWER_BRAKE"), ("sw_thermal_slowdown", "SW_THERMAL")):
                if (reasons.findtext(prefix + k) or "").strip() == "Active":
                    active.append(name)
        bus = (g.findtext("pci/pci_bus_id") or g.get("id") or "").strip()
        gpus.append({
            "index": i, "product": (g.findtext("product_name") or "").strip(),
            "serial": (g.findtext("serial") or "").strip(), "uuid": (g.findtext("uuid") or "").strip(),
            "bus": _bus_key(bus),
            "ecc_mode": (g.findtext("ecc_mode/current_ecc") or "").strip() or None,
            "remapped_rows_correctable": _int_or_none(rr.findtext("remapped_row_corr")) if rr_av else None,
            "remapped_rows_uncorrectable": _int_or_none(rr.findtext("remapped_row_unc")) if rr_av else None,
            "remap_pending": _yes_no(rr.findtext("remapped_row_pending")) if rr_av else None,
            "remap_failure": _yes_no(rr.findtext("remapped_row_failure")) if rr_av else None,
            "remap_histogram": hist or None,
            "dram_correctable_volatile": ecc_val("volatile", "dram_correctable"),
            "dram_uncorrectable_volatile": ecc_val("volatile", "dram_uncorrectable"),
            "dram_correctable_aggregate": ecc_val("aggregate", "dram_correctable"),
            "dram_uncorrectable_aggregate": ecc_val("aggregate", "dram_uncorrectable"),
            "sram_uncorrectable_aggregate": ecc_val("aggregate", "sram_uncorrectable"),
            "clock_events_active_now": active,
            "pcie_replays": _int_or_none(g.findtext("pci/replay_counter")),
            "pcie_replay_rollovers": _int_or_none(g.findtext("pci/replay_rollover_counter")),
            "gpu_temp_c": _int_or_none(g.findtext("temperature/gpu_temp")),
        })
    return {"gpu_count": len(gpus), "driver_version": (root.findtext("driver_version") or "").strip() or None,
            "timestamp": (root.findtext("timestamp") or "").strip() or None, "gpus": gpus}


def parse_smi_csv(text):
    """`nvidia-smi --query-... --format=csv` (with header). Column names follow NVIDIA's query names,
    for example remapped_rows.correctable. Units such as ' MiB' are stripped; '[N/A]' is unknown."""
    rows = list(csv.reader(io.StringIO(text.strip())))
    if not rows:
        raise NvidiaInputError("empty CSV")
    hdr = [h.strip().split(" [")[0] for h in rows[0]]
    out = []
    for r in rows[1:]:
        d = {h: (v.strip() if v.strip() not in ("[N/A]", "N/A", "[Not Supported]") else None) for h, v in zip(hdr, r)}
        out.append(d)
    return out


# ---------------------------------------------------------------- 2b. dcgmi nvlink --errors --gpuid N --json
NVLINK_ERROR_NAMES = ("CRC FLIT Error", "CRC Data Error", "Replay Error", "Recovery Error", "Link Integrity Error")


def parse_dcgm_nvlink_json(doc):
    """NVIDIA/DCGM dcgmi/Nvlink.cpp writes a DcgmiOutput tree: {"header": [..., "GPU <id>"], "body":
    {"Link <n>": {"children": {"CRC FLIT Error": {"value": "<count>"}, ...}}}}. Hopper and older report CRC
    FLIT, CRC Data, Replay and Recovery per link; Blackwell reports Link Integrity Error.
    Returns {gpu, links: {n: {name: count}}, total}."""
    try:
        if isinstance(doc, (str, bytes)):
            doc = json.loads(doc)
        gpu = None
        for h in doc.get("header", []):
            m = re.match(r"GPU (\d+)$", str(h).strip())
            if m:
                gpu = _gpu_index(m.group(1))
        links, total = {}, 0
        for sec, box in (doc.get("body") or {}).items():
            m = re.match(r"Link (\d+)$", str(sec).strip())
            if not m:
                continue
            counts = {}
            for name, leaf in ((box or {}).get("children") or {}).items():
                if name in NVLINK_ERROR_NAMES:
                    v = str((leaf or {}).get("value", "")).strip()
                    if v.isdigit():
                        counts[name] = int(v); total += int(v)
            links[int(m.group(1))] = counts
        return {"gpu": gpu, "links": links, "total": total}
    except NvidiaInputError:
        raise
    except (ValueError, TypeError, AttributeError) as e:
        raise NvidiaInputError(f"malformed dcgmi nvlink JSON: {e}")


OUTLIER_FACTOR, OUTLIER_MIN = 10, 100  # HYPOTHESIS: a link with 10x its siblings' median and at least 100 errors


def nvlink_outliers(links):
    """A failing cable, bridge or connector shows as one link far above its siblings on the same GPU."""
    totals = {l: sum(c.values()) for l, c in links.items()}
    vals = sorted(totals.values())
    if len(vals) < 2:
        return []
    med = vals[len(vals) // 2]
    return sorted(l for l, t in totals.items() if t >= OUTLIER_MIN and t >= OUTLIER_FACTOR * max(med, 1))


# ---------------------------------------------------------------- 3. kernel log Xid lines
XID_RE = re.compile(r"NVRM: Xid \(PCI:([0-9a-fA-F]{4}:)?([0-9a-fA-F]{2}:[0-9a-fA-F]{2})(?:[^)]*)\):\s*(\d+)\s*,\s*(.*)")


def _bus_key(s):
    """'00000000:3B:00.0' or '0000:3b:00' or '3b:00' -> '3b:00' (bus:device), the part Xid lines print."""
    m = re.search(r"([0-9a-fA-F]{2}):([0-9a-fA-F]{2})(?:\.[0-7])?$", s.strip())
    return f"{m.group(1)}:{m.group(2)}".lower() if m else s.strip().lower()


def parse_xid_log(text):
    events = []
    for n, line in enumerate(str(text).splitlines(), 1):
        m = XID_RE.search(line)
        if not m:
            continue
        xid = int(m.group(3))
        cat = xid_catalog().get(xid, {})
        events.append({"line": n, "bus": m.group(2).lower(), "xid": xid, "detail": m.group(4).strip(),
                       "mnemonic": cat.get("mnemonic", ""), "description": cat.get("description", ""),
                       "nvidia_immediate_action": cat.get("immediate_action", ""),
                       "nvidia_investigatory_action": cat.get("investigatory_action", ""),
                       "applies_a100": cat.get("applies_a100", ""), "applies_h100": cat.get("applies_h100", "")})
    return events


def _merge_flag(from_dcgm, from_smi):
    """True if either source says so; False only if a source affirmatively says no; None if neither knows."""
    if from_dcgm or from_smi:
        return True
    if from_smi is False:
        return False
    return None


def load_capture(path):
    """A capture folder or the .tar.gz that tools/capture_nvidia.sh produces. Archive members that would
    land outside the extraction folder are refused."""
    import tarfile, tempfile
    from pathlib import Path as _P
    p = _P(path)
    if p.is_dir():
        return load_capture_dir(p)
    if not tarfile.is_tarfile(p):
        raise NvidiaInputError("not a capture folder or .tar.gz")
    tmp = _P(tempfile.mkdtemp(prefix="recompute_capture_"))
    with tarfile.open(p) as t:
        for m in t.getmembers():
            target = (tmp / m.name).resolve()
            if not str(target).startswith(str(tmp.resolve())) or m.issym() or m.islnk():
                raise NvidiaInputError(f"unsafe path in archive: {m.name}")
        try:
            t.extractall(tmp, filter="data")  # Python's safe mode (3.12+); members were already checked above
        except TypeError:
            t.extractall(tmp)  # older Python without the filter argument
    dirs = [d for d in tmp.iterdir() if d.is_dir()]
    return load_capture_dir(dirs[0] if len(dirs) == 1 else tmp)


def load_capture_dir(path):
    """Grade-ready report from a folder written by tools/capture_nvidia.sh (any subset of files)."""
    from pathlib import Path as _P
    d = _P(path)
    def opt(name):
        f = d / name
        return f.read_text(errors="replace", encoding="utf-8") if f.exists() else None
    notes = []
    # A diagnostic that could not run (common in rented containers without full privileges) leaves an
    # empty or error file. That makes the server untested; it must not discard the good nvidia-smi data.
    dcgm = opt("dcgm_diag.json")
    if dcgm is not None:
        try:
            parse_dcgm_json(dcgm)
        except NvidiaInputError as e:
            notes.append(f"NVIDIA's diagnostic output could not be used ({e}); the server is graded as untested.")
            dcgm = None
    nvl = []
    for f in sorted(d.glob("nvlink_gpu*.json")):
        try:
            parse_dcgm_nvlink_json(f.read_text(errors="replace", encoding="utf-8")); nvl.append(f.read_text(errors="replace", encoding="utf-8"))
        except NvidiaInputError as e:
            notes.append(f"{f.name} could not be used ({e}).")
    csv_text = opt("remapped_rows.csv")
    if csv_text is not None and not csv_text.strip():
        csv_text = None
    chassis = json.loads(opt("chassis.json")) if opt("chassis.json") else None
    rep, prov = build_report(dcgm=dcgm, smi_xml=opt("nvidia_smi.xml"), smi_csv=csv_text,
                             kernel_log=opt("kernel.log"), chassis=chassis, nvlink=nvl or None)
    prov["notes"] = notes + prov["notes"]
    return rep, prov


# ---------------------------------------------------------------- 4. merge into the engine's report
def build_report(dcgm=None, smi_xml=None, smi_csv=None, kernel_log=None, chassis=None, expected_gpus=None, nvlink=None):
    """nvlink: list of `dcgmi nvlink --errors --gpuid N --json` outputs (one per GPU)."""
    try:
        return _build_report(dcgm, smi_xml, smi_csv, kernel_log, chassis, expected_gpus, nvlink)
    except NvidiaInputError:
        raise
    except (KeyError, TypeError, ValueError, AttributeError, IndexError) as e:
        raise NvidiaInputError(f"could not combine the NVIDIA inputs: {type(e).__name__}: {e}")


def _build_report(dcgm, smi_xml, smi_csv, kernel_log, chassis, expected_gpus, nvlink=None):
    """Merge whatever NVIDIA output is available into the report engine/diagnostics.evaluate() grades.
    Returns (report, provenance). Unknown values stay None: unknown is never treated as clean."""
    prov = {"sources": [], "gpu_count_by_source": {}, "notes": [], "nvidia_findings": [], "unattributed_xids": [], "extras": []}
    d = parse_dcgm_json(dcgm) if dcgm is not None else None
    s = parse_smi_xml(smi_xml) if smi_xml is not None else None
    if d: prov["sources"].append(f"dcgmi diag ({d['meta']['layout']}, DCGM {d['meta']['dcgm_version'] or 'version not stated'})"); prov["gpu_count_by_source"]["dcgmi diag"] = d["gpu_count"]
    if s: prov["sources"].append(f"nvidia-smi -q -x (driver {s['driver_version']})"); prov["gpu_count_by_source"]["nvidia-smi"] = s["gpu_count"]
    counts = {c for c in prov["gpu_count_by_source"].values() if c}
    if expected_gpus: counts.add(expected_gpus)
    if len(counts) > 1:
        prov["notes"].append(f"GPU count disagrees between sources {prov['gpu_count_by_source']} and expected {expected_gpus}: a GPU may be missing from the bus.")
    n = expected_gpus or (max(counts) if counts else 0)
    if n > MAX_GPUS:
        raise NvidiaInputError(f"{n} GPUs is more than any server carries; the input is corrupted")
    if n == 0:
        raise NvidiaInputError("no GPUs found in any input")

    rows = []
    for i in range(n):
        smi = s["gpus"][i] if s and i < len(s["gpus"]) else {}
        fact = d["gpu_facts"].get(i, {}) if d else {}
        xids = set(fact.get("xids", set()))
        unc = smi.get("remapped_rows_uncorrectable")
        if fact.get("remapped_rows_uncorrectable_min") is not None:
            unc = max(unc or 0, fact["remapped_rows_uncorrectable_min"])
        row = {"index": i,
               "ecc_correctable_30d": smi.get("dram_correctable_volatile"),
               "remapped_rows_correctable": smi.get("remapped_rows_correctable"),
               "remapped_rows_uncorrectable": unc,
               "remap_pending": _merge_flag(fact.get("remap_pending"), smi.get("remap_pending")),
               "remap_failure": _merge_flag(fact.get("remap_failure"), smi.get("remap_failure")),
               "remap_histogram": smi.get("remap_histogram"),
               "xids": sorted(xids), "clock_events": {}, "nvlink_errors": None, "nvlink_outlier_links": [], "pcie_replays": smi.get("pcie_replays") if smi else None,
               "untested_reason": fact.get("skipped_for_memory_condition"),
               "memory_telemetry": ("missing" if not smi else "na" if smi.get("remapped_rows_correctable") is None else "ok"),
               "dcgm_warnings": [{k: f[k] for k in ("test", "code", "name", "severity_name", "category", "message", "nvidia_next_step")}
                                 for f in (d["findings"] if d else []) if f.get("gpu") == i and f.get("name") != "CASCADE"],
               "serial": smi.get("serial") or (d["meta"]["serials"].get(i) if d else None),
               "bus": smi.get("bus")}
        if smi.get("pcie_replay_rollovers"):
            prov["notes"].append(f"GPU {i}: the PCIe replay counter rolled over {smi['pcie_replay_rollovers']} time(s), so replays are very high.")
            row["pcie_replays"] = max(row["pcie_replays"] or 0, 400)  # at least the scoring cap
        if smi.get("clock_events_active_now"):
            prov["notes"].append(f"GPU {i}: clock slowdown active at capture time: {', '.join(smi['clock_events_active_now'])}.")
        rows.append(row)

    if kernel_log is not None:
        prov["sources"].append("kernel log (Xid lines)")
        by_bus = {r["bus"]: r for r in rows if r.get("bus")}
        for ev in parse_xid_log(kernel_log):
            target = by_bus.get(ev["bus"])
            if target is None and n == 1:
                target = rows[0]
            if target is None:
                prov["unattributed_xids"].append(ev)  # no nvidia-smi bus map: cannot pin it to a GPU
                continue
            if ev["xid"] not in target["xids"]:
                target["xids"].append(ev["xid"])
            prov["nvidia_findings"].append({"source": "kernel log", "gpu": target["index"], **ev})

    if nvlink:
        prov["sources"].append("dcgmi nvlink --errors (per GPU)")
        for doc in nvlink:
            nv = parse_dcgm_nvlink_json(doc)
            if nv["gpu"] is None or nv["gpu"] >= n:
                prov["notes"].append(f"NVLink output for GPU {nv['gpu']} does not match a GPU in this server; ignored.")
                continue
            rows[nv["gpu"]]["nvlink_errors"] = nv["total"]
            rows[nv["gpu"]]["nvlink_outlier_links"] = nvlink_outliers(nv["links"])
            worst = max(nv["links"].items(), key=lambda kv: sum(kv[1].values()), default=(None, {}))
            if worst[0] is not None and sum(worst[1].values()):
                prov["notes"].append(f"GPU {nv['gpu']}: {nv['total']} NVLink errors, most on link {worst[0]} ({worst[1]}).")
        for r in rows:  # a GPU with no NVLink output stays unknown, never zero
            if r["nvlink_errors"] is None:
                prov["notes"].append(f"GPU {r['index']}: no NVLink error output provided.")

    if smi_csv is not None:
        prov["sources"].append("nvidia-smi CSV query")
        for rec in parse_smi_csv(smi_csv):
            bus = _bus_key(rec.get("gpu_bus_id") or rec.get("pci.bus_id") or "")
            idx = rec.get("index")
            target = next((r for r in rows if (idx is not None and str(r["index"]) == str(idx)) or (bus and r.get("bus") == bus)), None)
            if target is None:
                continue
            for k_csv, k in (("remapped_rows.correctable", "remapped_rows_correctable"), ("remapped_rows.uncorrectable", "remapped_rows_uncorrectable")):
                if rec.get(k_csv) is not None and str(rec[k_csv]).isdigit():
                    target[k] = int(rec[k_csv])
            for k_csv, k in (("remapped_rows.pending", "remap_pending"), ("remapped_rows.failure", "remap_failure")):
                if rec.get(k_csv) is not None:
                    v = str(rec[k_csv]).strip().lower()
                    target[k] = v in ("yes", "true", "1")
            if rec.get("ecc.errors.corrected.volatile.dram") and str(rec["ecc.errors.corrected.volatile.dram"]).isdigit():
                target["ecc_correctable_30d"] = int(rec["ecc.errors.corrected.volatile.dram"])

    if d:
        prov["nvidia_findings"] = d["findings"] + prov["nvidia_findings"]
        prov["extras"] = d["extras"]
        tests = {k: (v if isinstance(v, str) else (v + ["skip"] * (n - len(v)))[:n]) for k, v in d["tests"].items()}
        level = d["run_level"]
    else:
        tests, level = {}, 0
        prov["notes"].append("No dcgmi diag output: the server is untested and can only be graded as untested.")

    ch = chassis or {}
    report = {"dcgm_version": d["meta"]["dcgm_version"] if d else None, "run_level": level, "tests": tests,
              "gpus": [{k: v for k, v in r.items() if k not in ("serial", "bus")} for r in rows],
              "chassis": {"power_on_hours": ch.get("power_on_hours", 0), "cosmetic": ch.get("cosmetic", "good"),
                          "faults": ch.get("faults", [])},
              "skipped_tests": d["skipped_entirely"] if d else [],
              "source": "nvidia"}
    prov["gpu_serials"] = {r["index"]: r["serial"] for r in rows if r.get("serial")}
    return report, prov
