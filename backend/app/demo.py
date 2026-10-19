import os

from fastapi import APIRouter, Header, HTTPException
from sqlalchemy import func, select

from .assets import seed_fleet
from .db import Asset, Base, SessionLocal, engine
from .diagnostics_api import seed_demo_sellers
from .output import MODEL_ERROR
from .schema import error

router = APIRouter(tags=["demo"])


def load_demo_data():
    with SessionLocal() as session:
        fleet = seed_fleet(session)
        sellers = seed_demo_sellers(session)
    return {"fleet": fleet, "demo_sellers": sellers}


def seed_if_empty():
    with SessionLocal() as session:
        empty = not session.scalar(select(func.count()).select_from(Asset))
    return load_demo_data() if empty else None


@router.post("/demo/reset", responses={**MODEL_ERROR, 403: error("Wrong or missing X-Demo-Token", "wrong demo token")})
def demo_reset(x_demo_token: str | None = Header(None)):
    """Delete every asset, batch and history, then reload the 100 test servers (SYN-FLEET) and the four demo
    sellers (DEMO-SELLERS). If the server has DEMO_RESET_TOKEN set, send it in the X-Demo-Token header."""
    token = os.getenv("DEMO_RESET_TOKEN")
    if token and x_demo_token != token:
        raise HTTPException(403, "wrong demo token")
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    return {"reset": True, **load_demo_data()}
