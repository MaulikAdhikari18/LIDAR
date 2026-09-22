"""
Baseline Benchmark Mode (Prototype Enhancement A3).

Runs the SAME synthetic scene under three modes and reports MEASURED
values only — no fabricated percentage improvements (explicit
requirement in the addendum, Sec. 6 & "Non-Negotiable" Sec. 3):

  1. Uniform high-resolution mapping        (every cell at finest 0.05 m)
  2. Simple distance-based adaptive resolution
         (near -> fine, middle -> medium, far -> coarse; distance is the
          ONLY input — this is exactly the "conventional approach" the
          master document Sec. 18 contrasts us against)
  3. Our method — utility-driven adaptive resolution via AdaptiveMapManager

Metrics reported (Sec. 6 "Recommended measurements"):
  - active cell count / memory footprint proxy
  - measured wall-clock processing time
  - resolution allocated at the two same-distance regions (pedestrian vs
    empty road patch) -> this is the numeric backbone of Demonstration D1
    and D2.
"""
from __future__ import annotations
import math
import time
from typing import Dict, List

from config import RESOLUTION_LEVELS, SCENE_X_RANGE, SCENE_Y_RANGE
from data.synthetic_scene import generate_synthetic_frame, PEDESTRIAN_START, STATIC_ROAD_PATCH_CENTER
from core.adaptive_map_manager import AdaptiveMapManager

FINE, MEDIUM, COARSE = RESOLUTION_LEVELS[2], RESOLUTION_LEVELS[1], RESOLUTION_LEVELS[0]
NEAR_BAND_M = 12.0
MID_BAND_M = 25.0


def _grid_cell_count(x_range, y_range, cell_size) -> int:
    nx = max(1, round((x_range[1] - x_range[0]) / cell_size))
    ny = max(1, round((y_range[1] - y_range[0]) / cell_size))
    return nx * ny


def run_baseline_uniform() -> dict:
    t0 = time.perf_counter()
    cell_count = _grid_cell_count(SCENE_X_RANGE, SCENE_Y_RANGE, FINE)
    elapsed = time.perf_counter() - t0
    return {
        "mode": "uniform_high_resolution",
        "active_cell_count": cell_count,
        "memory_footprint": float(cell_count),
        "processing_time_ms": round(elapsed * 1000, 4),
        "pedestrian_resolution_m": FINE,
        "static_patch_resolution_m": FINE,   # uniform -> everything is finest, including low-value cells
    }


def _distance_band_resolution(dist_m: float) -> float:
    if dist_m <= NEAR_BAND_M:
        return FINE
    if dist_m <= MID_BAND_M:
        return MEDIUM
    return COARSE


def run_baseline_distance() -> dict:
    """Conventional simplified approach (Master Doc Sec. 18): resolution is
    a pure function of distance, nothing else."""
    t0 = time.perf_counter()
    x0, x1 = SCENE_X_RANGE
    y0, y1 = SCENE_Y_RANGE

    # walk the coarsest grid and look up the distance-band resolution for
    # each coarse cell's centre, then count how many finer cells that
    # implies within the same footprint (so totals are comparable).
    total_cells = 0
    nx = max(1, round((x1 - x0) / COARSE))
    ny = max(1, round((y1 - y0) / COARSE))
    for i in range(nx):
        for j in range(ny):
            cx = x0 + (i + 0.5) * COARSE
            cy = y0 + (j + 0.5) * COARSE
            dist = math.hypot(cx, cy)
            res = _distance_band_resolution(dist)
            per_side = round(COARSE / res)
            total_cells += per_side * per_side

    ped_dist = math.hypot(*PEDESTRIAN_START[:2])
    patch_dist = math.hypot(*STATIC_ROAD_PATCH_CENTER[:2])
    elapsed = time.perf_counter() - t0
    return {
        "mode": "distance_based_adaptive",
        "active_cell_count": total_cells,
        "memory_footprint": float(total_cells),
        "processing_time_ms": round(elapsed * 1000, 4),
        "pedestrian_resolution_m": _distance_band_resolution(ped_dist),
        "static_patch_resolution_m": _distance_band_resolution(patch_dist),
        "note": "Same distance -> same resolution for both regions (this is exactly the limitation our method removes).",
    }


def run_our_method(warmup_frames: int = 15) -> dict:
    """Runs a FRESH AdaptiveMapManager (isolated from the live API map) for
    a few frames so tracking/confidence can settle, then reports the
    measured state on the final frame."""
    t0 = time.perf_counter()
    mgr = AdaptiveMapManager()
    summary = None
    for fid in range(warmup_frames):
        points, labels, _ = generate_synthetic_frame(fid)
        summary = mgr.process_frame(points, labels)
    elapsed = time.perf_counter() - t0

    ped_cell = _closest_region(summary["regions"], PEDESTRIAN_START[:2])
    patch_cell = _closest_region(summary["regions"], STATIC_ROAD_PATCH_CENTER[:2])

    return {
        "mode": "our_utility_driven_method",
        "active_cell_count": mgr.map.total_leaf_count(),
        "memory_footprint": mgr.map.memory_footprint_estimate(),
        "processing_time_ms": round((elapsed / warmup_frames) * 1000, 4),
        "pedestrian_resolution_m": ped_cell["resolution_m"] if ped_cell else None,
        "static_patch_resolution_m": patch_cell["resolution_m"] if patch_cell else None,
        "pedestrian_utility": ped_cell["utility"] if ped_cell else None,
        "static_patch_utility": patch_cell["utility"] if patch_cell else None,
        "budget_used": summary["budget"]["used"],
        "budget_total": summary["budget"]["total"],
    }


def _closest_region(regions: List[dict], xy) -> dict:
    best, best_d = None, float("inf")
    for r in regions:
        cx = (r["bounds"][0] + r["bounds"][2]) / 2.0
        cy = (r["bounds"][1] + r["bounds"][3]) / 2.0
        d = math.hypot(cx - xy[0], cy - xy[1])
        if d < best_d:
            best_d, best = d, r
    return best


def run_full_benchmark() -> dict:
    return {
        "uniform": run_baseline_uniform(),
        "distance_based": run_baseline_distance(),
        "our_method": run_our_method(),
    }
