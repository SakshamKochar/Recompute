import io
import shutil
import tarfile
import tempfile
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from .assets import AssetCreate, asset_out, create_asset
from .batches import new_batch
from .db import Asset, Batch, get_session
from .diagnose import DATA, DEMO_SELLERS, DiagnoseError, diagnose_capture
from .output import MODEL_ERROR, checked_recommend
from pydantic import ValidationError

from .schema import AssetInputs, error

router = APIRouter(tags=["diagnostics"])

MAX_BYTES = 50_000_000
MAX_EXTRACTED = 50_000_000
MAX_MEMBERS = 500


def extract_capture(data, dest):
    """Unpack a capture safely: regular files and folders only, no paths outside dest, bounded size.
    Returns the folder holding the capture files."""
    try:
        tar = tarfile.open(fileobj=io.BytesIO(data), mode="r:*")
    except (tarfile.TarError, EOFError, OSError):
        raise DiagnoseError("could not read the NVIDIA files: not a .tar.gz capture")
    root = Path(dest).resolve()
    count, total = 0, 0
    with tar:
        while True:
            try:
                m = tar.next()
            except (tarfile.TarError, EOFError, OSError):
                raise DiagnoseError("could not read the NVIDIA files: the archive is damaged")
            if m is None:
                break
            count += 1
            if count > MAX_MEMBERS:
                raise DiagnoseError(f"capture has more than {MAX_MEMBERS} entries")
            target = (root / m.name).resolve()
            inside = target == root or str(target).startswith(str(root) + "/")
            if not inside or not (m.isfile() or m.isdir()):
                raise DiagnoseError(f"could not read the NVIDIA files: unsafe or unsupported entry in archive: {m.name}")
            if m.isfile():
                total += m.size
                if total > MAX_EXTRACTED:
                    raise DiagnoseError("capture unpacks to more than 50 MB")
            try:
                if m.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                src = tar.extractfile(m)
                with open(target, "wb") as out:
                    if src:
                        shutil.copyfileobj(src, out)
            except (OSError, tarfile.TarError):
                raise DiagnoseError(f"could not read the NVIDIA files: conflicting or damaged entry in archive: {m.name}")
    dirs = [d for d in root.iterdir() if d.is_dir()]
    return dirs[0] if len(dirs) == 1 and not any(f.is_file() for f in root.iterdir()) else root
DEMO_BATCH = "DEMO-SELLERS"
BAD_CAPTURE = {422: error("The capture could not be read or graded", "could not read the NVIDIA files: not a capture folder or .tar.gz")}


def failed_part_of(d):
    parts = (["GPU"] if d["failed_gpus"] else []) + [f["part"] for f in d["chassis_faults"]]
    return ", ".join(dict.fromkeys(parts)) or None


def body_for(asset_id, model, site, ownership, d, inputs, synthetic=False):
    return AssetCreate(asset_id=asset_id, model=model, site=site, grade=d["grade"], failed_part=failed_part_of(d),
                       synthetic=synthetic, inputs=AssetInputs(**inputs, ownership=ownership))


@router.post("/assets/diagnose", status_code=201, responses={**BAD_CAPTURE, **MODEL_ERROR,
             409: error("An asset with this ID already exists", "asset SRV-9 already exists"),
             413: error("Capture over 50 MB", "capture is larger than 50 MB")})
def post_diagnose(file: UploadFile = File(..., description="The .tar.gz from tools/capture_nvidia.sh"),
                        asset_id: str = Form(..., pattern=r"^[A-Za-z0-9_-]{1,64}$"),
                        model: str = Form(..., description="Names the GPU and memory, like 8x A100 80GB"),
                        site: str | None = Form(None),
                        ownership: Literal["owned", "client_approved", "consigned"] = Form("owned"),
                        dry_run: bool = Query(False), session: Session = Depends(get_session)):
    """Grade a server from NVIDIA's own test output and run the model on it. ReCompute runs no GPU tests."""
    if not dry_run and session.get(Asset, asset_id):
        raise HTTPException(409, f"asset {asset_id} already exists")
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "capture is larger than 50 MB")
    with tempfile.TemporaryDirectory() as tmp:
        try:
            d, inputs = diagnose_capture(extract_capture(data, tmp), model)
            body = body_for(asset_id, model, site, ownership, d, inputs)
        except DiagnoseError as e:
            raise HTTPException(422, str(e))
        except ValidationError as e:
            raise HTTPException(422, "the graded server is outside the model's ranges: "
                                + "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors()))
    if dry_run:
        return {"dry_run": True, "diagnostics": d, "inputs": body.inputs.to_model(),
                "result": checked_recommend(body.inputs.to_model())}
    asset = create_asset(session, body, diagnostics=d)
    session.commit()
    return asset_out(asset)


@router.post("/demo/sellers", responses=MODEL_ERROR)
def seed_demo_sellers(session: Session = Depends(get_session)):
    """Load the four demo sellers from SIMULATED NVIDIA files (data/demo_inputs), graded by the same code
    a real upload uses. Safe to call twice."""
    if not session.get(Batch, DEMO_BATCH):
        new_batch(session, "demo", "data/demo_inputs", DEMO_BATCH)
    added, skipped = [], []
    for seller, model in DEMO_SELLERS.items():
        asset_id = f"DEMO-{seller.upper()}"
        if session.get(Asset, asset_id):
            skipped.append(asset_id)
            continue
        d, inputs = diagnose_capture(DATA / "demo_inputs" / seller, model)
        d["simulated"] = True
        create_asset(session, body_for(asset_id, model, None, "owned", d, inputs, synthetic=True), DEMO_BATCH, d)
        added.append(asset_id)
    session.commit()
    return {"added": added, "skipped": skipped, "batch_id": DEMO_BATCH}
