"""
Confidence-Aware Adaptation (Prototype Enhancement A1).

Purpose (per the addendum): make the existing uncertainty signal a
VISIBLE and OPERATIONAL part of adaptive resolution.

  - When a region is uncertain, increased uncertainty increases the
    expected value of additional spatial detail (via ConfidenceOfBenefit
    in information_gain.py: low confidence -> higher ConfidenceOfBenefit).
  - When repeated consistent observations make a region more certain,
    utility can decrease, allowing coarsening and resource release.
  - A wrong prediction (Enhancement A2) sharply reduces confidence again,
    so uncertainty is never "spent once and forgotten".

Confidence is intentionally kept as ONE contributor among the existing
contextual signals (feeding ConfidenceOfBenefit and U), not an automatic
refinement command on its own.
"""
from __future__ import annotations

from config import (
    CONFIDENCE_GAIN_PER_OBSERVATION,
    CONFIDENCE_LOSS_ON_PREDICTION_ERROR,
    CONFIDENCE_MIN,
    CONFIDENCE_MAX,
)


def update_confidence(current_confidence: float, observed_consistently: bool,
                       prediction_error: bool = False) -> float:
    """
    Update a cell/track's confidence given this frame's evidence.

      observed_consistently: True if this frame's observation matched
          expectations (object where we expected it, semantic label stable).
      prediction_error: True if a tracked object deviated from its
          predicted position beyond the error threshold (Enhancement A2).
    """
    c = current_confidence
    if prediction_error:
        c -= CONFIDENCE_LOSS_ON_PREDICTION_ERROR
    elif observed_consistently:
        c += CONFIDENCE_GAIN_PER_OBSERVATION
    else:
        c -= CONFIDENCE_GAIN_PER_OBSERVATION * 0.5  # mild decay when unseen/inconsistent

    return min(CONFIDENCE_MAX, max(CONFIDENCE_MIN, c))


def uncertainty_signal_from_confidence(confidence: float) -> float:
    """The 'U' contextual signal (0..1) is simply the inverse of confidence:
    a less-certain region has a higher uncertainty signal, which (a) raises
    IVcurrent's U term and (b) raises ConfidenceOfBenefit in the gain model —
    the two places uncertainty is documented to matter."""
    return min(1.0, max(0.0, 1.0 - confidence))
