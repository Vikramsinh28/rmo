from __future__ import annotations

from datetime import datetime, timezone

from app.tracking.detector import Detection
from app.tracking.models import BoundingBox
from app.tracking.tracker import IoUPersonTracker


def _det(x: float, conf: float = 0.9) -> Detection:
    return Detection(
        tracking_candidate_id='c',
        bounding_box=BoundingBox(x, 0.2, 0.25, 0.5),
        confidence=conf,
        class_name='person',
    )


def test_track_persistence_across_movement():
    tracker = IoUPersonTracker(iou_threshold=0.2, max_lost_frames=5)
    t0 = datetime.now(timezone.utc)
    first = tracker.update([_det(0.30)], t0)
    assert len(first) == 1
    track_id = first[0].track_id
    second = tracker.update([_det(0.32)], t0)
    assert len(second) == 1
    assert second[0].track_id == track_id
    assert second[0].age_frames == 2


def test_new_person_gets_new_id():
    tracker = IoUPersonTracker(iou_threshold=0.3, max_lost_frames=5)
    t0 = datetime.now(timezone.utc)
    a = tracker.update([_det(0.1)], t0)
    b = tracker.update([_det(0.1), _det(0.6)], t0)
    assert len(b) == 2
    assert {p.track_id for p in b} != {a[0].track_id}


def test_temporary_disappearance_and_timeout():
    tracker = IoUPersonTracker(iou_threshold=0.3, max_lost_frames=2)
    t0 = datetime.now(timezone.utc)
    first = tracker.update([_det(0.3)], t0)
    track_id = first[0].track_id
    # Missing for two updates — still retained internally but not in active list.
    assert tracker.update([], t0) == []
    assert track_id in tracker._tracks
    tracker.update([], t0)
    # Third miss exceeds max_lost_frames=2
    tracker.update([], t0)
    assert track_id not in tracker._tracks
