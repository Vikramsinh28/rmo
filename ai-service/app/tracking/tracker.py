from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Dict, List, Optional

from app.config import settings
from app.tracking.models import BoundingBox, Detection, TrackedPerson


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PersonTracker(ABC):
    @abstractmethod
    def update(self, detections: List[Detection], timestamp: datetime) -> List[TrackedPerson]:
        raise NotImplementedError

    @abstractmethod
    def reset(self) -> None:
        raise NotImplementedError


class IoUPersonTracker(PersonTracker):
    """Simple IoU association tracker with temporary Person-N IDs."""

    def __init__(
        self,
        iou_threshold: Optional[float] = None,
        max_lost_frames: Optional[int] = None,
    ) -> None:
        self.iou_threshold = (
            iou_threshold if iou_threshold is not None else settings.ai_tracking_iou_threshold
        )
        self.max_lost_frames = (
            max_lost_frames if max_lost_frames is not None else settings.ai_tracking_max_lost_frames
        )
        self._next_id = 1
        self._tracks: Dict[str, TrackedPerson] = {}

    def reset(self) -> None:
        self._next_id = 1
        self._tracks.clear()

    def update(self, detections: List[Detection], timestamp: datetime) -> List[TrackedPerson]:
        unmatched_dets = list(detections)
        matched: Dict[str, Detection] = {}

        # Greedy IoU matching.
        track_ids = list(self._tracks.keys())
        for track_id in track_ids:
            track = self._tracks[track_id]
            best_iou = 0.0
            best_det: Optional[Detection] = None
            for det in unmatched_dets:
                score = track.bounding_box.iou(det.bounding_box)
                if score > best_iou:
                    best_iou = score
                    best_det = det
            if best_det and best_iou >= self.iou_threshold:
                matched[track_id] = best_det
                unmatched_dets.remove(best_det)

        for track_id, det in matched.items():
            track = self._tracks[track_id]
            track.bounding_box = det.bounding_box
            track.tracking_confidence = det.confidence
            track.last_seen_at = timestamp
            track.age_frames += 1
            track.lost_frames = 0

        for track_id in track_ids:
            if track_id in matched:
                continue
            track = self._tracks[track_id]
            track.lost_frames += 1
            if track.lost_frames > self.max_lost_frames:
                del self._tracks[track_id]

        for det in unmatched_dets:
            track_id = f'Person-{self._next_id}'
            self._next_id += 1
            self._tracks[track_id] = TrackedPerson(
                track_id=track_id,
                bounding_box=det.bounding_box,
                tracking_confidence=det.confidence,
                first_seen_at=timestamp,
                last_seen_at=timestamp,
                age_frames=1,
                lost_frames=0,
            )

        return [
            track for track in self._tracks.values()
            if track.lost_frames == 0
        ]
