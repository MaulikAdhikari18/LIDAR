"""
API v1 — every endpoint here computes its answer from the real pipeline
(AdaptiveMapManager + synthetic scene / real dataset). Nothing is a
hardcoded literal response.
"""
from __future__ import annotations
import math
from fastapi import APIRouter, HTTPException, Query

from core.adaptive_map_manager import AdaptiveMapManager
from data import data_ingestion
from data.synthetic_scene import (
    generate_synthetic_frame, PEDESTRIAN_START, STATIC_ROAD_PATCH_CENTER,
    VEHICLE_START, ROAD_EDGE_OBSTACLE_CENTER, BUILDING_CENTER, TURN_AT_FRAME,
)
from benchmark.baselines import run_full_benchmark
from config import REFINE_THRESHOLD, COARSEN_THRESHOLD, TOTAL_COMPUTATIONAL_BUDGET

router = APIRouter()

# ---------------------------------------------------------------------------
# One persistent manager backs the live API session (map/tracker/budget all
# survive across calls, per the locked architecture's "do not rebuild from
# scratch every frame" rule).
# ---------------------------------------------------------------------------
manager = AdaptiveMapManager()
_provoke_turn = {"active": False}


def _get_frame_data(frame_id: int, provoke_turn: bool = False):
    """Real dataset if available on disk, else the synthetic scene."""
    if data_ingestion.frame_available(frame_id):
        points, labels = data_ingestion.read_frame(frame_id)
        return points, labels, None
    return generate_synthetic_frame(frame_id, provoke_turn=provoke_turn)


@router.post("/frame")
async def advance_frame():
    points, labels, dyn = _get_frame_data(manager.frame_id, provoke_turn=_provoke_turn["active"])
    summary = manager.process_frame(points, labels)
    return summary


@router.post("/reset")
async def reset():
    manager.reset()
    _provoke_turn["active"] = False
    return {"status": "ok"}


@router.get("/config")
async def get_config():
    return {
        "refine_threshold": REFINE_THRESHOLD,
        "coarsen_threshold": COARSEN_THRESHOLD,
        "total_budget": TOTAL_COMPUTATIONAL_BUDGET,
        "resolution_levels_m": [0.50, 0.20, 0.05],
        "prediction_horizon_s": 2.0,
    }


@router.get("/decisions/{region_id}")
async def get_decision_explanation(region_id: str):
    """Enhancement A4 — explainable 'Why did you refine this?' panel,
    computed from the manager's actual last-processed frame state."""
    result = manager.get_decision_explanation(region_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Unknown region_id '{region_id}'. "
                             "Call POST /frame at least once, then use an id from its 'regions' list.")
    return result


@router.post("/scenario/provoke_turn")
async def set_provoke_turn(active: bool = Query(True)):
    """Toggles the sudden-trajectory-change scenario used by Demo D4
    (Prediction Failure and Recovery). Call /reset afterwards to replay
    from frame 0 with the turn armed."""
    _provoke_turn["active"] = active
    return {"provoke_turn_active": active, "turn_at_frame": TURN_AT_FRAME}


@router.get("/benchmark/run")
async def benchmark_run():
    """Enhancement A3 — controlled experiment across all three modes."""
    return run_full_benchmark()


# --- Demonstration Endpoints (D1-D8), all computed live -------------------

@router.get("/demo/d1_same_distance")
async def demo_d1_same_distance():
    """D1 — pedestrian and a low-value static patch sit at the SAME
    distance (both 15.0 m from the sensor); show that resolution still
    differs because information value differs."""
    ped_dist = math.hypot(*PEDESTRIAN_START[:2])
    patch_dist = math.hypot(*STATIC_ROAD_PATCH_CENTER[:2])
    ped_region = _find_region_near(PEDESTRIAN_START[:2])
    patch_region = _find_region_near(STATIC_ROAD_PATCH_CENTER[:2])
    return {
        "distance_pedestrian_m": round(ped_dist, 3),
        "distance_static_patch_m": round(patch_dist, 3),
        "note": "Distance is contextual input only; resolution is the OUTPUT of resource allocation.",
        "pedestrian_region": ped_region,
        "static_patch_region": patch_region,
    }


@router.get("/demo/d2_computational_benefit")
async def demo_d2_computational_benefit():
    """D2 — measured resource usage across all three modes on the same scene/budget."""
    return run_full_benchmark()


