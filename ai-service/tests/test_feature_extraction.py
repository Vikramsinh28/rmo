from __future__ import annotations

import numpy as np

from app.features.face_features import FaceFeatureExtractor
from app.features.movement_features import MovementFeatureExtractor
from app.features.pose_features import PoseFeatureExtractor
from app.tracking.models import BoundingBox, FeatureSnapshot
from datetime import datetime, timezone


def test_pose_gait_disabled_without_lower_body():
    pose = PoseFeatureExtractor().extract(BoundingBox(0.3, 0.2, 0.2, 0.4))
    assert pose['lowerBodyVisible'] is False
    assert pose['gaitAvailable'] is False
    assert pose['keypoints']['ankles'] is None


def test_pose_lower_body_heuristic_still_disables_gait_without_keypoints():
    pose = PoseFeatureExtractor().extract(BoundingBox(0.2, 0.05, 0.3, 0.9))
    assert pose['lowerBodyVisible'] is True
    assert pose['gaitAvailable'] is False


def test_movement_from_history():
    history = []
    box = BoundingBox(0.3, 0.2, 0.25, 0.5)
    for i in range(5):
        history.append(
            FeatureSnapshot(
                timestamp=datetime.now(timezone.utc),
                bounding_box=BoundingBox(0.3 + i * 0.01, 0.2, 0.25, 0.5),
            ),
        )
    movement = MovementFeatureExtractor().extract(
        history,
        box,
        lower_body_visible=False,
        gait_available=False,
    )
    assert movement['gaitAvailable'] is False
    assert movement['stepTiming'] is None
    assert movement['postureStability'] is not None


def test_face_extractor_returns_nulls_when_no_face():
    frame = np.zeros((120, 120, 3), dtype=np.uint8)
    face = FaceFeatureExtractor().extract(frame, BoundingBox(0.1, 0.1, 0.5, 0.7))
    assert face['visible'] is False
    assert face['headPose']['pitch'] is None
    assert face['eyes']['openProbability'] is None
