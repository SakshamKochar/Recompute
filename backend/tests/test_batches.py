import csv
import io
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.fleet import totals
from app.main import app

client = TestClient(app)
DATA = Path(__file__).resolve().parent.parent / "data"

CSV = """asset_id,asset_profile,health_pass,repairable,repair_parts_cost,offer_today
F-1,a100_8x,true,,,
F-2,h100_8x,true,,,
F-3,a100_8x,false,true,500,
F-4,a100_8x,false,false,,
F-5,a100_8x,true,,,99500
"""


def upload(text=CSV, **params):
    r = client.post("/assets/upload", params=params, files={"file": ("fleet.csv", text.encode(), "text/csv")})
    assert r.status_code == 200, r.text
    return r.json()


def test_upload_returns_values_and_totals():
    body = upload()
    rows = {a["asset_id"]: a for a in body["assets"]}
    assert rows["F-1"]["route"] == "LIST AND WAIT" and rows["F-1"]["baseline_route"] == "SELL NOW"
    assert rows["F-1"]["sell_now_value"] == pytest.approx(80000 * (1 - 0.136) - 400)
    assert rows["F-3"]["route"] == "REPAIR" and rows["F-3"]["baseline_route"] == "HARVEST"
    assert rows["F-4"]["route"] == "HARVEST" and rows["F-4"]["gain_vs_baseline"] == 0
    for a in body["assets"]:
        assert a["gain_vs_baseline"] == pytest.approx(a["route_value"] - a["sell_now_value"])
    t = body["totals"]
    assert t["count"] == 5 and sum(t["routes"].values()) == 5
    assert t["gain_vs_baseline"] == pytest.approx(sum(a["gain_vs_baseline"] for a in body["assets"]))
    assert t["gain_vs_baseline"] == pytest.approx(t["recommended_value"] - t["baseline_value"])
    assert t["changed_from_baseline"] == sum(a["route"] != a["baseline_route"] for a in body["assets"])
    assert body["batch_id"].startswith("UP-")


def test_dry_run_gives_same_numbers_and_saves_nothing():
    dry = upload(dry_run="true")
    assert dry["batch_id"] is None and client.get("/batches").json()["batches"] == []
    real = upload()
    assert dry["totals"] == real["totals"]


def test_batch_view_matches_upload_and_sorts_by_gain():
    body = upload()
    b = client.get(f"/batches/{body['batch_id']}").json()
    assert b["totals"] == body["totals"] and b["filename"] == "fleet.csv" and b["source"] == "upload"
    gains = [a["gain_vs_baseline"] for a in b["assets"]]
    assert gains == sorted(gains, reverse=True)
    ids = [a["asset_id"] for a in client.get(f"/batches/{body['batch_id']}", params={"sort": "asset_id"}).json()["assets"]]
    assert ids == ["F-1", "F-2", "F-3", "F-4", "F-5"]


def test_each_upload_is_its_own_batch():
    first = upload()
    second = upload(CSV.replace("F-", "G-"))
    assert first["batch_id"] != second["batch_id"]
    listed = client.get("/assets", params={"batch_id": first["batch_id"]}).json()
    assert listed["count"] == 5 and all(a["asset_id"].startswith("F-") for a in listed["assets"])
    assert len(client.get("/batches").json()["batches"]) == 2


def test_seeded_fleet_batch_matches_fleet_endpoint():
    client.post("/fleet/seed")
    b = client.get("/batches/SYN-FLEET").json()
    fleet = client.get("/fleet").json()
    assert b["totals"]["count"] == 100 and b["totals"]["routes"] == fleet["routes"]
    assert b["totals"]["gain_vs_baseline"] == pytest.approx(fleet["total_gain_vs_baseline"])


def test_values_follow_input_changes():
    body = upload()
    before = client.get(f"/batches/{body['batch_id']}").json()["totals"]["gain_vs_baseline"]
    client.patch("/assets/F-1/inputs", json={"offer_today": 99000})
    after = client.get(f"/batches/{body['batch_id']}").json()["totals"]["gain_vs_baseline"]
    assert after != before
    one = client.get("/assets/F-1").json()
    assert one["batch_id"] == body["batch_id"] and one["route"] == "SELL NOW" and one["gain_vs_baseline"] == 0


