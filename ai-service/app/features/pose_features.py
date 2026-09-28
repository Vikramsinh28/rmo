from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

from app.config import settings
from app.tracking.models import BoundingBox, Keypoint

# COCO-17 keypoint indices (YOLO pose / most pose models).
NOSE = 0
LEFT_SHOULDER, RIGHT_SHOULDER = 5, 6
LEFT_ELBOW, RIGHT_ELBOW = 7, 8
LEFT_WRIST, RIGHT_WRIST = 9, 10
LEFT_HIP, RIGHT_HIP = 11, 12
LEFT_KNEE, RIGHT_KNEE = 13, 14
LEFT_ANKLE, RIGHT_ANKLE = 15, 16

_GROUPS: Dict[str, Tuple[int, int]] = {
    'shoulders': (LEFT_SHOULDER, RIGHT_SHOULDER),
    'elbows': (LEFT_ELBOW, RIGHT_ELBOW),
    'wrists': (LEFT_WRIST, RIGHT_WRIST),
    'hips': (LEFT_HIP, RIGHT_HIP),
    'knees': (LEFT_KNEE, RIGHT_KNEE),
    'ankles': (LEFT_ANKLE, RIGHT_ANKLE),
}

Point = Tuple[float, float]


def _midpoint(a: Optional[Point], b: Optional[Point]) -> Optional[Point]:
    if a is None or b is None:
        return None
    return ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)


