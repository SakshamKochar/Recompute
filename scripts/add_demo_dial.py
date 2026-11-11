"""Add recorded What-if Lab stops for one input on one featured asset to the Demo-mode snapshot.

Demo mode answers the What-if Lab from recorded model runs; a slider is only enabled in Demo mode when
its stops were recorded. This records the given values with the real v0.9 API, in-process, the same
way scripts/build_demo_snapshot.py records the other dials, and leaves every other response untouched.

Finals stage case (SYN-003, rental $1.57 dated index -> $0.80 stage hypothetical):
    backend/.venv/bin/python scripts/add_demo_dial.py SYN-003 rental_rate 0.80 1.57
"""
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(tempfile.mkdtemp(), "dial.db")
os.environ.pop("DEMO_RESET_TOKEN", None)
sys.path.insert(0, str(ROOT / "backend"))
os.chdir(ROOT / "backend")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

SNAPSHOT = ROOT / "frontend" / "public" / "demo" / "snapshot.json"


def main():
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    asset, dial, values = sys.argv[1], sys.argv[2], [float(v) for v in sys.argv[3:]]
    snap = json.loads(SNAPSHOT.read_text())
    lab = snap["lab"].get(asset)
    if lab is None:
        raise SystemExit(f"{asset} is not a featured Demo-mode asset: {sorted(snap['lab'])}")
    base = lab["inputs"]
    grid = {}
    with TestClient(app) as client:
        for v in values:
            r = client.post("/recommend", json={**base, dial: v})
            if r.status_code != 200:
                raise SystemExit(f"{dial}={v}: {r.status_code} {r.text}")
            out = r.json()
            grid[str(v)] = {"result": out["result"], "warnings": out["warnings"]}
            b = out["result"]["base"]
            print(asset, dial, v, out["result"]["route"], {k: round(x) for k, x in b.items() if x is not None})
    lab["grids"][dial] = grid
    SNAPSHOT.write_text(json.dumps(snap, separators=(",", ":")))


if __name__ == "__main__":
    main()
