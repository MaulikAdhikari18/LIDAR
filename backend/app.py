from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
import tempfile, os

from config import Config
from input.dataset_loader import DatasetLoader
from mapping.map_manager import MapManager
from tracking.tracker import Tracker
from prediction.future_occupancy import FuturePredictor
from allocation.budget_manager import BudgetManager
from controller import AdaptiveController

app = FastAPI(
    title="Adaptive Variable-Resolution 2.5D LiDAR",
    version="1.0.0",
    description="Utility-driven, predictive, budget-constrained adaptive 2.5D LiDAR mapping backend."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

config = Config()
dataset = DatasetLoader(config)
map_manager = MapManager(config)
tracker = Tracker(config)
predictor = FuturePredictor(config)
allocator = BudgetManager(config)
controller = AdaptiveController(config, map_manager, tracker, predictor, allocator)

state = {"frame_id": 0, "last_result": None}

# --- Startup bootstrap -------------------------------------------------------
# Every object above is a module-level singleton built at import time, so ALL
# dataset state dies with the process. Before this bootstrap existed, a demo
# required two manual POSTs (/api/dataset/path then /api/config) after every
# single restart -- and `reload=True` below means any backend file edit restarts
# the process silently. Forgetting them produced a 404 from /api/frame
# ("No dataset frame available") with a frontend that still showed a green
# "SYSTEM ONLINE" header, i.e. a dead demo that looked alive.
#
# Both steps now happen automatically. Override either with an env var:
#   FOVEAMAP_DATASET=/path/to/sequences/00     (or a .zip, or a velodyne dir)
#   FOVEAMAP_BUDGET=5000
# Failure here is never fatal: we warn and fall back to the old manual flow,
# because a backend that boots and serves /api/config is far easier to debug
# than one that refuses to start.

def _dataset_candidates():
    """Ordered paths to try when FOVEAMAP_DATASET is unset.

    Deliberately narrow -- `DatasetLoader._discover` uses rglob() and treats
    .txt/.csv as point clouds, so pointing at a broad root risks ingesting
    calib.txt or poses.txt as LiDAR frames. A sequence dir is safe: .label
    files are not a supported extension, so only the .bin files are picked up.
    """
    repo = Path(__file__).resolve().parent.parent
    data = repo / "FoveaMap_Data" / "dataset" / "sequences"
    seqs = sorted(p for p in data.glob("*") if p.is_dir()) if data.is_dir() else []
    return [s for s in seqs] + [s / "velodyne" for s in seqs]


def _bootstrap():
    budget = os.getenv("FOVEAMAP_BUDGET")
    if budget:
        try:
            config.update({"computational_budget": float(budget)})
        except ValueError:
            print(f"[bootstrap] WARNING: FOVEAMAP_BUDGET={budget!r} is not a number; "
                  f"keeping {config.computational_budget}")
    print(f"[bootstrap] computational_budget = {config.computational_budget}")

    override = os.getenv("FOVEAMAP_DATASET")
    candidates = [Path(override).expanduser()] if override else _dataset_candidates()
    if not candidates:
        print("[bootstrap] WARNING: no dataset found automatically. "
              "POST /api/dataset/path before calling /api/frame.")
        return

    for path in candidates:
        try:
            dataset.load_path(str(path))
        except Exception as exc:
            print(f"[bootstrap] skipped {path}: {type(exc).__name__}: {exc}")
            continue
        st = dataset.status()
        labelled = dataset._find_kitti_label(dataset.files[0]) is not None
        print(f"[bootstrap] dataset loaded: {st['frames']} frames from {st['source']} "
              f"(ground-truth labels: {'yes' if labelled else 'NO -- semantics will be degraded'})")
        return

    print("[bootstrap] WARNING: every candidate dataset path failed. "
          "POST /api/dataset/path before calling /api/frame.")


_bootstrap()
# ---------------------------------------------------------------------------

class ConfigUpdate(BaseModel):
    resolution_levels: list[float] | None = None
    computational_budget: float | None = None
    prediction_horizon: float | None = None
    wS: float | None = None
    wM: float | None = None
    wU: float | None = None
    wG: float | None = None
    wD: float | None = None
    wP: float | None = None
    refine_threshold: float | None = None
    coarsen_threshold: float | None = None
    max_stale_frames: int | None = None

@app.get("/")
def root():
    return {
        "service": "Adaptive Variable-Resolution 2.5D LiDAR Backend",
        "status": "running",
        "docs": "/docs",
        "dataset": dataset.status()
    }

@app.get("/api/state")
def get_state():
    return controller.serialize_state(state["last_result"])

@app.post("/api/frame")
def next_frame():
    frame = dataset.next_frame()
    if frame is None:
        raise HTTPException(status_code=404, detail="No dataset frame available. Upload/configure a dataset first.")
    state["frame_id"] += 1
    result = controller.process_frame(frame, state["frame_id"])
    state["last_result"] = result
    return result

@app.post("/api/reset")
def reset():
    global dataset, map_manager, tracker, predictor, allocator, controller
    dataset.reset()
    map_manager = MapManager(config)
    tracker = Tracker(config)
    predictor = FuturePredictor(config)
    allocator = BudgetManager(config)
    controller = AdaptiveController(config, map_manager, tracker, predictor, allocator)
    state["frame_id"] = 0
    state["last_result"] = None
    return {"ok": True, "dataset": dataset.status()}

@app.get("/api/config")
def get_config():
    """Read back the live config.

    Previously the only way to see the running config was to POST an empty
    body to /api/config, so the frontend hardcoded its own copy of
    computational_budget and map_dimensions. Those duplicated constants drifted
    out of sync with config.py, which silently rescaled every per-region budget
    figure in the UI. With a real GET the frontend can just ask.
    """
    return {"ok": True, "config": config.to_dict()}

@app.post("/api/config")
def update_config(update: ConfigUpdate):
    data = update.model_dump(exclude_none=True)
    config.update(data)
    controller.refresh_config(config)
    dataset.config = config
    return {"ok": True, "config": config.to_dict()}

@app.get("/api/decisions")
def decisions(limit: int = 200):
    return controller.decision_log[-limit:]

@app.get("/api/dataset")
def dataset_status():
    return dataset.status()

@app.post("/api/dataset/upload")
async def upload_dataset(file: UploadFile = File(...)):
    allowed = {".zip", ".npy", ".npz", ".pcd", ".ply", ".bin", ".csv", ".txt"}
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in allowed:
        raise HTTPException(status_code=400, detail=f"Unsupported dataset format: {suffix}")

    temp_dir = Path(tempfile.gettempdir()) / "adaptive_lidar_uploads"
    temp_dir.mkdir(exist_ok=True)
    target = temp_dir / (Path(file.filename).name)
    target.write_bytes(await file.read())

    try:
        dataset.load_path(str(target))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {"ok": True, "dataset": dataset.status()}

@app.post("/api/dataset/path")
def set_dataset_path(payload: dict):
    path = payload.get("path")
    if not path:
        raise HTTPException(status_code=400, detail="path is required")
    try:
        dataset.load_path(path)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "dataset": dataset.status()}

@app.get("/api/baseline")
def baseline():
    if not state["last_result"]:
        raise HTTPException(status_code=400, detail="Generate a frame first")
    return controller.baseline_compare(state["last_result"])

@app.get("/api/metrics")
def metrics():
    return controller.metrics_summary()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=True)