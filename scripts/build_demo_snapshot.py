"""Record a Demo-mode snapshot from the real backend.

Every number in the snapshot is a real response from the v0.9 API, run in-process against a throwaway
SQLite database seeded with Saksham's synthetic fleet and the four simulated demo sellers. A short scripted
walkthrough (a few lifecycle moves and two illustrative outcomes) is applied so the lifecycle and outcome
screens have something to show; those entries are flagged in the snapshot.

Run from the repo root:  backend/.venv/bin/python scripts/build_demo_snapshot.py
Writes:                  frontend/public/demo/snapshot.json
"""
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(tempfile.mkdtemp(), "snapshot.db")
os.environ.pop("DEMO_RESET_TOKEN", None)
sys.path.insert(0, str(ROOT / "backend"))
os.chdir(ROOT / "backend")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

OUT = ROOT / "frontend" / "public" / "demo" / "snapshot.json"
FEATURED = ["DEMO-SHAURYAA", "DEMO-SWAYAM", "DEMO-SAKSHAM", "DEMO-KABIR", "SYN-003", "SYN-040", "SYN-031", "SYN-076"]
GRIDS = {
    "utilization": [round(0.2 + 0.05 * i, 2) for i in range(17)],
    "elec_per_kwh": [round(0.04 + 0.02 * i, 2) for i in range(14)],
    "market_decay_pct_mo": [round(0.005 * i, 3) for i in range(11)],
    "dwell_days": [float(15 * i) for i in range(1, 11)],
}
WALKTHROUGH_NOTE = "Demo walkthrough step recorded by the snapshot script."

client = TestClient(app)
store = {}


def ok(r, code=200):
    assert r.status_code == code, (r.request.url, r.status_code, r.text)
    return r.json()


def get(path):
    store[f"GET {path}"] = data = ok(client.get(path))
    return data


def event(asset_id, name, **kw):
    return ok(client.post(f"/assets/{asset_id}/events", json={"event": name, **kw}))


def walkthrough():
    event("SYN-062", "list", selected_route="YIELD WHILE LISTED")
    event("SYN-062", "activate")
    event("SYN-062", "start_compute")
    event("SYN-076", "list", selected_route="LIST AND WAIT")
    event("DEMO-KABIR", "repair", selected_route="REPAIR")
    event("SYN-004", "harvest", selected_route="HARVEST")
    harvest = client.get("/assets/SYN-004").json()["route_value"]
    ok(client.post("/assets/SYN-004/outcomes",
                   json={"realized_value": round(harvest * 0.96, 2), "note": "Illustrative outcome. " + WALKTHROUGH_NOTE}), 201)
    sell_now = next(a for a in client.get("/assets").json()["assets"]
                    if a["route"] == "SELL NOW" and a["state"] == "RECEIVED" and a["asset_id"].startswith("SYN-0"))
    event(sell_now["asset_id"], "list", selected_route="SELL NOW")
    event(sell_now["asset_id"], "sell")
    ok(client.post(f"/assets/{sell_now['asset_id']}/outcomes",
                   json={"realized_value": round(sell_now["route_value"] - 1850, 2),
                         "note": "Illustrative outcome: freight came in over estimate. " + WALKTHROUGH_NOTE}), 201)
    override = next(a for a in client.get("/assets").json()["assets"]
                    if a["route"] == "SELL NOW" and a["state"] == "RECEIVED" and a["asset_id"].startswith("SYN-")
                    and a["asset_id"] != sell_now["asset_id"])["asset_id"]
    event(override, "list", selected_route="HOST LONGER")
    event(override, "activate", override=True,
          note="Illustrative override: client asked for a quarter of hosting before sale. " + WALKTHROUGH_NOTE)
    return [sell_now["asset_id"], "SYN-062", "SYN-076", "DEMO-KABIR", "SYN-004", override]


def latest_inputs(asset_id):
    hist = client.get(f"/assets/{asset_id}/history").json()["events"]
    return [e for e in hist if e["type"] == "recommendation"][-1]["inputs"]


def recommend(body, **query):
    qs = "&".join(f"{k}={v}" for k, v in query.items())
    r = ok(client.post("/recommend" + (f"?{qs}" if qs else ""), json=body))
    return r


def main():
    ok(client.post("/demo/reset"))
    walked = walkthrough()

    get("/health")
    get("/meta")
    get("/dashboard")
    get("/market/evidence")
    get("/outcomes")
    assets = get("/assets")["assets"]
    for b in get("/batches")["batches"]:
        bid = b["batch_id"]
        for s in ("base", "bear", "bull"):
            get(f"/batches/{bid}?scenario={s}")
        get(f"/batches/{bid}/scenarios")
    for a in assets:
        get(f"/assets/{a['asset_id']}")
        get(f"/assets/{a['asset_id']}/history")
    store["GET /assets/upload/template"] = client.get("/assets/upload/template").text

    lab = {}
    for aid in FEATURED:
        base = latest_inputs(aid)
        entry = {"inputs": base, "scenarios": {}, "grids": {}}
        for s in ("base", "bear", "bull"):
            r = recommend(base, scenario=s, flip_points="true")
            entry["scenarios"][s] = r
        for dial, values in GRIDS.items():
            entry["grids"][dial] = {}
            for v in values:
                r = recommend({**base, dial: v})
                entry["grids"][dial][str(v)] = {"result": r["result"], "warnings": r["warnings"]}
        lab[aid] = entry

    snapshot = {
        "notice": ("Illustrative snapshot. Recorded from the ReCompute v0.9 backend on synthetic servers and "
                   "simulated NVIDIA diagnostics. Nothing in Demo mode is a live recommendation or a transaction."),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_version": store["GET /health"]["model_version"],
        "walkthrough_assets": walked,
        "walkthrough_note": WALKTHROUGH_NOTE,
        "featured": FEATURED,
        "grids": {k: v for k, v in GRIDS.items()},
        "responses": store,
        "lab": lab,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(snapshot, separators=(",", ":")))
    print(f"wrote {OUT.relative_to(ROOT)}: {OUT.stat().st_size / 1e6:.2f} MB, {len(store)} responses, "
          f"{len(lab)} lab assets")


if __name__ == "__main__":
    main()
