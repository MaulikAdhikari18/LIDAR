"""
AdaptiveMapManager — ties every module together into the exact
frame-by-frame pipeline described in the Master Document, Sections 13 & 14:

  RAW LiDAR -> preprocessing -> CURRENT PERCEPTION -> CURRENT 2.5D MAP ->
  DYNAMIC OBJECT TRACKING -> LIGHTWEIGHT FUTURE PREDICTION ->
  FUTURE OCCUPANCY PROBABILITY -> CURRENT + FUTURE INFORMATION VALUE ->
  EXPECTED INFORMATION GAIN -> REFINEMENT COST -> UTILITY ->
  FIXED COMPUTATIONAL BUDGET -> REFINE/MAINTAIN/COARSEN ->
  HIERARCHICAL MAP UPDATE -> RESOURCE RECLAMATION + REALLOCATION ->
  NEXT FRAME.

This is the ONE persistent object the API talks to: the quadtree map, the
tracker and the budget ledger all live inside it and survive across
`/frame` calls, exactly as the "What We Must NOT Change" list requires
("Do not rebuild an unrelated static grid every frame").

--------------------------------------------------------------------------
A note on resolving the documented "ResolutionGain" ambiguity
--------------------------------------------------------------------------
The revision notes explicitly flag that ResolutionGain's exact meaning in
the documentation is ambiguous and say the CODE is authoritative. Taking
`ResolutionGain = 0` for an already-finest cell (as information_gain.py
implements literally) is correct for judging whether a cell should REFINE
further — there's nothing finer to refine to. But it must NOT be used, on
its own, to decide whether an already-fine cell should be COARSENED —
otherwise every finest-resolution cell would coarsen every single frame
regardless of importance, which contradicts Differentiator #6 and Demo D6
("A region stays refined while its object is present").

So this manager computes two separate, clearly-named quantities per cell:

  * refine_utility    — InformationGain(full Base incl. uncertainty, ResolutionGain=next-level-jump)
                         / RefinementCost -> only used to decide whether to
                         REFINE further. Zero for a cell already at the
                         finest level (nothing finer to refine to). This
                         matches the documented formula exactly, including
                         uncertainty as a legitimate reason to invest in
                         finding out more.

  * retention_utility  — InformationGain(Base WITHOUT the uncertainty term,
                         ResolutionGain = the jump that got us here) /
                         MaintenanceCost -> only used to decide whether an
                         already-refined cell (level > 0) still deserves to
                         KEEP its resolution. Uncertainty is deliberately
                         excluded here: "we don't know much about this cell"
                         is a good reason to go find out (refine_utility),
                         but not a good reason to keep paying for fine
                         resolution indefinitely once we HAVE looked and
                         found nothing important (S/M/G/Pfuture all low).
                         Without this distinction an intermittently-observed
                         but genuinely boring cell would stay "uncertain"
                         forever and, via ConfidenceOfBenefit amplifying its
                         own uncertainty term, would never fall back below
                         the coarsen threshold -- silently breaking
                         Differentiator #6 (resource reclamation).

Coarsening is applied per SIBLING GROUP (all children of one parent),
mirroring "a parent region can be subdivided ... and fine children can be
merged back" (Master Doc Sec. 12) — a group only collapses when every
child in it has fallen below the coarsen threshold.
"""
from __future__ import annotations
import math
import time
from collections import defaultdict
from typing import Dict, List, Optional

import numpy as np

from config import (
    SCENE_X_RANGE, SCENE_Y_RANGE, FRAME_DT_SECONDS,
    COARSEN_THRESHOLD, REFINE_THRESHOLD,
)
from core.quadtree import HierarchicalQuadtreeMap, QuadCell, RESOLUTION_LEVELS
from core.tracker import ObjectTracker
from core.budget_manager import BudgetManager
from core.prediction import predict_future_position, leaf_center_arrays, gaussian_future_occupancy_batch
from core.information_gain import confidence_of_benefit, resolution_gain
from core.refinement_cost import compute_refinement_cost, compute_maintain_cost
from core.utility import classify_utility, Decision
from core.confidence import update_confidence
from models.perception import PerceptionModel
from config import (
    IV_WEIGHT_SAFETY, IV_WEIGHT_MOTION, IV_WEIGHT_UNCERTAINTY, IV_WEIGHT_GEOMETRY,
    IV_WEIGHT_DISTANCE, IV_WEIGHT_FUTURE,
    IG_WEIGHT_UNCERTAINTY, IG_WEIGHT_SAFETY, IG_WEIGHT_GEOMETRY, IG_WEIGHT_MOTION, IG_WEIGHT_FUTURE,
    IG_SCALE_FACTOR, SAFETY_WEIGHT_BY_BUCKET,
    COST_K_COMPUTE, COST_K_MEMORY, COST_K_POINTS, COST_HARDWARE_MULTIPLIER, COST_MIN,
    CONFIDENCE_GAIN_PER_OBSERVATION, CONFIDENCE_LOSS_ON_PREDICTION_ERROR,
    CONFIDENCE_MIN, CONFIDENCE_MAX, TRANSITION_COOLDOWN_FRAMES,
)

