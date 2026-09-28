from __future__ import annotations

from typing import Any, Dict

from app.tracking.models import BoundingBox


class PoseFeatureExtractor:
    """
    Body/pose feature interface without inventing keypoints.

    A full pose model is not bundled. We only derive visibility heuristics from
    the person bounding box. Keypoints remain null. Gait is disabled unless
    lower body visibility heuristics pass (still no gait metrics without pose).
    """

    def extract(self, person_box: BoundingBox) -> Dict[str, Any]:
        # Heuristic: tall boxes that extend toward the bottom of the frame may
        # include lower body. This is visibility only — not pose estimation.
        body_visible = person_box.height >= 0.25 and person_box.width >= 0.08
        lower_body_visible = (
            body_visible
            and (person_box.y + person_box.height) >= 0.85
            and person_box.height >= 0.45
        )
        gait_available = False  # lower-body visibility alone is insufficient without keypoints

        keypoints = {
            'shoulders': None,
            'elbows': None,
            'wrists': None,
            'hips': None,
            'knees': None,
            'ankles': None,
        }

        return {
            'visible': body_visible,
            'lowerBodyVisible': lower_body_visible,
            'gaitAvailable': gait_available,
            'keypoints': keypoints,
            'torsoAngle': None,
            'shoulderAlignment': None,
            'bodyVisibility': round(min(1.0, person_box.height / 0.7), 3) if body_visible else 0.0,
            'movementMagnitude': None,
            'movementSmoothness': None,
            'signalsAvailable': [
                'bodyVisible',
                'lowerBodyVisible',
                'gaitAvailable',
                'bodyVisibility',
            ],
            'note': (
                'Pose keypoints are unavailable without a local pose model. '
                'Gait is disabled when lower body keypoints are unavailable.'
            ),
        }
