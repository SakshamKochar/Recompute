import pytest
from fastapi.testclient import TestClient

from app.fleet import load_fleet
from app.main import app
from app.output import checked_recommend
from app.repairs import repair_inputs, row_for

client = TestClient(app)


def create(asset_id, failed_part, model="8x A100 80GB", **inputs):
    r = client.post("/assets", json={"asset_id": asset_id, "model": model, "failed_part": failed_part,
                                     "inputs": {"health_pass": False, "repairable": True, **inputs}})
    assert r.status_code == 201, r.text
    return client.get(f"/assets/{asset_id}").json()


@pytest.mark.parametrize("part,profile,model,cost,days", [
    ("GPU", "a100_8x", "8x A100 80GB", 10829, 10),
    ("GPU", "a100_8x", "8x A100 40GB", 5900, 10),
    ("GPU", "h100_8x", "8x H100 80GB", 24500, 10),
    ("PSU", "a100_8x", None, 415, 3),
    ("power supply", "h100_8x", None, 415, 3),
    ("Fan", "a100_8x", None, 150, 2),
    ("NVMe drive", "a100_8x", None, 429, 3),
    ("NIC", "a100_8x", None, 599, 4),
    ("NIC", "h100_8x", None, 1191, 4),
    ("Memory module", "h100_8x", None, 2245, 2),
])
def test_table_lookup(part, profile, model, cost, days):
    row = row_for(part, profile, model)
    assert float(row["cost_usd"]) == cost and float(row["repair_days"]) == days


def test_failed_part_sets_repair_cost_and_route():
    psu = create("R-PSU", "PSU")
    assert psu["route"] == "REPAIR" and psu["after_repair"] == "LIST AND WAIT"
    assert psu["repair_pricing"]["filled"] == {"repair_parts_cost": 415.0, "repair_days": 3.0}
    assert "Repair costs $1,315" in psu["recommendation"]["result"]["audit"][0]
    assert psu["inputs"] == {"health_pass": False, "repairable": True}
    gpu = create("R-GPU", "GPU")
    assert gpu["route"] == "HARVEST"
    assert gpu["recommendation"]["result"]["base"]["REPAIR"] < psu["recommendation"]["result"]["base"]["REPAIR"]


def test_given_cost_wins_and_healthy_is_untouched():
    a = create("R-SET", "GPU", repair_parts_cost=500)
    assert a["repair_pricing"]["filled"] == {"repair_days": 10.0} and a["route"] == "REPAIR"
    healthy = {"health_pass": True}
    assert repair_inputs(healthy, "PSU") == (healthy, None)


def test_unknown_part_falls_back_to_model_default():
    a = create("R-UNK", "baseboard")
    assert a["repair_pricing"]["priced"] is False
    assert "Repair costs $11,729" in a["recommendation"]["result"]["audit"][0]


def test_upload_and_dry_run_use_the_table():
    csv_text = "asset_id,model,asset_profile,health_pass,repairable,failed_part\nU-1,8x H100 80GB,h100_8x,false,true,NIC\n"
    files = {"file": ("f.csv", csv_text.encode(), "text/csv")}
    dry = client.post("/assets/upload", params={"dry_run": "true"}, files=files).json()["assets"][0]
    real = client.post("/assets/upload", files=files).json()["assets"][0]
    assert dry == real and real["route"] == "REPAIR"
    rec = client.get("/assets/U-1").json()["recommendation"]
    assert "Repair costs $2,091" in rec["result"]["audit"][0]


def test_new_psu_price_changes_no_fleet_route():
    for a in load_fleet():
        if a["asset"]["failed_part"] == "PSU":
            inputs = {**a["inputs"], "repair_parts_cost": 415.0}
            assert checked_recommend(inputs)["route"] == a["summary"]["route"], a["asset"]["asset_id"]


@pytest.mark.parametrize("model,rate", [("8x A100 40GB", 1.26), ("8x A100 40 GB", 1.26), ("8x A100 80GB", 1.57),
                                        ("8x H100 80GB", 2.72), (None, 1.57)])
def test_a100_40gb_rents_at_126_everywhere(model, rate):
    profile = "h100_8x" if model and "H100" in model else "a100_8x"
    aid = f"R40-{abs(hash(str(model))) % 10000}"
    client.post("/assets", json={"asset_id": aid, "model": model, "inputs": {"asset_profile": profile}})
    a = client.get(f"/assets/{aid}", params={"confidence": "false"}).json()
    assert a["recommendation"]["result"]["daily_compute_margin"] == pytest.approx(
        checked_recommend({"asset_profile": profile, "rental_rate": rate})["daily_compute_margin"])
    assert (a["model_adjustments"] is not None) == (rate == 1.26)
    assert "rental_rate" not in a["inputs"]


def test_a100_40gb_given_rate_wins_and_upload_applies_it():
    client.post("/assets", json={"asset_id": "R40-SET", "model": "8x A100 40GB", "inputs": {"rental_rate": 2.0}})
    assert client.get("/assets/R40-SET", params={"confidence": "false"}).json()["model_adjustments"] is None
    csv_text = "asset_id,model\nU40,8x A100 40GB\n"
    files = {"file": ("f.csv", csv_text.encode(), "text/csv")}
    dry = client.post("/assets/upload", params={"dry_run": "true"}, files=files).json()["assets"][0]
    real = client.post("/assets/upload", files=files).json()["assets"][0]
    assert dry == real
    rec = client.get("/assets/U40", params={"confidence": "false"}).json()["recommendation"]
    assert rec["result"]["daily_compute_margin"] == pytest.approx(checked_recommend({"rental_rate": 1.26})["daily_compute_margin"])
