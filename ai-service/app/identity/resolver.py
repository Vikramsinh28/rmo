from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

from app.tracking.models import PersonRollup, TrackedPerson


class IdentityResult:
    def __init__(
        self,
        status: str = 'UNKNOWN',
        display_name: Optional[str] = None,
        user_id: Optional[int] = None,
        confidence: Optional[float] = None,
    ) -> None:
        self.status = status
        self.display_name = display_name
        self.user_id = user_id
        self.confidence = confidence

    def to_dict(self) -> Dict[str, Any]:
        return {
            'status': self.status,
            'displayName': self.display_name,
            'userId': self.user_id,
            'confidence': self.confidence,
        }


class IdentityResolver(ABC):
    """
    Future hook for periodic Rekognition SearchFacesByImage.

    Phase 10 must NOT call AWS. Default resolver always returns UNKNOWN.
    """

    @abstractmethod
    def resolve(self, track: TrackedPerson, frame_bgr=None, rollup: Optional[PersonRollup] = None) -> IdentityResult:
        raise NotImplementedError


class UnknownIdentityResolver(IdentityResolver):
    def resolve(self, track: TrackedPerson, frame_bgr=None, rollup: Optional[PersonRollup] = None) -> IdentityResult:
        return IdentityResult(status='UNKNOWN', display_name=None, user_id=None, confidence=None)
