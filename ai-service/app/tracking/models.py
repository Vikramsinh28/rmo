from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional


@dataclass
class BoundingBox:
    """Normalized bounding box (x, y, width, height) in [0, 1]."""

    x: float
    y: float
    width: float
    height: float

    def clamp(self) -> 'BoundingBox':
        x = max(0.0, min(1.0, self.x))
        y = max(0.0, min(1.0, self.y))
        w = max(0.0, min(1.0 - x, self.width))
        h = max(0.0, min(1.0 - y, self.height))
        return BoundingBox(x=x, y=y, width=w, height=h)

    def iou(self, other: 'BoundingBox') -> float:
        ax2, ay2 = self.x + self.width, self.y + self.height
        bx2, by2 = other.x + other.width, other.y + other.height
        ix1, iy1 = max(self.x, other.x), max(self.y, other.y)
        ix2, iy2 = min(ax2, bx2), min(ay2, by2)
        iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
        inter = iw * ih
        if inter <= 0:
            return 0.0
        union = self.width * self.height + other.width * other.height - inter
        return inter / union if union > 0 else 0.0

    def center(self) -> tuple[float, float]:
        return (self.x + self.width / 2.0, self.y + self.height / 2.0)

    def to_dict(self) -> Dict[str, float]:
        return {
            'x': round(self.x, 4),
            'y': round(self.y, 4),
            'width': round(self.width, 4),
            'height': round(self.height, 4),
        }


@dataclass
class Keypoint:
    """COCO-17 body keypoint, normalized to the full frame."""

    x: float
    y: float
    confidence: float

    def to_dict(self) -> Dict[str, float]:
        return {
            'x': round(self.x, 4),
            'y': round(self.y, 4),
            'confidence': round(self.confidence, 3),
        }


@dataclass
class Detection:
    tracking_candidate_id: str
    bounding_box: BoundingBox
    confidence: float
    class_name: str = 'person'
    keypoints: Optional[List[Keypoint]] = None


@dataclass
class TrackedPerson:
    track_id: str
    bounding_box: BoundingBox
    tracking_confidence: float
    first_seen_at: datetime
    last_seen_at: datetime
    age_frames: int
    lost_frames: int
    keypoints: Optional[List[Keypoint]] = None


@dataclass
class FeatureSnapshot:
    timestamp: datetime
    bounding_box: BoundingBox
    face: Dict[str, Any] = field(default_factory=dict)
    body: Dict[str, Any] = field(default_factory=dict)
    movement: Dict[str, Any] = field(default_factory=dict)
    quality: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PersonRollup:
    track_id: str
    first_seen_at: datetime
    last_seen_at: datetime
    identity: Dict[str, Any]
    identity_confidence: Optional[float]
    face_features: Dict[str, Any]
    pose_features: Dict[str, Any]
    movement_features: Dict[str, Any]
    quality: Dict[str, Any]
    history: List[FeatureSnapshot] = field(default_factory=list)
    tracking_confidence: float = 0.0
    bounding_box: Optional[BoundingBox] = None
