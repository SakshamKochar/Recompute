import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def event(asset_id, name, **kw):
    r = client.post(f"/assets/{asset_id}/events", json={"event": name, **kw})
    assert r.status_code == 200, r.text
    return r


def dash(**params):
    r = client.get("/dashboard", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_empty_database():
    d = dash()
    assert d["total_assets"] == 0 and d["open_assets"] == 0
    assert set(d["by_state"].values()) == {0}
    assert d["action_items"] == [] and d["recent_activity"] == []


def test_seeded_fleet_matches_fleet_endpoint():
    client.post("/fleet/seed")
    d = dash()
    fleet = client.get("/fleet").json()
    assert d["total_assets"] == 100 and d["open_assets"] == 100
    assert d["by_state"]["RECEIVED"] == 100
    assert d["by_route"] == fleet["routes"]
    assert d["open_value"]["gain_vs_baseline"] == pytest.approx(fleet["total_gain_vs_baseline"], abs=1)
    assert d["action_counts"] == {"awaiting_decision": 100}
    assert d["action_items"] == []
    assert len(dash(include_awaiting="true")["action_items"]) == 100
    assert all(a["at"].endswith("+00:00") for a in d["recent_activity"])
    assert len(d["recent_activity"]) == 10


def test_action_items_route_changed_at_risk_and_override():
    client.post("/fleet/seed")
    for e in ("list", "activate", "start_compute"):
        event("SYN-003", e)
    client.patch("/assets/SYN-003/inputs", json={"colo_per_kw_mo": 448, "exit_days": 10})
    event("SYN-001", "list")
    event("SYN-001", "activate", override=True, note="demo override")

    listed = dash()["action_items"]
    assert [i["kind"] for i in listed] == ["sale_at_risk", "route_changed", "route_changed", "overridden"]
    items = {(i["asset_id"], i["kind"]) for i in listed}
    assert ("SYN-003", "route_changed") in items
    assert ("SYN-003", "sale_at_risk") in items
    assert ("SYN-001", "overridden") in items
    assert ("SYN-001", "route_changed") in items
    assert ("SYN-003", "awaiting_decision") not in items


def test_sold_assets_leave_open_value_and_recent_is_newest_first():
    client.post("/assets", json={"asset_id": "S1", "inputs": {"offer_today": 65500, "market_price": 66000, "dwell_days": 5}})
    before = dash()["open_value"]["recommended"]
    event("S1", "list")
    event("S1", "sell")
    d = dash()
    assert d["open_assets"] == 0 and d["by_state"]["SOLD"] == 1
    assert before > 0 and d["open_value"]["recommended"] == 0
    assert [a["event"] for a in d["recent_activity"]] == ["sell", "list", "received"]


def test_filters():
    client.post("/fleet/seed")
    client.post("/assets", json={"asset_id": "REAL-1"})
    assert dash(include_synthetic="false")["total_assets"] == 1
    assert dash(recent=0)["recent_activity"] == []
    assert client.get("/dashboard", params={"recent": 500}).status_code == 422


def test_error_codes_are_documented():
    paths = client.get("/openapi.json").json()["paths"]
    assert {"404", "409"} <= set(paths["/assets/{asset_id}/events"]["post"]["responses"])
    assert "413" in paths["/assets/upload"]["post"]["responses"]
    assert "404" in paths["/fleet/{asset_id}"]["get"]["responses"]
