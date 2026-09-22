"""
Dynamic Object Tracking.

Implements Revision Notes Sec. 4 & 5, and Master Doc Sec. 8/9 ("estimate
position, velocity, direction and uncertainty across frames"):

    Vmeasured = (P2 - P1) / (t2 - t1)
    Vnew      = 0.7 * Vprevious + 0.3 * Vmeasured

Multi-object association across frames uses simple nearest-neighbour
gating (sufficient for the lightweight prototype — no heavy SLAM/JPDA is
required per the Prototype Enhancements "Scope Control" section).

Also implements Prediction-Error Recovery bookkeeping (Enhancement A2):
each track remembers where it was predicted to go, so the caller can
detect a "miss" when the object doesn't show up there.
"""
from __future__ import annotations
import math
from typing import Dict, List, Optional, Tuple

from config import (
    VELOCITY_SMOOTH_PREV_WEIGHT,
    VELOCITY_SMOOTH_NEW_WEIGHT,
    YAW_RATE_SMOOTH_PREV_WEIGHT,
    YAW_RATE_SMOOTH_NEW_WEIGHT,
    MIN_SPEED_FOR_YAW_RATE_MS,
    PREDICTION_ERROR_DISTANCE_M,
)

MAX_ASSOCIATION_DISTANCE_M = 3.0  # gating distance for nearest-neighbour matching


class Track:
    """A single tracked dynamic object across frames."""

    def __init__(self, track_id: str, position: Tuple[float, float, float],
                 semantic_class: str, t: float):
        self.track_id = track_id
        self.position = position           # current (x, y, z)
        self.previous_position = position
        self.velocity = (0.0, 0.0, 0.0)     # smoothed velocity
        self.direction_rad = 0.0
        # Smoothed heading turn-rate (rad/s), feeding the CTRV future-
        # prediction model in core/prediction.py so a turning object's
        # projected path actually curves instead of assuming it keeps
        # driving along whatever heading it had this instant.
        self.yaw_rate = 0.0
        self.uncertainty = 0.5              # grows when unmatched, shrinks with consistent hits
        self.semantic_class = semantic_class
        self.last_seen_t = t
        self.hits = 1
        self.misses = 0

        # long-horizon (2.0s) predicted position, purely for reporting /
        # demo display (D3/D4) -- NOT used in the prediction-error check above
        self.last_predicted_position: Optional[Tuple[float, float, float]] = None
        self.last_prediction_error_magnitude = 0.0
        self.last_prediction_error = False

    def update(self, new_position: Tuple[float, float, float], t: float):
        dt = max(1e-3, t - self.last_seen_t)
        vmeasured = tuple((new_position[i] - self.position[i]) / dt for i in range(3))

        # --- Prediction-error recovery check (Enhancement A2) --------------
        # This is a ONE-STEP-AHEAD consistency check: "given where this
        # object was and how fast it was moving, is it where we'd expect it
        # dt seconds later?" A sudden turn shows up immediately as a big
        # miss here. This is deliberately NOT compared against the longer
        # PREDICTION_HORIZON_SECONDS (2.0 s) future projection used for the
        # Gaussian occupancy field (core/prediction.py) -- comparing a
        # 2-second-ahead prediction against a position only one (much
        # shorter) frame later would flag a "miss" on almost every frame
        # regardless of how well-behaved the object actually is, since the
        # two time horizons aren't comparable.
        predicted_position_now = tuple(self.position[i] + self.velocity[i] * dt for i in range(3))
        err = _dist3(new_position, predicted_position_now)
        self.last_prediction_error_magnitude = err  # raw distance in meters, always recorded
        # skip the check for the first couple of hits: the velocity estimate
        # is still warming up (starts at zero) then, so an apparent "miss"
        # there reflects smoothing lag, not a genuine trajectory change.
        self.last_prediction_error = (self.hits >= 3) and (err > PREDICTION_ERROR_DISTANCE_M)

        # --- Velocity smoothing: Vnew = 0.7*Vprev + 0.3*Vmeasured ----------
        self.velocity = tuple(
            VELOCITY_SMOOTH_PREV_WEIGHT * self.velocity[i] +
            VELOCITY_SMOOTH_NEW_WEIGHT * vmeasured[i]
            for i in range(3)
        )
        previous_direction = self.direction_rad
        self.direction_rad = math.atan2(self.velocity[1], self.velocity[0])

        # --- Yaw-rate smoothing (feeds the CTRV model in core/prediction.py) --
        # Only estimated once the object is actually moving fast enough for
        # its heading to mean something -- atan2 of a near-zero velocity
        # vector is noise, and treating that noise as a sudden turn would
        # make a car that's basically stopped project a spinning path. The
        # raw heading delta is wrapped into [-pi, pi] first (via atan2 of
        # sin/cos) so a jump like -179deg -> 179deg reads as a real 2deg
        # turn, not a spurious 358deg spin the other way.
        if self.speed() > MIN_SPEED_FOR_YAW_RATE_MS:
            raw_delta = math.atan2(
                math.sin(self.direction_rad - previous_direction),
                math.cos(self.direction_rad - previous_direction),
            )
            yaw_rate_measured = raw_delta / dt
            self.yaw_rate = (
                YAW_RATE_SMOOTH_PREV_WEIGHT * self.yaw_rate +
                YAW_RATE_SMOOTH_NEW_WEIGHT * yaw_rate_measured
            )
        else:
            # Too slow for heading to be meaningful -- decay any stale turn
            # rate toward zero rather than freezing whatever it was the
            # last time the object was actually moving.
            self.yaw_rate *= YAW_RATE_SMOOTH_PREV_WEIGHT

        self.previous_position = self.position
        self.position = new_position
        self.last_seen_t = t
        self.hits += 1
        self.misses = 0

        # uncertainty shrinks with consistent observation, grows on a miss
        if self.last_prediction_error:
            self.uncertainty = min(0.95, self.uncertainty + 0.25)
        else:
            self.uncertainty = max(0.05, self.uncertainty * 0.85)

    def mark_missed(self):
        self.misses += 1
        self.uncertainty = min(0.95, self.uncertainty + 0.15)

    def speed(self) -> float:
        return math.sqrt(sum(v * v for v in self.velocity))

    def as_dict(self):
        return {
            "track_id": self.track_id,
            "position": self.position,
            "velocity": self.velocity,
            "direction_rad": self.direction_rad,
            "yaw_rate": self.yaw_rate,
            "uncertainty": self.uncertainty,
            "semantic_class": self.semantic_class,
            "hits": self.hits,
            "misses": self.misses,
            "prediction_error": self.last_prediction_error,
            "prediction_error_magnitude": self.last_prediction_error_magnitude,
        }


