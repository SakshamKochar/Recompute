import io
import tarfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
DEMO = Path(__file__).resolve().parent.parent / "data" / "demo_inputs"


def capture(seller):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        for f in (DEMO / seller).iterdir():
            if f.name != "README.md":
                t.add(f, arcname=f"capture/{f.name}")
    return buf.getvalue()


def post(data, asset_id="SRV-9", model="8x A100 40GB", **params):
    return client.post("/assets/diagnose", params=params, data={"asset_id": asset_id, "model": model},
                       files={"file": ("capture.tar.gz", data, "application/gzip")})


@pytest.mark.parametrize("seller,grade,confidence,route", [
    ("SAKSHAM", "A+", "High", "SELL NOW"), ("SHAURYAA", "A", "High", "SELL NOW"),
    ("SWAYAM", "B", "High", "SELL NOW"), ("KABIR", "C", "Good", "REPAIR")])
def test_demo_sellers(seller, grade, confidence, route):
    assert client.post("/demo/sellers").json()["batch_id"] == "DEMO-SELLERS"
    a = client.get(f"/assets/DEMO-{seller}").json()
    assert a["diagnostics"]["grade"] == grade == a["grade"]
    assert a["diagnostics"]["evidence_confidence"] == confidence and a["diagnostics"]["simulated"] is True
    assert a["route"] == route and a["batch_id"] == "DEMO-SELLERS"


def test_demo_sellers_twice_and_batch_totals():
    first, second = client.post("/demo/sellers").json(), client.post("/demo/sellers").json()
    assert len(first["added"]) == 4 and second["added"] == [] and len(second["skipped"]) == 4
    assert client.get("/batches/DEMO-SELLERS").json()["totals"]["count"] == 4


def test_failed_server_from_capture():
    r = post(capture("kabir"))
    assert r.status_code == 201, r.text
    a = client.get("/assets/SRV-9").json()
    assert a["failed_part"] == "PSU" and a["route"] == "REPAIR" and a["after_repair"] == "SELL NOW"
    i = a["inputs"]
    assert i["health_pass"] is False and i["repair_parts_cost"] == 415 and i["repair_days"] == 3
    assert i["market_price"] == 60600 and i["offer_today"] == 57600 and i["dwell_days"] == 43
    assert i["rental_rate"] == 1.26 and i["harvest_value"] == pytest.approx(46203.57)
    d = a["diagnostics"]
    assert d["grade"] == "C" and d["priced_at_grade"] == "A" and d["findings"]
    assert d["provenance"]["sources"] and "simulated" not in d


def test_healthy_server_keeps_default_repair_numbers():
    post(capture("saksham"), asset_id="SRV-H", model="8x H100 80GB")
    i = client.get("/assets/SRV-H").json()["inputs"]
    assert i["asset_profile"] == "h100_8x" and i["market_price"] == 268500 and i["offer_today"] == 260400
    assert "repair_parts_cost" not in i


def test_dry_run_saves_nothing():
    r = post(capture("kabir"), dry_run="true").json()
    assert r["dry_run"] is True and r["result"]["route"] == "REPAIR"
    assert client.get("/assets/SRV-9").status_code == 404


def test_bad_inputs():
    assert post(b"not a tarball").status_code == 422
    r = post(capture("kabir"), model="8x B200")
    assert r.status_code == 422 and "A100 80GB" in r.json()["detail"]
    assert post(capture("kabir")).status_code == 201
    assert post(capture("kabir")).status_code == 409


def test_unsafe_archive_is_refused():
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        info = tarfile.TarInfo("../escape.json")
        info.size = 2
        t.addfile(info, io.BytesIO(b"{}"))
    r = post(buf.getvalue())
    assert r.status_code == 422 and "unsafe" in r.json()["detail"]


@pytest.mark.parametrize("seller,score", [("SAKSHAM", 100), ("SHAURYAA", 91), ("SWAYAM", 80), ("KABIR", 72)])
def test_demo_scores_match_saksham(seller, score):
    client.post("/demo/sellers")
    assert client.get(f"/assets/DEMO-{seller}", params={"confidence": "false"}).json()["diagnostics"]["score"] == score