class PoseFeatureExtractor:
    """
    Per-frame body features from COCO-17 keypoints.

    Geometry (angles, hipCenter, ankles, bodyHeight) uses isotropic units: x is scaled by
    the frame aspect ratio so both axes are fractions of frame height.

    Without keypoints (HOG / mock detectors) only bounding-box visibility heuristics
    are returned and every keypoint-derived value stays null. Gait is only marked
    available when hips and both ankles are confidently visible.
    """

    def __init__(self, min_keypoint_confidence: Optional[float] = None) -> None:
        self.min_confidence = (
            min_keypoint_confidence
            if min_keypoint_confidence is not None
            else settings.ai_keypoint_min_confidence
        )

    def extract(
        self,
        person_box: BoundingBox,
        keypoints: Optional[List[Keypoint]] = None,
        aspect: float = 1.0,
    ) -> Dict[str, Any]:
        if not keypoints or len(keypoints) < 17:
            return self._from_box(person_box)
        return self._from_keypoints(person_box, keypoints, aspect)

    def _point(self, keypoints: List[Keypoint], index: int, aspect: float) -> Optional[Point]:
        kp = keypoints[index]
        if kp.confidence < self.min_confidence:
            return None
        return (kp.x * aspect, kp.y)

    def _from_keypoints(
        self,
        person_box: BoundingBox,
        keypoints: List[Keypoint],
        aspect: float = 1.0,
    ) -> Dict[str, Any]:
        points = {i: self._point(keypoints, i, aspect) for i in range(17)}
        confident = sum(1 for p in points.values() if p is not None)

        shoulder_mid = _midpoint(points[LEFT_SHOULDER], points[RIGHT_SHOULDER])
        hip_mid = _midpoint(points[LEFT_HIP], points[RIGHT_HIP])
        knee_visible = points[LEFT_KNEE] is not None or points[RIGHT_KNEE] is not None
        ankle_visible = points[LEFT_ANKLE] is not None or points[RIGHT_ANKLE] is not None
        both_ankles = points[LEFT_ANKLE] is not None and points[RIGHT_ANKLE] is not None

        torso_angle: Optional[float] = None
        torso_length: Optional[float] = None
        if shoulder_mid and hip_mid:
            dx = shoulder_mid[0] - hip_mid[0]
            dy = hip_mid[1] - shoulder_mid[1]  # image y grows downward
            torso_length = math.hypot(dx, dy)
            if torso_length > 1e-4:
                # Signed lean from vertical, degrees. Positive = leaning toward image right.
                torso_angle = math.degrees(math.atan2(dx, dy))

        shoulder_alignment: Optional[float] = None
        shoulder_width: Optional[float] = None
        if points[LEFT_SHOULDER] and points[RIGHT_SHOULDER]:
            ls, rs = points[LEFT_SHOULDER], points[RIGHT_SHOULDER]
            dx = ls[0] - rs[0]
            dy = ls[1] - rs[1]
            shoulder_width = math.hypot(dx, dy)
            if abs(dx) > 1e-4:
                # Tilt of the shoulder line from horizontal, degrees.
                shoulder_alignment = math.degrees(math.atan2(dy, abs(dx)))

        ankle_mid = _midpoint(points[LEFT_ANKLE], points[RIGHT_ANKLE])
        body_height: Optional[float] = None
        if shoulder_mid and ankle_mid:
            body_height = math.hypot(ankle_mid[0] - shoulder_mid[0], ankle_mid[1] - shoulder_mid[1])
        elif torso_length:
            body_height = torso_length * 2.6  # typical shoulder-to-ankle / torso ratio

        body_visible = shoulder_mid is not None or hip_mid is not None
        lower_body_visible = hip_mid is not None and knee_visible and ankle_visible
        gait_available = hip_mid is not None and both_ankles

        grouped = {
            name: {
                'left': keypoints[left].to_dict() if points[left] else None,
                'right': keypoints[right].to_dict() if points[right] else None,
            }
            for name, (left, right) in _GROUPS.items()
        }

        signals = ['bodyVisible', 'lowerBodyVisible', 'gaitAvailable', 'bodyVisibility', 'keypoints']
        if torso_angle is not None:
            signals.append('torsoAngle')
        if shoulder_alignment is not None:
            signals.append('shoulderAlignment')
        if hip_mid is not None:
            signals.append('hipCenter')

        return {
            'visible': body_visible,
            'lowerBodyVisible': lower_body_visible,
            'gaitAvailable': gait_available,
            'keypoints': grouped,
            'keypointCoverage': round(confident / 17.0, 3),
            'torsoAngle': round(torso_angle, 2) if torso_angle is not None else None,
            'shoulderAlignment': (
                round(shoulder_alignment, 2) if shoulder_alignment is not None else None
            ),
            'hipCenter': (
                {'x': round(hip_mid[0], 4), 'y': round(hip_mid[1], 4)} if hip_mid else None
            ),
            'shoulderCenter': (
                {'x': round(shoulder_mid[0], 4), 'y': round(shoulder_mid[1], 4)}
                if shoulder_mid else None
            ),
            'shoulderWidth': round(shoulder_width, 4) if shoulder_width else None,
            'ankles': {
                'left': (
                    {'x': round(points[LEFT_ANKLE][0], 4), 'y': round(points[LEFT_ANKLE][1], 4)}
                    if points[LEFT_ANKLE] else None
                ),
                'right': (
                    {'x': round(points[RIGHT_ANKLE][0], 4), 'y': round(points[RIGHT_ANKLE][1], 4)}
                    if points[RIGHT_ANKLE] else None
                ),
            },
            'bodyHeight': round(body_height, 4) if body_height else None,
            'bodyVisibility': round(confident / 17.0, 3),
            'movementMagnitude': None,
            'movementSmoothness': None,
            'source': 'keypoints',
            'signalsAvailable': signals,
        }

    def _from_box(self, person_box: BoundingBox) -> Dict[str, Any]:
        # Heuristic: tall boxes that extend toward the bottom of the frame may
        # include lower body. This is visibility only — not pose estimation.
        body_visible = person_box.height >= 0.25 and person_box.width >= 0.08
        lower_body_visible = (
            body_visible
            and (person_box.y + person_box.height) >= 0.85
            and person_box.height >= 0.45
        )
        return {
            'visible': body_visible,
            'lowerBodyVisible': lower_body_visible,
            'gaitAvailable': False,  # lower-body visibility alone is insufficient without keypoints
            'keypoints': {name: None for name in _GROUPS},
            'keypointCoverage': 0.0,
            'torsoAngle': None,
            'shoulderAlignment': None,
            'hipCenter': None,
            'shoulderCenter': None,
            'shoulderWidth': None,
            'ankles': {'left': None, 'right': None},
            'bodyHeight': None,
            'bodyVisibility': round(min(1.0, person_box.height / 0.7), 3) if body_visible else 0.0,
            'movementMagnitude': None,
            'movementSmoothness': None,
            'source': 'boundingBox',
            'signalsAvailable': [
                'bodyVisible',
                'lowerBodyVisible',
                'gaitAvailable',
                'bodyVisibility',
            ],
            'note': (
                'Pose keypoints are unavailable without a pose model. '
                'Gait is disabled when lower body keypoints are unavailable.'
            ),
        }