def _dist3(a, b) -> float:
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


class ObjectTracker:
    """Maintains all active tracks frame to frame."""

    def __init__(self, max_missed_frames: int = 5):
        self.tracks: Dict[str, Track] = {}
        self._next_id = 0
        self.max_missed_frames = max_missed_frames

    def update(self, detections: List[dict], t: float) -> List[Track]:
        """
        detections: list of {'position': (x,y,z), 'semantic_class': str}
        Returns the list of currently active tracks after association.
        """
        unmatched_tracks = set(self.tracks.keys())
        for det in detections:
            best_id, best_dist = None, MAX_ASSOCIATION_DISTANCE_M
            for tid in unmatched_tracks:
                d = _dist3(self.tracks[tid].position, det["position"])
                if d < best_dist:
                    best_dist, best_id = d, tid
            if best_id is not None:
                self.tracks[best_id].update(det["position"], t)
                unmatched_tracks.discard(best_id)
            else:
                new_id = f"track_{self._next_id}"
                self._next_id += 1
                self.tracks[new_id] = Track(new_id, det["position"], det["semantic_class"], t)

        for tid in unmatched_tracks:
            self.tracks[tid].mark_missed()

        # drop stale tracks
        self.tracks = {tid: tr for tid, tr in self.tracks.items()
                        if tr.misses <= self.max_missed_frames}
        return list(self.tracks.values())

    def set_predicted_position(self, track_id: str, predicted_position: Tuple[float, float, float]):
        if track_id in self.tracks:
            self.tracks[track_id].last_predicted_position = predicted_position

    def reset(self):
        self.tracks = {}
        self._next_id = 0