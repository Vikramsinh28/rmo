from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import List, Optional


class ImpairmentStatus(str, Enum):
    NO_CLEAR_INDICATOR = 'NO_CLEAR_INDICATOR'
    POTENTIAL_IMPAIRMENT = 'POTENTIAL_IMPAIRMENT'
    INSUFFICIENT_QUALITY = 'INSUFFICIENT_QUALITY'
    NO_PERSON_DETECTED = 'NO_PERSON_DETECTED'
    ANALYSIS_UNAVAILABLE = 'ANALYSIS_UNAVAILABLE'


class RiskLevel(str, Enum):
    LOW = 'LOW'
    MEDIUM = 'MEDIUM'
    HIGH = 'HIGH'
    UNKNOWN = 'UNKNOWN'


@dataclass(frozen=True)
class ImpairmentAnalysisResult:
    """Normalized assistive signal. Does not establish alcohol consumption."""

    status: ImpairmentStatus
    risk_level: RiskLevel
    confidence: Optional[float]
    indicators: List[str] = field(default_factory=list)
    requires_human_review: bool = False
    disclaimer: str = (
        'Potential impairment indicators are assistive safety signals only. '
        'Single-frame analysis cannot confirm alcohol consumption or intoxication. '
        'Human verification is required.'
    )

    def to_dict(self) -> dict:
        return {
            'status': self.status.value,
            'riskLevel': self.risk_level.value,
            'confidence': self.confidence,
            'indicators': list(self.indicators),
            'requiresHumanReview': self.requires_human_review,
            'disclaimer': self.disclaimer,
        }


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
