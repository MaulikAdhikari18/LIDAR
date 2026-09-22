from config import CONFIDENCE_MIN, CONFIDENCE_MAX
from core.confidence import update_confidence, uncertainty_signal_from_confidence


def test_confidence_gains_on_consistent_observation():
    c = update_confidence(0.5, observed_consistently=True)
    assert c > 0.5


def test_confidence_drops_sharply_on_prediction_error():
    # prediction_error takes priority over observed_consistently, and its
    # loss (0.35) is much larger than a single gain step (0.08).
    c = update_confidence(0.5, observed_consistently=True, prediction_error=True)
    assert c < 0.5
    assert abs(c - 0.15) < 1e-9


def test_confidence_decays_mildly_when_unseen():
    c = update_confidence(0.5, observed_consistently=False)
    assert c < 0.5
    # mild decay is half the gain step
    assert abs(c - 0.46) < 1e-9


def test_confidence_clamped_to_bounds():
    # repeated gains never exceed CONFIDENCE_MAX
    c = 0.5
    for _ in range(200):
        c = update_confidence(c, observed_consistently=True)
    assert c <= CONFIDENCE_MAX

    # repeated prediction errors never fall below CONFIDENCE_MIN
    c = 0.5
    for _ in range(200):
        c = update_confidence(c, observed_consistently=False, prediction_error=True)
    assert c >= CONFIDENCE_MIN


def test_uncertainty_is_inverse_of_confidence():
    assert abs(uncertainty_signal_from_confidence(0.9) - 0.1) < 1e-9
    assert abs(uncertainty_signal_from_confidence(0.0) - 1.0) < 1e-9
    assert abs(uncertainty_signal_from_confidence(1.0) - 0.0) < 1e-9


def test_uncertainty_signal_clamped_to_unit_range():
    # out-of-range confidence (shouldn't happen given CONFIDENCE_MIN/MAX,
    # but the function guards independently) still returns a valid signal.
    assert uncertainty_signal_from_confidence(1.5) == 0.0
    assert uncertainty_signal_from_confidence(-0.5) == 1.0