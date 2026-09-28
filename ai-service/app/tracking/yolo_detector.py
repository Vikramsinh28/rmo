from __future__ import annotations

import logging
import os
import threading
from typing import Any, Dict, List, Optional

import numpy as np

from app.config import settings
from app.tracking.detector import PersonDetector
from app.tracking.models import BoundingBox, Detection, Keypoint

logger = logging.getLogger('rmo-ai-service')

# Model weights are shared across sessions; inference is serialized because
# ultralytics predictors are not guaranteed to be thread-safe.
_models: Dict[str, Any] = {}
_load_lock = threading.Lock()
_infer_lock = threading.Lock()


def _load_model(name: str) -> Any:
    with _load_lock:
        model = _models.get(name)
        if model is None:
            import torch
            from ultralytics import YOLO

            model = YOLO(name)
            # Warm up once: the first predict is slow and ultralytics resets
            # torch's thread count during it, so apply our setting afterwards.
            model.predict(
                np.zeros((settings.ai_pose_image_size, settings.ai_pose_image_size, 3), np.uint8),
                imgsz=settings.ai_pose_image_size,
                device=settings.ai_pose_device,
                verbose=False,
            )
            threads = settings.ai_pose_threads or min(4, os.cpu_count() or 1)
            torch.set_num_threads(threads)
            _models[name] = model
            logger.info('AI_POSE_MODEL_LOADED model=%s threads=%s', name, threads)
        return model


class YoloPosePersonDetector(PersonDetector):
    """
    YOLO pose model: person boxes plus COCO-17 keypoints in a single pass.

    Keypoints are normalized to the full frame and attached to each detection.
    """

    provider_name = 'yolo-pose'

    def __init__(
        self,
        model_name: Optional[str] = None,
        device: Optional[str] = None,
        image_size: Optional[int] = None,
        min_confidence: Optional[float] = None,
        max_detections: int = 10,
    ) -> None:
        self.model_name = model_name or settings.ai_pose_model
        self.device = device or settings.ai_pose_device
        self.image_size = image_size or settings.ai_pose_image_size
        self.min_confidence = (
            min_confidence if min_confidence is not None else settings.ai_pose_min_confidence
        )
        self.max_detections = max_detections
        self._model = _load_model(self.model_name)

    def detect(self, frame_bgr: np.ndarray) -> List[Detection]:
        height, width = frame_bgr.shape[:2]
        if width < 32 or height < 32:
            return []
        with _infer_lock:
            results = self._model.predict(
                frame_bgr,
                imgsz=self.image_size,
                conf=self.min_confidence,
                classes=[0],
                device=self.device,
                max_det=self.max_detections,
                verbose=False,
            )
        if not results:
            return []
        result = results[0]
        if result.boxes is None or len(result.boxes) == 0:
            return []

        boxes = result.boxes.xyxy.cpu().numpy()
        confidences = result.boxes.conf.cpu().numpy()
        keypoint_data = (
            result.keypoints.data.cpu().numpy()
            if result.keypoints is not None and result.keypoints.data is not None
            else None
        )

        detections: List[Detection] = []
        for index, (x1, y1, x2, y2) in enumerate(boxes):
            box = BoundingBox(
                x=float(x1) / width,
                y=float(y1) / height,
                width=float(x2 - x1) / width,
                height=float(y2 - y1) / height,
            ).clamp()
            if box.width < 0.02 or box.height < 0.04:
                continue
            keypoints: Optional[List[Keypoint]] = None
            if keypoint_data is not None and index < len(keypoint_data):
                has_confidence = keypoint_data.shape[-1] > 2
                keypoints = [
                    Keypoint(
                        x=float(row[0]) / width,
                        y=float(row[1]) / height,
                        confidence=float(row[2]) if has_confidence else 1.0,
                    )
                    for row in keypoint_data[index]
                ]
            detections.append(
                Detection(
                    tracking_candidate_id=f'yolo-{index}',
                    bounding_box=box,
                    confidence=round(float(confidences[index]), 4),
                    class_name='person',
                    keypoints=keypoints,
                ),
            )
        return detections
