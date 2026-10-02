from __future__ import annotations

from datetime import datetime
from typing import Iterable, List, Optional

from app.tracking.models import BoundingBox, TrackedPerson

# A challenger must look this much more like the subject, for this long, to take over.
SWITCH_RATIO = 1.5
SWITCH_AFTER_SECONDS = 3.0


def subject_score(box: BoundingBox, aspect: float = 1.0) -> float:
    """Larger and more central people score higher (the crew member faces the camera)."""
    area = box.width * aspect * box.height
    cx, _ = box.center()
    centrality = 1.0 - 0.5 * min(1.0, abs(cx - 0.5) * 2.0)
    return area * centrality


class SubjectSelector:
    """
    Chooses the one person the interview is about.

    The choice is sticky: a brief occlusion keeps the current subject, and another
    person only takes over after clearly dominating the frame for a few seconds.
    """

    def __init__(self) -> None:
        self.primary: Optional[str] = None
        self._challenger: Optional[str] = None
        self._challenger_since: Optional[datetime] = None

    def reset(self) -> None:
        self.primary = None
        self._challenger = None
        self._challenger_since = None

    def select(
        self,
        tracked: List[TrackedPerson],
        known_ids: Iterable[str],
        now: datetime,
        aspect: float = 1.0,
    ) -> Optional[str]:
        if not tracked:
            if self.primary not in set(known_ids):
                self.reset()
            return self.primary

        scores = {person.track_id: subject_score(person.bounding_box, aspect) for person in tracked}
        best = max(scores, key=scores.get)

        if self.primary is None or self.primary not in set(known_ids):
            self._take(best)
            return self.primary

        current = scores.get(self.primary)
        if current is None:
            # Subject briefly not detected but still tracked: keep it.
            self._clear_challenger()
            return self.primary

        if best != self.primary and scores[best] >= current * SWITCH_RATIO:
            if self._challenger != best:
                self._challenger = best
                self._challenger_since = now
            elif (now - self._challenger_since).total_seconds() >= SWITCH_AFTER_SECONDS:
                self._take(best)
        else:
            self._clear_challenger()
        return self.primary

    def _take(self, track_id: str) -> None:
        self.primary = track_id
        self._clear_challenger()

    def _clear_challenger(self) -> None:
        self._challenger = None
        self._challenger_since = None
