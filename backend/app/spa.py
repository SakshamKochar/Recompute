"""Serve the built web app from the same process as the API.

The browser calls `/api/...`. This strips that prefix so the existing routes
answer, and serves the Vite build beside them. JS and CSS live under `/static`
so they never collide with the API's `/assets` routes.
"""
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


class StripApiPrefix:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            path = scope.get("path") or ""
            if path == "/api" or path.startswith("/api/"):
                scope = dict(scope)
                stripped = path[4:] or "/"
                scope["path"] = stripped
                scope["raw_path"] = stripped.encode()
        await self.app(scope, receive, send)


def mount_web(app: FastAPI, dist: str | os.PathLike) -> None:
    root = Path(dist)
    index = root / "index.html"
    if not index.is_file():
        raise FileNotFoundError(f"WEB_DIST has no index.html: {root}")

    static_dir = root / "static"
    if static_dir.is_dir():
        app.mount("/static", StaticFiles(directory=static_dir), name="web-static")

    # One file, not a mount. A `/demo` mount would swallow POST /demo/reset
    # and POST /demo/sellers.
    snapshot = root / "demo" / "snapshot.json"
    if snapshot.is_file():

        @app.get("/demo/snapshot.json", include_in_schema=False)
        def web_snapshot():
            return FileResponse(snapshot, media_type="application/json")

    @app.get("/", include_in_schema=False)
    def web_index():
        return FileResponse(index)

    favicon = root / "favicon.svg"
    if favicon.is_file():

        @app.get("/favicon.svg", include_in_schema=False)
        def web_favicon():
            return FileResponse(favicon)