MAX_TRACK_SPEED_MS = 5.0            # used to normalise the M (motion) signal into [0,1]
TRACK_INFLUENCE_RADIUS_M = 1.0      # a track "touches" any cell within this radius of its position


class AdaptiveMapManager:
    def __init__(self):
        self.map = HierarchicalQuadtreeMap(SCENE_X_RANGE, SCENE_Y_RANGE)
        self.tracker = ObjectTracker()
        self.budget = BudgetManager()
        self.perception = PerceptionModel()
        self.frame_id = 0
        self.last_frame_summary: Optional[dict] = None
        self.last_processing_time_s = 0.0
        # cached raw inputs from the most recently processed frame, used by
        # the live-API compatibility layer's "baseline for THIS frame" endpoint
        self.last_points: Optional[np.ndarray] = None
        self.last_labels: Optional[np.ndarray] = None

    def reset(self):
        self.map.reset()
        self.tracker.reset()
        self.budget.reset()
        self.frame_id = 0
        self.last_frame_summary = None

    # ---------------------------------------------------------------- frame
    def process_frame(self, points: np.ndarray, labels: np.ndarray) -> dict:
        t0 = time.perf_counter()
        t = self.frame_id * FRAME_DT_SECONDS
        self.last_points, self.last_labels = points, labels

        # 1-3. CURRENT PERCEPTION -------------------------------------------------
        perc = self.perception.detect_and_segment(points, labels)
        class_names = perc["class_names"]

        # 4-5. DYNAMIC OBJECT TRACKING ---------------------------------------------
        detections = [{"position": tuple(o["position"]), "semantic_class": o["semantic_class"]}
                       for o in perc["dynamic_objects"]]
        tracks = self.tracker.update(detections, t)

        # Snapshot the map's leaves ONCE this frame (before any mutation) and
        # build parallel numpy arrays. Everything below operates on these
        # arrays with vectorised numpy math instead of a heavy pure-Python
        # per-cell loop -- this is what keeps /frame fast as the map grows
        # into thousands of leaves. The per-cell formulas are IDENTICAL to
        # the scalar reference implementations in core/information_value.py,
        # core/information_gain.py and core/refinement_cost.py (see
        # tests/test_vectorized_matches_scalar.py for a direct cross-check).
        leaves = self.map.all_leaf_cells()
        n = len(leaves)
        ids, xs, ys = leaf_center_arrays(leaves)
        sizes = np.array([c.size for c in leaves], dtype=np.float64)
        levels = np.array([c.level for c in leaves], dtype=np.int64)
        confidence_old = np.array([c.confidence for c in leaves], dtype=np.float64)

        # 6-7. LIGHTWEIGHT FUTURE PREDICTION + FUTURE OCCUPANCY PROBABILITY -------
        future_prob = np.zeros(n, dtype=np.float64)
        track_predictions = []
        for tr in tracks:
            p_future = predict_future_position(tr)
            probs = gaussian_future_occupancy_batch(xs, ys, (p_future[0], p_future[1]), tr.uncertainty)
            future_prob += probs
            self.tracker.set_predicted_position(tr.track_id, p_future)
            track_predictions.append({
                "track_id": tr.track_id,
                "current_position": tr.position,
                "predicted_position": p_future,
                "velocity": tr.velocity,
                "uncertainty": tr.uncertainty,
                "prediction_error": tr.last_prediction_error,
                # CTRV inputs, passed through so the live-API layer's future
                # fan (api/live_endpoints.py) can project the SAME curved
                # path the map's Gaussian occupancy field above already
                # uses, instead of re-deriving a straight line from just
                # this one 2.0s endpoint.
                "direction_rad": tr.direction_rad,
                "yaw_rate": tr.yaw_rate,
            })
        future_prob = np.clip(future_prob, 0.0, 1.0)

        # motion (M) and the prediction-error influence mask, vectorised over
        # every track against every leaf at once (broadcasting, no per-cell loop)
        M = np.zeros(n, dtype=np.float64)
        prediction_error_mask = np.zeros(n, dtype=bool)
        for tr, tp in zip(tracks, track_predictions):
            dx = xs - tr.position[0]
            dy = ys - tr.position[1]
            dist = np.hypot(dx, dy)
            influence_radius = np.maximum(TRACK_INFLUENCE_RADIUS_M, sizes)
            mask = dist <= influence_radius
            speed_norm = min(1.0, tr.speed() / MAX_TRACK_SPEED_MS)
            M = np.maximum(M, np.where(mask, speed_norm, 0.0))
            if tp["prediction_error"]:
                prediction_error_mask |= mask

        # Assign every point to its (possibly hierarchical) leaf cell, cheaply.
        leaf_of_point = self._assign_points_to_leaves(points)

        # semantic class (majority label) + point_count + geometry (G): only
        # meaningfully computed for the (typically small) set of OCCUPIED
        # cells; everything else defaults to 0/previous value.
        point_count = np.zeros(n, dtype=np.int64)
        G = np.zeros(n, dtype=np.float64)
        for i, cell in enumerate(leaves):
            idxs = leaf_of_point.get(cell.id)
            if idxs is None or len(idxs) == 0:
                continue
            point_count[i] = len(idxs)
            if len(idxs) == 1:
                cell.semantic_class = str(class_names[idxs[0]])
            else:
                cell_classes = class_names[idxs]
                values, counts = np.unique(cell_classes, return_counts=True)
                cell.semantic_class = str(values[np.argmax(counts)])
                G[i] = float(min(1.0, np.std(points[idxs, 3]) / 0.5))
            cell.point_count = int(len(idxs))

        # S (safety/semantic importance): looked up per cell's (possibly
        # just-updated) semantic class -> bucket -> weight.
        S = np.array([
            SAFETY_WEIGHT_BY_BUCKET.get(self.perception.semantic_bucket(c.semantic_class), 0.05)
            for c in leaves
        ], dtype=np.float64)

        # U (uncertainty signal fed into IV/Gain): inverse of PRIOR confidence
        U = 1.0 - confidence_old

        # D (distance relevance): deliberately small-weight signal
        dist_from_sensor = np.hypot(xs, ys)
        D = 1.0 - np.clip(dist_from_sensor, 0.0, 40.0) / 40.0

        # ---- Confidence-Aware Adaptation (Enhancement A1 + A2 tie-in) -----------
        # Confidence should only move for cells that have SOME observational
        # history. A cell that has NEVER received a single LiDAR point isn't
        # "highly uncertain" in the safety-relevant sense -- it's simply
        # outside where anything has happened. Letting confidence decay
        # toward the floor for such cells would make U (uncertainty) spike
        # for empty background space and wrongly make it look worth
        # refining. So confidence only updates once a cell has been touched
        # at least once (this frame or previously); truly untouched cells
        # keep their neutral starting confidence.
        observation_count_old = np.array([c.observation_count for c in leaves], dtype=np.int64)
        observed_consistently = point_count > 0
        ever_observed = (observation_count_old > 0) | observed_consistently
        confidence_new_if_updated = np.where(
            prediction_error_mask, confidence_old - CONFIDENCE_LOSS_ON_PREDICTION_ERROR,
            np.where(observed_consistently, confidence_old + CONFIDENCE_GAIN_PER_OBSERVATION,
                     confidence_old - CONFIDENCE_GAIN_PER_OBSERVATION * 0.5)
        )
        confidence_new_if_updated = np.clip(confidence_new_if_updated, CONFIDENCE_MIN, CONFIDENCE_MAX)
        confidence_new = np.where(ever_observed, confidence_new_if_updated, confidence_old)
        observation_count_new = observation_count_old + observed_consistently.astype(np.int64)

        # ---- Information Value / Information Gain (Revision Notes Sec. 7 & 8) ---
        # IVcurrent = 0.30S + 0.20M + 0.15U + 0.15G + 0.05D ; IVtotal = IVcurrent + 0.15*Pfuture
        iv_current = (IV_WEIGHT_SAFETY * S + IV_WEIGHT_MOTION * M + IV_WEIGHT_UNCERTAINTY * U +
                      IV_WEIGHT_GEOMETRY * G + IV_WEIGHT_DISTANCE * D)
        iv_total = iv_current + IV_WEIGHT_FUTURE * future_prob

        base = (IG_WEIGHT_UNCERTAINTY * U + IG_WEIGHT_SAFETY * S + IG_WEIGHT_GEOMETRY * G +
                IG_WEIGHT_MOTION * M + IG_WEIGHT_FUTURE * future_prob)
        # Retention deliberately EXCLUDES the uncertainty term. "We don't
        # know much about this cell yet" is a valid reason to spend budget
        # FINDING OUT (it belongs in refine_gain, matching the documented
        # formula exactly), but it is not a valid reason to KEEP paying for
        # fine resolution indefinitely -- once a cell has been refined, only
        # demonstrated importance (safety relevance, motion, geometric
        # complexity, future relevance) should justify continuing to hold
        # that detail. Without this distinction, a boring/empty region that
        # happens to be intermittently observed would stay "uncertain"
        # forever and, via ConfidenceOfBenefit amplifying its own
        # uncertainty term, would never fall back below the coarsen
        # threshold -- silently breaking Differentiator #6 (resource
        # reclamation). This is exactly the kind of implementation choice
        # the revision notes defer to the code for.
        base_importance_only = (IG_WEIGHT_SAFETY * S + IG_WEIGHT_GEOMETRY * G +
                                 IG_WEIGHT_MOTION * M + IG_WEIGHT_FUTURE * future_prob)
        cob = 0.5 + 0.5 * (1.0 - confidence_new)  # ConfidenceOfBenefit, using this frame's updated confidence

        rg_lookup = np.array([resolution_gain(l) for l in range(len(RESOLUTION_LEVELS))])
        rg = rg_lookup[levels]
        # resolution_gain of the level BELOW this cell (the jump that
        # originally justified refining into it) -- used for retention only.
        rg_below_lookup = np.array([resolution_gain(max(0, l - 1)) for l in range(len(RESOLUTION_LEVELS))])
        rg_below = rg_below_lookup[levels]

        can_refine = levels < (len(RESOLUTION_LEVELS) - 1)
        refine_gain = base * rg * cob * IG_SCALE_FACTOR
        retention_gain = base_importance_only * rg_below * cob * IG_SCALE_FACTOR

        # num_new_cells depends only on level -> precompute once per level
        n_new_lookup = np.array([self._num_new_cells_for_level(l) for l in range(len(RESOLUTION_LEVELS))])
        n_new_cells = n_new_lookup[levels]

        refine_cost = np.maximum(
            COST_MIN,
            (COST_K_COMPUTE * n_new_cells + COST_K_MEMORY * n_new_cells + COST_K_POINTS * point_count)
            * COST_HARDWARE_MULTIPLIER,
        )
        maintain_cost = compute_maintain_cost()  # scalar, same for every cell

        refine_utility = np.where(can_refine, refine_gain / refine_cost, 0.0)
        retention_utility = retention_gain / maintain_cost

        # ---- write results back onto the QuadCell objects (for explainability) --
        for i, cell in enumerate(leaves):
            cell.signals = {"S": float(S[i]), "M": float(M[i]), "U": float(U[i]),
                             "G": float(G[i]), "D": float(D[i]), "P_future": float(future_prob[i])}
            cell.confidence = float(confidence_new[i])
            cell.observation_count = int(observation_count_new[i])
            cell.future_probability = float(future_prob[i])
            # Persisted separately from last_utility (which is refine_utility
            # for any cell that can still go finer): reporting/coarsen logic
            # needs "is this specific cell still worth KEEPING" regardless of
            # whether it could also be refined further -- conflating the two
            # previously let boring-but-technically-refinable cells pass an
            # "interesting" filter that meant to catch exactly them.
            cell.retention_utility = float(retention_utility[i])
            if can_refine[i]:
                cell.last_information_gain = float(refine_gain[i])
                cell.last_cost = float(refine_cost[i])
                cell.last_utility = float(refine_utility[i])
            else:
                cell.last_information_gain = float(retention_gain[i])
                cell.last_cost = float(maintain_cost)
                cell.last_utility = float(retention_utility[i])

        refine_candidates = [
            {"cell": leaves[i], "utility": float(refine_utility[i]), "refine_cost": float(refine_cost[i]),
             "iv_total": float(iv_total[i])}
            for i in np.where(can_refine & (refine_utility >= REFINE_THRESHOLD) &
                               (self.frame_id - np.array([leaves[j].last_transition_frame for j in range(n)])
                                >= TRANSITION_COOLDOWN_FRAMES))[0]
        ]
        retention_records = [
            {"cell": leaves[i], "retention_utility": float(retention_utility[i])}
            for i in np.where(levels > 0)[0]
        ]

        # 13-15. FIXED BUDGET -> REFINE / MAINTAIN / COARSEN -----------------------
        decisions: Dict[str, str] = {}

        # -- REFINE: highest utility first, gated by remaining budget --------------
        for rec in sorted(refine_candidates, key=lambda r: r["utility"], reverse=True):
            cell: QuadCell = rec["cell"]
            granted = self.budget.allocate(cell.id, rec["refine_cost"], self.frame_id)
            if granted:
                cell.refine()
                cell.last_transition_frame = self.frame_id
                # the parent is no longer a leaf (won't appear in the region
                # list), so record REFINE on each newly created child leaf too
                for child in cell.children:
                    child.allocated_cost = rec["refine_cost"] / max(1, len(cell.children))
                    child.last_transition_frame = self.frame_id
                    decisions[child.id] = Decision.REFINE.value
            else:
                decisions[cell.id] = Decision.MAINTAIN.value

        # -- COARSEN: whole sibling groups collapse together (Sec. 12) -------------
        # A group is only eligible to coarsen once its parent's own cooldown
        # (from the last time it was refined/coarsened) has elapsed -- same
        # hysteresis mechanism as REFINE above, applied to the parent's
        # identity since the parent QuadCell persists across refine/coarsen
        # cycles even as its .children list is created and wiped.
        groups: Dict[str, List[dict]] = defaultdict(list)
        for rec in retention_records:
            cell = rec["cell"]
            if cell.parent is not None:
                groups[cell.parent.id].append(rec)
        for parent_id, members in groups.items():
            parent = members[0]["cell"].parent
            cooldown_elapsed = (self.frame_id - parent.last_transition_frame) >= TRANSITION_COOLDOWN_FRAMES
            if cooldown_elapsed and all(m["retention_utility"] < COARSEN_THRESHOLD for m in members):
                reclaimed = sum(m["cell"].allocated_cost for m in members)
                self.budget.reclaim(parent_id, reclaimed, self.frame_id)
                parent.coarsen()
                parent.last_transition_frame = self.frame_id
                decisions[parent_id] = Decision.COARSEN.value
            else:
                for m in members:
                    decisions.setdefault(m["cell"].id, Decision.MAINTAIN.value)

        final_leaves = self.map.all_leaf_cells()
        for cell in final_leaves:
            decisions.setdefault(cell.id, Decision.MAINTAIN.value)

        self.last_processing_time_s = time.perf_counter() - t0
        self.frame_id += 1

        summary = self._build_summary(perc, tracks, track_predictions, decisions, points, final_leaves)
        self.last_frame_summary = summary
        return summary

    # ---------------------------------------------------------------- helpers
    @staticmethod
    def _num_new_cells_for_level(level: int) -> int:
        """How many children a cell at this level would get if refined one
        level finer (0 if already at the finest level)."""
        if level >= len(RESOLUTION_LEVELS) - 1:
            return 0
        cur = RESOLUTION_LEVELS[level]
        nxt = RESOLUTION_LEVELS[level + 1]
        per_side = max(2, round(cur / nxt))
        return per_side * per_side

    def _assign_points_to_leaves(self, points: np.ndarray) -> Dict[str, np.ndarray]:
        """Vectorised point -> leaf-cell assignment. Points are first binned
        into ROOT cells in O(N); only the (usually few) refined branches are
        then walked recursively on their small point subsets."""
        if len(points) == 0:
            return {}
        x0, _ = self.map.x_range
        y0, _ = self.map.y_range
        size = self.map.root_cells[0].size if self.map.root_cells else 0.5

        ix = np.floor((points[:, 0] - x0) / size).astype(np.int64)
        iy = np.floor((points[:, 1] - y0) / size).astype(np.int64)
        keys = ix * 1_000_003 + iy

        order = np.argsort(keys)
        sorted_keys = keys[order]
        unique_keys, start_idx = np.unique(sorted_keys, return_index=True)
        groups = np.split(order, start_idx[1:])
        key_to_indices = dict(zip(unique_keys.tolist(), groups))

        result: Dict[str, np.ndarray] = {}
        for root in self.map.root_cells:
            rix = int(round((root.x_min - x0) / size))
            riy = int(round((root.y_min - y0) / size))
            key = rix * 1_000_003 + riy
            idxs = key_to_indices.get(key, np.array([], dtype=int))
            self._assign_recursive(root, idxs, points, result)
        return result

    def _assign_recursive(self, cell: QuadCell, idxs: np.ndarray, points: np.ndarray,
                           result: Dict[str, np.ndarray]):
        if cell.is_leaf():
            result[cell.id] = idxs
            return
        if len(idxs) == 0:
            for child in cell.children:
                result[child.id] = idxs
            return
        pts = points[idxs]
        for child in cell.children:
            mask = ((pts[:, 0] >= child.x_min) & (pts[:, 0] < child.x_max) &
                    (pts[:, 1] >= child.y_min) & (pts[:, 1] < child.y_max))
            self._assign_recursive(child, idxs[mask], points, result)

    def _build_summary(self, perc, tracks, track_predictions, decisions, points, leaves=None) -> dict:
        if leaves is None:
            leaves = self.map.all_leaf_cells()
        regions = []
        level_counts = {0: 0, 1: 0, 2: 0}
        DYNAMIC_CLASSES_FOR_REPORTING = {"car", "person", "rider", "truck", "bike"}
        for cell in leaves:
            level_counts[cell.level] = level_counts.get(cell.level, 0) + 1
            just_transitioned = decisions.get(cell.id) not in ("MAINTAIN", None)
            # A level>0 cell with no points this frame and unremarkable
            # utility is almost always a "boring sibling" -- created because
            # ONE cell in its refine group had a real reason to exist, but
            # itself carries no real information. These previously flooded
            # the reported region list (and the frontend's region cards)
            # with many near-identical low-value entries even though they
            # cost nothing extra to compute -- this filter only affects what
            # gets REPORTED via the API, not the map's actual internal state
            # (still fully counted in `active_cell_count`/`cells_by_level`).
            meaningfully_useful = cell.level == 0 or cell.retention_utility >= COARSEN_THRESHOLD
            interesting = (
                cell.semantic_class in DYNAMIC_CLASSES_FOR_REPORTING or
                cell.point_count > 0 or
                cell.future_probability > 0.02 or
                just_transitioned or
                (cell.level > 0 and meaningfully_useful)
            )
            if not interesting:
                continue
            regions.append({
                "id": cell.id,
                "level": cell.level,
                "resolution_m": cell.size,
                "bounds": [cell.x_min, cell.y_min, cell.x_max, cell.y_max],
                "distance": math.hypot(*cell.center),
                "semantic_class": cell.semantic_class,
                "point_count": cell.point_count,
                "confidence": cell.confidence,
                "signals": cell.signals,
                "information_gain": cell.last_information_gain,
                "cost": cell.last_cost,
                "utility": cell.last_utility,
                "decision": decisions.get(cell.id, "MAINTAIN"),
            })
        return {
            "frame_id": self.frame_id,
            "regions": regions,
            "tracks": [tr.as_dict() for tr in tracks],
            "predictions": track_predictions,
            "scene_complexity": perc["scene_complexity"],
            "classification_results": perc["dynamic_objects"] + perc["static_objects"],
            "budget": {
                "total": self.budget.total_budget,
                "used": round(self.budget.used_budget, 3),
                "remaining": round(self.budget.remaining(), 3),
            },
            "ledger": self.budget.recent_events(20),
            "metrics": {
                "processing_time_ms": round(self.last_processing_time_s * 1000, 3),
                "active_cell_count": len(leaves),
                "reported_region_count": len(regions),
                "cells_by_level": level_counts,
                "point_count": int(len(points)),
            },
        }

    def get_decision_explanation(self, region_id: str) -> Optional[dict]:
        for cell in self.map.all_leaf_cells():
            if cell.id == region_id:
                return {
                    "region_id": cell.id,
                    "level": cell.level,
                    "resolution_m": cell.size,
                    "semantic_class": cell.semantic_class,
                    "distance": math.hypot(*cell.center),
                    "signals": cell.signals,
                    "future_relevance": cell.future_probability,
                    "expected_information_gain": cell.last_information_gain,
                    "refinement_cost": cell.last_cost,
                    "utility": cell.last_utility,
                    "decision": cell.last_decision if cell.last_decision else "MAINTAIN",
                }
        return None