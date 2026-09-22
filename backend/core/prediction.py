"""
Lightweight Future Prediction & Probabilistic Future Occupancy.

Implements Revision Notes Sec. 6 and Master Doc Sec. 9/10:

    Pfuture = CTRV(Pcurrent, heading, speed, yaw_rate, dt)
    dt = PREDICTION_HORIZON_SECONDS (2.0 s)

CTRV (Constant Turn Rate and Velocity) is the same motion model used by
Kalman-filter object trackers in real autonomous-vehicle stacks. It reduces
to the original constant-velocity model (Pfuture = Pcurrent + V*dt) for any
track that isn't turning -- see _ctrv_offset's fallback below -- so a
straight-moving pedestrian or car is projected exactly as before; only a
track with a real, sustained turn rate (core/tracker.py) now curves instead
of assuming it keeps driving off along whatever heading it had this instant.

Gaussian uncertainty is added around Pfuture, producing a probability
DISTRIBUTION over nearby cells rather than a single deterministic point
(Master Doc Sec. 9: "the probability layer is not a second complete future
2.5D map"). We represent it as a dict: {cell_id: probability}, computed
fresh each frame from the current track state — never stored as a
persistent second map.
"""
from __future__ import annotations
import math
from typing import Dict, Tuple

from config import PREDICTION_HORIZON_SECONDS, FUTURE_GAUSSIAN_SIGMA_M, MIN_YAW_RATE_RAD_S
from core.tracker import Track
from core.quadtree import HierarchicalQuadtreeMap


def ctrv_offset(heading: float, speed: float, yaw_rate: float, horizon: float) -> Tuple[float, float]:
    """Closed-form CTRV (x, y) displacement over `horizon` seconds, starting
    from heading `heading` (rad), moving at `speed` (m/s), turning at
    `yaw_rate` (rad/s).

    Falls back to straight-line motion (speed*horizon in the heading
    direction) when the turn rate is negligible -- CTRV's own formula
    divides by yaw_rate, so it blows up as yaw_rate -> 0. This is the
    well-known CTRV singularity, not a bug: a truly straight-moving object
    has no meaningful turn radius to divide by, and the straight-line
    result is exactly what the curved formula converges to in that limit
    anyway.

    Shared by predict_future_position() below (the long-horizon Gaussian
    occupancy field) and api/live_endpoints.py's future-fan builder (the
    "straight" candidate the frontend draws as the projected path), so the
    two never drift apart into two different motion models.
    """
    if abs(yaw_rate) < MIN_YAW_RATE_RAD_S:
        return speed * horizon * math.cos(heading), speed * horizon * math.sin(heading)
    r = speed / yaw_rate
    dx = r * (math.sin(heading + yaw_rate * horizon) - math.sin(heading))
    dy = r * (-math.cos(heading + yaw_rate * horizon) + math.cos(heading))
    return dx, dy


def predict_future_position(track: Track,
                             horizon: float = PREDICTION_HORIZON_SECONDS) -> Tuple[float, float, float]:
    """Pfuture = CTRV(Pcurrent, heading, speed, yaw_rate, dt)."""
    x0, y0, z0 = track.position
    dx, dy = ctrv_offset(track.direction_rad, track.speed(), track.yaw_rate, horizon)
    return (x0 + dx, y0 + dy, z0 + track.velocity[2] * horizon)


def gaussian_future_occupancy(map_: HierarchicalQuadtreeMap,
                               predicted_xy: Tuple[float, float],
                               uncertainty: float,
                               sigma_base: float = FUTURE_GAUSSIAN_SIGMA_M) -> Dict[str, float]:
    """
    Deposit a 2D Gaussian "relevance/occupancy" probability field over the
    leaf cells of the map around the predicted position (scalar/dict
    reference implementation — convenient for demo endpoints; the
    hot per-frame path in AdaptiveMapManager uses the vectorised
    `gaussian_future_occupancy_batch` below on precomputed arrays instead
    of re-walking the tree for every track).

    Returns {cell_id: probability_in_[0,1]} for every leaf cell that
    receives non-negligible probability. This dict is recomputed every
    frame and is NOT persisted as a second full future map.
    """
    ids, xs, ys = leaf_center_arrays(map_.all_leaf_cells())
    probs = gaussian_future_occupancy_batch(xs, ys, predicted_xy, uncertainty, sigma_base)
    return {cid: float(p) for cid, p in zip(ids, probs) if p > 0.02}


def leaf_center_arrays(leaves) -> Tuple[list, "np.ndarray", "np.ndarray"]:
    """Precompute (ids, x-centers, y-centers) once per frame so every track's
    future-occupancy field can be evaluated with vectorised numpy ops
    instead of walking the quadtree once per track."""
    import numpy as np
    ids = [c.id for c in leaves]
    xs = np.array([c.center[0] for c in leaves], dtype=np.float64)
    ys = np.array([c.center[1] for c in leaves], dtype=np.float64)
    return ids, xs, ys


def gaussian_future_occupancy_batch(xs, ys, predicted_xy: Tuple[float, float],
                                     uncertainty: float,
                                     sigma_base: float = FUTURE_GAUSSIAN_SIGMA_M):
    """Vectorised version of the Gaussian future-occupancy field: same
    math as gaussian_future_occupancy, evaluated for every leaf at once."""
    import numpy as np
    sigma = sigma_base * (1.0 + uncertainty)
    px, py = predicted_xy
    dx = xs - px
    dy = ys - py
    dist2 = dx * dx + dy * dy
    cutoff2 = (3.0 * sigma) ** 2
    probs = np.zeros_like(xs)
    mask = dist2 <= cutoff2
    # exp(0) == 1.0 at the peak, so this is already normalised to [0,1]
    probs[mask] = np.exp(-dist2[mask] / (2.0 * sigma * sigma))
    return probs


def _gaussian2d(dx: float, dy: float, sigma: float) -> float:
    return math.exp(-(dx * dx + dy * dy) / (2.0 * sigma * sigma))