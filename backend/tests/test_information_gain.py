from core.information_value import InformationSignals, compute_current_information_value, compute_total_information_value
from core.information_gain import confidence_of_benefit, resolution_gain, information_gain_base, compute_information_gain
from core.refinement_cost import compute_refinement_cost


def test_iv_current_weights_exact():
    sig = InformationSignals(S=1.0, M=1.0, U=1.0, G=1.0, D=1.0)
    iv = compute_current_information_value(sig)
    # 0.30 + 0.20 + 0.15 + 0.15 + 0.05 = 0.85
    assert abs(iv - 0.85) < 1e-9


def test_iv_total_adds_future_weight():
    sig = InformationSignals(S=0, M=0, U=0, G=0, D=0, P_future=1.0)
    iv_total = compute_total_information_value(sig)
    assert abs(iv_total - 0.15) < 1e-9  # wP = 0.15


def test_confidence_of_benefit_formula():
    assert abs(confidence_of_benefit(1.0) - 0.5) < 1e-9   # fully confident -> 0.5
    assert abs(confidence_of_benefit(0.0) - 1.0) < 1e-9   # zero confidence -> 1.0
    assert abs(confidence_of_benefit(0.5) - 0.75) < 1e-9


def test_resolution_gain_zero_at_finest_level():
    assert resolution_gain(2) == 0.0  # finest level (0.05m) -> nothing left to gain
    assert resolution_gain(0) > 0.0
    assert resolution_gain(1) > 0.0


def test_information_gain_base_weights_sum_to_one():
    sig = InformationSignals(S=1, M=1, U=1, G=1, D=0, P_future=1)
    base = information_gain_base(sig)
    # aU + aS + aG + aM + aF = 0.20+0.30+0.15+0.15+0.20 = 1.0
    assert abs(base - 1.0) < 1e-9


def test_compute_information_gain_scale_factor():
    sig = InformationSignals(S=1, M=1, U=1, G=1, D=0, P_future=1)
    gain = compute_information_gain(sig, level=0, confidence=1.0)
    # base=1.0, resolution_gain(0)=(0.5-0.2)/0.5=0.6, CoB(1.0)=0.5, *10
    expected = 1.0 * 0.6 * 0.5 * 10.0
    assert abs(gain - expected) < 1e-9


def test_refinement_cost_defaults():
    # 1 new cell, 0 points: (0.20+0.10)*1 + 0.02*0 = 0.30
    cost = compute_refinement_cost(num_new_cells=1, num_points_in_cell=0)
    assert abs(cost - 0.30) < 1e-9
