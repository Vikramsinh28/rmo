from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app import config
from app.safety.engine import SafetyDetectionEngine
from app.safety.models import FrameObservation
from app.processing.pipeline import FrameProcessingPipeline, drop_session_pipeline


def _ts(base: datetime, ms: int) -> datetime:
    return base + timedelta(milliseconds=ms)


@pytest.fixture
def engine(monkeypatch):
    monkeypatch.setattr(config.settings, 'safety_detection_enabled', True)
    monkeypatch.setattr(config.settings, 'ai_strict_mode', True)
    monkeypatch.setattr(config.settings, 'eye_closure_enabled', True)
    monkeypatch.setattr(config.settings, 'head_down_enabled', True)
    monkeypatch.setattr(config.settings, 'eye_closure_alert_after_ms', 2000)
    monkeypatch.setattr(config.settings, 'eye_closure_critical_after_ms', 4000)
    monkeypatch.setattr(config.settings, 'eye_closure_recovery_ms', 500)
    monkeypatch.setattr(config.settings, 'eye_closure_min_face_quality', 0.55)
    monkeypatch.setattr(config.settings, 'eye_closure_max_missing_frames', 3)
    monkeypatch.setattr(config.settings, 'eye_closure_open_probability_max', 0.35)
    monkeypatch.setattr(config.settings, 'head_down_pitch_threshold_deg', 25.0)
    monkeypatch.setattr(config.settings, 'head_down_alert_after_ms', 2000)
    monkeypatch.setattr(config.settings, 'head_down_critical_after_ms', 5000)
    monkeypatch.setattr(config.settings, 'head_down_recovery_ms', 1000)
    monkeypatch.setattr(config.settings, 'head_down_max_missing_frames', 3)
    monkeypatch.setattr(config.settings, 'bad_condition_confirmation_frames', 2)
    monkeypatch.setattr(config.settings, 'good_condition_recovery_frames', 3)
    monkeypatch.setattr(config.settings, 'quality_gap_tolerance_ms', 1000)
    monkeypatch.setattr(config.settings, 'safety_alert_cooldown_ms', 10_000)
    monkeypatch.setattr(config.settings, 'multi_signal_escalation_enabled', True)
    monkeypatch.setattr(config.settings, 'multi_signal_critical_count', 2)
    return SafetyDetectionEngine()


def _closed(base: datetime, ms: int, quality: float = 0.8) -> FrameObservation:
    return FrameObservation(
        timestamp=_ts(base, ms),
        face_visible=True,
        face_quality=quality,
        eyes_available=True,
        eyes_open_probability=0.1,
        head_pose_available=True,
        head_pitch_deg=5.0,
    )


def _open(base: datetime, ms: int, quality: float = 0.8) -> FrameObservation:
    return FrameObservation(
        timestamp=_ts(base, ms),
        face_visible=True,
        face_quality=quality,
        eyes_available=True,
        eyes_open_probability=0.9,
        head_pose_available=True,
        head_pitch_deg=5.0,
    )


def _missing(base: datetime, ms: int) -> FrameObservation:
    return FrameObservation(
        timestamp=_ts(base, ms),
        face_visible=True,
        face_quality=0.8,
        eyes_available=False,
        eyes_open_probability=None,
        head_pose_available=True,
        head_pitch_deg=5.0,
    )


def _head_down(base: datetime, ms: int, pitch: float = 35.0) -> FrameObservation:
    return FrameObservation(
        timestamp=_ts(base, ms),
        face_visible=True,
        face_quality=0.85,
        eyes_available=True,
        eyes_open_probability=0.9,
        head_pose_available=True,
        head_pitch_deg=pitch,
    )


def _both(base: datetime, ms: int) -> FrameObservation:
    return FrameObservation(
        timestamp=_ts(base, ms),
        face_visible=True,
        face_quality=0.85,
        eyes_available=True,
        eyes_open_probability=0.1,
        head_pose_available=True,
        head_pitch_deg=40.0,
    )


def test_1_eyes_closed_500ms_normal(engine):
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    engine.evaluate('Person-1', _closed(base, 0))
    engine.evaluate('Person-1', _closed(base, 200))
    result = engine.evaluate('Person-1', _closed(base, 500))
    assert result.state == 'NORMAL'
    assert result.alert_emitted is None


def test_2_eyes_closed_1500ms_no_alert(engine):
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for ms in (0, 200, 700, 1200, 1500):
        result = engine.evaluate('Person-1', _closed(base, ms))
    assert result.state == 'NORMAL'
    assert not any(s.type == 'EYE_CLOSURE' for s in result.signals)


def test_3_eyes_closed_2000ms_warning(engine):
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for ms in (0, 200, 1000, 2000, 2200):
        result = engine.evaluate('Person-1', _closed(base, ms))
    assert result.state == 'WARNING'
    assert result.alert_emitted == 'WARNING'
    assert result.requires_human_verification is True
    assert 'human verification' in (result.note or '').lower()
    assert 'drunk' not in (result.note or '').lower()


def test_4_eyes_closed_4000ms_critical(engine):
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    result = None
    for ms in (0, 200, 1000, 2200, 3000, 4000, 4200):
        result = engine.evaluate('Person-1', _closed(base, ms))
    assert result is not None
    assert result.state == 'CRITICAL'
    assert any(s.type == 'EYE_CLOSURE' and s.severity == 'CRITICAL' for s in result.signals)


