from core.tracker import ObjectTracker


def test_velocity_measured_and_smoothing():
    tr = ObjectTracker()
    # frame 0: first detection at (0,0,0)
    tr.update([{"position": (0.0, 0.0, 0.0), "semantic_class": "car"}], t=0.0)
    tid = list(tr.tracks.keys())[0]
    assert tr.tracks[tid].velocity == (0.0, 0.0, 0.0)

    # frame 1: moved to (1,0,0) after 1s -> Vmeasured = (1,0,0)
    tr.update([{"position": (1.0, 0.0, 0.0), "semantic_class": "car"}], t=1.0)
    v1 = tr.tracks[tid].velocity
    # Vnew = 0.7*0 + 0.3*1 = 0.3
    assert abs(v1[0] - 0.3) < 1e-9

    # frame 2: moved to (2,0,0) after another 1s -> Vmeasured = (1,0,0)
    tr.update([{"position": (2.0, 0.0, 0.0), "semantic_class": "car"}], t=2.0)
    v2 = tr.tracks[tid].velocity
    # Vnew = 0.7*0.3 + 0.3*1 = 0.51
    assert abs(v2[0] - 0.51) < 1e-9
