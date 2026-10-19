"""Market evidence shipped with the model, plus a live rental-ask tape.

The CSVs in data/sources are dated observations. GET /market/live is separate:
it reads on-demand asks from Vast.ai's public bundles API (no key), caches them
for a minute, and never touches the decision model. Hosts list those prices;
they are not completed rentals.
"""
import csv
import json
import os
import statistics
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from functools import lru_cache

from fastapi import APIRouter

from .fleet import DATA
from .recompute_model import resolve_defaults
from .schema import MODEL_VERSION

router = APIRouter(tags=["market"])

SOURCES = {
    "rental_index": ("rental_index_history.csv", "GPU rental index readings, USD per GPU-hour"),
    "resale": ("resale_evidence.csv", "Observed used-hardware prices and asking prices"),
    "electricity": ("eia_state_rates.csv", "Electricity rates, cents per kWh"),
    "grades": ("grade_table.csv", "How a diagnostic grade moves price, wait and offer (team hypothesis)"),
    "repair_costs": ("fault_costs.csv", "Repair part cost and days by failed part"),
}
NUMERIC = {"usd_per_gpu_hr", "price_usd", "cents_per_kwh", "cost_usd", "repair_days", "min_score",
           "price_factor", "dwell_factor", "best_offer_ratio", "warranty_days"}

# GPUs the decision cares about, then the neighbouring asks a reader needs for context.
# profile is set only where Saksham's model has a rental_rate assumption.
WATCH = (
    {"key": "h100_sxm", "label": "H100 SXM", "gpu_name": "H100 SXM", "profile": "h100_8x"},
    {"key": "a100_sxm", "label": "A100 SXM", "gpu_name": "A100 SXM4", "profile": "a100_8x"},
    {"key": "h100_nvl", "label": "H100 NVL", "gpu_name": "H100 NVL", "profile": None},
    {"key": "a100_pcie", "label": "A100 PCIe", "gpu_name": "A100 PCIE", "profile": None},
    {"key": "h200", "label": "H200", "gpu_name": "H200", "profile": None},
    {"key": "h200_nvl", "label": "H200 NVL", "gpu_name": "H200 NVL", "profile": None},
    {"key": "b200", "label": "B200", "gpu_name": "B200", "profile": None},
    {"key": "l40s", "label": "L40S", "gpu_name": "L40S", "profile": None},
    {"key": "rtx_4090", "label": "RTX 4090", "gpu_name": "RTX 4090", "profile": None},
)

VAST_BUNDLES = "https://cloud.vast.ai/api/v0/bundles/"
SAMPLE_CAP = 64
PRICE_MAX = 50.0  # drop per-GPU asks at or below 0, or above this
TTL_SECONDS = 60
RETRY_SECONDS = 20
FETCH_TIMEOUT = 8
HISTORY_POINTS = 24

SOURCE = {
    "name": "Vast.ai marketplace",
    "url": "https://cloud.vast.ai/",
    "kind": "On-demand asks listed by hosts; not completed rentals",
}
NOTE = (
    "Median on-demand ask per GPU-hour from the offers Vast.ai's public bundles API returned "
    f"(at most {SAMPLE_CAP} per GPU). Hosts set these prices. They are not completed rentals, and "
    "not the full book when capped is true. The decision model's rental rates are not changed; "
    "model_rental_rate is the assumption that profile already ships with."
)

_lock = threading.Lock()
_refresh_lock = threading.Lock()
_history = {}
_state = {"expires": 0.0, "payload": None}


def _cell(k, v):
    if k in NUMERIC and v not in (None, ""):
        try:
            return float(v)
        except ValueError:
            return v
    return v


@lru_cache(maxsize=1)
def load_evidence():
    out = {}
    for key, (name, title) in SOURCES.items():
        with open(DATA / "sources" / name, newline="") as f:
            rows = [{k: _cell(k, v) for k, v in r.items()} for r in csv.DictReader(f)]
        out[key] = {"file": f"data/sources/{name}", "title": title, "rows": rows}
    return out


def reset_live_cache():
    """Drop the in-memory tape. Tests use this so one case cannot leak into the next."""
    with _lock:
        _state["expires"] = 0.0
        _state["payload"] = None
        _history.clear()


def feed_enabled():
    return os.getenv("MARKET_LIVE_FEED", "vast").strip().lower() not in ("0", "off", "false", "no")


def fetch_offers(gpu_name):
    """One page of public on-demand bundles for a GPU name. No API key."""
    query = {
        "gpu_name": {"eq": gpu_name},
        "rentable": {"eq": True},
        "num_gpus": {"gte": 1},
        "type": "on-demand",
        "limit": SAMPLE_CAP,
    }
    url = VAST_BUNDLES + "?" + urllib.parse.urlencode({"q": json.dumps(query, separators=(",", ":"))})
    req = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "User-Agent": "ReCompute/0.9 (rental tape; public offers only)",
    })
    try:
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
            data = json.load(resp)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"{gpu_name}: {exc}") from exc
    offers = data.get("offers") if isinstance(data, dict) else None
    if not isinstance(offers, list):
        raise RuntimeError(f"{gpu_name}: unexpected response")
    return offers