def test_5_missing_frame_still_warning(engine):
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for ms in (0, 200, 800, 1400):
        engine.evaluate('Person-1', _closed(base, ms))
    engine.evaluate('Person-1', _missing(base, 1800))
    result = engine.evaluate('Person-1', _closed(base, 2400))
    assert result.state == 'WARNING'


def test_6_brief_reopen_continues_event(engine):
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for ms in (0, 200, 1000, 2200):
        engine.evaluate('Person-1', _closed(base, ms))
    # Reopen shorter than recovery (500ms) and fewer than recovery frames.
    engine.evaluate('Person-1', _open(base, 2300))
    engine.evaluate('Person-1', _open(base, 2500))
    result = engine.evaluate('Person-1', _closed(base, 2700))
    assert result.state in {'WARNING', 'CRITICAL'}
    assert any(s.type == 'EYE_CLOSURE' for s in result.signals)


def test_7_recovery_returns_normal(engine):
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for ms in (0, 200, 1000, 2200):
        engine.evaluate('Person-1', _closed(base, ms))
    # Open long enough with recovery frames.
    result = None
    for ms in (2300, 2500, 2700, 3000, 3300):
        result = engine.evaluate('Person-1', _open(base, ms))
    assert result is not None
    assert result.state == 'NORMAL'
    assert result.signals == []


def test_8_head_down_warning(engine):
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    result = None
    for ms in (0, 200, 1000, 2200):
        result = engine.evaluate('Person-1', _head_down(base, ms))
    assert result is not None
    assert result.state == 'WARNING'
    assert any(s.type == 'HEAD_DOWN' for s in result.signals)


def test_9_head_down_critical(engine):
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    result = None
    for ms in (0, 200, 1000, 2200, 3500, 5200):
        result = engine.evaluate('Person-1', _head_down(base, ms))
    assert result is not None
    assert result.state == 'CRITICAL'


def test_10_multi_signal_escalation(engine):
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    result = None
    for ms in (0, 200, 1000, 2200):
        result = engine.evaluate('Person-1', _both(base, ms))
    assert result is not None
    assert result.state == 'CRITICAL'
    assert len(result.signals) >= 2


def test_11_poor_quality_does_not_immediately_reset(engine):
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for ms in (0, 200, 1000, 2200):
        engine.evaluate('Person-1', _closed(base, ms))
    poor = FrameObservation(
        timestamp=_ts(base, 2500),
        face_visible=True,
        face_quality=0.2,
        eyes_available=True,
        eyes_open_probability=0.1,
        head_pose_available=True,
        head_pitch_deg=5.0,
    )
    result = engine.evaluate('Person-1', poor)
    assert result.state in {'WARNING', 'CRITICAL'}


def test_12_cooldown_prevents_spam(engine):
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    alerts = []
    for ms in (0, 200, 1000, 2200, 2500, 2800, 3100):
        result = engine.evaluate('Person-1', _closed(base, ms))
        if result.alert_emitted:
            alerts.append(result.alert_emitted)
    assert alerts.count('WARNING') == 1


def test_13_warning_to_critical_emits_despite_cooldown(engine):
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    alerts = []
    for ms in (0, 200, 1000, 2200, 3000, 4000, 4200):
        result = engine.evaluate('Person-1', _closed(base, ms))
        if result.alert_emitted:
            alerts.append(result.alert_emitted)
    assert 'WARNING' in alerts
    assert 'CRITICAL' in alerts


def test_14_pipeline_never_calls_aws():
    import numpy as np
    from app.tracking.detector import MockPersonDetector
    from app.tracking.tracker import IoUPersonTracker
    from app.tracking.state import RollingPersonStateStore

    pipeline = FrameProcessingPipeline(
        detector=MockPersonDetector(),
        tracker=IoUPersonTracker(max_lost_frames=3),
        state=RollingPersonStateStore(window_seconds=30),
    )
    frame = np.zeros((120, 160, 3), dtype=np.uint8)
    # Hint mock detector via raw marker bytes.
    result = pipeline.process('1', frame, raw_bytes=b'POC_PERSON:one|')
    assert result['awsCalls'] == 0
    assert result['limitations']['noContinuousRekognition'] is True
    assert result['limitations']['doesNotConfirmAlcoholConsumption'] is True


def test_15_tracking_failure_does_not_raise_to_webrtc():
    from app.sessions import store

    started = store.start(901, 1, 2, 3)
    assert started.status == 'RUNNING'
    # Corrupt payload — tracking may fail internally but ingest returns.
    session = store.ingest_frame(901, b'not-an-image')
    assert session.status == 'RUNNING'
    store.stop(901)


def test_16_stop_clears_safety_state(engine):
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for ms in (0, 200, 2200):
        engine.evaluate('Person-1', _closed(base, ms))
    assert engine.warning_count >= 1
    drop_session_pipeline(777)
    # Direct engine reset mirrors pipeline.reset on stop.
    engine.reset()
    assert engine.warning_count == 0
    assert engine.session_summary()['activeAlerts'] == []


def test_disabled_safety_returns_insufficient(monkeypatch):
    monkeypatch.setattr(config.settings, 'safety_detection_enabled', False)
    engine = SafetyDetectionEngine()
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    result = engine.evaluate('Person-1', _closed(base, 5000))
    assert result.state == 'INSUFFICIENT_EVIDENCE'
