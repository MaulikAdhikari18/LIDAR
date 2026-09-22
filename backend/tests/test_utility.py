from core.utility import compute_utility, classify_utility, Decision


def test_compute_utility_basic():
    assert compute_utility(10.0, 2.0) == 5.0
    assert compute_utility(1.0, 0.0) == 0.0


def test_classify_utility_thresholds():
    assert classify_utility(0.0) == Decision.COARSEN
    assert classify_utility(0.249) == Decision.COARSEN
    assert classify_utility(0.25) == Decision.MAINTAIN
    assert classify_utility(0.549) == Decision.MAINTAIN
    assert classify_utility(0.55) == Decision.REFINE
    assert classify_utility(2.0) == Decision.REFINE
