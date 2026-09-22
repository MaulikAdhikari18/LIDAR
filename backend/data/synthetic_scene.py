"""
Synthetic LiDAR Scene Generator.

Master Doc Sec. 19 ("Prototype Requirements") explicitly calls for a
"Synthetic LiDAR scene with road, building, pedestrian, moving vehicle and
road edge/obstacle" — this module IS that scene. It is used automatically
whenever a real dataset frame is not available
(data/data_ingestion.frame_available() == False), so every endpoint in
this backend runs out of the box on any machine.

The scene is deliberately built so that a pedestrian and an empty-road
patch sit at the SAME distance from the sensor (both exactly 15 m) —
this directly feeds Demonstration D1 ("Same Distance, Different
Resolution") without any hardcoding on the API side; the distance really
is identical, and only the downstream utility calculation differs.

Objects animate frame to frame using simple constant-velocity motion, and
`provoke_turn=True` lets a caller trigger a sudden trajectory change for
Demonstration D4 (Prediction Failure and Recovery).
"""
from __future__ import annotations
from typing import List, Tuple
import math
import numpy as np

from config import SCENE_X_RANGE, SCENE_Y_RANGE, FRAME_DT_SECONDS

RNG = np.random.default_rng(42)

# label ids consistent with config.SEMANTIC_CLASS_MAP
LABEL_GROUND = 22
LABEL_BUILDING = 15
LABEL_PERSON = 4
LABEL_CAR = 7
LABEL_POLE = 13
LABEL_CURB = 40  # synthetic-only "uncertain road edge" object

TURN_AT_FRAME = 30          # frame index at which provoked objects change direction
VEHICLE_START = np.array([8.0, 5.0, 0.0])
VEHICLE_VELOCITY = np.array([0.0, 3.0, 0.0])       # heading up the +y road
VEHICLE_TURN_VELOCITY = np.array([2.5, 1.0, 0.0])  # sudden turn for D4

PEDESTRIAN_START = np.array([0.0, 15.0, 0.0])       # distance 15.0 from sensor at origin
PEDESTRIAN_VELOCITY = np.array([0.9, 0.0, 0.0])

STATIC_ROAD_PATCH_CENTER = np.array([15.0, 0.0, 0.0])   # distance 15.0 too -> same-distance pair
ROAD_EDGE_OBSTACLE_CENTER = np.array([-8.0, 20.0, 0.0])
BUILDING_CENTER = np.array([19.0, 37.0, 0.0])


def _cluster(center: np.ndarray, n: int, spread: float, intensity_mean: float,
             intensity_std: float = 0.05, position_noise_extra: float = 0.0) -> np.ndarray:
    pts = RNG.normal(loc=center, scale=spread, size=(n, 3))
    pts[:, 2] = np.abs(pts[:, 2]) * 0.3  # small positive elevation jitter
    if position_noise_extra > 0:
        # extra per-frame positional scatter -- simulates the genuinely
        # ambiguous / noisy returns a real curb, pothole, or road-edge
        # obstacle produces (points don't settle into a clean, confident
        # shape frame to frame the way a solid object's do).
        pts[:, :2] += RNG.normal(0, position_noise_extra, size=(n, 2))
    intensity = np.clip(RNG.normal(intensity_mean, intensity_std, size=(n, 1)), 0.0, 1.0)
    return np.hstack([pts, intensity])


