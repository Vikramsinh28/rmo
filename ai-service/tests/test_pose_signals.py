from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from app.features.face_mesh import (
    FACE_MODEL_3D,
    MeshFaceFeatureExtractor,
    estimate_head_pose,
    eye_aspect_ratio,
    mouth_aspect_ratio,
)
from app.features.movement_features import MovementFeatureExtractor
from app.features.pose_features import PoseFeatureExtractor
from app.tracking.models import BoundingBox, Detection, FeatureSnapshot, Keypoint
from app.tracking.tracker import IoUPersonTracker


def _skeleton(lean: float = 0.0, ankles: bool = True, hip_x: float = 0.5) -> list[Keypoint]:
    """Upright COCO-17 skeleton; `lean` shifts the shoulders sideways (normalized)."""
    kp = [Keypoint(0.0, 0.0, 0.0) for _ in range(17)]
    kp[0] = Keypoint(hip_x + lean, 0.15, 0.9)  # nose
    kp[1] = Keypoint(hip_x + lean - 0.01, 0.14, 0.9)
    kp[2] = Keypoint(hip_x + lean + 0.01, 0.14, 0.9)
    kp[5] = Keypoint(hip_x + lean - 0.06, 0.25, 0.9)
    kp[6] = Keypoint(hip_x + lean + 0.06, 0.25, 0.9)
    kp[11] = Keypoint(hip_x - 0.05, 0.50, 0.9)
    kp[12] = Keypoint(hip_x + 0.05, 0.50, 0.9)
    kp[13] = Keypoint(hip_x - 0.05, 0.70, 0.9)
    kp[14] = Keypoint(hip_x + 0.05, 0.70, 0.9)
    conf = 0.9 if ankles else 0.1
    kp[15] = Keypoint(hip_x - 0.05, 0.90, conf)
    kp[16] = Keypoint(hip_x + 0.05, 0.90, conf)
    return kp


BOX = BoundingBox(0.4, 0.1, 0.2, 0.85)


def test_pose_from_upright_keypoints():
    pose = PoseFeatureExtractor(min_keypoint_confidence=0.5).extract(BOX, _skeleton())
    assert pose['source'] == 'keypoints'
    assert abs(pose['torsoAngle']) < 0.5
    assert abs(pose['shoulderAlignment']) < 0.5
    assert pose['lowerBodyVisible'] is True
    assert pose['gaitAvailable'] is True
    assert pose['hipCenter'] == {'x': 0.5, 'y': 0.5}
    assert pose['bodyHeight'] == pytest.approx(0.65, abs=1e-3)
    assert pose['keypoints']['ankles']['left'] is not None


def test_pose_torso_lean_sign():
    extractor = PoseFeatureExtractor(min_keypoint_confidence=0.5)
    right = extractor.extract(BOX, _skeleton(lean=0.05))
    left = extractor.extract(BOX, _skeleton(lean=-0.05))
    assert right['torsoAngle'] > 5
    assert left['torsoAngle'] < -5


def test_pose_gait_disabled_without_ankles():
    pose = PoseFeatureExtractor(min_keypoint_confidence=0.5).extract(BOX, _skeleton(ankles=False))
    assert pose['gaitAvailable'] is False
    assert pose['lowerBodyVisible'] is False
    assert pose['keypoints']['ankles'] == {'left': None, 'right': None}


def test_pose_without_keypoints_falls_back_to_box():
    pose = PoseFeatureExtractor().extract(BOX, None)
    assert pose['source'] == 'boundingBox'
    assert pose['torsoAngle'] is None
    assert pose['gaitAvailable'] is False


def test_hip_sway_uses_keypoint_history():
    extractor = PoseFeatureExtractor(min_keypoint_confidence=0.5)
    now = datetime.now(timezone.utc)
    history = []
    for i in range(8):
        hip_x = 0.5 + (0.03 if i % 2 else -0.03)
        history.append(
            FeatureSnapshot(
                timestamp=now + timedelta(milliseconds=200 * i),
                bounding_box=BOX,
                body=extractor.extract(BOX, _skeleton(hip_x=hip_x)),
            ),
        )
    current = extractor.extract(BOX, _skeleton())
    swaying = MovementFeatureExtractor().extract(history, BOX, True, True, current_pose=current)
    assert swaying['lateralSway'] > 0.03
    assert 'lateralSway' in swaying['signalsAvailable']
    assert swaying['gaitAvailable'] is True

    still = [
        FeatureSnapshot(timestamp=now, bounding_box=BOX, body=current) for _ in range(8)
    ]
    steady = MovementFeatureExtractor().extract(still, BOX, True, True, current_pose=current)
    assert steady['lateralSway'] == 0.0


def test_hip_sway_needs_enough_samples():
    movement = MovementFeatureExtractor().extract([], BOX, False, False, current_pose=None)
    assert movement['lateralSway'] is None


def test_eye_and_mouth_aspect_ratios():
    open_eye = [(0, 0), (3, -3), (7, -3), (10, 0), (7, 3), (3, 3)]
    closed_eye = [(0, 0), (3, -0.5), (7, -0.5), (10, 0), (7, 0.5), (3, 0.5)]
    assert eye_aspect_ratio(open_eye) == pytest.approx(0.6)
    assert eye_aspect_ratio(closed_eye) == pytest.approx(0.1)
    assert mouth_aspect_ratio((5, 0), (5, 4), (0, 2), (10, 2)) == pytest.approx(0.4)
    assert eye_aspect_ratio([(0, 0)] * 6) == 0.0


