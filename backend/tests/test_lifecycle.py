from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

YIELD_INPUTS = {"dwell_days": 60, "activation_cost": 400, "first_month_utilization": 0.60, "market_decay_pct_mo": 0.02}


def create(asset_id, inputs=None, **extra):
    r = client.post("/assets", json={"asset_id": asset_id, "model": "8x A100 80GB", "inputs": inputs or {}, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def event(asset_id, name, **kw):
    return client.post(f"/assets/{asset_id}/events", json={"event": name, **kw})


def test_create_runs_model_and_logs_intake():
    a = create("A1")
    assert a["state"] == "RECEIVED"
    assert a["route"] == "LIST AND WAIT"
    assert a["recommendation"]["model_version"] == "0.9"
    assert a["allowed_events"] == ["list"]
    assert a["override_events"] == ["harvest", "recycle"]
    h = client.get("/assets/A1/history").json()["events"]
    assert [e["type"] for e in h] == ["recommendation", "transition"]
    assert h[1]["event"] == "received"


def test_create_rejects_duplicates_and_bad_inputs():
    create("A1")
    assert client.post("/assets", json={"asset_id": "A1"}).status_code == 409
    assert client.post("/assets", json={"asset_id": "A2", "inputs": {"colo_per_kw_m": 1}}).status_code == 422
    assert client.post("/assets", json={"asset_id": "bad id!"}).status_code == 422
    assert client.get("/assets/NOPE").status_code == 404


def test_yield_while_listed_full_cycle():
    a = create("Y1", YIELD_INPUTS)
    assert a["route"] == "YIELD WHILE LISTED"
    for name, state in [("list", "LISTED"), ("activate", "ACTIVATING"), ("start_compute", "COMPUTING"),
                        ("buyer_found", "DRAINING"), ("drained", "SANITIZING"), ("sell", "SOLD")]:
        r = event("Y1", name)
        assert r.status_code == 200, (name, r.text)
        assert r.json()["asset"]["state"] == state
        if name == "buyer_found":
            d = r.json()["transition"]["details"]
            assert d["exit_days"] == 3 and d["buyer_window_days"] == 9 and d["at_risk"] is False
    final = client.get("/assets/Y1").json()
    assert final["allowed_events"] == [] and final["override_events"] == []
    assert event("Y1", "list").status_code == 409
    assert client.patch("/assets/Y1/inputs", json={"dwell_days": 10}).status_code == 409
    states = [e["to_state"] for e in client.get("/assets/Y1/history").json()["events"] if e["type"] == "transition"]
    assert states == ["RECEIVED", "LISTED", "ACTIVATING", "COMPUTING", "DRAINING", "SANITIZING", "SOLD"]


def test_activate_against_recommendation_needs_override_with_note():
    create("S1", {"offer_today": 65500, "market_price": 66000, "dwell_days": 5})
    event("S1", "list")
    r = event("S1", "activate")
    assert r.status_code == 409 and "SELL NOW" in r.json()["detail"]
    assert event("S1", "activate", override=True).status_code == 422
    r = event("S1", "activate", override=True, note="Demo: operator chose to test compute")
    assert r.status_code == 200
    assert r.json()["transition"]["override"] is True
    assert r.json()["transition"]["route_at_time"] == "SELL NOW"


def test_consigned_asset_can_never_activate():
    create("C1", {"ownership": "consigned"})
    event("C1", "list")
    c1 = client.get("/assets/C1").json()
    assert "activate" not in c1["allowed_events"] + c1["override_events"]
    r = event("C1", "activate", override=True, note="trying anyway")
    assert r.status_code == 409 and "override not allowed" in r.json()["detail"]


def test_invalid_transitions():
    create("X1")
    assert event("X1", "sell").status_code == 409
    assert event("X1", "teleport").status_code == 422
    assert event("X1", "buyer_found").status_code == 409


def test_failed_server_repair_path():
    a = create("R1", {"health_pass": False, "repairable": True, "repair_parts_cost": 500}, failed_part="PSU")
    assert a["route"] == "REPAIR"
    r1 = client.get("/assets/R1").json()
    assert r1["allowed_events"] == ["repair"]
    assert r1["override_events"] == ["list", "harvest", "recycle"]
    assert event("R1", "list").status_code == 409
    r = event("R1", "repair")
    assert r.status_code == 200 and r.json()["transition"]["details"]["repair_cost"] == 1400
    assert event("R1", "list").status_code == 200
    create("R2")
    assert event("R2", "repair").status_code == 409


def test_patch_inputs_reruns_model():
    create("P1")
    r = client.patch("/assets/P1/inputs", json={"asset_profile": "h100_8x"})
    assert r.status_code == 200
    assert r.json()["route"] == "SELL NOW"
    assert r.json()["inputs"] == {"asset_profile": "h100_8x"}
    assert client.patch("/assets/P1/inputs", json={"pue": 9}).status_code == 422
    assert client.patch("/assets/P1/inputs", json={"typo": 1}).status_code == 422
    recs = [e for e in client.get("/assets/P1/history").json()["events"] if e["type"] == "recommendation"]
    assert [r["route"] for r in recs] == ["LIST AND WAIT", "SELL NOW"]


def test_seed_fleet_and_filters():
    assert client.post("/fleet/seed").json() == {"added": 100, "skipped": 0, "batch_id": "SYN-FLEET"}
    assert client.post("/fleet/seed").json() == {"added": 0, "skipped": 100, "batch_id": "SYN-FLEET"}
    assert client.get("/assets", params={"state": "RECEIVED"}).json()["count"] == 100
    assert client.get("/assets", params={"route": "HOST LONGER"}).json()["count"] == 9
    assert client.get("/assets", params={"state": "FLYING"}).status_code == 422
    one = client.get("/assets/SYN-001").json()
    assert one["synthetic"] is True and one["site"] == "Columbus OH"
