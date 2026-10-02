from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from app.config import settings
from app.safety.models import (
    FrameObservation,
    SafetyEvaluation,
    SafetySignal,
    TrackSafetyState,
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _ms(start: Optional[datetime], now: datetime) -> float:
    if start is None:
        return 0.0
    return max(0.0, (now - start).total_seconds() * 1000.0)


class SafetyDetectionEngine:
    """
    Timestamp-based temporal safety evaluation per track.

    Does NOT call AWS. Does NOT diagnose alcohol/intoxication.
    """

    def __init__(self) -> None:
        self._tracks: Dict[str, TrackSafetyState] = {}
        self.warning_count = 0
        self.critical_count = 0
        self.last_alert_at: Optional[datetime] = None
        self._active_alerts: Dict[str, str] = {}

    def reset(self) -> None:
        self._tracks.clear()
        self.warning_count = 0
        self.critical_count = 0
        self.last_alert_at = None
        self._active_alerts.clear()

    def drop_missing(self, active_track_ids: List[str]) -> None:
        active = set(active_track_ids)
        for track_id in list(self._tracks.keys()):
            if track_id not in active:
                self._active_alerts.pop(track_id, None)
                del self._tracks[track_id]

    def session_summary(self) -> dict:
        return {
            'warningCount': self.warning_count,
            'criticalCount': self.critical_count,
            'activeAlerts': [
                {'trackId': track_id, 'level': level}
                for track_id, level in self._active_alerts.items()
            ],
            'lastAlertAt': self.last_alert_at.isoformat() if self.last_alert_at else None,
            'strictMode': bool(settings.ai_strict_mode),
            'enabled': bool(settings.safety_detection_enabled),
        }

    def evaluate(
        self,
        track_id: str,
        observation: FrameObservation,
        first_seen_at: Optional[datetime] = None,
    ) -> SafetyEvaluation:
        if not settings.safety_detection_enabled:
            return SafetyEvaluation(
                state='INSUFFICIENT_EVIDENCE',
                visual_status='INSUFFICIENT_EVIDENCE',
                note='Safety detection disabled.',
            )

        now = observation.timestamp
        track = self._tracks.get(track_id)
        if track is None:
            track = TrackSafetyState(
                track_id=track_id,
                first_seen_at=first_seen_at or now,
                last_seen_at=now,
            )
            self._tracks[track_id] = track

        track.last_seen_at = now
        track.face_visible = observation.face_visible
        track.quality = observation.face_quality
        track.movement_level = observation.movement_level

        thresholds = self._thresholds()
        quality_ok = self._quality_ok(observation, thresholds['eye_min_quality'])

        # Quality gap: do not immediately reset an active temporal event.
        if not quality_ok:
            return self._handle_quality_gap(track, now, thresholds)

        track.face_missing_since = None
        eyes_closed = self._eyes_closed(observation, thresholds)
        head_down = self._head_down(observation, thresholds)

        self._update_eye_timers(track, eyes_closed, observation, now, thresholds)
        self._update_head_timers(track, head_down, observation, now, thresholds)

        signals = self._build_signals(track, thresholds)
        state, visual = self._resolve_state(signals, observation, quality_ok, thresholds)
        confidence = self._confidence(signals, observation)

        previous = track.current_safety_state
        track.current_safety_state = state
        track.active_signals = signals

        alert = self._maybe_emit_alert(track, previous, state, now, thresholds)
        requires = state in {'WARNING', 'CRITICAL'}

        return SafetyEvaluation(
            state=state,
            signals=signals,
            confidence=confidence,
            requires_human_verification=requires,
            visual_status=visual,
            alert_emitted=alert,
            note=(
                'Potential impairment indicator detected — requires human verification.'
                if requires
                else None
            ),
        )

    def _thresholds(self) -> dict:
        strict = bool(settings.ai_strict_mode)
        # Non-strict mode keeps longer, more conservative temporal windows.
        scale = 1.0 if strict else 3.0
        return {
            'eye_enabled': bool(settings.eye_closure_enabled),
            'eye_alert_ms': settings.eye_closure_alert_after_ms * scale,
            'eye_critical_ms': settings.eye_closure_critical_after_ms * scale,
            'eye_recovery_ms': settings.eye_closure_recovery_ms,
            'eye_min_quality': settings.eye_closure_min_face_quality,
            'eye_max_missing': settings.eye_closure_max_missing_frames,
            'eye_closed_threshold': settings.eye_closure_open_probability_max,
            'head_enabled': bool(settings.head_down_enabled),
            'head_pitch': settings.head_down_pitch_threshold_deg,
            'head_alert_ms': settings.head_down_alert_after_ms * scale,
            'head_critical_ms': settings.head_down_critical_after_ms * scale,
            'head_recovery_ms': settings.head_down_recovery_ms,
            'head_max_missing': settings.head_down_max_missing_frames,
            'confirm_frames': settings.bad_condition_confirmation_frames,
            'recover_frames': settings.good_condition_recovery_frames,
            'quality_gap_ms': settings.quality_gap_tolerance_ms,
            'cooldown_ms': settings.safety_alert_cooldown_ms,
            'multi_enabled': bool(settings.multi_signal_escalation_enabled),
            'multi_count': settings.multi_signal_critical_count,
            'multi_window_ms': settings.multi_signal_window_ms,
        }

    def _quality_ok(self, observation: FrameObservation, min_quality: float) -> bool:
        if not observation.face_visible:
            return False
        if observation.face_quality is None:
            return False
        return observation.face_quality >= min_quality

    def _eyes_closed(self, observation: FrameObservation, thresholds: dict) -> Optional[bool]:
        if not thresholds['eye_enabled']:
            return None
        if not observation.eyes_available or observation.eyes_open_probability is None:
            return None
        return observation.eyes_open_probability <= thresholds['eye_closed_threshold']

    def _head_down(self, observation: FrameObservation, thresholds: dict) -> Optional[bool]:
        if not thresholds['head_enabled']:
            return None
        if not observation.head_pose_available or observation.head_pitch_deg is None:
            return None
        return observation.head_pitch_deg >= thresholds['head_pitch']

    def _update_eye_timers(
        self,
        track: TrackSafetyState,
        eyes_closed: Optional[bool],
        observation: FrameObservation,
        now: datetime,
        thresholds: dict,
    ) -> None:
        if eyes_closed is None:
            track.eyes_missing_streak += 1
            if (
                track.eyes_closed_since is not None
                and track.eyes_missing_streak <= thresholds['eye_max_missing']
            ):
                track.eyes_closed_duration_ms = _ms(track.eyes_closed_since, now)
                return
            # Beyond tolerance — do not grow further, but only reset after recovery path.
            return

        track.eyes_missing_streak = 0
        if eyes_closed:
            track.consecutive_closed_frames += 1
            track.consecutive_open_frames = 0
            track.eyes_open_since = None
            if track.consecutive_closed_frames >= thresholds['confirm_frames']:
                if track.eyes_closed_since is None:
                    track.eyes_closed_since = now
                track.eyes_closed_duration_ms = _ms(track.eyes_closed_since, now)
            return

        # Eyes open
        track.consecutive_open_frames += 1
        track.consecutive_closed_frames = 0
        if track.eyes_closed_since is None:
            track.eyes_closed_duration_ms = 0.0
            return
        if track.eyes_open_since is None:
            track.eyes_open_since = now
        open_ms = _ms(track.eyes_open_since, now)
        if (
            open_ms >= thresholds['eye_recovery_ms']
            and track.consecutive_open_frames >= thresholds['recover_frames']
        ):
            track.eyes_closed_since = None
            track.eyes_closed_duration_ms = 0.0
            track.eyes_open_since = None
        else:
            # Brief reopen — keep the event running.
            track.eyes_closed_duration_ms = _ms(track.eyes_closed_since, now)

    def _update_head_timers(
        self,
        track: TrackSafetyState,
        head_down: Optional[bool],
        observation: FrameObservation,
        now: datetime,
        thresholds: dict,
    ) -> None:
        void = observation
        del void
        if head_down is None:
            track.head_missing_streak += 1
            if (
                track.head_down_since is not None
                and track.head_missing_streak <= thresholds['head_max_missing']
            ):
                track.head_down_duration_ms = _ms(track.head_down_since, now)
            return

        track.head_missing_streak = 0
        if head_down:
            track.consecutive_head_down_frames += 1
            track.consecutive_head_up_frames = 0
            track.head_up_since = None
            if track.consecutive_head_down_frames >= thresholds['confirm_frames']:
                if track.head_down_since is None:
                    track.head_down_since = now
                track.head_down_duration_ms = _ms(track.head_down_since, now)
            return

        track.consecutive_head_up_frames += 1
        track.consecutive_head_down_frames = 0
        if track.head_down_since is None:
            track.head_down_duration_ms = 0.0
            return
        if track.head_up_since is None:
            track.head_up_since = now
        up_ms = _ms(track.head_up_since, now)
        if (
            up_ms >= thresholds['head_recovery_ms']
            and track.consecutive_head_up_frames >= thresholds['recover_frames']
        ):
            track.head_down_since = None
            track.head_down_duration_ms = 0.0
            track.head_up_since = None
        else:
            track.head_down_duration_ms = _ms(track.head_down_since, now)

    def _build_signals(self, track: TrackSafetyState, thresholds: dict) -> List[SafetySignal]:
        signals: List[SafetySignal] = []
        if track.eyes_closed_duration_ms >= thresholds['eye_alert_ms']:
            severity = (
                'CRITICAL'
                if track.eyes_closed_duration_ms >= thresholds['eye_critical_ms']
                else 'WARNING'
            )
            signals.append(
                SafetySignal(
                    type='EYE_CLOSURE',
                    duration_ms=track.eyes_closed_duration_ms,
                    severity=severity,
                    label='Prolonged eye closure',
                ),
            )
        if track.head_down_duration_ms >= thresholds['head_alert_ms']:
            severity = (
                'CRITICAL'
                if track.head_down_duration_ms >= thresholds['head_critical_ms']
                else 'WARNING'
            )
            signals.append(
                SafetySignal(
                    type='HEAD_DOWN',
                    duration_ms=track.head_down_duration_ms,
                    severity=severity,
                    label='Prolonged head-down posture',
                ),
            )
        return signals

    def _resolve_state(
        self,
        signals: List[SafetySignal],
        observation: FrameObservation,
        quality_ok: bool,
        thresholds: dict,
    ) -> Tuple[str, str]:
        if not signals:
            if not quality_ok or (
                not observation.eyes_available and not observation.head_pose_available
            ):
                return 'INSUFFICIENT_EVIDENCE', 'INSUFFICIENT_EVIDENCE'
            return 'NORMAL', 'NORMAL'

        critical = any(signal.severity == 'CRITICAL' for signal in signals)
        warning_signals = [signal for signal in signals if signal.severity in {'WARNING', 'CRITICAL'}]

        if thresholds['multi_enabled'] and len(warning_signals) >= thresholds['multi_count']:
            # Simultaneous signals within window → escalate.
            critical = True

        if critical:
            return 'CRITICAL', 'HIGH_INDICATORS'
        return 'WARNING', 'ELEVATED_INDICATORS'

    def _confidence(
        self,
        signals: List[SafetySignal],
        observation: FrameObservation,
    ) -> Optional[float]:
        if not signals:
            return None
        base = 0.55
        if observation.face_quality is not None:
            base = 0.45 + 0.45 * float(observation.face_quality)
        boost = min(0.25, 0.08 * len(signals))
        return round(min(0.95, base + boost), 3)

    def _handle_quality_gap(
        self,
        track: TrackSafetyState,
        now: datetime,
        thresholds: dict,
    ) -> SafetyEvaluation:
        if track.face_missing_since is None:
            track.face_missing_since = now
        gap_ms = _ms(track.face_missing_since, now)

        # Keep running timers briefly during low-quality gaps.
        if gap_ms <= thresholds['quality_gap_ms']:
            if track.eyes_closed_since is not None:
                track.eyes_closed_duration_ms = _ms(track.eyes_closed_since, now)
            if track.head_down_since is not None:
                track.head_down_duration_ms = _ms(track.head_down_since, now)
            signals = self._build_signals(track, thresholds)
            if signals:
                state, visual = self._resolve_state(signals, FrameObservation(timestamp=now), True, thresholds)
                track.current_safety_state = state
                track.active_signals = signals
                return SafetyEvaluation(
                    state=state,
                    signals=signals,
                    confidence=self._confidence(signals, FrameObservation(timestamp=now, face_quality=track.quality)),
                    requires_human_verification=True,
                    visual_status=visual,
                    note='Potential impairment indicator detected — requires human verification.',
                )

        # Gap too long with no established alert → insufficient evidence.
        if track.current_safety_state in {'WARNING', 'CRITICAL'} and gap_ms <= thresholds['quality_gap_ms'] * 2:
            signals = track.active_signals
            return SafetyEvaluation(
                state=track.current_safety_state,
                signals=signals,
                confidence=None,
                requires_human_verification=True,
                visual_status=(
                    'HIGH_INDICATORS' if track.current_safety_state == 'CRITICAL' else 'ELEVATED_INDICATORS'
                ),
            )

        track.current_safety_state = 'INSUFFICIENT_EVIDENCE'
        return SafetyEvaluation(
            state='INSUFFICIENT_EVIDENCE',
            visual_status='INSUFFICIENT_EVIDENCE',
            note='Insufficient face evidence for safety evaluation.',
        )

    def _maybe_emit_alert(
        self,
        track: TrackSafetyState,
        previous: str,
        state: str,
        now: datetime,
        thresholds: dict,
    ) -> Optional[str]:
        if state not in {'WARNING', 'CRITICAL'}:
            self._active_alerts.pop(track.track_id, None)
            return None

        # Escalation WARNING → CRITICAL always emits.
        escalating = previous == 'WARNING' and state == 'CRITICAL'
        same_level = track.last_alert_level == state
        cooldown_active = False
        if track.last_alert_at is not None and same_level and not escalating:
            cooldown_active = _ms(track.last_alert_at, now) < thresholds['cooldown_ms']

        entered = previous != state and state in {'WARNING', 'CRITICAL'}
        if not entered and not escalating:
            if state in {'WARNING', 'CRITICAL'}:
                self._active_alerts[track.track_id] = state
            return None
        if cooldown_active:
            self._active_alerts[track.track_id] = state
            return None

        track.last_alert_at = now
        track.last_alert_level = state
        self.last_alert_at = now
        self._active_alerts[track.track_id] = state
        if state == 'WARNING':
            track.warning_count += 1
            self.warning_count += 1
        else:
            track.critical_count += 1
            self.critical_count += 1
        return state
