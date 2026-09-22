"""
Utility = Information Gain / Cost, and the REFINE / MAINTAIN / COARSEN
classification.

Revision Notes Sec. 10 & 11:

    Utility = InformationGain / Cost

    Utility < 0.25                  -> COARSEN
    0.25 <= Utility < 0.55          -> MAINTAIN / no threshold-triggered change
    Utility >= 0.55                 -> REFINE candidate
        (still requires a legal finer transition AND enough remaining budget)
"""
from __future__ import annotations
from enum import Enum

from config import COARSEN_THRESHOLD, REFINE_THRESHOLD


class Decision(str, Enum):
    REFINE = "REFINE"
    MAINTAIN = "MAINTAIN"
    COARSEN = "COARSEN"


def compute_utility(information_gain: float, cost: float) -> float:
    if cost <= 0:
        return 0.0
    return information_gain / cost


def classify_utility(utility: float) -> Decision:
    if utility < COARSEN_THRESHOLD:
        return Decision.COARSEN
    if utility >= REFINE_THRESHOLD:
        return Decision.REFINE
    return Decision.MAINTAIN
