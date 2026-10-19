import pytest
from fastapi.testclient import TestClient

from app.fleet import load_fleet
from app.main import app
from app.recompute_model import DEFAULTS, PRESETS, preset_for
from app.schema import AssetInputs

client = TestClient(app)

# Routes from the Presets tab of ReCompute_Calculator_Inputs.xlsx (finance, v0.7; unchanged in v0.9)
SHEET_ROUTES = {
    "a100_8x": ["LIST AND WAIT", "SELL NOW", "YIELD WHILE LISTED", "HOST LONGER", "HARVEST", "LIST AND WAIT"],
    "h100_8x": ["SELL NOW", "SELL NOW", "YIELD WHILE LISTED", "HOST LONGER", "HARVEST", "SELL NOW"],
}
SHEET_CASES = [(profile, name, route) for profile, routes in SHEET_ROUTES.items()
               for name, route in zip(["Defaults", *PRESETS], routes)]

# Full v0.9 result for the A100 defaults, kept so any change in the model's numbers is noticed
SNAPSHOT_A100 = {
    "route": "LIST AND WAIT",
    "base": {"SELL NOW": 68720.00, "LIST AND WAIT": 81810.45, "YIELD WHILE LISTED": 83009.32,
             "HOST LONGER": 92047.87, "HARVEST": 68444.56, "RECYCLE": 128.75, "REPAIR": None},
    "stress": {"LIST AND WAIT": 79061.54, "YIELD WHILE LISTED": 80598.83, "HOST LONGER": 75552.45},
    "eligible": ["SELL NOW", "LIST AND WAIT", "YIELD WHILE LISTED", "HOST LONGER"],
    "breakeven_dwell_days": 43,
    "breakeven_utilization": 0.46,
    "daily_compute_margin": 80.75,
    "after_repair_route": None,
    "audit": [
        "LIST AND WAIT beats SELL NOW by $13,090 (needs $1,374) and still wins in its stress case by $10,342.",
        "YIELD WHILE LISTED vs LIST AND WAIT: $1,199, below the $1,636 margin, so rejected.",
        "HOST LONGER beats LIST AND WAIT by $10,237 in the base case but loses $4,781 in its stress case, so rejected.",
    ],
}


def assert_matches(got, want):
    assert set(got) == set(want)
    for key, value in want.items():
        if isinstance(value, dict):
            assert set(got[key]) == set(value), key
            for route, v in value.items():
                if v is None:
                    assert got[key][route] is None
                else:
                    assert got[key][route] == pytest.approx(v, abs=0.01), (key, route)
        elif isinstance(value, float):
            assert got[key] == pytest.approx(value, abs=0.01), key
        else:
            assert got[key] == value, key


@pytest.mark.parametrize("profile,name,route", SHEET_CASES)
def test_routes_match_finance_sheet(profile, name, route):
    body = {**({} if name == "Defaults" else preset_for(name, profile)), "asset_profile": profile}
    r = client.post("/recommend", json=body)
    assert r.status_code == 200
    assert r.json()["model_version"] == "0.9"
    assert r.json()["result"]["route"] == route


@pytest.mark.parametrize("profile,offer,harvest,recycle,part", [
    ("a100_8x", 80000, 68444.56, 128.75, 10829), ("h100_8x", 235700, 182889.20, 169, 24500)])
def test_values_checked_by_hand(profile, offer, harvest, recycle, part):
    base = client.post("/recommend", json={"asset_profile": profile}).json()["result"]["base"]
    assert base["SELL NOW"] == pytest.approx(offer * (1 - 0.136) - 400)
    assert base["HARVEST"] == harvest and base["RECYCLE"] == recycle
    failed = client.post("/recommend", json={"asset_profile": profile, "health_pass": False}).json()["result"]
    assert f"Repair costs ${part + 600 + 300:,}" in failed["audit"][0]


def test_a100_snapshot():
    assert_matches(client.post("/recommend", json={}).json()["result"], SNAPSHOT_A100)


def test_schema_covers_every_model_field():
    assert set(AssetInputs.model_fields) == set(DEFAULTS)
    assert len(DEFAULTS) == 43


@pytest.mark.parametrize("body", [
    {"colo_per_kw_m": 300},
    {"asset_profile": "b200_8x"},
    {"utilization": 60},
    {"gpus": 0},
    {"pue": 0.9},
    {"bear_decay_mult": 0.5},
    {"health_pass": "false"},
    {"ownership": "leased"},
    {"horizon_months": 1.5},
    {"offer_today": -1},
])
def test_rejects_bad_input(body):
    assert client.post("/recommend", json=body).status_code == 422


def test_h100_profile_swaps_defaults_and_explicit_input_wins():
    r = client.post("/recommend", json={"asset_profile": "h100_8x", "server_kw": 9.0}).json()
    assert r["inputs"] == {"asset_profile": "h100_8x", "server_kw": 9.0}
    assert r["result"]["base"]["SELL NOW"] == pytest.approx(235700 * (1 - 0.136) - 400)


def test_fleet_reproduces_saksham_csv():
    fleet = load_fleet()
    assert len(fleet) == 100
    for a in fleet:
        s, e = a["summary"], a["expected"]
        assert s["route"] == e["route"], a["asset"]["asset_id"]
        assert (s["after_repair"] or "") == e["after_repair"], a["asset"]["asset_id"]
        for k in ("route_value", "sell_now_value", "gain_vs_baseline"):
            assert s[k] == pytest.approx(float(e[k]), abs=1), (a["asset"]["asset_id"], k)


def test_fleet_endpoints():
    r = client.get("/fleet").json()
    assert r["count"] == 100 and sum(r["routes"].values()) == 100
    assert client.get("/fleet/SYN-001").status_code == 200
    assert client.get("/fleet/NOPE").status_code == 404


def test_meta():
    r = client.get("/meta").json()
    assert set(r["profiles"]) == {"a100_8x", "h100_8x"}
    assert r["profiles"]["h100_8x"]["server_kw"] == 10.2
    assert len(r["assumptions"]) > 40
