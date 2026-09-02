"""
Bridge between raw SemanticKITTI ground-truth labels (.label files) and this
backend's perception output format (regions + dynamic_objects).

Why this exists:
  input/dataset_loader.py only reads point geometry (.bin) and an optional
  hand-written .json sidecar. It has no idea that a SemanticKITTI-style
  `labels/000123.label` file sitting next to `velodyne/000123.bin` contains
  real per-point semantic + instance ground truth. Without this bridge,
  perception/semantic.py falls back to density-only "unknown" blobs and the
  whole utility/tracking/prediction pipeline has nothing real to react to.

This module:
  1. Parses .label files (uint32 per point: low 16 bits = semantic class id,
     high 16 bits = instance id).
  2. Maps SemanticKITTI class ids to this project's semantic categories.
  3. Produces coarse full-coverage terrain/static regions from ALL points
     (so the adaptive grid still sees the whole scene, not just objects).
  4. Clusters "thing" classes (car/person/bicyclist/...) by instance id into
     discrete detections, and tracks their centroids across frames itself
     (since raw KITTI gives no velocity) to produce vx/vy for the existing
     tracker.py to consume unchanged.

Usage: instantiate ONE KittiPerceptionBridge per running session (it holds
state across frames), and call .build(...) instead of perception.semantic.perceive
whenever the current frame has a label_path.
"""

import math
import numpy as np

# --- SemanticKITTI class id -> (our semantic_class name, category) -------
# category is one of: "drivable", "static", "dynamic"
# Reuses the class names already scored in perception/semantic.SEMANTIC_SCORE
# where a sensible match exists; unmapped/rare ids fall back to "unknown".
CLASS_MAP = {
    0:   ("unknown", "static"),   # unlabeled
    1:   ("unknown", "static"),   # outlier
    10:  ("vehicle", "dynamic"),  # car
    11:  ("vehicle", "dynamic"),  # bicycle
    13:  ("vehicle", "dynamic"),  # bus
    15:  ("vehicle", "dynamic"),  # motorcycle
    16:  ("vehicle", "dynamic"),  # on-rails
    18:  ("vehicle", "dynamic"),  # truck
    20:  ("vehicle", "dynamic"),  # other-vehicle
    30:  ("pedestrian", "dynamic"),  # person
    31:  ("vehicle", "dynamic"),  # bicyclist
    32:  ("vehicle", "dynamic"),  # motorcyclist
    40:  ("road", "drivable"),    # road
    44:  ("road", "drivable"),    # parking
    48:  ("curb", "static"),      # sidewalk (proxy for curb boundary)
    49:  ("terrain", "drivable"),  # other-ground
    50:  ("building", "static"),  # building
    51:  ("obstacle", "static"),  # fence
    52:  ("obstacle", "static"),  # other-structure
    60:  ("road", "drivable"),    # lane-marking
    70:  ("obstacle", "static"),  # vegetation
    71:  ("obstacle", "static"),  # trunk
    72:  ("terrain", "drivable"),  # terrain
    80:  ("obstacle", "static"),  # pole
    81:  ("obstacle", "static"),  # traffic-sign
    99:  ("unknown", "static"),   # other-object
    252: ("vehicle", "dynamic"),  # moving-car
    253: ("vehicle", "dynamic"),  # moving-bicyclist
    254: ("pedestrian", "dynamic"),  # moving-person
    255: ("vehicle", "dynamic"),  # moving-motorcyclist
    256: ("vehicle", "dynamic"),  # moving-on-rails
    257: ("vehicle", "dynamic"),  # moving-bus
    258: ("vehicle", "dynamic"),  # moving-truck
    259: ("vehicle", "dynamic"),  # moving-other-vehicle
}

SEMANTIC_SCORE = {
    "pedestrian": 1.0, "vehicle": 0.9, "curb": 0.75,
    "obstacle": 0.85, "road": 0.25, "building": 0.35,
    "terrain": 0.20, "unknown": 0.45,
}

DYNAMIC_IDS = {k for k, v in CLASS_MAP.items() if v[1] == "dynamic"}

