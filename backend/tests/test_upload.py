from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
FLEET = Path(__file__).resolve().parent.parent / "data" / "recompute_synthetic_fleet.csv"


def upload(text, **params):
    return client.post("/assets/upload", params=params,
                       files={"file": ("inventory.csv", text.encode(), "text/csv")})


GOOD = """asset_id,model,site,asset_profile,health_pass,repairable,failed_part,repair_parts_cost,offer_today,dwell_days
SRV-1,8x A100 80GB,Phoenix AZ,a100_8x,true,,,,"$58,000",45
SRV-2,8x H100 80GB,Phoenix AZ,h100_8x,false,yes,PSU,500,,
SRV-3,8x A100 40GB,Tempe AZ,,TRUE,,,,,
"""


def test_upload_creates_assets_with_routes():
    r = upload(GOOD)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["added"] == 3 and body["dry_run"] is False
    assert [a["asset_id"] for a in body["assets"]] == ["SRV-1", "SRV-2", "SRV-3"]
    assert body["assets"][1]["route"] == "REPAIR"
    one = client.get("/assets/SRV-1").json()
    assert one["inputs"] == {"asset_profile": "a100_8x", "health_pass": True, "offer_today": 58000.0, "dwell_days": 45.0}
    assert one["state"] == "RECEIVED" and one["site"] == "Phoenix AZ"


def test_dry_run_saves_nothing():
    r = upload(GOOD, dry_run="true").json()
    assert r["would_add"] == 3 and r["added"] == 0
    assert client.get("/assets").json()["count"] == 0


def test_bad_rows_reject_whole_file_with_row_numbers():
    text = """asset_id,utilization,health_pass,gpus
OK-1,0.5,true,8
BAD-1,60,true,8
BAD-2,0.5,maybe,8
BAD-3,0.5,true,2.5
OK-1,0.5,true,8
"""
    r = upload(text)
    assert r.status_code == 422
    errs = r.json()["detail"]["errors"]
    got = {(e["row"], e["field"]) for e in errs}
    assert got == {(3, "utilization"), (4, "health_pass"), (5, "gpus"), (6, "asset_id")}
    assert client.get("/assets").json()["count"] == 0


def test_unknown_or_missing_columns():
    r = upload("asset_id,colo_per_kw_m\nA,300\n")
    assert r.status_code == 422 and r.json()["detail"]["unknown_columns"] == ["colo_per_kw_m"]
    assert upload("model\nx\n").status_code == 422
    assert upload("").status_code == 422
    assert upload("asset_id\n").status_code == 422


def test_existing_assets_error_or_skip():
    upload(GOOD)
    r = upload(GOOD)
    assert r.status_code == 422 and "already exists" in r.json()["detail"]["errors"][0]["error"]
    r = upload(GOOD, skip_existing="true").json()
    assert r["added"] == 0 and r["skipped"] == ["SRV-1", "SRV-2", "SRV-3"]


def test_synthetic_fleet_csv_uploads_and_matches_its_routes():
    r = upload(FLEET.read_text())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["added"] == 100
    assert set(body["ignored_columns"]) == {"route", "after_repair", "route_value", "sell_now_value", "gain_vs_baseline"}
    assert body["routes"] == {"SELL NOW": 40, "LIST AND WAIT": 34, "HARVEST": 11, "HOST LONGER": 9, "YIELD WHILE LISTED": 3, "REPAIR": 3}


def test_template_downloads_and_uploads_cleanly():
    t = client.get("/assets/upload/template")
    assert t.status_code == 200 and t.headers["content-type"].startswith("text/csv")
    r = upload(t.text, dry_run="true")
    assert r.status_code == 200, r.text
    assert r.json()["would_add"] == 2
