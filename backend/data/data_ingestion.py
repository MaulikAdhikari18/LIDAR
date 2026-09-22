"""
Real LiDAR dataset ingestion — SemanticPOSS / KITTI-style .bin + .label files.

Point-cloud preprocessing (Master Doc Sec. 13, step "Point-cloud
preprocessing"): here we do the minimum required to make raw scans usable —
reshaping to (N,4), decoding packed semantic/instance labels, and dropping
NaN/inf rows.

If DATASET_ROOT is not set or the requested frame doesn't exist on disk,
`frame_available()` returns False and the caller (api/v1/endpoints.py)
transparently falls back to the synthetic scene generator
(data/synthetic_scene.py), so the whole backend runs on any machine.

The dataset root can be set two ways:
  1. At process start, via the FOVEAMAP_DATASET_ROOT / FOVEAMAP_SEQUENCE
     environment variables (read once below as the initial default).
  2. At runtime, via set_dataset_root() — this is what the frontend's
     POST /api/dataset/path calls, so a dataset can be pointed at without
     restarting the server.
"""
from __future__ import annotations
import os
import numpy as np

# Mutable module-level state (not a frozen constant) so set_dataset_root()
# can change it while the server is running.
_state = {
    "root": os.environ.get("FOVEAMAP_DATASET_ROOT", ""),
    "sequence": os.environ.get("FOVEAMAP_SEQUENCE", "00"),
}


def set_dataset_root(path: str, sequence: str = "00") -> None:
    """Point the ingestion layer at a new dataset root at runtime."""
    _state["root"] = path or ""
    _state["sequence"] = sequence or "00"


def get_dataset_root() -> str:
    return _state["root"]


def get_sequence() -> str:
    return _state["sequence"]


def _sequence_path() -> str:
    return os.path.join(_state["root"], "sequences", _state["sequence"])


def frame_paths(frame_id: int):
    seq = _sequence_path()
    bin_file = os.path.join(seq, "velodyne", f"{frame_id:06d}.bin")
    label_file = os.path.join(seq, "labels", f"{frame_id:06d}.label")
    return bin_file, label_file


def frame_available(frame_id: int) -> bool:
    if not _state["root"]:
        return False
    bin_file, label_file = frame_paths(frame_id)
    return os.path.exists(bin_file) and os.path.exists(label_file)


def total_frames() -> int:
    """Count of available .bin frames in the current sequence, or 0 if
    no dataset is configured / the folder doesn't exist. Used by the
    frontend's 'Frame 42 / 1000' progress display."""
    if not _state["root"]:
        return 0
    velodyne_dir = os.path.join(_sequence_path(), "velodyne")
    if not os.path.isdir(velodyne_dir):
        return 0
    return len([f for f in os.listdir(velodyne_dir) if f.endswith(".bin")])


def list_sequences() -> list[str]:
    """Sub-folder names directly under <root>/sequences/ (e.g. ["00", "01",
    ..., "05"]), sorted -- lets the frontend offer a sequence picker instead
    of requiring the sequence name to be typed by hand. Empty if no root is
    set or the sequences/ folder doesn't exist."""
    if not _state["root"]:
        return []
    sequences_dir = os.path.join(_state["root"], "sequences")
    if not os.path.isdir(sequences_dir):
        return []
    return sorted(
        name for name in os.listdir(sequences_dir)
        if os.path.isdir(os.path.join(sequences_dir, name))
    )


def read_points(bin_file: str) -> np.ndarray:
    """x, y, z, intensity — standard KITTI/SemanticPOSS .bin layout."""
    points = np.fromfile(bin_file, dtype=np.float32)
    points = points.reshape(-1, 4)
    points = points[np.isfinite(points).all(axis=1)]  # preprocessing: drop bad rows
    return points


def read_semlabels(label_file: str) -> np.ndarray:
    raw = np.fromfile(label_file, dtype=np.uint32)
    return (raw & 0xFFFF).astype(np.int64)


def read_inslabels(label_file: str) -> np.ndarray:
    raw = np.fromfile(label_file, dtype=np.uint32)
    return (raw >> 16).astype(np.int64)


def read_frame(frame_id: int):
    """Convenience: returns (points, semantic_labels) for a real dataset
    frame. Caller must check frame_available() first."""
    bin_file, label_file = frame_paths(frame_id)
    points = read_points(bin_file)
    labels = read_semlabels(label_file)
    n = min(len(points), len(labels))
    return points[:n], labels[:n]