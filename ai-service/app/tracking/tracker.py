from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Dict, List, Optional

import numpy as np

from app.config import settings
from app.tracking.models import BoundingBox, Detection, TrackedPerson

logger = logging.getLogger('rmo-ai-service')


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PersonTracker(ABC):
    @abstractmethod
    def update(self, detections: List[Detection], timestamp: datetime) -> List[TrackedPerson]:
        raise NotImplementedError

    @abstractmethod
    def reset(self) -> None:
        raise NotImplementedError

    @abstractmethod
    def known_track_ids(self) -> List[str]:
        """Active plus temporarily lost track IDs still retained by the tracker."""
        raise NotImplementedError


class IoUPersonTracker(PersonTracker):
    """Simple IoU association tracker with temporary Person-N IDs."""

    provider_name = 'iou'

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

    def known_track_ids(self) -> List[str]:
        return list(self._tracks.keys())

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
            track.keypoints = det.keypoints
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
                keypoints=det.keypoints,
            )

        return [
            track for track in self._tracks.values()
            if track.lost_frames == 0
        ]


class ByteTrackPersonTracker(PersonTracker):
    """
    ByteTrack (Kalman motion model + two-stage high/low confidence association).

    Wraps supervision's implementation and maps its integer IDs to Person-N.
    """

    provider_name = 'bytetrack'

    def __init__(
        self,
        max_lost_frames: Optional[int] = None,
        frame_rate: Optional[int] = None,
        activation_threshold: float = 0.3,
        matching_threshold: float = 0.8,
    ) -> None:
        import supervision as sv

        self._sv = sv
        self.max_lost_frames = (
            max_lost_frames if max_lost_frames is not None else settings.ai_tracking_max_lost_frames
        )
        self.frame_rate = frame_rate or max(1, round(1000 / max(settings.ai_frame_interval_ms, 1)))
        self.activation_threshold = activation_threshold
        self.matching_threshold = matching_threshold
        self._tracker = self._build()
        self._next_id = 1
        self._id_map: Dict[int, str] = {}
        self._tracks: Dict[str, TrackedPerson] = {}

    def _build(self):
        # supervision scales lost_track_buffer by frame_rate / 30; undo that so the
        # buffer is expressed in processed frames.
        buffer = max(1, int(round(self.max_lost_frames * 30 / self.frame_rate)))
        return self._sv.ByteTrack(
            track_activation_threshold=self.activation_threshold,
            lost_track_buffer=buffer,
            minimum_matching_threshold=self.matching_threshold,
            frame_rate=self.frame_rate,
        )

    def reset(self) -> None:
        self._tracker = self._build()
        self._next_id = 1
        self._id_map.clear()
        self._tracks.clear()

    def known_track_ids(self) -> List[str]:
        return list(self._tracks.keys())

    def update(self, detections: List[Detection], timestamp: datetime) -> List[TrackedPerson]:
        sv = self._sv
        if detections:
            xyxy = np.array(
                [
                    [
                        d.bounding_box.x,
                        d.bounding_box.y,
                        d.bounding_box.x + d.bounding_box.width,
                        d.bounding_box.y + d.bounding_box.height,
                    ]
                    for d in detections
                ],
                dtype=np.float32,
            )
            sv_detections = sv.Detections(
                xyxy=xyxy,
                confidence=np.array([d.confidence for d in detections], dtype=np.float32),
                class_id=np.zeros(len(detections), dtype=int),
                data={'index': np.arange(len(detections))},
            )
        else:
            sv_detections = sv.Detections.empty()

        tracked = self._tracker.update_with_detections(sv_detections)

        seen: set[str] = set()
        active: List[TrackedPerson] = []
        if tracked.tracker_id is not None and len(tracked) > 0:
            indices = tracked.data.get('index')
            for row, external_id in enumerate(tracked.tracker_id):
                external_id = int(external_id)
                det = detections[int(indices[row])]
                track_id = self._id_map.get(external_id)
                if track_id is None:
                    track_id = f'Person-{self._next_id}'
                    self._next_id += 1
                    self._id_map[external_id] = track_id
                track = self._tracks.get(track_id)
                if track is None:
                    track = TrackedPerson(
                        track_id=track_id,
                        bounding_box=det.bounding_box,
                        tracking_confidence=det.confidence,
                        first_seen_at=timestamp,
                        last_seen_at=timestamp,
                        age_frames=1,
                        lost_frames=0,
                        keypoints=det.keypoints,
                    )
                    self._tracks[track_id] = track
                else:
                    track.bounding_box = det.bounding_box
                    track.tracking_confidence = det.confidence
                    track.keypoints = det.keypoints
                    track.last_seen_at = timestamp
                    track.age_frames += 1
                    track.lost_frames = 0
                seen.add(track_id)
                active.append(track)

        for track_id in list(self._tracks.keys()):
            if track_id in seen:
                continue
            track = self._tracks[track_id]
            track.lost_frames += 1
            if track.lost_frames > self.max_lost_frames:
                del self._tracks[track_id]
                self._id_map = {k: v for k, v in self._id_map.items() if v != track_id}

        return active


def get_person_tracker(provider: Optional[str] = None) -> PersonTracker:
    name = (provider or settings.ai_tracker_provider or 'iou').strip().lower()
    if name == 'bytetrack':
        try:
            return ByteTrackPersonTracker()
        except Exception as error:  # noqa: BLE001 — missing supervision falls back to IoU
            logger.warning('AI_BYTETRACK_UNAVAILABLE fallback=iou reason=%s', error)
    return IoUPersonTracker()
