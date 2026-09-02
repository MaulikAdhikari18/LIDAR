import time
from preprocessing.pointcloud import preprocess
from perception.semantic import perceive
from perception.kitti_labels import KittiPerceptionBridge
from utility.information_value import current_information_value, future_expected_value
from utility.information_gain import estimate_information_gain
from utility.refinement_cost import estimate_refinement_cost
from evaluation.baseline import BaselineEngine
from evaluation.metrics import MetricsEvaluator

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
        self.kitti_bridge = KittiPerceptionBridge()

    def refresh_config(self, config):
        self.config = config
        self.allocator.config = config
        self.baseline.config = config
        self.evaluator.config = config

    def process_frame(self, lidar_frame, frame_id):
        t0 = time.perf_counter()

        label_path = lidar_frame.get("label_path")
        if label_path:
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