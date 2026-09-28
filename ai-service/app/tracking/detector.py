from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import List

import numpy as np

from app.tracking.models import BoundingBox, Detection

logger = logging.getLogger('rmo-ai-service')


class PersonDetector(ABC):
    provider_name: str = 'unknown'

    @abstractmethod
    def detect(self, frame_bgr: np.ndarray) -> List[Detection]:
        raise NotImplementedError


class HogPersonDetector(PersonDetector):
    """OpenCV HOG default people detector — CPU-friendly local development."""

    provider_name = 'hog'

    def __init__(self) -> None:
        import cv2

        self._cv2 = cv2
        self._hog = cv2.HOGDescriptor()
        self._hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

    def detect(self, frame_bgr: np.ndarray) -> List[Detection]:
        height, width = frame_bgr.shape[:2]
        if width < 32 or height < 32:
            return []
        # Downscale large frames for latency.
        scale = 1.0
        work = frame_bgr
        if max(width, height) > 640:
            scale = 640.0 / max(width, height)
            work = self._cv2.resize(frame_bgr, (int(width * scale), int(height * scale)))
        rects, weights = self._hog.detectMultiScale(
            work,
            winStride=(8, 8),
            padding=(8, 8),
            scale=1.05,
        )
        detections: List[Detection] = []
        for index, (x, y, w, h) in enumerate(rects):
            conf = float(weights[index]) if index < len(weights) else 0.5
            # HOG weight is not probability; normalize softly.
            conf = max(0.05, min(0.99, (conf + 1.5) / 3.5))
            box = BoundingBox(
                x=(x / scale) / width,
                y=(y / scale) / height,
                width=(w / scale) / width,
                height=(h / scale) / height,
            ).clamp()
            if box.width < 0.02 or box.height < 0.04:
                continue
            detections.append(
                Detection(
                    tracking_candidate_id=f'cand-{index}',
                    bounding_box=box,
                    confidence=round(conf, 4),
                    class_name='person',
                ),
            )
        return detections[:10]


class MockPersonDetector(PersonDetector):
    """
    Deterministic detector for tests.

    Looks for latin1 markers POC_PERSON:x,y,w,h| (normalized floats)
    or returns a center box when POC_PERSON:center| is present.
    """

    provider_name = 'mock'

    def __init__(self) -> None:
        self._raw_hint: bytes = b''

    def set_raw_hint(self, raw: bytes | None) -> None:
        self._raw_hint = raw or b''

    def detect(self, frame_bgr: np.ndarray) -> List[Detection]:
        text = self._raw_hint.decode('latin1', errors='ignore')
        if not text:
            try:
                text = frame_bgr.tobytes()[:8000].decode('latin1', errors='ignore')
            except Exception:
                text = ''
        if 'POC_PERSON:none|' in text:
            return []
        detections: List[Detection] = []
        import re

        for match in re.finditer(
            r'POC_PERSON:([0-9.]+),([0-9.]+),([0-9.]+),([0-9.]+)\|',
            text,
        ):
            box = BoundingBox(
                x=float(match.group(1)),
                y=float(match.group(2)),
                width=float(match.group(3)),
                height=float(match.group(4)),
            ).clamp()
            detections.append(
                Detection(
                    tracking_candidate_id=f'mock-{len(detections)}',
                    bounding_box=box,
                    confidence=0.9,
                    class_name='person',
                ),
            )
        if detections:
            return detections
        if 'POC_PERSON:center|' in text or 'POC_PERSON:one|' in text:
            return [
                Detection(
                    tracking_candidate_id='mock-0',
                    bounding_box=BoundingBox(x=0.35, y=0.2, width=0.3, height=0.55),
                    confidence=0.92,
                    class_name='person',
                ),
            ]
        if 'POC_PERSON:two|' in text:
            return [
                Detection(
                    tracking_candidate_id='mock-0',
                    bounding_box=BoundingBox(x=0.15, y=0.2, width=0.25, height=0.55),
                    confidence=0.9,
                    class_name='person',
                ),
                Detection(
                    tracking_candidate_id='mock-1',
                    bounding_box=BoundingBox(x=0.55, y=0.22, width=0.25, height=0.52),
                    confidence=0.88,
                    class_name='person',
                ),
            ]
        return []


def get_person_detector(provider: str | None = None) -> PersonDetector:
    from app.config import settings

    name = (provider or settings.ai_tracking_provider or 'hog').strip().lower()
    if name == 'mock':
        return MockPersonDetector()
    if name in {'yolo', 'yolo-pose'}:
        try:
            from app.tracking.yolo_detector import YoloPosePersonDetector

            return YoloPosePersonDetector()
        except Exception as error:  # noqa: BLE001 — missing deps / weights fall back to HOG
            logger.warning('AI_POSE_MODEL_UNAVAILABLE fallback=hog reason=%s', error)
    return HogPersonDetector()
