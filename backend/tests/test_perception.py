import numpy as np

from models.perception import (
    PerceptionModel,
    classify_cluster_geometric,
    predict_future_occupancy_simple,
    _simple_radius_cluster,
)
from models.pointnet2_lite import TORCH_AVAILABLE


def _make_frame():
    # ground carpet (terrain, label 22), a tight building cluster (static,
    # label 15) and a tight person cluster (dynamic, label 4).
    ground = np.array([[x, 0.0, 0.0, 0.1] for x in range(10)], dtype=np.float64)
    building = np.array([
        [20.0, 20.0, 0.0, 0.6], [20.1, 20.0, 0.0, 0.6], [20.0, 20.1, 3.0, 0.6],
        [20.1, 20.1, 3.0, 0.6],
    ], dtype=np.float64)
    person = np.array([
        [5.0, 0.0, 0.0, 0.5], [5.1, 0.0, 0.2, 0.5], [5.0, 0.1, 0.4, 0.5],
    ], dtype=np.float64)
    points = np.vstack([ground, building, person])
    labels = np.array([22] * len(ground) + [15] * len(building) + [4] * len(person))
    return points, labels


def test_perception_model_has_no_checkpoint_in_this_environment():
    # No models/checkpoints/pointnet2.pth ships with the project, and torch
    # isn't installed in this environment either -- both mean the
    # deterministic label-driven fallback classifier is what's actually
    # exercised, which is what every other endpoint/test relies on.
    assert TORCH_AVAILABLE is False
    model = PerceptionModel()
    assert model.use_checkpoint is False
    assert model.net is None


def test_semantic_bucket_mapping():
    model = PerceptionModel()
    assert model.semantic_bucket("person") == "dynamic_person"
    assert model.semantic_bucket("rider") == "dynamic_person"
    assert model.semantic_bucket("car") == "dynamic_vehicle"
    assert model.semantic_bucket("pole") == "static_obstacle"
    assert model.semantic_bucket("building") == "static_structure"
    assert model.semantic_bucket("ground") == "terrain"


def test_detect_and_segment_splits_terrain_static_dynamic():
    points, labels = _make_frame()
    model = PerceptionModel()
    result = model.detect_and_segment(points, labels)

    assert len(result["terrain_points"]) == 10
    assert len(result["static_objects"]) == 1
    assert len(result["dynamic_objects"]) == 1

    building_obj = result["static_objects"][0]
    assert building_obj["semantic_class"] == "building"
    assert building_obj["true_class_binary"] == "static"

    person_obj = result["dynamic_objects"][0]
    assert person_obj["semantic_class"] == "person"
    assert person_obj["true_class_binary"] == "dynamic"
    assert "classification_correct" in person_obj


def test_detect_and_segment_handles_empty_frame():
    points = np.empty((0, 4), dtype=np.float64)
    labels = np.empty((0,), dtype=np.int64)
    model = PerceptionModel()
    result = model.detect_and_segment(points, labels)
    assert len(result["terrain_points"]) == 0
    assert result["static_objects"] == []
    assert result["dynamic_objects"] == []
    assert result["scene_complexity"] == 0.0


def test_classify_cluster_geometric_wide_flat_is_static():
    # wide footprint (radius > 1.8), low height -> static (e.g. a building
    # wall or fence segment)
    xy = np.array([[x, 0.0] for x in np.linspace(-3, 3, 10)])
    z = np.zeros((10, 1))
    pts = np.hstack([xy, z])
    assert classify_cluster_geometric(pts) == "static"


def test_classify_cluster_geometric_tall_is_static():
    # narrow footprint but tall (height_range > 2.2) -> static (e.g. a pole)
    pts = np.array([[0.0, 0.0, z] for z in np.linspace(0, 3.0, 10)])
    assert classify_cluster_geometric(pts) == "static"


def test_classify_cluster_geometric_compact_is_dynamic():
    # compact footprint, low height -> dynamic (e.g. a pedestrian)
    pts = np.array([[0.0, 0.0, 0.0], [0.2, 0.1, 0.3], [0.1, -0.1, 0.5], [0.0, 0.0, 0.8]])
    assert classify_cluster_geometric(pts) == "dynamic"


def test_classify_cluster_geometric_defaults_to_static_for_tiny_clusters():
    assert classify_cluster_geometric(np.empty((0, 3))) == "static"
    assert classify_cluster_geometric(np.array([[0.0, 0.0, 0.0]])) == "static"


def test_simple_radius_cluster_keeps_chained_points_together():
    # a chain of points each within `radius` of the next should form ONE
    # cluster even though the two ends are farther apart than `radius`.
    xyz = np.array([[i * 1.0, 0.0, 0.0] for i in range(5)])  # 0,1,2,3,4
    clusters = _simple_radius_cluster(xyz, radius=1.5)
    assert len(clusters) == 1
    assert len(clusters[0]) == 5


def test_simple_radius_cluster_splits_distant_groups():
    xyz = np.array([[0.0, 0.0, 0.0], [0.5, 0.0, 0.0], [50.0, 0.0, 0.0], [50.5, 0.0, 0.0]])
    clusters = _simple_radius_cluster(xyz, radius=1.5)
    assert len(clusters) == 2
    assert {len(c) for c in clusters} == {2}


def test_predict_future_occupancy_simple_projects_constant_velocity():
    tracked = [{"id": "t1", "position": [0.0, 0.0, 0.0], "velocity": [2.0, 0.0, 0.0], "uncertainty": 0.1}]
    preds = predict_future_occupancy_simple(tracked, dt=2.0)
    assert len(preds) == 1
    pos = preds[0]["position"]
    assert abs(pos[0] - 4.0) < 1e-9
    assert 0.1 <= preds[0]["probability"] <= 1.0