def per_gpu_prices(offers):
    prices = []
    for offer in offers:
        if not isinstance(offer, dict) or offer.get("is_bid"):
            continue
        gpus = offer.get("num_gpus")
        dph = offer.get("dph_total")
        if not isinstance(gpus, (int, float)) or gpus <= 0 or not isinstance(dph, (int, float)):
            continue
        price = dph / gpus
        if price <= 0 or price > PRICE_MAX:
            continue
        prices.append(price)
    return prices


def _round(n):
    return round(float(n), 4)


def summarize(spec, offers):
    prices = per_gpu_prices(offers)
    if not prices:
        return None
    median = _round(statistics.median(prices))
    hist = _history.setdefault(spec["key"], deque(maxlen=HISTORY_POINTS))
    previous = hist[-1] if hist else None
    hist.append(median)
    change = None
    if previous not in (None, 0):
        change = round((median - previous) / previous * 100, 2)
    profile = spec["profile"]
    rate = resolve_defaults(profile)["rental_rate"] if profile else None
    return {
        "key": spec["key"],
        "label": spec["label"],
        "gpu_name": spec["gpu_name"],
        "offers": len(prices),
        "capped": len(offers) >= SAMPLE_CAP,
        "median": median,
        "low": _round(min(prices)),
        "high": _round(max(prices)),
        "unit": "USD/GPU-hr",
        "previous": previous,
        "change_pct": change,
        "history": [ _round(v) for v in hist ],
        "in_model": profile is not None,
        "model_profile": profile,
        "model_rental_rate": rate,
    }


def _envelope(quotes, *, live, stale=False, error=None, note=NOTE):
    return {
        "model_version": MODEL_VERSION,
        "live": live,
        "stale": stale,
        "source": SOURCE,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "ttl_seconds": TTL_SECONDS,
        "sample_cap": SAMPLE_CAP,
        "note": note,
        "quotes": quotes,
        "error": error,
    }


def _disabled():
    return _envelope([], live=False, note="Live rental asks are turned off (MARKET_LIVE_FEED). The dated evidence is unchanged.")


def _refresh():
    raw = []
    missing = []
    with ThreadPoolExecutor(max_workers=len(WATCH)) as pool:
        futures = {pool.submit(fetch_offers, spec["gpu_name"]): spec for spec in WATCH}
        for fut in as_completed(futures):
            spec = futures[fut]
            try:
                raw.append((spec, fut.result()))
            except Exception:
                missing.append(spec["label"])
    order = {spec["key"]: i for i, spec in enumerate(WATCH)}
    with _lock:
        quotes = []
        for spec, offers in raw:
            quote = summarize(spec, offers)
            if quote:
                quotes.append(quote)
        quotes.sort(key=lambda q: order[q["key"]])
        if not quotes:
            detail = "No rental asks returned"
            if missing:
                detail += " (" + ", ".join(missing) + ")"
            raise RuntimeError(detail)
        note = NOTE
        if missing:
            note += " No usable asks for: " + ", ".join(missing) + "."
        payload = _envelope(quotes, live=True, note=note)
        _state["payload"] = payload
        _state["expires"] = time.monotonic() + TTL_SECONDS
        return payload


def live_quotes():
    if not feed_enabled():
        return _disabled()
    now = time.monotonic()
    with _lock:
        cached = _state["payload"]
        if cached and now < _state["expires"]:
            return cached
    with _refresh_lock:
        now = time.monotonic()
        with _lock:
            cached = _state["payload"]
            if cached and now < _state["expires"]:
                return cached
        try:
            return _refresh()
        except Exception as exc:
            with _lock:
                previous = _state["payload"]
                if previous and previous.get("quotes"):
                    stale = dict(previous)
                    stale["stale"] = True
                    stale["live"] = True
                    stale["error"] = "Vast.ai did not answer; showing the last reading."
                    _state["payload"] = stale
                    _state["expires"] = time.monotonic() + RETRY_SECONDS
                    return stale
            return _envelope([], live=False, error="Vast.ai did not answer, and there is no earlier reading.", note=NOTE)


@router.get("/market/evidence")
def market_evidence():
    return {
        "model_version": MODEL_VERSION,
        "live": False,
        "note": "Dated observations shipped with the model in data/sources. Not a live market feed. "
                "Each row carries its own status (SOURCED, DERIVED, HYPOTHESIS, TO_VERIFY) and retrieval date.",
        "sources": load_evidence(),
    }


@router.get("/market/live")
def market_live():
    return live_quotes()
