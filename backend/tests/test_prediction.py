import math

import numpy as np

from core.prediction import (
    ctrv_offset,
    predict_future_position,
    gaussian_future_occupancy_batch,
    gaussian_future_occupancy,
)
from core.tracker import ObjectTracker
from core.quadtree import HierarchicalQuadtreeMap


def test_ctrv_offset_straight_line_when_not_turning():
    # yaw_rate below MIN_YAW_RATE_RAD_S falls back to straight-line motion:
    # heading 0 rad (along +x), speed 2 m/s, 3s horizon -> dx=6, dy=0.
    dx, dy = ctrv_offset(heading=0.0, speed=2.0, yaw_rate=0.0, horizon=3.0)
    assert abs(dx - 6.0) < 1e-9
    assert abs(dy - 0.0) < 1e-9


def test_ctrv_offset_curves_when_turning():
    # A real turn rate should curve the path away from the straight-line
    # projection at the same speed/heading/horizon.
    straight_dx, straight_dy = ctrv_offset(heading=0.0, speed=2.0, yaw_rate=0.0, horizon=3.0)
    turn_dx, turn_dy = ctrv_offset(heading=0.0, speed=2.0, yaw_rate=0.5, horizon=3.0)
    assert (turn_dx, turn_dy) != (straight_dx, straight_dy)
    # turning left (positive yaw_rate) from heading 0 should end up with
    # positive lateral (y) displacement.
    assert turn_dy > 0


def test_ctrv_offset_matches_straight_line_at_small_yaw_rate():
    # As yaw_rate -> 0 the curved formula should converge to the straight
    # line result (this is the CTRV singularity the fallback avoids).
    speed, heading, horizon = 3.0, 0.4, 2.0
    straight_dx, straight_dy = ctrv_offset(heading, speed, 0.0, horizon)
    tiny_yaw_dx, tiny_yaw_dy = ctrv_offset(heading, speed, 1e-6, horizon)
    assert abs(tiny_yaw_dx - straight_dx) < 1e-3
    assert abs(tiny_yaw_dy - straight_dy) < 1e-3


def test_predict_future_position_uses_track_state():
    tr = ObjectTracker()
    tr.update([{"position": (0.0, 0.0, 0.0), "semantic_class": "car"}], t=0.0)
    tid = list(tr.tracks.keys())[0]
    track = tr.tracks[tid]
    # give it a known velocity/direction directly
    track.velocity = (1.0, 0.0, 0.0)
    track.direction_rad = 0.0
    track.yaw_rate = 0.0

    x, y, z = predict_future_position(track, horizon=2.0)
    # straight-line motion at speed()=1.0 m/s for 2.0s -> +2.0 in x
    assert abs(x - 2.0) < 1e-6
    assert abs(y - 0.0) < 1e-6


def test_gaussian_future_occupancy_batch_peaks_at_predicted_point():
    xs = np.array([0.0, 5.0, 50.0])
    ys = np.array([0.0, 0.0, 0.0])
    probs = gaussian_future_occupancy_batch(xs, ys, predicted_xy=(0.0, 0.0), uncertainty=0.0, sigma_base=3.0)
    # exact match with the predicted point -> probability 1.0 (exp(0))
    assert abs(probs[0] - 1.0) < 1e-9
    # closer points get higher probability than farther ones
    assert probs[0] > probs[1] > probs[2]
    # far outside the 3-sigma cutoff -> exactly zero, not just small
    assert probs[2] == 0.0


def test_gaussian_future_occupancy_batch_widens_with_uncertainty():
    xs = np.array([4.0])
    ys = np.array([0.0])
    low_unc = gaussian_future_occupancy_batch(xs, ys, (0.0, 0.0), uncertainty=0.0, sigma_base=3.0)
    high_unc = gaussian_future_occupancy_batch(xs, ys, (0.0, 0.0), uncertainty=1.0, sigma_base=3.0)
    # a wider Gaussian (higher uncertainty) spreads more probability to the
    # same fixed distance away from the predicted point.
    assert high_unc[0] > low_unc[0]


def test_gaussian_future_occupancy_returns_dict_keyed_by_cell_id():
    map_ = HierarchicalQuadtreeMap((0.0, 20.0), (0.0, 20.0))
    result = gaussian_future_occupancy(map_, predicted_xy=(10.0, 10.0), uncertainty=0.2, sigma_base=3.0)
    assert isinstance(result, dict)
    # every returned probability is meaningful (the function already
    # filters out anything <= 0.02) and within [0, 1]
    for p in result.values():
        assert 0.02 < p <= 1.0