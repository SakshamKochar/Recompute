"""Regression tests for the pre-push review findings."""
import io
import tarfile
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.diagnostics_api as dapi
from app.main import app

client = TestClient(app)
DEMO = Path(__file__).resolve().parent.parent / "data" / "demo_inputs"


def tgz(entries):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        for info, data in entries:
            t.addfile(info, io.BytesIO(data) if data is not None else None)
    return buf.getvalue()


def demo_entries(seller, replace=None):
    out = []
    for f in (DEMO / seller).iterdir():
        if f.name == "README.md":
            continue
        data = (replace or {}).get(f.name, f.read_bytes())
        info = tarfile.TarInfo(f"cap/{f.name}")
        info.size = len(data)
        out.append((info, data))
    return out


def diagnose(data, **params):
    return client.post("/assets/diagnose", params=params, data={"asset_id": "RV-1", "model": "8x A100 40GB"},
                       files={"file": ("c.tar.gz", data, "application/gzip")})


def test_fifo_in_capture_is_refused():
    fifo = tarfile.TarInfo("cap/nvidia_smi.xml")
    fifo.type = tarfile.FIFOTYPE
    r = diagnose(tgz([(fifo, None)]))
    assert r.status_code == 422 and "unsupported" in r.json()["detail"]


def test_no_temp_folders_left_behind():
    before = set(Path(tempfile.gettempdir()).glob("recompute_capture_*"))
    for _ in range(3):
        diagnose(tgz(demo_entries("kabir")), dry_run="true")
        diagnose(b"junk")
    assert set(Path(tempfile.gettempdir()).glob("recompute_capture_*")) == before


def test_capture_size_limit(monkeypatch):
    monkeypatch.setattr(dapi, "MAX_EXTRACTED", 1000)
    r = diagnose(tgz(demo_entries("kabir")))
    assert r.status_code == 422 and "50 MB" in r.json()["detail"]


def test_odd_captures_are_422_not_500():
    assert diagnose(tgz(demo_entries("kabir", {"chassis.json": b"{not json"}))).status_code == 422
    d = tarfile.TarInfo("cap/nvidia_smi.xml")
    d.type = tarfile.DIRTYPE
    assert diagnose(tgz(demo_entries("kabir")[:1] + [(d, None)])).status_code == 422


def test_huge_money_is_rejected_and_pages_stay_up():
    csv_text = "asset_id,market_price,offer_today\n" + "".join(f"H{i},1e308,1e308\n" for i in range(3))
    r = client.post("/assets/upload", files={"file": ("h.csv", csv_text.encode(), "text/csv")})
    assert r.status_code == 422
    assert client.get("/batches").status_code == 200 and client.get("/dashboard").status_code == 200


def test_repair_transition_logs_the_priced_repair():
    client.post("/assets", json={"asset_id": "RP", "failed_part": "PSU", "inputs": {"health_pass": False}})
    d = client.post("/assets/RP/events", json={"event": "repair"}).json()["transition"]["details"]
    assert d["repair_cost"] == 1315 and d["repair_days"] == 3


def test_repaired_server_comes_back_healthy():
    client.post("/assets", json={"asset_id": "RH", "failed_part": "PSU",
                                 "inputs": {"health_pass": False, "dwell_days": 60, "activation_cost": 400,
                                            "first_month_utilization": 0.6, "market_decay_pct_mo": 0.02}})
    assert client.get("/assets/RH").json()["after_repair"] == "YIELD WHILE LISTED"
    client.post("/assets/RH/events", json={"event": "repair"})
    a = client.post("/assets/RH/events", json={"event": "list"}).json()["asset"]
    assert a["route"] == "YIELD WHILE LISTED" and a["failed"] is False
    assert "repair" not in a["allowed_events"] + a["override_events"] and "activate" in a["allowed_events"]


def test_40_gb_with_a_space_prices_a_40gb_gpu():
    r = client.post("/assets", json={"asset_id": "G40", "model": "8x A100 40 GB", "failed_part": "GPU",
                                     "inputs": {"health_pass": False}})
    assert client.get("/assets/G40").json()["repair_pricing"]["table_row"] == "GPU A100 40GB"


def test_multi_fault_capture_reports_engine_pricing():
    chassis = (DEMO / "kabir" / "chassis.json").read_text().replace(
        '"faults": [', '"faults": [{"part": "Fan", "slot": 1, "detail": "fan 1 stopped"}, ')
    r = diagnose(tgz(demo_entries("kabir", {"chassis.json": chassis.encode()})))
    assert r.status_code == 201, r.text
    a = client.get("/assets/RV-1").json()
    assert a["failed_part"] == "Fan, PSU" and a["repair_pricing"]["source"] == "inputs"
    assert a["inputs"]["repair_parts_cost"] == 565


def test_totals_are_rounded_everywhere():
    client.post("/fleet/seed")
    assert client.get("/fleet").json()["total_gain_vs_baseline"] == 545788.66
    ov = client.get("/dashboard").json()["open_value"]
    assert all(round(v, 2) == v for v in ov.values())


def test_unneeded_override_is_not_recorded():
    client.post("/assets", json={"asset_id": "OV"})
    t = client.post("/assets/OV/events", json={"event": "list", "override": True, "note": "x"}).json()["transition"]
    assert t["override"] is False
    assert not [i for i in client.get("/dashboard").json()["action_items"] if i["kind"] == "overridden"]


def test_oversized_csv_field_is_422():
    csv_text = "asset_id,site\nX1," + "a" * 140_000 + "\n"
    assert client.post("/assets/upload", files={"file": ("x.csv", csv_text.encode(), "text/csv")}).status_code == 422


def test_scenario_light_mode_matches_full():
    client.post("/fleet/seed")
    s = client.get("/batches/SYN-FLEET/scenarios").json()["scenarios"]
    assert s["bear"]["gain_vs_baseline"] == pytest.approx(195828, abs=1) and s["bull"]["gain_vs_baseline"] == pytest.approx(3288718, abs=1)


def test_dot_rooted_archive_is_accepted():
    root = tarfile.TarInfo(".")
    root.type = tarfile.DIRTYPE
    entries = [(root, None)] + [(tarfile.TarInfo("./" + i.name.split("/", 1)[1]), d) for i, d in demo_entries("kabir")]
    for (info, d) in entries[1:]:
        info.size = len(d)
    r = diagnose(tgz(entries), dry_run="true")
    assert r.status_code == 201, r.text
    assert r.json()["diagnostics"]["grade"] == "C"


def test_too_many_entries_stops_early(monkeypatch):
    monkeypatch.setattr(dapi, "MAX_MEMBERS", 5)
    many = []
    for i in range(50):
        info = tarfile.TarInfo(f"cap/f{i}")
        info.size = 0
        many.append((info, b""))
    r = diagnose(tgz(many))
    assert r.status_code == 422 and "more than 5 entries" in r.json()["detail"]


def test_error_messages_hide_server_paths():
    d = tarfile.TarInfo("cap/nvidia_smi.xml")
    d.type = tarfile.DIRTYPE
    detail = diagnose(tgz(demo_entries("kabir")[:1] + [(d, None)])).json()["detail"]
    assert "/tmp" not in detail


def test_huge_header_field_is_422():
    csv_text = "asset_id," + "a" * 140_000 + "\nX1,1\n"
    assert client.post("/assets/upload", files={"file": ("x.csv", csv_text.encode(), "text/csv")}).status_code == 422