def _project(pitch=0.0, yaw=0.0, roll=0.0, size=400):
    cv2 = pytest.importorskip('cv2')
    rx, ry, rz = np.radians([pitch, yaw, roll])
    rot_x = cv2.Rodrigues(np.array([rx, 0.0, 0.0]))[0]
    rot_y = cv2.Rodrigues(np.array([0.0, ry, 0.0]))[0]
    rot_z = cv2.Rodrigues(np.array([0.0, 0.0, rz]))[0]
    camera = np.array([[size, 0, size / 2], [0, size, size / 2], [0, 0, 1]], dtype=np.float64)
    points = (rot_z @ rot_y @ rot_x @ FACE_MODEL_3D.T).T + np.array([0, 0, 1500.0])
    uv = (camera @ points.T).T
    return uv[:, :2] / uv[:, 2:]


@pytest.mark.parametrize(
    'angles',
    [
        {'pitch': 0.0, 'yaw': 0.0, 'roll': 0.0},
        {'pitch': 0.0, 'yaw': 25.0, 'roll': 0.0},
        {'pitch': -20.0, 'yaw': 0.0, 'roll': 0.0},
        {'pitch': 10.0, 'yaw': -15.0, 'roll': 12.0},
    ],
)
def test_head_pose_recovers_projected_rotation(angles):
    pose = estimate_head_pose(_project(**angles), 400, 400)
    assert pose is not None
    for key, value in angles.items():
        assert pose[key] == pytest.approx(value, abs=1.0)


def test_face_region_prefers_face_keypoints():
    region = MeshFaceFeatureExtractor.face_region(BOX, 1000, 1000, _skeleton())
    x1, y1, x2, y2 = region
    assert x1 < 500 < x2
    assert y1 < 145 < y2
    assert y2 < 300  # does not extend to the torso

    fallback = MeshFaceFeatureExtractor.face_region(BOX, 1000, 1000, None)
    assert fallback[1] == 100
    assert fallback[3] < 500  # upper part of a tall standing box


def test_face_region_skips_when_pose_shows_no_usable_face():
    facing_away = _skeleton()
    for index in range(3):
        facing_away[index] = Keypoint(facing_away[index].x, facing_away[index].y, 0.1)
    assert MeshFaceFeatureExtractor.face_region(BOX, 1000, 1000, facing_away) is None
    # Same skeleton in a tiny frame: face keypoints only a few pixels apart.
    assert MeshFaceFeatureExtractor.face_region(BOX, 200, 200, _skeleton()) is None


def test_iou_tracker_carries_keypoints():
    tracker = IoUPersonTracker(max_lost_frames=2)
    now = datetime.now(timezone.utc)
    skeleton = _skeleton()
    det = Detection('d0', BOX, 0.9, keypoints=skeleton)
    tracked = tracker.update([det], now)
    assert tracked[0].keypoints is skeleton
    assert tracker.known_track_ids() == [tracked[0].track_id]


def test_bytetrack_keeps_identity_across_motion():
    pytest.importorskip('supervision')
    from app.tracking.tracker import ByteTrackPersonTracker

    tracker = ByteTrackPersonTracker(max_lost_frames=3, frame_rate=5)
    now = datetime.now(timezone.utc)
    ids = set()
    for i in range(6):
        box = BoundingBox(0.30 + i * 0.01, 0.2, 0.2, 0.6)
        tracked = tracker.update(
            [Detection(f'd{i}', box, 0.9, keypoints=_skeleton())],
            now + timedelta(milliseconds=200 * i),
        )
        assert len(tracked) == 1
        assert tracked[0].keypoints is not None
        ids.add(tracked[0].track_id)
    assert ids == {'Person-1'}

    # Person leaves: retained while lost, then dropped.
    for i in range(5):
        assert tracker.update([], now + timedelta(seconds=2 + i)) == []
    assert tracker.known_track_ids() == []


def test_bytetrack_separates_two_people():
    pytest.importorskip('supervision')
    from app.tracking.tracker import ByteTrackPersonTracker

    tracker = ByteTrackPersonTracker(max_lost_frames=3, frame_rate=5)
    now = datetime.now(timezone.utc)
    tracked = []
    for i in range(3):
        tracked = tracker.update(
            [
                Detection('a', BoundingBox(0.10 + i * 0.01, 0.2, 0.2, 0.6), 0.9),
                Detection('b', BoundingBox(0.60 - i * 0.01, 0.2, 0.2, 0.6), 0.85),
            ],
            now + timedelta(milliseconds=200 * i),
        )
    assert sorted(t.track_id for t in tracked) == ['Person-1', 'Person-2']


def test_pose_geometry_is_aspect_corrected():
    # Shoulders directly above hips in pixels on a 16:9 frame, torso leaning 45° in pixels.
    from app.features.pose_features import PoseFeatureExtractor
    from app.tracking.models import BoundingBox, Keypoint

    def keypoints(shoulder_x):
        points = [Keypoint(0.5, 0.2, 0.0) for _ in range(17)]
        points[5] = Keypoint(shoulder_x - 0.02, 0.3, 0.9)
        points[6] = Keypoint(shoulder_x + 0.02, 0.3, 0.9)
        points[11] = Keypoint(0.48, 0.6, 0.9)
        points[12] = Keypoint(0.52, 0.6, 0.9)
        return points

    box = BoundingBox(0.3, 0.1, 0.4, 0.8)
    aspect = 16 / 9
    lean = 0.3 / aspect  # 0.3 frame heights to the right, in width-normalised units
    features = PoseFeatureExtractor(0.5).extract(box, keypoints(0.5 + lean), aspect=aspect)
    assert abs(features['torsoAngle'] - 45.0) < 0.5
    upright = PoseFeatureExtractor(0.5).extract(box, keypoints(0.5), aspect=aspect)
    assert abs(upright['torsoAngle']) < 0.5

