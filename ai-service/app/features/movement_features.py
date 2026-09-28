from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

from app.tracking.models import FeatureSnapshot, BoundingBox


class MovementFeatureExtractor:
    """Derive movement metrics from rolling bbox history — not impairment labels."""

    def extract(
        self,
        history: List[FeatureSnapshot],
        current_box: BoundingBox,
        lower_body_visible: bool,
        gait_available: bool,
        current_pose: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        result = self._from_boxes(history, current_box, lower_body_visible, gait_available)
        sway = self._hip_sway(history, current_pose)
        if sway is not None:
            result['lateralSway'] = sway
            result['signalsAvailable'] = [*result.get('signalsAvailable', []), 'lateralSway']
        else:
            result['lateralSway'] = None
        return result

    @staticmethod
    def _hip_sway(
        history: List[FeatureSnapshot],
        current_pose: Optional[Dict[str, Any]],
    ) -> Optional[float]:
        """Std-dev of hip-center x over recent frames, in units of body height."""
        poses = [snap.body for snap in history[-30:]]
        if current_pose:
            poses.append(current_pose)
        samples = [
            (pose['hipCenter']['x'], pose['bodyHeight'])
            for pose in poses
            if pose and pose.get('hipCenter') and pose.get('bodyHeight')
        ]
        if len(samples) < 5:
            return None
        xs = [x for x, _ in samples]
        scale = sum(h for _, h in samples) / len(samples)
        if scale <= 1e-4:
            return None
        mean_x = sum(xs) / len(xs)
        std_x = math.sqrt(sum((x - mean_x) ** 2 for x in xs) / len(xs))
        return round(std_x / scale, 4)

    def _from_boxes(
        self,
        history: List[FeatureSnapshot],
        current_box: BoundingBox,
        lower_body_visible: bool,
        gait_available: bool,
    ) -> Dict[str, Any]:
        centers = [snap.bounding_box.center() for snap in history[-30:]]
        centers.append(current_box.center())
        if len(centers) < 2:
            return {
                'postureStability': None,
                'lateralMovement': None,
                'movementSmoothness': None,
                'balanceCorrections': None,
                'handArmMovement': None,
                'stepTiming': None,
                'strideConsistency': None,
                'leftRightSymmetry': None,
                'pathStability': None,
                'gaitAvailable': False,
                'signalsAvailable': [],
            }

        dx = [centers[i][0] - centers[i - 1][0] for i in range(1, len(centers))]
        dy = [centers[i][1] - centers[i - 1][1] for i in range(1, len(centers))]
        distances = [math.hypot(a, b) for a, b in zip(dx, dy)]
        lateral = sum(abs(v) for v in dx) / len(dx)
        magnitude = sum(distances) / len(distances)
        # Smoothness: inverse of jitter (std of step lengths).
        mean_d = magnitude
        variance = sum((d - mean_d) ** 2 for d in distances) / len(distances)
        smoothness = 1.0 / (1.0 + math.sqrt(variance) * 20.0)
        stability = 1.0 / (1.0 + magnitude * 25.0)

        result: Dict[str, Any] = {
            'postureStability': round(stability, 4),
            'lateralMovement': round(lateral, 4),
            'movementSmoothness': round(smoothness, 4),
            'balanceCorrections': None,
            'handArmMovement': None,
            'stepTiming': None,
            'strideConsistency': None,
            'leftRightSymmetry': None,
            'pathStability': round(stability, 4),
            'gaitAvailable': False,
            'signalsAvailable': [
                'postureStability',
                'lateralMovement',
                'movementSmoothness',
                'pathStability',
            ],
        }

        # PDF: do not use gait when lower body unavailable / keypoints missing.
        result['gaitAvailable'] = bool(lower_body_visible and gait_available)
        if not result['gaitAvailable']:
            result['gaitAvailable'] = False
            result['stepTiming'] = None
            result['strideConsistency'] = None
            result['leftRightSymmetry'] = None
            result['note'] = 'Gait features disabled — lower body keypoints unavailable.'
        return result
