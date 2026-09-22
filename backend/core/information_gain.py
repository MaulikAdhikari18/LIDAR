"""
Expected Information Gain.

Implements Revision Notes Sec. 8:

    Base = aU*U + aS*S + aG*G + aM*M + aF*Pfuture
    ConfidenceOfBenefit = 0.5 + 0.5*(1 - confidence)
    InformationGain = Base * ResolutionGain * ConfidenceOfBenefit * 10

Default base weights (documented order U/S/G/M/F): 0.20 / 0.30 / 0.15 / 0.15 / 0.20.

The notes flag the documentation's "ResolutionGain" notation as ambiguous
and say the code is authoritative — this module IS that implementation.
We define ResolutionGain as how much detail refining this cell would
actually add: the fractional jump from the current cell size to the next
finer level, in [0, 1]. A cell already at the finest level has
ResolutionGain = 0, so it can never be a REFINE candidate (there is
nowhere finer to go) — this directly implements the "legal finer
transition" requirement in Sec. 11.
"""
from __future__ import annotations

from config import (
    IG_WEIGHT_UNCERTAINTY, IG_WEIGHT_SAFETY, IG_WEIGHT_GEOMETRY,
    IG_WEIGHT_MOTION, IG_WEIGHT_FUTURE, IG_SCALE_FACTOR, RESOLUTION_LEVELS,
)
from core.information_value import InformationSignals


def confidence_of_benefit(confidence: float) -> float:
    """ConfidenceOfBenefit = 0.5 + 0.5*(1 - confidence).
    Low confidence (uncertain region) -> value closer to 1.0 -> refining is
    worth more. High confidence (already well understood) -> value closer
    to 0.5 -> refining adds less marginal benefit. This is the direct
    mechanism behind Confidence-Aware Adaptation (Enhancement A1)."""
    confidence = min(1.0, max(0.0, confidence))
    return 0.5 + 0.5 * (1.0 - confidence)


def resolution_gain(level: int) -> float:
    """
    Fractional jump in resolution the NEXT refine step would deliver:
        ResolutionGain = (size[level] - size[level+1]) / size[level]
    A cell already at the finest level returns 0.0 (nothing left to gain).
    """
    if level >= len(RESOLUTION_LEVELS) - 1:
        return 0.0
    cur = RESOLUTION_LEVELS[level]
    nxt = RESOLUTION_LEVELS[level + 1]
    return (cur - nxt) / cur


def information_gain_base(sig: InformationSignals) -> float:
    """Base = aU*U + aS*S + aG*G + aM*M + aF*Pfuture"""
    return (IG_WEIGHT_UNCERTAINTY * sig.U +
            IG_WEIGHT_SAFETY * sig.S +
            IG_WEIGHT_GEOMETRY * sig.G +
            IG_WEIGHT_MOTION * sig.M +
            IG_WEIGHT_FUTURE * sig.P_future)


def compute_information_gain(sig: InformationSignals, level: int, confidence: float) -> float:
    """InformationGain = Base * ResolutionGain * ConfidenceOfBenefit * 10"""
    base = information_gain_base(sig)
    r_gain = resolution_gain(level)
    cob = confidence_of_benefit(confidence)
    return base * r_gain * cob * IG_SCALE_FACTOR
