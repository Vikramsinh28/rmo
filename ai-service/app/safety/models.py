from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional


SafetyState = str  # NORMAL | WARNING | CRITICAL | INSUFFICIENT_EVIDENCE


@dataclass
class SafetySignal:
    type: str
    duration_ms: float
    severity: str
    label: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            'type': self.type,
            'durationMs': round(self.duration_ms),
            'severity': self.severity,
            'label': self.label,
        }


@dataclass
class SafetyEvaluation:
    state: SafetyState
    signals: List[SafetySignal] = field(default_factory=list)
    confidence: Optional[float] = None
    requires_human_verification: bool = False
    visual_status: str = 'INSUFFICIENT_EVIDENCE'
    alert_emitted: Optional[str] = None  # WARNING | CRITICAL | None
    note: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            'state': self.state,
            'signals': [signal.to_dict() for signal in self.signals],
            'confidence': self.confidence,
            'requiresHumanVerification': self.requires_human_verification,
            'visualStatus': self.visual_status,
            'alertEmitted': self.alert_emitted,
            'note': self.note,
            # Safe product wording — never alcohol/drunk claims.
            'guidance': (
                'Potential impairment indicator detected — requires human verification.'
                if self.requires_human_verification
                else None
            ),
        }


@dataclass
class FrameObservation:
    timestamp: datetime
    face_visible: bool = False
    face_quality: Optional[float] = None
    eyes_available: bool = False
    eyes_open_probability: Optional[float] = None
    head_pose_available: bool = False
    head_pitch_deg: Optional[float] = None
    movement_level: Optional[float] = None


@dataclass
class TrackSafetyState:
    track_id: str
    first_seen_at: datetime
    last_seen_at: datetime
    face_visible: bool = False
    eyes_closed_since: Optional[datetime] = None
    eyes_closed_duration_ms: float = 0.0
    eyes_open_since: Optional[datetime] = None
    eyes_missing_streak: int = 0
    head_down_since: Optional[datetime] = None
    head_down_duration_ms: float = 0.0
    head_up_since: Optional[datetime] = None
    head_missing_streak: int = 0
    face_missing_since: Optional[datetime] = None
    movement_level: Optional[float] = None
    quality: Optional[float] = None
    consecutive_bad_frames: int = 0
    consecutive_good_frames: int = 0
    consecutive_closed_frames: int = 0
    consecutive_open_frames: int = 0
    consecutive_head_down_frames: int = 0
    consecutive_head_up_frames: int = 0
    current_safety_state: SafetyState = 'INSUFFICIENT_EVIDENCE'
    last_alert_at: Optional[datetime] = None
    last_alert_level: Optional[str] = None
    warning_count: int = 0
    critical_count: int = 0
    active_signals: List[SafetySignal] = field(default_factory=list)
