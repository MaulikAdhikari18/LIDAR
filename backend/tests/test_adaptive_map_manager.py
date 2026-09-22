from core.adaptive_map_manager import AdaptiveMapManager
from data.synthetic_scene import generate_synthetic_frame


def test_process_frame_returns_well_formed_summary():
    manager = AdaptiveMapManager()
    points, labels, _ = generate_synthetic_frame(0)
    summary = manager.process_frame(points, labels)

    for key in ("frame_id", "regions", "tracks", "predictions", "scene_complexity",
                "classification_results", "budget", "ledger", "metrics"):
        assert key in summary

    # frame_id is incremented internally before the summary is built (it
    # already reflects "frames processed so far", not the input frame_id
    # argument), matching how api/live_endpoints.py reads it.
    assert summary["frame_id"] == 1
    assert isinstance(summary["regions"], list) and len(summary["regions"]) > 0
    # the synthetic frame always includes a moving pedestrian and vehicle
    assert len(summary["tracks"]) >= 1
    assert len(summary["predictions"]) == len(summary["tracks"])

    for region in summary["regions"]:
        for key in ("id", "level", "resolution_m", "bounds", "distance",
                    "semantic_class", "decision"):
            assert key in region
        assert region["decision"] in ("REFINE", "MAINTAIN", "COARSEN")


def test_budget_never_exceeds_total_across_frames():
    manager = AdaptiveMapManager()
    for frame_id in range(5):
        points, labels, _ = generate_synthetic_frame(frame_id)
        summary = manager.process_frame(points, labels)
        budget = summary["budget"]
        assert budget["used"] <= budget["total"] + 1e-6
        assert budget["remaining"] >= -1e-6
        assert abs(budget["used"] + budget["remaining"] - budget["total"]) < 1e-3


def test_frame_id_increments_and_tracks_persist_across_frames():
    manager = AdaptiveMapManager()
    points0, labels0, _ = generate_synthetic_frame(0)
    manager.process_frame(points0, labels0)
    assert manager.frame_id == 1  # advanced past the processed frame

    points1, labels1, _ = generate_synthetic_frame(1)
    summary1 = manager.process_frame(points1, labels1)
    assert summary1["frame_id"] == 2
    assert manager.frame_id == 2

    # the pedestrian/vehicle tracks from frame 0 should still be tracked
    # (same object, not re-created), not reset every frame.
    assert len(manager.tracker.tracks) >= 1


def test_reset_clears_map_tracker_and_budget():
    manager = AdaptiveMapManager()
    for frame_id in range(3):
        points, labels, _ = generate_synthetic_frame(frame_id)
        manager.process_frame(points, labels)
    assert manager.frame_id == 3
    assert len(manager.tracker.tracks) > 0
    assert manager.budget.used_budget > 0

    manager.reset()
    assert manager.frame_id == 0
    assert len(manager.tracker.tracks) == 0
    assert manager.budget.used_budget == 0
    assert manager.last_frame_summary is None


def test_get_decision_explanation_returns_none_for_unknown_region():
    manager = AdaptiveMapManager()
    points, labels, _ = generate_synthetic_frame(0)
    manager.process_frame(points, labels)
    assert manager.get_decision_explanation("not-a-real-region-id") is None


def test_get_decision_explanation_returns_explanation_for_real_region():
    manager = AdaptiveMapManager()
    points, labels, _ = generate_synthetic_frame(0)
    summary = manager.process_frame(points, labels)
    region_id = summary["regions"][0]["id"]

    explanation = manager.get_decision_explanation(region_id)
    assert explanation is not None
    assert explanation["region_id"] == region_id
    for key in ("expected_information_gain", "refinement_cost", "utility", "decision"):
        assert key in explanation