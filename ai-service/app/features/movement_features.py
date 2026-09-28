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
        if not lower_body_visible or not gait_available:
            result['gaitAvailable'] = False
            result['stepTiming'] = None
            result['strideConsistency'] = None
            result['leftRightSymmetry'] = None
            result['note'] = 'Gait features disabled — lower body keypoints unavailable.'
        return result
