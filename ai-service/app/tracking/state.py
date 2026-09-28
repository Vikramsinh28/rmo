from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from app.config import settings
from app.tracking.models import FeatureSnapshot, PersonRollup, TrackedPerson


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class RollingPersonStateStore:
    """Bounded in-memory rolling state per track. Does not store raw frames."""

    def __init__(self, window_seconds: Optional[int] = None) -> None:
        self.window = timedelta(
            seconds=window_seconds if window_seconds is not None else settings.ai_tracking_window_seconds,
        )
        self._people: Dict[str, PersonRollup] = {}

    def reset(self) -> None:
        self._people.clear()

    def upsert(
        self,
        tracked: TrackedPerson,
        face: dict,
        pose: dict,
        movement: dict,
        quality: dict,
        identity: dict,
        timestamp: Optional[datetime] = None,
    ) -> PersonRollup:
        now = timestamp or _utc_now()
        existing = self._people.get(tracked.track_id)
        if existing is None:
            existing = PersonRollup(
                track_id=tracked.track_id,
                first_seen_at=tracked.first_seen_at,
                last_seen_at=tracked.last_seen_at,
                identity=identity,
                identity_confidence=identity.get('confidence'),
                face_features=face,
                pose_features=pose,
                movement_features=movement,
                quality=quality,
                history=[],
                tracking_confidence=tracked.tracking_confidence,
                bounding_box=tracked.bounding_box,
            )
            self._people[tracked.track_id] = existing
        else:
            existing.last_seen_at = tracked.last_seen_at
            existing.tracking_confidence = tracked.tracking_confidence
            existing.bounding_box = tracked.bounding_box
            existing.face_features = face
            existing.pose_features = pose
            existing.movement_features = movement
            existing.quality = quality
            # Identity stays UNKNOWN unless a future resolver updates it.
            if identity.get('status') == 'RECOGNIZED':
                existing.identity = identity
                existing.identity_confidence = identity.get('confidence')
            elif existing.identity.get('status') != 'RECOGNIZED':
                existing.identity = identity
                existing.identity_confidence = identity.get('confidence')

        existing.history.append(
            FeatureSnapshot(
                timestamp=now,
                bounding_box=tracked.bounding_box,
                face=face,
                body=pose,
                movement=movement,
                quality=quality,
            ),
        )
        self._prune(existing, now)
        return existing

    def drop_missing(self, active_track_ids: List[str]) -> None:
        active = set(active_track_ids)
        for track_id in list(self._people.keys()):
            if track_id not in active:
                del self._people[track_id]

    def get(self, track_id: str) -> Optional[PersonRollup]:
        return self._people.get(track_id)

    def all(self) -> List[PersonRollup]:
        return list(self._people.values())

    def _prune(self, person: PersonRollup, now: datetime) -> None:
        cutoff = now - self.window
        person.history = [item for item in person.history if item.timestamp >= cutoff]
        # Hard cap to avoid unbounded growth if timestamps cluster.
        if len(person.history) > 120:
            person.history = person.history[-120:]
