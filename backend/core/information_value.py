"""
Current + Future Information Value.

Implements Revision Notes Sec. 7 exactly:

    IVcurrent = 0.30*S + 0.20*M + 0.15*U + 0.15*G + 0.05*D
    (Future probability carries a SEPARATE weight wP = 0.15)
    IVtotal   = IVcurrent + wP * Pfuture      (0.85 + 0.15 = 1.00 total weight)

S = semantic/safety importance     (Master Doc Sec. 7 / Sec. 4)
M = motion                         (temporal change)
U = uncertainty
G = geometric/scene complexity
D = distance relevance (deliberately a SMALL signal — Sec. 7 & Differentiator #1:
    two regions at the same distance can receive different resolutions)
Pfuture = probabilistic future occupancy contribution for this cell
"""
from __future__ import annotations
from dataclasses import dataclass

from config import (
    IV_WEIGHT_SAFETY, IV_WEIGHT_MOTION, IV_WEIGHT_UNCERTAINTY,
    IV_WEIGHT_GEOMETRY, IV_WEIGHT_DISTANCE, IV_WEIGHT_FUTURE,
)


@dataclass
class InformationSignals:
    """The five current-scene signals (S, M, U, G, D) plus the future
    contribution Pfuture — exactly what the explainable decision panel
    (Enhancement A4) must expose for every region."""
    S: float
    M: float
    U: float
    G: float
    D: float
    P_future: float = 0.0

    def clamp(self):
        for name in ("S", "M", "U", "G", "D", "P_future"):
            setattr(self, name, min(1.0, max(0.0, getattr(self, name))))
        return self


def compute_current_information_value(sig: InformationSignals) -> float:
    """IVcurrent = 0.30S + 0.20M + 0.15U + 0.15G + 0.05D"""
    sig.clamp()
    return (IV_WEIGHT_SAFETY * sig.S +
            IV_WEIGHT_MOTION * sig.M +
            IV_WEIGHT_UNCERTAINTY * sig.U +
            IV_WEIGHT_GEOMETRY * sig.G +
            IV_WEIGHT_DISTANCE * sig.D)


def compute_total_information_value(sig: InformationSignals) -> float:
    """IVtotal = IVcurrent + wP * Pfuture  (present + future views combined,
    Differentiator #4)."""
    iv_current = compute_current_information_value(sig)
    return iv_current + IV_WEIGHT_FUTURE * sig.P_future


def distance_relevance(distance_m: float, ref_distance_m: float = 40.0) -> float:
    """
    Turns raw distance into a small, bounded [0,1] relevance signal.
    Deliberately only a minor contributor (weight 0.05) — distance is a
    CONTEXTUAL input, never the primary resolution rule (Master Doc Sec. 3,
    "What We Must NOT Change").
    """
    d = max(0.0, min(distance_m, ref_distance_m))
    return 1.0 - (d / ref_distance_m)
