from __future__ import annotations

import numpy as np

from app.features.quality import QualityEngine
from app.tracking.models import BoundingBox


def test_quality_score_bounds():
    frame = np.full((160, 160, 3), 120, dtype=np.uint8)
    # Add some texture for sharpness.
    frame[40:80, 40:80] = 200
    quality = QualityEngine().assess(
        frame,
        BoundingBox(0.2, 0.2, 0.3, 0.5),
        face_visible=True,
        body_visible=True,
        lower_body_visible=False,
        face_quality=0.7,
    )
    assert 0.0 <= quality['score'] <= 1.0
    assert quality['faceVisible'] is True
    assert quality['lowerBodyVisible'] is False


def test_poor_dark_frame_lowers_score():
    dark = np.zeros((160, 160, 3), dtype=np.uint8)
    bright = np.full((160, 160, 3), 200, dtype=np.uint8)
    bright[20:100, 20:100] = 40
    box = BoundingBox(0.2, 0.2, 0.4, 0.5)
    q_dark = QualityEngine().assess(dark, box, True, True, False, 0.5)
    q_bright = QualityEngine().assess(bright, box, True, True, False, 0.5)
    assert q_dark['score'] <= q_bright['score']