# --- Vectorized lookup tables (built once at import time) -----------------
# SemanticKITTI ids top out at 259, so a flat array indexed by id is both
# simpler and far faster than a per-point dict/Python-loop lookup.
_MAX_ID = 300
_CLASS_NAMES = sorted({name for name, _ in CLASS_MAP.values()} | {"unknown"})
_NAME_TO_IDX = {name: i for i, name in enumerate(_CLASS_NAMES)}
_UNKNOWN_IDX = _NAME_TO_IDX["unknown"]

_ID_TO_CLASS_IDX = np.full(_MAX_ID, _UNKNOWN_IDX, dtype=np.int64)
_ID_TO_IS_DYNAMIC = np.zeros(_MAX_ID, dtype=bool)
for _sid, (_name, _category) in CLASS_MAP.items():
    _ID_TO_CLASS_IDX[_sid] = _NAME_TO_IDX[_name]
    _ID_TO_IS_DYNAMIC[_sid] = (_category == "dynamic")

_IMPORTANCE_BY_IDX = np.array(
    [SEMANTIC_SCORE.get(name, 0.45) for name in _CLASS_NAMES], dtype=float
)


def load_label_file(path):
    """Returns (semantic_ids, instance_ids) arrays aligned to the point cloud."""
    raw = np.fromfile(str(path), dtype=np.uint32)
    semantic_ids = raw & 0xFFFF
    instance_ids = raw >> 16
    return semantic_ids, instance_ids


