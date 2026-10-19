from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.testclient import TestClient

from app.spa import StripApiPrefix, mount_web


def _app(tmp_path: Path) -> FastAPI:
    dist = tmp_path / "web"
    (dist / "static").mkdir(parents=True)
    (dist / "static" / "app.js").write_text("console.log(1)\n")
    (dist / "demo").mkdir()
    (dist / "demo" / "snapshot.json").write_text("{}\n")
    (dist / "index.html").write_text("<h1>ReCompute</h1>\n")
    (dist / "favicon.svg").write_text("<svg></svg>\n")
    app = FastAPI()

    @app.get("/health")
    def health(q: str = Query("")):
        return {"ok": True, "q": q}

    @app.post("/demo/reset")
    def demo_reset():
        return {"reset": True}

    mount_web(app, dist)
    app.add_middleware(StripApiPrefix)
    return app


def test_site_and_api_share_one_origin(tmp_path):
    client = TestClient(_app(tmp_path))
    assert "ReCompute" in client.get("/").text
    assert client.get("/static/app.js").text.startswith("console.log")
    assert client.get("/demo/snapshot.json").json() == {}
    assert client.get("/favicon.svg").status_code == 200
    assert client.get("/health").json()["ok"] is True
    assert client.get("/api/health?q=1").json() == {"ok": True, "q": "1"}
    assert client.post("/api/demo/reset").json() == {"reset": True}
    assert client.post("/demo/reset").json() == {"reset": True}
