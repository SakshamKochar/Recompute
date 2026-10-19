"""GET /market/live. Vast.ai is never contacted: fetch_offers is replaced in every test."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app import market

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean():
    market.reset_live_cache()
    yield
    market.reset_live_cache()


def _offers(*prices, extra=0, bid=False):
    rows = [{"dph_total": p, "num_gpus": 1, "is_bid": bid} for p in prices]
    rows.extend({"dph_total": 1, "num_gpus": 1} for _ in range(extra))
    return rows


def test_live_feed_off_does_not_fetch(monkeypatch):
    monkeypatch.setenv("MARKET_LIVE_FEED", "off")

    def boom(_name):
        raise AssertionError("fetch_offers should not run when the feed is off")

    monkeypatch.setattr(market, "fetch_offers", boom)
    body = client.get("/market/live").json()
    assert body["live"] is False
    assert body["quotes"] == []
    assert "MARKET_LIVE_FEED" in body["note"]
    assert body["model_version"]


def test_live_quotes_median_filters_and_model_rate(monkeypatch):
    monkeypatch.setenv("MARKET_LIVE_FEED", "vast")

    def fake(gpu_name):
        # 2.0 and 2.4 survive. Zero, a bid, and a per-GPU ask over $50 do not.
        return [
            {"dph_total": 4.0, "num_gpus": 2},
            {"dph_total": 2.4, "num_gpus": 1},
            {"dph_total": 0, "num_gpus": 1},
            {"dph_total": 80, "num_gpus": 1},
            {"dph_total": 9, "num_gpus": 1, "is_bid": True},
        ] if gpu_name == "H100 SXM" else _offers(1.0)

    monkeypatch.setattr(market, "fetch_offers", fake)
    body = client.get("/market/live").json()
    assert body["live"] is True
    assert body["stale"] is False
    assert body["source"]["kind"].startswith("On-demand asks")
    h100 = next(q for q in body["quotes"] if q["key"] == "h100_sxm")
    assert h100["offers"] == 2
    assert h100["median"] == 2.2
    assert h100["low"] == 2.0
    assert h100["high"] == 2.4
    assert h100["capped"] is False
    assert h100["previous"] is None
    assert h100["change_pct"] is None
    assert h100["history"] == [2.2]
    assert h100["in_model"] is True
    assert h100["model_profile"] == "h100_8x"
    assert h100["model_rental_rate"] == pytest.approx(2.72)
    assert h100["unit"] == "USD/GPU-hr"
    a100 = next(q for q in body["quotes"] if q["key"] == "a100_sxm")
    assert a100["model_rental_rate"] == pytest.approx(1.57)
    assert a100["in_model"] is True
    assert body["quotes"][0]["key"] == "h100_sxm"
    l40s = next(q for q in body["quotes"] if q["key"] == "l40s")
    assert l40s["in_model"] is False
    assert l40s["model_rental_rate"] is None


def test_second_reading_records_change_and_history(monkeypatch):
    monkeypatch.setenv("MARKET_LIVE_FEED", "vast")
    calls = {"n": 0}

    def fake(_gpu_name):
        calls["n"] += 1
        price = 2.0 if calls["n"] <= len(market.WATCH) else 2.2
        return _offers(price)

    monkeypatch.setattr(market, "fetch_offers", fake)
    first = client.get("/market/live").json()
    assert first["quotes"][0]["change_pct"] is None
    market._state["expires"] = 0
    second = client.get("/market/live").json()
    h100 = next(q for q in second["quotes"] if q["key"] == "h100_sxm")
    assert h100["previous"] == 2.0
    assert h100["median"] == 2.2
    assert h100["change_pct"] == 10.0
    assert h100["history"] == [2.0, 2.2]
    assert second["stale"] is False


def test_cache_does_not_refetch(monkeypatch):
    monkeypatch.setenv("MARKET_LIVE_FEED", "vast")
    calls = {"n": 0}

    def fake(_gpu_name):
        calls["n"] += 1
        return _offers(1.5)

    monkeypatch.setattr(market, "fetch_offers", fake)
    client.get("/market/live")
    client.get("/market/live")
    assert calls["n"] == len(market.WATCH)


def test_failure_with_no_cache_is_not_live(monkeypatch):
    monkeypatch.setenv("MARKET_LIVE_FEED", "vast")

    def boom(_name):
        raise RuntimeError("down")

    monkeypatch.setattr(market, "fetch_offers", boom)
    body = client.get("/market/live").json()
    assert body["live"] is False
    assert body["quotes"] == []
    assert body["error"]
    assert "Vast.ai" in body["error"]


def test_failure_after_a_reading_is_stale(monkeypatch):
    monkeypatch.setenv("MARKET_LIVE_FEED", "vast")
    monkeypatch.setattr(market, "fetch_offers", lambda _n: _offers(3.0))
    first = client.get("/market/live").json()
    assert first["live"] is True
    market._state["expires"] = 0

    def boom(_name):
        raise RuntimeError("down")

    monkeypatch.setattr(market, "fetch_offers", boom)
    stale = client.get("/market/live").json()
    assert stale["live"] is True
    assert stale["stale"] is True
    assert stale["quotes"][0]["median"] == 3.0
    assert "last reading" in stale["error"]


def test_capped_sample_is_flagged(monkeypatch):
    monkeypatch.setenv("MARKET_LIVE_FEED", "vast")
    monkeypatch.setattr(market, "fetch_offers", lambda _n: _offers(1.25, extra=market.SAMPLE_CAP - 1))
    body = client.get("/market/live").json()
    assert all(q["capped"] for q in body["quotes"])
    assert body["sample_cap"] == 64


def test_one_gpu_failing_keeps_the_others(monkeypatch):
    monkeypatch.setenv("MARKET_LIVE_FEED", "vast")

    def fake(gpu_name):
        if gpu_name == "B200":
            raise RuntimeError("down")
        return _offers(1.1)

    monkeypatch.setattr(market, "fetch_offers", fake)
    body = client.get("/market/live").json()
    assert body["live"] is True
    assert "B200" in body["note"]
    assert all(q["key"] != "b200" for q in body["quotes"])


def test_evidence_endpoint_stays_not_live():
    body = client.get("/market/evidence").json()
    assert body["live"] is False
    assert body["sources"]["rental_index"]["rows"]