def test_results_csv_download():
    body = upload()
    r = client.get(f"/batches/{body['batch_id']}/results.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert f"{body['batch_id']}-base-results.csv" in r.headers["content-disposition"]
    rows = list(csv.DictReader(io.StringIO(r.text)))
    assert [row["asset_id"] for row in rows] == [a["asset_id"] for a in
                                                 client.get(f"/batches/{body['batch_id']}").json()["assets"]]
    assert sum(float(row["gain_vs_baseline"]) for row in rows) == pytest.approx(body["totals"]["gain_vs_baseline"], abs=0.05)


def test_unknown_batch_is_404():
    assert client.get("/batches/NOPE").status_code == 404
    assert client.get("/batches/NOPE/results.csv").status_code == 404


def test_500_servers_in_one_upload():
    rows = ["asset_id,asset_profile"] + [f"B-{i:03d},{'h100_8x' if i % 4 == 0 else 'a100_8x'}" for i in range(500)]
    body = upload("\n".join(rows))
    assert body["added"] == 500 and body["totals"]["count"] == 500
    assert client.get(f"/batches/{body['batch_id']}").json()["totals"] == body["totals"]


def test_totals_for_the_financials():
    t = upload()["totals"]
    assert t["avg_gain_per_server"] == pytest.approx(t["gain_vs_baseline"] / 5, abs=0.01)
    assert t["fee_rate"] == 0.10
    assert t["projected_fee_if_every_recommendation_followed"] == pytest.approx(t["gain_vs_baseline"] * 0.10, abs=0.01)
    assert t["failed_count"] == 2 and t["failed_share"] == 0.4
    a, h = t["by_profile"]["a100_8x"], t["by_profile"]["h100_8x"]
    assert a["count"] == 4 and h["count"] == 1
    assert a["gain_vs_baseline"] + h["gain_vs_baseline"] == pytest.approx(t["gain_vs_baseline"], abs=0.02)
    assert h["avg_gain_per_server"] == h["gain_vs_baseline"]


def test_servers_with_no_change_count_as_zero_in_the_average():
    t = upload("asset_id,offer_today,market_price,dwell_days\nZ-1,65500,66000,5\nZ-2,,,\n")["totals"]
    assert t["changed_from_baseline"] == 1 and t["count"] == 2
    assert t["avg_gain_per_server"] == pytest.approx(t["gain_vs_baseline"] / 2, abs=0.01)


def test_scenarios_match_saksham_bear_base_bull():
    """Every number in Saksham's fleet_uplift_v09.json, for all three scenarios and every server group."""
    client.post("/fleet/seed")
    want = json.loads((DATA / "fleet_uplift_v09.json").read_text())["scenarios"]
    got = client.get("/batches/SYN-FLEET/scenarios").json()["scenarios"]
    for s, groups in want.items():
        rows = client.get("/batches/SYN-FLEET", params={"scenario": s}).json()["assets"]
        assert got[s]["routes"] == groups["routes"], s
        pick = {"all": lambda r: True, "A100": lambda r: r["asset_profile"] == "a100_8x",
                "H100": lambda r: r["asset_profile"] == "h100_8x",
                "A100_80GB": lambda r: r["model"] == "8x A100 80GB", "A100_40GB": lambda r: r["model"] == "8x A100 40GB"}
        for g, w in groups.items():
            if g == "routes":
                continue
            t = totals([r for r in rows if pick[g](r)])
            assert t["count"] == w["servers"] and t["changed_from_baseline"] == w["changed"], (s, g)
            for mine, theirs in (("recommended_value", "routed"), ("baseline_value", "default"),
                                 ("gain_vs_baseline", "uplift"), ("avg_gain_per_server", "avg_uplift_per_server")):
                assert t[mine] == pytest.approx(w[theirs], abs=1), (s, g, mine)
    assert got["base"] == client.get("/batches/SYN-FLEET").json()["totals"]


def test_scenario_view_and_csv():
    client.post("/fleet/seed")
    bear = client.get("/batches/SYN-FLEET", params={"scenario": "bear"}).json()
    assert bear["scenario"] == "bear" and bear["totals"]["routes"] == {"HARVEST": 14, "LIST AND WAIT": 30, "SELL NOW": 56}
    r = client.get("/batches/SYN-FLEET/results.csv", params={"scenario": "bull"})
    assert "SYN-FLEET-bull-results.csv" in r.headers["content-disposition"]
    assert client.get("/batches/SYN-FLEET", params={"scenario": "worst"}).status_code == 422
