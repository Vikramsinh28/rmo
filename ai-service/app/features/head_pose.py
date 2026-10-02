from __future__ import annotations

from typing import Any, Dict, Optional, Protocol

from app.config import settings
from app.tracking.models import BoundingBox


class HeadPoseProvider(Protocol):
    name: str

    def estimate(
        self,
        person_box: BoundingBox,
        face_box: Optional[Dict[str, float]],
        face_visible: bool,
    ) -> Dict[str, Any]:
        ...


class UnavailableHeadPoseProvider:
    """Honest unavailable provider — does not invent angles."""

    name = 'unavailable'

    def estimate(
        self,
        person_box: BoundingBox,
        face_box: Optional[Dict[str, float]],
        face_visible: bool,
    ) -> Dict[str, Any]:
        void = person_box, face_box, face_visible
        del void
        return {
            'available': False,
            'provider': self.name,
            'pitch': None,
            'yaw': None,
            'roll': None,
            'status': 'ANALYSIS_UNAVAILABLE',
            'note': 'Head-pose estimation is not available for this configuration.',
        }


class MockHeadPoseProvider:
    """Deterministic provider for tests via MOCK_HEAD_PITCH_DEG."""

    name = 'mock'

    def estimate(
        self,
        person_box: BoundingBox,
        face_box: Optional[Dict[str, float]],
        face_visible: bool,
    ) -> Dict[str, Any]:
        void = person_box, face_box
        del void
        if not face_visible:
            return UnavailableHeadPoseProvider().estimate(person_box, face_box, False)
        raw = settings.mock_head_pitch_deg
        if raw is None:
            return {
                'available': True,
                'provider': self.name,
                'pitch': 0.0,
                'yaw': 0.0,
                'roll': 0.0,
                'status': 'OK',
                'note': 'Mock head pose (neutral).',
            }
        pitch = float(raw)
        return {
            'available': True,
            'provider': self.name,
            'pitch': pitch,
            'yaw': 0.0,
            'roll': 0.0,
            'status': 'OK',
            'note': 'Mock head pose from MOCK_HEAD_PITCH_DEG.',
        }


class HeuristicFacePositionHeadPoseProvider:
    """
    Approximate pitch from face vertical position inside the person box.

    This is NOT a 3D head-pose model. It is a local heuristic suitable for
    detecting prolonged head-down posture in webcam monitoring.
    """

    name = 'heuristic_face_position'

    def estimate(
        self,
        person_box: BoundingBox,
        face_box: Optional[Dict[str, float]],
        face_visible: bool,
    ) -> Dict[str, Any]:
        if not face_visible or not face_box:
            return UnavailableHeadPoseProvider().estimate(person_box, face_box, False)

        face_cy = float(face_box['y']) + float(face_box['height']) / 2.0
        relative_y = (face_cy - person_box.y) / max(person_box.height, 1e-6)
        # Typical upright face center ~0.18–0.28 of person height from top.
        # Head-down pushes the face lower in the person box.
        pitch = (relative_y - 0.22) * 140.0
        pitch = max(-45.0, min(70.0, pitch))
        return {
            'available': True,
            'provider': self.name,
            'pitch': round(pitch, 2),
            'yaw': None,
            'roll': None,
            'status': 'OK',
            'note': (
                'Heuristic pitch from face position within person box. '
                'Not a calibrated 3D head-pose estimate.'
            ),
        }


def get_head_pose_provider() -> HeadPoseProvider:
    value = (settings.head_pose_provider or 'heuristic').strip().lower()
    if value in {'unavailable', 'none', 'off'}:
        return UnavailableHeadPoseProvider()
    if value == 'mock':
        return MockHeadPoseProvider()
    return HeuristicFacePositionHeadPoseProvider()
