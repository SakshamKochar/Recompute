"""Backend additions for the frontend integration: scenario recommend, selected route, outcomes, market evidence, CORS."""
from fastapi.testclient import TestClient

from app.main import app, cors_origins
from app.recompute_model import apply_scenario, recommend

client = TestClient(app)

YIELD_INPUTS = {"dwell_days": 60, "activation_cost": 400, "first_month_utilization": 0.60, "market_decay_pct_mo": 0.02}


def create(asset_id, inputs=None, **extra):
    r = client.post("/assets", json={"asset_id": asset_id, "model": "8x A100 80GB", "inputs": inputs or {}, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def event(asset_id, name, **kw):
    return client.post(f"/assets/{asset_id}/events", json={"event": name, **kw})


# ---- /recommend?scenario= --------------------------------------------------------------------------------------

def test_recommend_without_scenario_is_unchanged():
    r = client.post("/recommend", json={"utilization": 0.7}).json()
    assert "scenario" not in r
    assert r["inputs"] == {"utilization": 0.7}
    assert r["result"]["route"] == recommend({"utilization": 0.7})["route"]


def test_recommend_scenario_matches_saksham_apply_scenario():
    for s in ("bear", "base", "bull"):
        for profile in ("a100_8x", "h100_8x"):
            body = {"asset_profile": profile, "utilization": 0.6}
            r = client.post(f"/recommend?scenario={s}", json=body).json()
            want_inputs = apply_scenario(body, s)
            assert r["scenario"] == s
            assert r["inputs"] == want_inputs
            assert r["result"] == recommend(want_inputs)


def test_recommend_bear_moves_value_down_and_bull_up():
    vals = {s: client.post(f"/recommend?scenario={s}", json={}).json()["result"] for s in ("bear", "base", "bull")}
    best = {s: v["base"][v["route"]] for s, v in vals.items()}
    assert best["bear"] < best["base"] < best["bull"]


def test_recommend_rejects_unknown_scenario():
    assert client.post("/recommend?scenario=crash", json={}).status_code == 422


def test_meta_lists_scenarios():
    m = client.get("/meta").json()
    assert set(m["scenarios"]["combined"]) == {"bear", "base", "bull"}
    assert m["scenarios"]["dials"]["electricity"]["high"] == {"kind": "set", "changes": {"elec_per_kwh": 0.1354}}


# ---- selected_route --------------------------------------------------------------------------------------------

def test_selected_route_is_recorded_and_exposed():
    create("Y1", YIELD_INPUTS)
    r = event("Y1", "list", selected_route="YIELD WHILE LISTED")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["transition"]["details"]["selected_route"] == "YIELD WHILE LISTED"
    assert body["asset"]["selected_route"] == "YIELD WHILE LISTED"
    assert body["asset"]["route"] == "YIELD WHILE LISTED"
    listed = client.get("/assets").json()["assets"][0]
    assert listed["selected_route"] == "YIELD WHILE LISTED"


def test_selected_route_must_be_eligible():
    create("C1", {"ownership": "consigned"})
    r = event("C1", "list", selected_route="HOST LONGER")
    assert r.status_code == 409
    assert "not eligible" in r.json()["detail"]
    assert client.get("/assets/C1").json()["state"] == "RECEIVED"


def test_selected_route_rejects_unknown_route():
    create("A1")
    assert event("A1", "list", selected_route="MOON").status_code == 422


def test_selected_route_does_not_bypass_override_rules():
    create("S1", {"offer_today": 65500, "market_price": 66000, "dwell_days": 5})
    assert client.get("/assets/S1").json()["route"] == "SELL NOW"
    assert event("S1", "list", selected_route="HOST LONGER").status_code == 200
    r = event("S1", "activate")
    assert r.status_code == 409
    assert event("S1", "activate", override=True, note="client wants a quarter of hosting").status_code == 200


# ---- outcomes --------------------------------------------------------------------------------------------------

def walk_to_sold(asset_id):
    for e in ("list", "activate", "start_compute", "buyer_found", "drained", "sell"):
        assert event(asset_id, e).status_code == 200, e


def test_outcome_requires_final_state():
    create("Y1", YIELD_INPUTS)
    r = client.post("/assets/Y1/outcomes", json={"realized_value": 70000})
    assert r.status_code == 409
    assert "RECEIVED" in r.json()["detail"]


def test_outcome_records_against_terminal_transition_and_allows_losses():
    create("Y1", YIELD_INPUTS)
    walk_to_sold("Y1")
    r = client.post("/assets/Y1/outcomes", json={"realized_value": -1250.5, "note": "buyer returned it damaged"})
    assert r.status_code == 201, r.text
    o = r.json()["outcome"]
    assert o["realized_value"] == -1250.5
    sold = [t for t in client.get("/assets/Y1/history").json()["events"] if t["type"] == "transition"][-1]
    assert sold["to_state"] == "SOLD" and o["transition_id"] == sold["id"]
    assert client.get("/assets/Y1").json()["outcome"]["realized_value"] == -1250.5


def test_outcome_validation():
    create("Y1", YIELD_INPUTS)
    walk_to_sold("Y1")
    assert client.post("/assets/Y1/outcomes", json={"realized_value": "lots"}).status_code == 422
    assert client.post("/assets/Y1/outcomes", json={"realized_value": 2e9}).status_code == 422
    assert client.post("/assets/Y1/outcomes", json={}).status_code == 422
    assert client.post("/assets/Y1/outcomes", json={"realized_value": 1, "extra": 1}).status_code == 422
    assert client.post("/assets/NOPE/outcomes", json={"realized_value": 1}).status_code == 404


def test_outcome_corrections_are_appended_not_overwritten():
    create("H1", {"health_pass": False, "repairable": False})
    assert event("H1", "harvest").status_code == 200
    client.post("/assets/H1/outcomes", json={"realized_value": 60000})
    client.post("/assets/H1/outcomes", json={"realized_value": 61000, "note": "final invoice"})
    hist = [e for e in client.get("/assets/H1/history").json()["events"] if e["type"] == "outcome"]
    assert [o["realized_value"] for o in hist] == [60000, 61000]
    entry = client.get("/outcomes").json()["entries"][0]
    assert entry["outcome"]["realized_value"] == 61000
    assert entry["outcome_corrections"] == 1


def test_ledger_ties_outcome_to_decision_time_recommendation():
    create("Y1", YIELD_INPUTS)
    rec = client.get("/assets/Y1").json()["recommendation"]
    walk_to_sold("Y1")
    client.post("/assets/Y1/outcomes", json={"realized_value": 70000})
    led = client.get("/outcomes").json()
    e = led["entries"][0]
    assert e["decision"]["recommendation"]["id"] == rec["id"]
    assert e["decision"]["recommendation"]["model_version"] == "0.9"
    assert e["decision"]["recommendation"]["inputs"]["dwell_days"] == 60
    assert e["completed"]["state"] == "SOLD"
    c = e["comparison"]
    assert c["basis"] == "recommended_route" and c["route"] == "YIELD WHILE LISTED"
    assert c["modeled_value"] == rec["result"]["base"]["YIELD WHILE LISTED"]
    assert abs(c["variance"] - (70000 - c["modeled_value"])) < 1e-6
    assert led["summary"] == {"in_motion": 0, "completed": 1, "with_outcome": 1, "realized_total": 70000.0,
                              "modeled_total_for_recorded": round(c["modeled_value"], 2),
                              "variance_total": round(c["variance"], 2)}


def test_ledger_compares_against_selected_route_when_one_was_chosen():
    create("S1", {"offer_today": 65500, "market_price": 66000, "dwell_days": 5})
    assert event("S1", "list", selected_route="LIST AND WAIT").status_code == 200
    assert event("S1", "sell").status_code == 200
    client.post("/assets/S1/outcomes", json={"realized_value": 50000})
    e = client.get("/outcomes").json()["entries"][0]
    assert e["decision"]["selected_route"] == "LIST AND WAIT"
    assert e["comparison"]["basis"] == "selected_route"
    assert e["comparison"]["modeled_value"] == e["decision"]["selected_route_value"]


def test_ledger_skips_untouched_assets_and_filters_by_state():
    create("A1")
    create("A2")
    event("A2", "list")
    led = client.get("/outcomes").json()
    assert [e["asset_id"] for e in led["entries"]] == ["A2"]
    assert led["summary"]["in_motion"] == 1 and led["summary"]["realized_total"] == 0
    assert client.get("/outcomes?state=completed").json()["entries"] == []
    assert [e["asset_id"] for e in client.get("/outcomes?state=open").json()["entries"]] == ["A2"]


def test_ledger_flags_recommendation_change_after_decision():
    a = create("R1", {"health_pass": False, "repairable": True})
    assert a["route"] == "HARVEST" and "repair" in a["override_events"]
    assert event("R1", "repair", override=True, note="technician quoted under default").status_code == 200
    assert event("R1", "list").status_code == 200
    e = client.get("/outcomes").json()["entries"][0]
    assert e["decision"]["recommendation"]["route"] == "HARVEST"
    assert e["decision"]["override"] is True
    assert e["current_recommendation"]["route"] not in ("HARVEST", "RECYCLE", "REPAIR")
    assert e["recommendation_changed"] is True


def test_demo_reset_clears_outcomes():
    create("H1", {"health_pass": False, "repairable": False})
    event("H1", "harvest")
    client.post("/assets/H1/outcomes", json={"realized_value": 1})
    assert client.post("/demo/reset").status_code == 200
    assert client.get("/outcomes").json()["entries"] == []


# ---- market evidence and CORS ----------------------------------------------------------------------------------

def test_market_evidence_is_labelled_not_live():
    m = client.get("/market/evidence").json()
    assert m["live"] is False
    rental = m["sources"]["rental_index"]["rows"]
    assert rental and all(isinstance(r["usd_per_gpu_hr"], float) for r in rental)
    assert all(r["status"] for r in m["sources"]["resale"]["rows"])
    assert m["sources"]["electricity"]["file"] == "data/sources/eia_state_rates.csv"


def test_cors_defaults_to_local_dev_origins(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    assert cors_origins() == ["http://127.0.0.1:5274", "http://localhost:5274"]
    monkeypatch.setenv("CORS_ORIGINS", "https://app.example.com, https://b.example.com")
    assert cors_origins() == ["https://app.example.com", "https://b.example.com"]
    r = client.options("/health", headers={"Origin": "http://127.0.0.1:5274", "Access-Control-Request-Method": "GET"})
    assert r.headers.get("access-control-allow-origin") == "http://127.0.0.1:5274"
    r = client.options("/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in r.headers
