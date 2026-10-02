from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import numpy as np

from app.config import settings
from app.features.head_pose import get_head_pose_provider
from app.tracking.models import BoundingBox, Keypoint

logger = logging.getLogger('rmo-ai-service')


def get_face_extractor(provider: Optional[str] = None):
    name = (provider or settings.ai_face_provider or 'haar').strip().lower()
    if name == 'mediapipe':
        try:
            from app.features.face_mesh import MeshFaceFeatureExtractor

            return MeshFaceFeatureExtractor()
        except Exception as error:  # noqa: BLE001 — missing mediapipe falls back to Haar
            logger.warning('AI_FACE_MESH_UNAVAILABLE fallback=haar reason=%s', error)
    return FaceFeatureExtractor()


class FaceFeatureExtractor:
    """
    Lightweight OpenCV Haar face + eye probe inside a person box.

    Does NOT call AWS Rekognition. Unreliable values are returned as null.
    Eye openness and head pose are local heuristics / pluggable providers —
    not medical-grade measurements. MediaPipe mesh is preferred when available.
    """

    provider_name = 'haar'

    def close(self) -> None:
        return None

    def __init__(self) -> None:
        import cv2

        self._cv2 = cv2
        cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        eye_path = cv2.data.haarcascades + 'haarcascade_eye.xml'
        self._face = cv2.CascadeClassifier(cascade_path)
        self._eyes = cv2.CascadeClassifier(eye_path)
        self._head_pose = get_head_pose_provider()

    def extract(
        self,
        frame_bgr: np.ndarray,
        person_box: BoundingBox,
        keypoints: Optional[List[Keypoint]] = None,
    ) -> Dict[str, Any]:
        void = keypoints
        del void
        height, width = frame_bgr.shape[:2]
        x1 = int(person_box.x * width)
        y1 = int(person_box.y * height)
        x2 = int((person_box.x + person_box.width) * width)
        y2 = int((person_box.y + person_box.height) * height)
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(width, x2), min(height, y2)
        if x2 - x1 < 16 or y2 - y1 < 16:
            return self._empty(visible=False, person_box=person_box)

        roi = frame_bgr[y1:y2, x1:x2]
        gray = self._cv2.cvtColor(roi, self._cv2.COLOR_BGR2GRAY)
        faces = self._face.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(24, 24))
        if len(faces) == 0:
            return self._empty(visible=False, person_box=person_box)

        fx, fy, fw, fh = max(faces, key=lambda item: item[2] * item[3])
        face_box = BoundingBox(
            x=(x1 + fx) / width,
            y=(y1 + fy) / height,
            width=fw / width,
            height=fh / height,
        ).clamp()
        # Quality proxy: face area relative to person box and sharpness of ROI.
        area_ratio = (fw * fh) / max((x2 - x1) * (y2 - y1), 1)
        face_gray = gray[fy:fy + fh, fx:fx + fw]
        lap = float(self._cv2.Laplacian(face_gray, self._cv2.CV_64F).var())
        sharpness = max(0.0, min(1.0, lap / 200.0))
        quality = round(max(0.0, min(1.0, 0.4 * area_ratio * 4 + 0.6 * sharpness)), 3)

        eyes = self._estimate_eyes(face_gray)
        head_pose = self._head_pose.estimate(
            person_box,
            face_box.to_dict(),
            face_visible=True,
        )

        signals = ['faceVisible', 'faceQuality', 'faceBoundingBox']
        if eyes.get('available'):
            signals.append('eyeOpenness')
        if head_pose.get('available'):
            signals.append('headPosePitch')

        return {
            'visible': True,
            'quality': quality,
            'boundingBox': face_box.to_dict(),
            'headPose': {
                'pitch': head_pose.get('pitch'),
                'yaw': head_pose.get('yaw'),
                'roll': head_pose.get('roll'),
                'available': bool(head_pose.get('available')),
                'provider': head_pose.get('provider'),
                'status': head_pose.get('status'),
                'note': head_pose.get('note'),
            },
            'eyes': eyes,
            'mouth': {
                'available': False,
                'openProbability': None,
            },
            'landmarkAvailability': False,
            'signalsAvailable': signals,
        }

    def _estimate_eyes(self, face_gray: np.ndarray) -> Dict[str, Any]:
        # Deterministic override for tests / local fixtures.
        if settings.mock_eye_open_probability is not None:
            prob = max(0.0, min(1.0, float(settings.mock_eye_open_probability)))
            return {
                'available': True,
                'openProbability': prob,
                'detectedCount': None,
                'provider': 'mock',
                'note': 'Mock eye openness from MOCK_EYE_OPEN_PROBABILITY.',
            }

        height, width = face_gray.shape[:2]
        if height < 20 or width < 20:
            return {'available': False, 'openProbability': None, 'detectedCount': 0, 'provider': 'haar'}

        # Eyes typically occupy the upper half of the face ROI.
        upper = face_gray[0:max(8, int(height * 0.55)), :]
        eyes = self._eyes.detectMultiScale(
            upper,
            scaleFactor=1.1,
            minNeighbors=3,
            minSize=(max(8, width // 10), max(8, height // 12)),
        )
        count = int(len(eyes))
        if count >= 2:
            open_probability = 0.92
        elif count == 1:
            open_probability = 0.55
        else:
            # Face found but no eyes — treat as likely closed / low openness.
            open_probability = 0.12

        return {
            'available': True,
            'openProbability': open_probability,
            'detectedCount': count,
            'provider': 'haar',
            'note': (
                'Local Haar eye probe. Not a clinical eye-closure measurement. '
                'Temporal safety engine requires sustained closure before alerting.'
            ),
        }

    def _empty(self, visible: bool, person_box: Optional[BoundingBox] = None) -> Dict[str, Any]:
        head_pose = {
            'pitch': None,
            'yaw': None,
            'roll': None,
            'available': False,
            'provider': self._head_pose.name,
            'status': 'ANALYSIS_UNAVAILABLE',
            'note': 'Face not visible.',
        }
        if person_box is not None and settings.mock_eye_open_probability is not None:
            # Allow mock eye injection even without a Haar face (tests).
            eyes = {
                'available': True,
                'openProbability': max(0.0, min(1.0, float(settings.mock_eye_open_probability))),
                'detectedCount': None,
                'provider': 'mock',
                'note': 'Mock eye openness from MOCK_EYE_OPEN_PROBABILITY.',
            }
            synthetic_box = {
                'x': person_box.x + person_box.width * 0.25,
                'y': person_box.y + person_box.height * 0.08,
                'width': person_box.width * 0.5,
                'height': person_box.height * 0.28,
            }
            return {
                'visible': True,
                'quality': 0.8,
                'boundingBox': synthetic_box,
                'headPose': self._head_pose.estimate(person_box, synthetic_box, face_visible=True),
                'eyes': eyes,
                'mouth': {'available': False, 'openProbability': None},
                'landmarkAvailability': False,
                'signalsAvailable': ['faceVisible', 'eyeOpenness'],
            }

        return {
            'visible': visible,
            'quality': None,
            'boundingBox': None,
            'headPose': head_pose,
            'eyes': {'available': False, 'openProbability': None, 'detectedCount': 0, 'provider': 'haar'},
            'mouth': {'available': False, 'openProbability': None},
            'landmarkAvailability': False,
            'signalsAvailable': ['faceVisible'],
        }
