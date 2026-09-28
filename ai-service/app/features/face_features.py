from __future__ import annotations

from typing import Any, Dict, Optional

import numpy as np

from app.tracking.models import BoundingBox


class FaceFeatureExtractor:
    """
    Lightweight OpenCV Haar face probe inside a person box.

    Does NOT call AWS Rekognition. Unreliable values are returned as null.
    """

    def __init__(self) -> None:
        import cv2

        self._cv2 = cv2
        cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        self._face = cv2.CascadeClassifier(cascade_path)

    def extract(self, frame_bgr: np.ndarray, person_box: BoundingBox) -> Dict[str, Any]:
        height, width = frame_bgr.shape[:2]
        x1 = int(person_box.x * width)
        y1 = int(person_box.y * height)
        x2 = int((person_box.x + person_box.width) * width)
        y2 = int((person_box.y + person_box.height) * height)
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(width, x2), min(height, y2)
        if x2 - x1 < 16 or y2 - y1 < 16:
            return self._empty(visible=False)

        roi = frame_bgr[y1:y2, x1:x2]
        gray = self._cv2.cvtColor(roi, self._cv2.COLOR_BGR2GRAY)
        faces = self._face.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(24, 24))
        if len(faces) == 0:
            return self._empty(visible=False)

        fx, fy, fw, fh = max(faces, key=lambda item: item[2] * item[3])
        face_box = BoundingBox(
            x=(x1 + fx) / width,
            y=(y1 + fy) / height,
            width=fw / width,
            height=fh / height,
        ).clamp()
        # Quality proxy: face area relative to person box and sharpness of ROI.
        area_ratio = (fw * fh) / max((x2 - x1) * (y2 - y1), 1)
        lap = float(self._cv2.Laplacian(gray[fy:fy + fh, fx:fx + fw], self._cv2.CV_64F).var())
        sharpness = max(0.0, min(1.0, lap / 200.0))
        quality = round(max(0.0, min(1.0, 0.4 * area_ratio * 4 + 0.6 * sharpness)), 3)

        return {
            'visible': True,
            'quality': quality,
            'boundingBox': face_box.to_dict(),
            'headPose': {
                'pitch': None,
                'yaw': None,
                'roll': None,
            },
            'eyes': {
                'available': False,
                'openProbability': None,
            },
            'mouth': {
                'available': False,
                'openProbability': None,
            },
            'landmarkAvailability': False,
            'signalsAvailable': ['faceVisible', 'faceQuality', 'faceBoundingBox'],
        }

    def _empty(self, visible: bool) -> Dict[str, Any]:
        return {
            'visible': visible,
            'quality': None,
            'boundingBox': None,
            'headPose': {'pitch': None, 'yaw': None, 'roll': None},
            'eyes': {'available': False, 'openProbability': None},
            'mouth': {'available': False, 'openProbability': None},
            'landmarkAvailability': False,
            'signalsAvailable': ['faceVisible'],
        }
