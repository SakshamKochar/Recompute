from fastapi.testclient import TestClient

import app.main as main
from app.main import app

client = TestClient(app)


def test_reset_wipes_and_reloads():
    client.post("/assets", json={"asset_id": "JUNK-1"})
    client.post("/assets/SYN-003/events", json={"event": "list"})
    r = client.post("/demo/reset").json()
    assert r["reset"] is True and r["fleet"]["added"] == 100 and len(r["demo_sellers"]["added"]) == 4
    assert client.get("/assets/JUNK-1").status_code == 404
    assert client.get("/assets/SYN-003").json()["state"] == "RECEIVED"
    assert {b["batch_id"] for b in client.get("/batches").json()["batches"]} == {"SYN-FLEET", "DEMO-SELLERS"}
    assert client.get("/batches/SYN-FLEET").json()["totals"]["avg_gain_per_server"] == 5457.89


def test_reset_twice_gives_the_same_state():
    a = client.post("/demo/reset").json()
    b = client.post("/demo/reset").json()
    assert a == b and client.get("/assets").json()["count"] == 104


def test_reset_token(monkeypatch):
    monkeypatch.setenv("DEMO_RESET_TOKEN", "s3cret")
    assert client.post("/demo/reset").status_code == 403
    assert client.post("/demo/reset", headers={"X-Demo-Token": "nope"}).status_code == 403
    assert client.post("/demo/reset", headers={"X-Demo-Token": "s3cret"}).status_code == 200


def test_seed_on_start(monkeypatch):
    monkeypatch.setenv("SEED_ON_START", "true")
    with TestClient(app) as c:
        assert c.get("/assets").json()["count"] == 104
    with TestClient(app) as c:
        assert c.get("/assets").json()["count"] == 104
    monkeypatch.delenv("SEED_ON_START")
    assert main.seed_if_empty() is None
