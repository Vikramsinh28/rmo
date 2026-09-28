from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

import numpy as np

from app.tracking.models import BoundingBox


class QualityEngine:
    """Frame / person quality signals. Poor quality must suppress downstream confidence."""

    @staticmethod
    def frame_stats(frame_bgr: np.ndarray) -> Tuple[float, float]:
        """Whole-frame (brightness, normalized sharpness); compute once per frame."""
        import cv2

        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        brightness = float(np.mean(gray) / 255.0)
        sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        return brightness, max(0.0, min(1.0, sharpness / 250.0))

    def assess(
        self,
        frame_bgr: np.ndarray,
        person_box: BoundingBox,
        face_visible: bool,
        body_visible: bool,
        lower_body_visible: bool,
        face_quality: float | None,
        frame_stats: Optional[Tuple[float, float]] = None,
    ) -> Dict[str, Any]:
        brightness, sharpness_n = frame_stats or self.frame_stats(frame_bgr)
        box_area = person_box.width * person_box.height
        size_score = max(0.0, min(1.0, box_area / 0.15))
        occlusion = 0.0
        if person_box.x <= 0.01 or person_box.y <= 0.01:
            occlusion += 0.2
        if person_box.x + person_box.width >= 0.99 or person_box.y + person_box.height >= 0.99:
            occlusion += 0.2

        face_component = face_quality if face_visible and face_quality is not None else (0.35 if face_visible else 0.15)
        quality = (
            0.25 * brightness
            + 0.30 * sharpness_n
            + 0.25 * size_score
            + 0.20 * float(face_component)
        )
        quality *= max(0.4, 1.0 - occlusion)

        return {
            'score': round(max(0.0, min(1.0, quality)), 3),
            'brightness': round(brightness, 3),
            'sharpness': round(sharpness_n, 3),
            'faceVisible': face_visible,
            'bodyVisible': body_visible,
            'lowerBodyVisible': lower_body_visible,
            'occlusionEstimate': round(occlusion, 3),
            'boundingBoxSize': round(box_area, 4),
            'signalsAvailable': [
                'qualityScore',
                'brightness',
                'sharpness',
                'faceVisible',
                'bodyVisible',
                'lowerBodyVisible',
            ],
        }
