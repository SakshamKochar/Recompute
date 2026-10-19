from fastapi.testclient import TestClient

from app.checks import decision_confidence, warnings
from app.main import app

client = TestClient(app)


def codes(inputs):
    return [w["code"] for w in warnings(inputs)]


def test_defaults_have_no_warnings():
    assert codes({}) == [] and codes({"asset_profile": "h100_8x"}) == []


def test_three_warnings():
    assert codes({"first_month_utilization": 0.7}) == ["first_month_above_steady"]
    assert codes({"offer_today": 120000}) == ["offer_above_market"]
    assert codes({"harvest_value": 150000}) == ["harvest_above_market"]
    assert codes({"repairable": True, "health_pass": True}) == []


def test_warnings_do_not_change_the_result():
    r = client.post("/recommend", json={"offer_today": 120000}).json()
    assert [w["code"] for w in r["warnings"]] == ["offer_above_market"]
    assert len(r["result"]) == 9 and "decision_confidence" not in r


def test_decision_confidence_levels():
    a100, h100 = decision_confidence({}), decision_confidence({"asset_profile": "h100_8x"})
    assert a100["level"] == "Medium" and 0.05 <= a100["smallest_move"] < 0.20
    assert h100["level"] == "Low" and h100["smallest_move"] < 0.05
    assert h100["drivers"][0]["input"] == "dwell_days"
    assert "hypothesis" in a100["basis"].lower()


def test_confidence_skipped_for_failed_servers():
    c = decision_confidence({"health_pass": False})
    assert c["level"] is None and "failed server" in c["note"]


def test_confidence_on_recommend_and_asset_detail():
    r = client.post("/recommend", params={"flip_points": "true"}, json={"asset_profile": "h100_8x"}).json()
    assert r["decision_confidence"]["level"] == "Low"
    client.post("/assets", json={"asset_id": "C1"})
    assert client.get("/assets/C1").json()["decision_confidence"]["level"] == "Medium"
    assert "decision_confidence" not in client.get("/assets/C1", params={"confidence": "false"}).json()


def test_warnings_on_upload_rows_and_csv():
    csv_text = "asset_id,offer_today,market_price\nW-1,99000,90000\nW-2,,\n"
    body = client.post("/assets/upload", files={"file": ("w.csv", csv_text.encode(), "text/csv")}).json()
    rows = {a["asset_id"]: a for a in body["assets"]}
    assert [w["code"] for w in rows["W-1"]["warnings"]] == ["offer_above_market"] and rows["W-2"]["warnings"] == []
    text = client.get(f"/batches/{body['batch_id']}/results.csv").text
    assert "offer_above_market" in text