def _terrain_carpet(n: int) -> np.ndarray:
    """
    A regular, stable grid of ground points (one per base map cell, with
    small positional jitter) rather than points re-sampled at brand-new
    random locations every frame. Real LiDAR ground returns are highly
    consistent frame to frame for static, flat terrain -- the same patch
    of road reflects a return almost every sweep. Fully re-randomising
    terrain point LOCATIONS every frame (so a given cell is hit on some
    frames and missed on others purely by chance) would make even
    perfectly boring, static ground look intermittently "unobserved",
    artificially inflating its uncertainty signal and triggering spurious
    refinement of empty background (see AdaptiveMapManager's confidence
    model). A stable grid with only small per-frame jitter avoids that.
    """
    x0, x1 = SCENE_X_RANGE
    y0, y1 = SCENE_Y_RANGE
    side = max(4, int(round(math.sqrt(n))))
    xs_grid = np.linspace(x0 + 0.25, x1 - 0.25, side)
    ys_grid = np.linspace(y0 + 0.25, y1 - 0.25, side)
    gx, gy = np.meshgrid(xs_grid, ys_grid)
    xs = gx.ravel() + RNG.normal(0, 0.05, size=gx.size)
    ys = gy.ravel() + RNG.normal(0, 0.05, size=gy.size)
    zs = np.zeros_like(xs)
    intensity = RNG.uniform(0.05, 0.2, size=xs.size)
    return np.stack([xs, ys, zs, intensity], axis=1)


def dynamic_object_positions(frame_id: int, provoke_turn: bool = False):
    """Returns ground-truth positions/velocities for the moving pedestrian
    and vehicle at this frame (used to build the synthetic point cloud AND
    exposed to demos so timing/prediction accuracy can be reported)."""
    t = frame_id * FRAME_DT_SECONDS

    veh_pos = VEHICLE_START.copy()
    veh_vel = VEHICLE_VELOCITY.copy()
    if provoke_turn and frame_id >= TURN_AT_FRAME:
        t_pre = TURN_AT_FRAME * FRAME_DT_SECONDS
        t_post = t - t_pre
        veh_pos = VEHICLE_START + VEHICLE_VELOCITY * t_pre + VEHICLE_TURN_VELOCITY * t_post
        veh_vel = VEHICLE_TURN_VELOCITY.copy()
    else:
        veh_pos = VEHICLE_START + VEHICLE_VELOCITY * t

    ped_pos = PEDESTRIAN_START + PEDESTRIAN_VELOCITY * t
    ped_vel = PEDESTRIAN_VELOCITY.copy()

    return {
        "vehicle": {"position": veh_pos, "velocity": veh_vel},
        "pedestrian": {"position": ped_pos, "velocity": ped_vel},
    }


def generate_synthetic_frame(frame_id: int, provoke_turn: bool = False):
    """Builds one synthetic LiDAR frame: (points[N,4], labels[N])."""
    dyn = dynamic_object_positions(frame_id, provoke_turn)

    terrain = _terrain_carpet(6000)
    building = _cluster(BUILDING_CENTER, 120, spread=1.5, intensity_mean=0.6)
    road_edge = _cluster(ROAD_EDGE_OBSTACLE_CENTER, 40, spread=0.6, intensity_mean=0.4,
                          intensity_std=0.35, position_noise_extra=0.25)
    # ^ deliberately noisy/ambiguous returns (wide intensity variance +
    # extra per-frame position scatter) so this reads as the master doc's
    # "uncertain road edge / obstacle" example (curb/pothole/ambiguous
    # LiDAR points) -- genuinely uncertain and geometrically complex,
    # not just another quiet static object.
    static_patch = _cluster(STATIC_ROAD_PATCH_CENTER, 15, spread=0.4, intensity_mean=0.1)  # low-value, same distance as pedestrian
    pedestrian = _cluster(dyn["pedestrian"]["position"], 25, spread=0.3, intensity_mean=0.5)
    vehicle = _cluster(dyn["vehicle"]["position"], 150, spread=0.5, intensity_mean=0.7)

    points = np.vstack([terrain, building, road_edge, static_patch, pedestrian, vehicle]).astype(np.float32)
    labels = np.concatenate([
        np.full(len(terrain), LABEL_GROUND),
        np.full(len(building), LABEL_BUILDING),
        np.full(len(road_edge), LABEL_CURB),
        np.full(len(static_patch), LABEL_GROUND),
        np.full(len(pedestrian), LABEL_PERSON),
        np.full(len(vehicle), LABEL_CAR),
    ]).astype(np.int64)

    return points, labels, dyn
