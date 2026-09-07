import time
import numpy as np
from preprocessing.pointcloud import preprocess
from perception.semantic import perceive
from perception.kitti_labels import KittiPerceptionBridge, load_label_file, to_checkpoint_taxonomy
from utility.information_value import current_information_value, future_expected_value
from utility.information_gain import estimate_information_gain
from utility.refinement_cost import estimate_refinement_cost
from evaluation.baseline import BaselineEngine
from evaluation.metrics import MetricsEvaluator
from evaluation.live_accuracy import LiveAccuracyEvaluator

class AdaptiveController:
    def __init__(self, config, map_manager, tracker, predictor, allocator):
        self.config = config
        self.map = map_manager
        self.tracker = tracker
        self.predictor = predictor
        self.allocator = allocator
        self.decision_log = []
        self.baseline = BaselineEngine(config)
        self.evaluator = MetricsEvaluator(config)
        self.live_accuracy = LiveAccuracyEvaluator()
        self.kitti_bridge = KittiPerceptionBridge()
        self._pointnet2_perception = None

    def refresh_config(self, config):
        self.config = config
        self.allocator.config = config
        self.baseline.config = config
        self.evaluator.config = config

    def _get_pointnet2_perception(self):
        # Lazy: only imports torch / loads the checkpoint the first time
        # perception_mode="pointnet2" is actually used, so the default
        # ground_truth/generic path keeps working on machines without torch
        # installed or without the checkpoint present.
        if self._pointnet2_perception is None:
            from perception.pointnet2_semantic import PointNet2Perception
            try:
                self._pointnet2_perception = PointNet2Perception()
            except Exception as exc:
                raise RuntimeError(
                    "perception_mode='pointnet2' requires torch and "
                    "checkpoints/pointnet2_foveamap.pth to be present and "
                    f"loadable ({type(exc).__name__}: {exc})"
                ) from exc
        return self._pointnet2_perception

    def process_frame(self, lidar_frame, frame_id):
        t0 = time.perf_counter()

        label_path = lidar_frame.get("label_path")
        perception_mode = getattr(self.config, "perception_mode", "ground_truth")

        if perception_mode == "pointnet2":
            # return_mask=True so that, if this frame ALSO has ground-truth
            # labels sitting next to it, we can filter the .label file the
            # exact same way and get a per-point ground truth array aligned
            # to the same points the model saw -- see the accuracy scoring
            # block below. This mirrors exactly how the label_path branch
            # (KittiPerceptionBridge.build) stays aligned after filtering.
            points, point_mask = preprocess(lidar_frame, self.config, return_mask=True)
            perception = self._get_pointnet2_perception()
            scene = perception.perceive(points, self.config)

            # Opportunistic live accuracy check: only possible on frames that
            # happen to carry SemanticKITTI ground truth, and only scores the
            # points the model actually sampled+predicted on (perception.
            # last_sampled_idx / last_predictions), not the whole scan.
            if label_path and perception.last_predictions is not None and len(perception.last_predictions):
                try:
                    semantic_ids, _instance_ids = load_label_file(label_path)
                    n = min(len(point_mask), len(semantic_ids))
                    semantic_ids = semantic_ids[:n][point_mask[:n]]
                    semantic_ids = np.clip(semantic_ids, 0, 299).astype(np.int64)
                    if len(semantic_ids) == len(points):
                        gt_3class = to_checkpoint_taxonomy(semantic_ids)
                        gt_for_sampled = gt_3class[perception.last_sampled_idx]
                        self.live_accuracy.update(perception.last_predictions, gt_for_sampled)
                except Exception as exc:
                    # Never let an accuracy side-check take down the actual
                    # demo frame -- log and move on.
                    print(f"[live_accuracy] skipped frame {frame_id}: {type(exc).__name__}: {exc}")
        elif label_path:
            points, point_mask = preprocess(lidar_frame, self.config, return_mask=True)
            scene = self.kitti_bridge.build(points, label_path, lidar_frame.get("timestamp", 0.0), self.config, point_mask=point_mask)
        else:
            points = preprocess(lidar_frame, self.config)
            scene = perceive(points, lidar_frame.get("objects", []), self.config)

        self.map.update_observations(scene["regions"], frame_id)
        decayed = self.map.decay_stale_cells(frame_id, self.config.max_stale_frames)
        tracks = self.tracker.update(scene["dynamic_objects"])
        future = self.predictor.predict(tracks, self.config.prediction_horizon)
        self.map.update_future_signal(future)

        candidates = []
        for region in self.map.active_regions():
            iv = current_information_value(region, self.config)
            ev = future_expected_value(region, self.config)
            for transition in self.map.legal_transitions(region):
                ig = estimate_information_gain(region, transition, iv, ev, self.config)
                cost = estimate_refinement_cost(region, transition, self.config)
                utility = ig / max(cost, 1e-9)
                candidates.append({
                    "region_id": region.region_id,
                    "from_resolution": region.resolution,
                    "to_resolution": transition,
                    "ig": ig, "cost": cost, "utility": utility,
                    "signals": {
                        "S": region.semantic_importance,
                        "M": region.motion,
                        "U": region.uncertainty,
                        "G": region.geometry,
                        "D": region.distance_relevance,
                        "P_future": region.future_probability,
                        "IV_current": iv, "EV_future": ev
                    }
                })

        decisions = self.allocator.allocate(candidates, self.map)
        applied = self.map.apply_decisions(decisions, frame_id, self.config)
        self.map.reclaim_resources()

        elapsed = time.perf_counter() - t0
        metrics = {
            "frame_id": frame_id,
            "processing_time_ms": elapsed * 1000,
            "fps": 1.0 / elapsed if elapsed else 0,
            "points_processed": len(points),
            "active_cells": self.map.active_cell_count(),
            "decayed_cells": len(decayed),
            "fine_cells": self.map.count_resolution(self.config.resolution_levels[-1]),
            "medium_cells": self.map.count_resolution(self.config.resolution_levels[-2]),
            "coarse_cells": self.map.count_resolution(self.config.resolution_levels[0]),
            "budget": self.config.computational_budget,
            "used_budget": self.map.active_cost,
            "remaining_budget": max(0, self.config.computational_budget - self.map.active_cost),
            "source_file": lidar_frame.get("source_file")
        }
        self.evaluator.record(metrics)
        self.decision_log.extend(applied)

        return {
            "frame_id": frame_id,
            "source_file": lidar_frame.get("source_file"),
            "points_processed": len(points),
            "objects": tracks,
            "future": future,
            "regions": self.map.serialize_active(),
            "candidates": sorted(candidates, key=lambda x: x["utility"], reverse=True)[:100],
            "decisions": applied,
            "metrics": metrics
        }

    def serialize_state(self, result):
        return result or {"frame_id": 0, "regions": [], "objects": [], "decisions": [], "metrics": {}}

    def baseline_compare(self, result):
        return self.baseline.compare(result)

    def metrics_summary(self):
        return self.evaluator.summary()

    def accuracy_summary(self):
        """Live pointnet2-vs-ground-truth accuracy, plus the checkpoint's own
        offline validation numbers when available, clearly separated so the
        two are never confused with each other."""
        summary = self.live_accuracy.summary()
        summary["checkpoint"] = (
            self._pointnet2_perception.info() if self._pointnet2_perception is not None else None
        )
        return summary