import copy

import pytest
from fastapi.testclient import TestClient

import app.output as output
from app.main import app
from app.recompute_model import PRESETS, recommend

client = TestClient(app, raise_server_exceptions=False)

CASES = [{}, {"asset_profile": "h100_8x"}, {"ownership": "consigned"}, {"health_pass": False},
         {"health_pass": False, "repairable": False}, {"utilization": 0, "first_month_utilization": 0},
         {"exit_days": 30, "buyer_window_days": 5}, *PRESETS.values()]


@pytest.mark.parametrize("inputs", CASES)
def test_real_results_pass(inputs):
    assert output.checked_recommend(inputs) == recommend(inputs)


def broken(change):
    def fake(inputs):
        r = copy.deepcopy(recommend(inputs))
        change(r)
        return r
    return fake


BREAKS = {
    "unknown route": (lambda r: r.update(route="SELL LATER"), "route"),
    "missing field": (lambda r: r.pop("audit"), "audit"),
    "extra field": (lambda r: r.update(score=1), "score"),
    "text for a number": (lambda r: r["base"].update({"SELL NOW": "54800"}), "base.SELL NOW"),
    "not finite": (lambda r: r.update(daily_compute_margin=float("nan")), "daily_compute_margin"),
    "route not eligible": (lambda r: r.update(route="HARVEST"), "result"),
    "base missing a route": (lambda r: r["base"].pop("RECYCLE"), "result"),
    "repair without after route": (lambda r: r.update(eligible=r["eligible"] + ["REPAIR"]), "result"),
    "empty audit": (lambda r: r.update(audit=[]), "audit"),
}


@pytest.mark.parametrize("name", BREAKS)
def test_broken_results_are_caught(name, monkeypatch):
    change, field = BREAKS[name]
    monkeypatch.setattr(output, "recommend", broken(change))
    r = client.post("/recommend", json={})
    assert r.status_code == 500
    d = r.json()["detail"]
    assert d["error"] == "model returned an invalid result" and d["model_version"] == "0.9"
    assert any(p["field"] == field for p in d["problems"]), d["problems"]


def test_bad_result_saves_nothing(monkeypatch):
    monkeypatch.setattr(output, "recommend", broken(lambda r: r.update(route="SELL LATER")))
    assert client.post("/assets", json={"asset_id": "B1"}).status_code == 500
    monkeypatch.undo()
    assert client.get("/assets/B1").status_code == 404


def test_bad_result_blocks_input_change(monkeypatch):
    client.post("/assets", json={"asset_id": "B2"})
    monkeypatch.setattr(output, "recommend", broken(lambda r: r.pop("route")))
    assert client.patch("/assets/B2/inputs", json={"dwell_days": 90}).status_code == 500
    monkeypatch.undo()
    events = client.get("/assets/B2/history").json()["events"]
    assert sum(i["type"] == "recommendation" for i in events) == 1
    assert "dwell_days" not in client.get("/assets/B2").json()["inputs"]


def test_500_is_documented():
    paths = client.get("/openapi.json").json()["paths"]
    assert "500" in paths["/recommend"]["post"]["responses"]
    assert "500" in paths["/assets"]["post"]["responses"]
    assert "500" in paths["/assets/upload"]["post"]["responses"]