class KittiPerceptionBridge:
    """Stateful: remembers last-seen centroid per track to derive velocity."""

    def __init__(self):
        self._history = {}  # track_id -> (x, y, timestamp)

    def reset(self):
        self._history.clear()

    def build(self, points, label_path, timestamp, config, point_mask=None):
        points = np.asarray(points, dtype=float)
        semantic_ids, instance_ids = load_label_file(label_path)

        if point_mask is not None:
            # points has ALREADY been filtered upstream (e.g. by
            # preprocessing.pointcloud.preprocess); point_mask tells us
            # exactly which of the original (unfiltered) label entries
            # survive, so we can filter labels the same way instead of
            # naive truncation (which silently misaligns points to the
            # wrong labels the moment any filtering actually happens).
            n = min(len(point_mask), len(semantic_ids))
            semantic_ids = semantic_ids[:n][point_mask[:n]]
            instance_ids = instance_ids[:n][point_mask[:n]]
            if len(semantic_ids) != len(points):
                # Defensive fallback: shapes still don't line up (e.g. a
                # label file that doesn't match this point cloud at all) -
                # truncate rather than crash, but this should not happen
                # in normal operation.
                n2 = min(len(points), len(semantic_ids))
                points, semantic_ids, instance_ids = points[:n2], semantic_ids[:n2], instance_ids[:n2]
        else:
            n = min(len(points), len(semantic_ids))
            points, semantic_ids, instance_ids = points[:n], semantic_ids[:n], instance_ids[:n]

        semantic_ids = np.clip(semantic_ids, 0, _MAX_ID - 1).astype(np.int64)

        regions = self._build_regions(points, semantic_ids, config)
        dynamic_objects = self._build_dynamic_objects(points, semantic_ids, instance_ids, timestamp)

        # Fold dynamic-object centroids into regions too, so the adaptive
        # engine sees them as high-value cells (not just the tracker).
        for obj in dynamic_objects:
            regions.append({
                "x": obj["x"], "y": obj["y"], "z": obj["z"],
                "semantic_class": obj["class"],
                "semantic_importance": SEMANTIC_SCORE.get(obj["class"], 0.45),
                "motion": min(1.0, math.hypot(obj["vx"], obj["vy"]) / 3.0),
                "uncertainty": max(0.05, 1 - obj["confidence"]),
                "geometry": 0.6,
                "distance_relevance": 1 / (1 + math.hypot(obj["x"], obj["y"]) / 10),
                "occupancy": 0.95,
                "confidence": obj["confidence"],
            })

        return {"regions": regions, "dynamic_objects": dynamic_objects}

    def _build_regions(self, points, semantic_ids, config):
        """Coarse full-coverage grid so terrain/static classes are represented
        everywhere, not only where a discrete object was detected. Fully
        vectorized: no per-point Python loop."""
        res = config.resolution_levels[0]
        half_w, half_h = config.map_dimensions[0] / 2, config.map_dimensions[1] / 2

        x, y = points[:, 0], points[:, 1]
        in_bounds = (np.abs(x) <= half_w) & (np.abs(y) <= half_h)
        is_dynamic = _ID_TO_IS_DYNAMIC[semantic_ids]
        keep = in_bounds & ~is_dynamic
        if not np.any(keep):
            return []

        x, y = x[keep], y[keep]
        class_idx = _ID_TO_CLASS_IDX[semantic_ids[keep]]

        cx = np.floor((x + half_w) / res).astype(np.int64)
        cy = np.floor((y + half_h) / res).astype(np.int64)
        cell_key = cx * 1_000_003 + cy  # unique per (cx, cy); both are >= 0 here

        uniq_cells, inv = np.unique(cell_key, return_inverse=True)
        n_cells = len(uniq_cells)

        counts = np.bincount(inv, minlength=n_cells)
        x_sum = np.bincount(inv, weights=x, minlength=n_cells)
        y_sum = np.bincount(inv, weights=y, minlength=n_cells)
        x_mean = x_sum / counts
        y_mean = y_sum / counts

        n_classes = len(_CLASS_NAMES)
        composite = inv * n_classes + class_idx
        class_counts = np.bincount(composite, minlength=n_cells * n_classes).reshape(n_cells, n_classes)
        dominant_idx = class_counts.argmax(axis=1)
        dominant_count = class_counts.max(axis=1)
        purity = dominant_count / counts

        dist = np.hypot(x_mean, y_mean)
        importance = _IMPORTANCE_BY_IDX[dominant_idx]
        uncertainty = np.maximum(0.05, 1 - purity)
        geometry = np.minimum(1.0, counts / 40.0)
        occupancy = np.minimum(1.0, counts / 30.0)
        distance_relevance = 1 / (1 + dist / 10)

        regions = []
        names = [_CLASS_NAMES[i] for i in dominant_idx]
        for i in range(n_cells):
            regions.append({
                "x": float(x_mean[i]), "y": float(y_mean[i]), "z": 0.0,
                "semantic_class": names[i],
                "semantic_importance": float(importance[i]),
                "motion": 0.0,
                "uncertainty": float(uncertainty[i]),
                "geometry": float(geometry[i]),
                "distance_relevance": float(distance_relevance[i]),
                "occupancy": float(occupancy[i]),
                "confidence": float(purity[i]),
            })
        return regions

    def _build_dynamic_objects(self, points, semantic_ids, instance_ids, timestamp):
        """Clusters 'thing' classes by instance id. Vectorized aside from a
        final loop over unique tracks (typically tens, not tens of thousands)."""
        is_dynamic = _ID_TO_IS_DYNAMIC[semantic_ids]
        has_instance = instance_ids > 0
        keep = is_dynamic & has_instance
        if not np.any(keep):
            return []

        x, y, z = points[keep, 0], points[keep, 1], points[keep, 2]
        sid = semantic_ids[keep]
        iid = instance_ids[keep].astype(np.int64)
        track_num = sid * 1_000_000 + iid

        uniq_tracks, inv = np.unique(track_num, return_inverse=True)
        n_tracks = len(uniq_tracks)
        counts = np.bincount(inv, minlength=n_tracks)
        x_mean = np.bincount(inv, weights=x, minlength=n_tracks) / counts
        y_mean = np.bincount(inv, weights=y, minlength=n_tracks) / counts
        z_mean = np.bincount(inv, weights=z, minlength=n_tracks) / counts
        track_sid = uniq_tracks // 1_000_000

        objects = []
        for i in range(n_tracks):
            cls_name = _CLASS_NAMES[_ID_TO_CLASS_IDX[track_sid[i]]]
            track_id = str(uniq_tracks[i])
            tx, ty, tz = float(x_mean[i]), float(y_mean[i]), float(z_mean[i])
            prev = self._history.get(track_id)
            if prev:
                px, py, pt = prev
                dt = max(1e-3, timestamp - pt)
                vx, vy = (tx - px) / dt, (ty - py) / dt
            else:
                vx, vy = 0.0, 0.0
            self._history[track_id] = (tx, ty, timestamp)
            objects.append({
                "track_id": track_id, "class": cls_name,
                "x": tx, "y": ty, "z": tz, "vx": vx, "vy": vy,
                "confidence": min(1.0, 0.5 + int(counts[i]) / 200.0),
            })
        return objects