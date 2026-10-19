import csv
import io
from collections import Counter

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import ValidationError
from sqlalchemy.orm import Session

from .assets import AssetCreate, create_asset
from .batches import new_batch
from .fleet import summarize, totals
from .db import Asset, get_session
from .output import MODEL_ERROR, checked_recommend
from .repairs import effective_inputs
from .schema import TOO_LARGE, AssetInputs

router = APIRouter(prefix="/assets/upload", tags=["upload"])

MAX_BYTES = 5_000_000
MAX_ROWS = 5000

DESCRIPTIVE = {"asset_id", "model", "grade", "age_months", "site", "failed_part", "synthetic"}
INPUTS = set(AssetInputs.model_fields)
IGNORED = {"route", "after_repair", "route_value", "sell_now_value", "gain_vs_baseline"}
BOOL = {"health_pass", "repairable", "synthetic"}
INT = {"gpus", "horizon_months", "age_months"}
TEXT = {"asset_id", "model", "grade", "site", "failed_part", "asset_profile", "ownership"}
TRUE, FALSE = {"true", "yes", "y", "1"}, {"false", "no", "n", "0"}

TEMPLATE_COLUMNS = [
    "asset_id", "model", "grade", "age_months", "site", "failed_part", "asset_profile", "ownership",
    "health_pass", "repairable", "gpus", "server_kw", "offer_today", "market_price", "dwell_days",
    "rental_rate", "utilization", "harvest_value", "repair_parts_cost", "repair_days",
]
TEMPLATE_ROWS = [
    ["SRV-0001", "8x A100 80GB", "A", "36", "Phoenix AZ", "", "a100_8x", "owned",
     "true", "", "8", "6.5", "58000", "64000", "45", "", "", "", "", ""],
    ["SRV-0002", "8x H100 80GB", "B", "20", "Phoenix AZ", "PSU", "h100_8x", "owned",
     "false", "true", "", "", "", "", "", "", "", "", "600", "3"],
]


def parse(field, raw):
    v = raw.strip()
    if field in TEXT:
        return v
    if field in BOOL:
        if v.lower() in TRUE:
            return True
        if v.lower() in FALSE:
            return False
        raise ValueError("must be true or false")
    try:
        n = float(v.replace(",", "").replace("$", ""))
    except ValueError:
        raise ValueError("must be a number")
    if field in INT:
        if n != int(n):
            raise ValueError("must be a whole number")
        return int(n)
    return n


def read_rows(data: bytes):
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(422, "file must be a UTF-8 CSV")
    reader = csv.DictReader(io.StringIO(text))
    try:
        fieldnames = reader.fieldnames
    except csv.Error as e:
        raise HTTPException(422, f"could not read the CSV: {e}")
    if not fieldnames:
        raise HTTPException(422, "file is empty")
    columns = [c.strip() for c in fieldnames]
    if "asset_id" not in columns:
        raise HTTPException(422, "missing required column asset_id")
    unknown = [c for c in columns if c and c not in DESCRIPTIVE | INPUTS | IGNORED]
    if unknown:
        raise HTTPException(422, {"message": "unknown columns; check spelling against the spec",
                                  "unknown_columns": unknown})
    dupes = [c for c, n in Counter(columns).items() if n > 1]
    if dupes:
        raise HTTPException(422, {"message": "duplicate columns", "duplicate_columns": dupes})
    try:
        rows = [{k.strip(): (v or "") for k, v in r.items() if k} for r in reader]
    except csv.Error as e:
        raise HTTPException(422, f"could not read the CSV: {e}")
    if not rows:
        raise HTTPException(422, "file has a header but no rows")
    if len(rows) > MAX_ROWS:
        raise HTTPException(413, f"at most {MAX_ROWS} rows per upload")
    return columns, rows


def build(row, line):
    errors, desc, inputs = [], {}, {}
    for field, raw in row.items():
        if field in IGNORED or raw.strip() == "":
            continue
        try:
            value = parse(field, raw)
        except ValueError as e:
            errors.append({"row": line, "field": field, "value": raw, "error": str(e)})
            continue
        (desc if field in DESCRIPTIVE else inputs)[field] = value
    if errors:
        return None, errors
    try:
        body = AssetCreate(**desc, inputs=AssetInputs(**inputs))
    except ValidationError as e:
        for err in e.errors():
            field = str(err["loc"][-1]) if err["loc"] else "row"
            errors.append({"row": line, "field": field, "value": row.get(field, ""), "error": err["msg"]})
        return None, errors
    return body, []


@router.post("", responses={**TOO_LARGE, **MODEL_ERROR})
def upload(file: UploadFile = File(...), dry_run: bool = Query(False), skip_existing: bool = Query(False),
           session: Session = Depends(get_session)):
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, f"file is larger than {MAX_BYTES // 1_000_000} MB")
    columns, rows = read_rows(data)

    errors, bodies, seen, skipped = [], [], {}, []
    for i, row in enumerate(rows, start=2):
        body, errs = build(row, i)
        if errs:
            errors.extend(errs)
            continue
        if body.asset_id in seen:
            errors.append({"row": i, "field": "asset_id", "value": body.asset_id,
                           "error": f"repeats row {seen[body.asset_id]}"})
            continue
        seen[body.asset_id] = i
        if session.get(Asset, body.asset_id):
            if skip_existing:
                skipped.append(body.asset_id)
                continue
            errors.append({"row": i, "field": "asset_id", "value": body.asset_id,
                           "error": "already exists; send skip_existing=true to skip it"})
            continue
        bodies.append((i, body))

    if errors:
        raise HTTPException(422, {"message": f"{len(errors)} problem(s) found; nothing was saved",
                                  "errors": errors[:200]})

    batch = None if dry_run or not bodies else new_batch(session, "upload", file.filename)
    results = []
    for i, body in bodies:
        if dry_run:
            inputs, _, _ = effective_inputs(body.inputs.to_model(), body.failed_part, body.model)
            values = summarize(inputs, checked_recommend(inputs))
        else:
            rec = create_asset(session, body, batch.batch_id).recommendations[-1]
            values = summarize(rec.inputs, rec.result)
        results.append({"row": i, "asset_id": body.asset_id, **values})
    if not dry_run:
        session.commit()

    return {
        "dry_run": dry_run,
        "batch_id": batch and batch.batch_id,
        "added": 0 if dry_run else len(results),
        "would_add": len(results) if dry_run else 0,
        "skipped": skipped,
        "ignored_columns": [c for c in columns if c in IGNORED],
        "routes": dict(Counter(r["route"] for r in results)),
        "totals": totals(results),
        "assets": results,
    }


@router.get("/template", response_class=PlainTextResponse)
def template():
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(TEMPLATE_COLUMNS)
    w.writerows(TEMPLATE_ROWS)
    return PlainTextResponse(out.getvalue(), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="recompute_upload_template.csv"'})
