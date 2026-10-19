"""Raw simulated marketplace listings."""
from .diagnostics import expected_tests

def suite(level, overrides=None, n=8):
    """All tests a DCGM run at this level performs, every GPU passing unless overridden.
    overrides: {test: {gpu_index: "warn" | "fail"}}. software is one system-level result."""
    out = {}
    for t in expected_tests(level):
        out[t] = "pass" if t == "software" else ["pass"] * n
    for t, per_gpu in (overrides or {}).items():
        for g, r in per_gpu.items():
            out[t][g] = r
    return out

def gpus(n=8, **per_gpu):
    """Per-GPU telemetry. per_gpu: g3={...} sets fields on GPU 3. Unset fields mean zero or clean."""
    rows = []
    for i in range(n):
        base = {"index": i, "ecc_correctable_30d": 0, "remapped_rows_correctable": 0,
                "remapped_rows_uncorrectable": 0, "remap_pending": False, "remap_failure": False,
                "xids": [], "clock_events": {}, "nvlink_errors": 0, "pcie_replays": 0}
        base.update(per_gpu.get(f"g{i}", {}))
        rows.append(base)
    return rows

def report(level, hours, cosmetic, tests=None, gpu_rows=None, faults=None, dcgm="4.6"):
    return {"dcgm_version": dcgm, "run_level": level, "tests": tests or suite(level),
            "gpus": gpu_rows or gpus(), "chassis": {"power_on_hours": hours, "cosmetic": cosmetic, "faults": faults or []}}

def load_nvidia_inputs(seller):
    """The demo sellers' reports come from NVIDIA-format files through the same reader real output uses."""
    import json
    from pathlib import Path
    from .nvidia_reader import build_report
    d = Path(__file__).resolve().parents[1] / "data/demo_inputs" / seller
    rep, prov = build_report(dcgm=(d / "dcgm_diag.json").read_text(encoding="utf-8"), smi_xml=(d / "nvidia_smi.xml").read_text(encoding="utf-8"),
                             kernel_log=(d / "kernel.log").read_text(encoding="utf-8"), chassis=json.loads((d / "chassis.json").read_text(encoding="utf-8")))
    return rep, prov


NVIDIA_PROVENANCE = {}
for _s in ("saksham", "shauryaa", "swayam", "kabir"):
    _rep, NVIDIA_PROVENANCE[_s] = load_nvidia_inputs(_s)

# Hand-written reports kept only as a reference for the unit tests (same evidence, engine format).
# SIMULATED test reports. Each one is written to read like a real DCGM run plus nvidia-smi
# memory telemetry, and the grade follows from it through engine/diagnostics.py.
REPORTS = {
    # Clean, young, full level-4 run: nothing to deduct.
    "saksham": report(4, 7200, "like_new", gpu_rows=gpus(g0={"ecc_correctable_30d": 12}, g5={"ecc_correctable_30d": 8})),
    # 2.5 years of service: wear plus three memory rows the GPUs fixed themselves.
    "shauryaa": report(4, 17000, "good", gpu_rows=gpus(g2={"remapped_rows_correctable": 2, "ecc_correctable_30d": 40},
                                                       g6={"remapped_rows_correctable": 1})),
    # Rented hard for 40 months: one targeted-power warning on GPU 3, a few correctable remaps,
    # two software thermal slowdowns, and one remap waiting for a GPU reset.
    "swayam": report(4, 22000, "good", tests=suite(4, {"targeted_power": {3: "warn"}}),
                     gpu_rows=gpus(g3={"remapped_rows_correctable": 3, "remap_pending": True, "clock_events": {"SW_THERMAL": 2}, "ecc_correctable_30d": 60})),
    # A power supply failed. With redundancy lost, the operator stopped at level 3 (the level-4
    # pulse test stresses power delivery), and two GPUs hit hardware power-brake slowdowns.
    "kabir": report(3, 18000, "good",
                    gpu_rows=gpus(g1={"clock_events": {"HW_POWER_BRAKE": 1}}, g4={"clock_events": {"HW_POWER_BRAKE": 1}}),
                    faults=[{"part": "PSU", "slot": 2, "detail": "power supply 2 reports no output; the server runs on the remaining supplies without redundancy"}]),
}

REPORTS_HANDWRITTEN = REPORTS
REPORTS = {k: load_nvidia_inputs(k)[0] for k in ("saksham", "shauryaa", "swayam", "kabir")}
SEED_LISTINGS=[
{"id":"saksham","seller_id":"saksham","display_name":"Saksham","title":"8x H100 80GB SXM Server","asset_profile":"h100_8x","gpu_model":"H100","gpu_count":8,"gpu_memory_gb":80,"system_power_kw":10.2,"form_factor":"SXM","age_months":14,"power_on_hours":7200,"site":"Phoenix AZ","ownership":"owned","report":REPORTS["saksham"],"rental":{"utilization":0.68,"more_than_30_days":True,"currently_rented":True},"repairable":False,"sanitization":"NIST SP 800-88 purge before shipment","accessories":"Rails and power cables"},
{"id":"shauryaa","seller_id":"shauryaa","display_name":"Shauryaa","title":"8x A100 80GB SXM Server","asset_profile":"a100_8x","gpu_model":"A100","gpu_count":8,"gpu_memory_gb":80,"system_power_kw":6.5,"form_factor":"SXM","age_months":30,"power_on_hours":17000,"site":"Dallas TX","ownership":"owned","report":REPORTS["shauryaa"],"rental":None,"repairable":False,"sanitization":"NIST SP 800-88 purge complete","accessories":"Rails and power cables"},
{"id":"swayam","seller_id":"swayam","display_name":"Swayam","title":"8x A100 80GB SXM Server","asset_profile":"a100_8x","gpu_model":"A100","gpu_count":8,"gpu_memory_gb":80,"system_power_kw":6.5,"form_factor":"SXM","age_months":40,"power_on_hours":22000,"site":"Atlanta GA","ownership":"client_approved","report":REPORTS["swayam"],"rental":{"utilization":0.64,"more_than_30_days":True,"currently_rented":True},"repairable":False,"sanitization":"NIST SP 800-88 purge before shipment","accessories":"Rails"},
{"id":"kabir","seller_id":"kabir","display_name":"Kabir","title":"8x A100 40GB SXM Server","asset_profile":"a100_8x","gpu_model":"A100","gpu_count":8,"gpu_memory_gb":40,"system_power_kw":6.5,"form_factor":"SXM","age_months":40,"power_on_hours":18000,"site":"Columbus OH","ownership":"owned","model_overrides":{"rental_rate":1.26},"report":REPORTS["kabir"],"rental":None,"repairable":True,"sanitization":"NIST SP 800-88 purge complete","accessories":"Rails and power cables"}]