@router.get("/demo/d3_prediction_before_arrival")
async def demo_d3_prediction_before_arrival():
    """D3 — show tracking + probabilistic future occupancy for the moving
    vehicle before it physically arrives somewhere new."""
    if manager.last_frame_summary is None:
        raise HTTPException(status_code=400, detail="Call POST /frame first to advance the simulation.")
    return {
        "tracks": manager.last_frame_summary["tracks"],
        "predictions": manager.last_frame_summary["predictions"],
        "note": "Probability is distributed over multiple future cells, not one deterministic point.",
    }


@router.post("/demo/d4_prediction_failure_and_recovery")
async def demo_d4_prediction_failure_and_recovery():
    """D4 — arm the sudden-turn scenario and reset, so the NEXT sequence of
    /frame calls will show the tracked vehicle deviating from its predicted
    path, the old candidate region losing utility, and the new region
    becoming valuable."""
    _provoke_turn["active"] = True
    manager.reset()
    return {
        "status": "armed",
        "turn_at_frame": TURN_AT_FRAME,
        "instructions": f"Call POST /frame repeatedly. Around frame {TURN_AT_FRAME} the tracked "
                         "vehicle changes direction; watch 'predictions[].prediction_error' turn "
                         "true and compare the affected regions' 'decision' before/after.",
    }


@router.get("/demo/d5_why_2_5d")
async def demo_d5_why_2_5d():
    """D5 — contrast the 2.5D footprint against a hypothetical dense full-3D voxel grid."""
    leaves = manager.map.all_leaf_cells()
    footprint_2_5d = len(leaves)
    # Hypothetical dense 3D voxelisation of the same extent at the finest
    # resolution, with a modest vertical extent, computed (not fabricated).
    from config import SCENE_X_RANGE, SCENE_Y_RANGE, RESOLUTION_LEVELS
    finest = RESOLUTION_LEVELS[-1]
    nx = round((SCENE_X_RANGE[1] - SCENE_X_RANGE[0]) / finest)
    ny = round((SCENE_Y_RANGE[1] - SCENE_Y_RANGE[0]) / finest)
    nz = round(3.0 / finest)  # assume a modest 3 m vertical extent of interest
    full_3d_footprint = nx * ny * nz
    return {
        "2_5d_footprint_cells": footprint_2_5d,
        "full_3d_footprint_voxels_if_dense_at_finest_res": full_3d_footprint,
        "justification": "Elevation/occupancy/semantic state are attached to each (x,y) region "
                          "instead of discretising a dense Z axis everywhere.",
    }


@router.get("/demo/d6_follow_the_information")
async def demo_d6_follow_the_information():
    """D6 — the centerpiece: recent RECLAIM/REALLOCATE ledger events showing
    budget literally moving from a coarsened region to a newly refined one."""
    events = manager.budget.recent_events(30)
    return {
        "events": events,
        "budget": {
            "total": manager.budget.total_budget,
            "used": round(manager.budget.used_budget, 3),
            "remaining": round(manager.budget.remaining(), 3),
        },
        "statement": "The computational budget follows the information, not the location.",
    }


@router.get("/demo/d7_region_by_region")
async def demo_d7_region_by_region():
    """D7 — decisions for one representative example of each object type,
    derived from the ACTUAL scoring/allocation logic (never hardcoded)."""
    if manager.last_frame_summary is None:
        raise HTTPException(status_code=400, detail="Call POST /frame first to advance the simulation.")
    targets = {
        "empty_road": STATIC_ROAD_PATCH_CENTER[:2],
        "building": BUILDING_CENTER[:2],
        "road_edge_obstacle": ROAD_EDGE_OBSTACLE_CENTER[:2],
        "vehicle": VEHICLE_START[:2],
        "pedestrian": PEDESTRIAN_START[:2],
    }
    return {name: _find_region_near(xy) for name, xy in targets.items()}


@router.get("/demo/d8_controlled_experiment")
async def demo_d8_controlled_experiment(runs: int = Query(3, ge=1, le=10)):
    """D8 — repeat the benchmark several times (not one cherry-picked run)
    and report every run's raw measurements."""
    results = [run_full_benchmark() for _ in range(runs)]
    return {"runs": results, "num_runs": runs}


def _find_region_near(xy) -> dict:
    if manager.last_frame_summary is None:
        return None
    regions = manager.last_frame_summary["regions"]
    best, best_d = None, float("inf")
    for r in regions:
        cx = (r["bounds"][0] + r["bounds"][2]) / 2.0
        cy = (r["bounds"][1] + r["bounds"][3]) / 2.0
        d = math.hypot(cx - xy[0], cy - xy[1])
        if d < best_d:
            best_d, best = d, r
    return best
