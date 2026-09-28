from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from app.temporal.features import TemporalFeatureExtractor
from app.temporal.risk import (
    ELEVATED,
    HIGH,
    INSUFFICIENT,
    MONITORING,
    NORMAL,
    RiskEngine,
    assess,
)
from app.tracking.models import BoundingBox, FeatureSnapshot

T0 = datetime(2026, 9, 28, 10, 0, tzinfo=timezone.utc)
BOX = BoundingBox(0.3, 0.1, 0.3, 0.85)


def _snapshot(i: int, dt: float = 0.2, **overrides) -> FeatureSnapshot:
    hip_x = overrides.get('hip_x', 0.5)
    hip_y = overrides.get('hip_y', 0.5)
    body = {
        'visible': True,
        'lowerBodyVisible': True,
        'gaitAvailable': overrides.get('gait', False),
        'torsoAngle': overrides.get('torso', 1.0),
        'shoulderAlignment': overrides.get('shoulder', 0.5),
        'hipCenter': {'x': hip_x, 'y': hip_y},
        'bodyHeight': overrides.get('body_height', 0.6),
        'ankles': overrides.get('ankles', {'left': None, 'right': None}),
        'keypoints': {'wrists': overrides.get('wrists', {'left': None, 'right': None})},
    }
    face = {
        'visible': overrides.get('face_visible', True),
        'headPose': overrides.get('head', {'pitch': 2.0, 'yaw': 1.0, 'roll': 1.0}),
        'eyes': {'openProbability': overrides.get('eyes', 0.9)},
    }
    return FeatureSnapshot(
        timestamp=T0 + timedelta(seconds=i * dt),
        bounding_box=BOX,
        face=face,
        body=body,
        quality={'score': overrides.get('quality', 0.8)},
    )


def _history(n: int, fn=lambda i: {}, dt: float = 0.2):
    return [_snapshot(i, dt=dt, **fn(i)) for i in range(n)]


def test_steady_person_features_are_low():
    features = TemporalFeatureExtractor(10).compute(_history(50))
    assert features['samples'] == 50
    assert features['windowSeconds'] == 9.8
    assert features['posture']['torsoAngleStd'] == 0.0
    assert features['sway']['hipSwayStd'] == 0.0
    assert features['sway']['walking'] is False
    assert features['head']['jitter'] == 0.0
    assert features['eyes']['closedFraction'] == 0.0
    assert features['gait'] is None  # gait keypoints never available
    assert assess(features).candidate == NORMAL


def test_window_only_uses_recent_samples():
    features = TemporalFeatureExtractor(4).compute(_history(100))
    assert features['samples'] == 21
    assert features['windowSeconds'] == 4.0


def test_unstable_person_features_and_high_candidate():
    def unstable(i):
        return {
            'torso': 12.0 if i % 2 else -12.0,
            'hip_x': 0.5 + (0.05 if i % 2 else -0.05),
            'head': {'pitch': 10.0 if i % 2 else -6.0, 'yaw': 0.0, 'roll': 12.0 if i % 2 else -4.0},
            'eyes': 0.1 if i % 3 == 0 else 0.9,
        }

    features = TemporalFeatureExtractor(10).compute(_history(50, unstable))
    assert features['posture']['torsoAngleStd'] > 10
    assert features['posture']['corrections'] > 20
    assert features['sway']['hipSwayStd'] > 0.07
    assert features['head']['jitter'] > 8
    assert 0.3 < features['eyes']['closedFraction'] < 0.4
    result = assess(features)
    assert result.candidate == HIGH
    assert result.groups['posture'] >= 0.6 and result.groups['sway'] >= 0.6
    assert any('sway' in text.lower() for text in result.evidence)
    assert all('alcohol' not in text.lower() for text in result.evidence)


def test_eye_closure_run_length():
    features = TemporalFeatureExtractor(10).compute(
        _history(30, lambda i: {'eyes': 0.1 if 10 <= i < 25 else 0.9}),
    )
    assert features['eyes']['longestClosureSeconds'] == 2.8
    assert features['eyes']['closedFraction'] == 0.5


def test_single_elevated_group_is_capped_at_monitoring():
    features = TemporalFeatureExtractor(10).compute(
        _history(50, lambda i: {'eyes': 0.05}),
    )
    result = assess(features)
    assert result.groups['eyes'] >= 0.6
    assert result.candidate == MONITORING


def test_low_quality_is_insufficient():
    features = TemporalFeatureExtractor(10).compute(_history(50, lambda i: {'quality': 0.2}))
    result = assess(features)
    assert result.candidate == INSUFFICIENT
    assert 'Low video quality' in result.limitations
    assert result.score is None


def test_too_short_window_is_insufficient():
    features = TemporalFeatureExtractor(10).compute(_history(10))
    assert assess(features).candidate == INSUFFICIENT


def test_occluded_body_and_face_is_insufficient():
    def hidden(i):
        return {'torso': None, 'face_visible': False}

    history = _history(50, hidden)
    for snap in history:
        snap.body['hipCenter'] = None
    result = assess(TemporalFeatureExtractor(10).compute(history))
    assert result.candidate == INSUFFICIENT
    assert 'Too few visible signals' in result.limitations


def _walking(interval_pattern):
    """Walking left-to-right with ankles alternating at the given step intervals (s)."""
    boundaries, acc = [], 0.0
    for interval in interval_pattern:
        acc += interval
        boundaries.append(acc)
    snaps, t = [], 0.0
    while t <= boundaries[-1]:
        steps_taken = sum(1 for b in boundaries if t >= b)
        offset = 0.06 * (1 if steps_taken % 2 == 0 else -1)
        hip_x = 0.1 + 0.12 * t  # 0.2 body heights / s
        snap = _snapshot(0, gait=True, hip_x=hip_x, ankles={
            'left': {'x': hip_x + offset, 'y': 0.9},
            'right': {'x': hip_x - offset, 'y': 0.9},
        })
        snap.timestamp = T0 + timedelta(seconds=t)
        snaps.append(snap)
        t = round(t + 0.1, 3)
    return snaps


def test_regular_gait_has_low_step_variation():
    gait = TemporalFeatureExtractor(10).compute(_walking([0.5] * 12))['gait']
    assert gait['walking'] is True
    assert gait['stepCount'] >= 8
    assert gait['stepIntervalCv'] < 0.1
    assert gait['stepSymmetry'] > 0.9
    assert gait['pathDeviation'] < 0.01


def test_irregular_gait_has_high_step_variation():
    gait = TemporalFeatureExtractor(10).compute(
        _walking([0.3, 0.9, 0.4, 1.0, 0.3, 0.8, 0.5, 1.1, 0.3, 0.9]),
    )['gait']
    assert gait['stepIntervalCv'] > 0.4
    assert gait['stepSymmetry'] < 0.8


def _features(candidate: str):
    """Minimal feature dicts that assess() maps to the requested candidate."""
    base = {
        'samples': 50,
        'windowSeconds': 10.0,
        'quality': {'mean': 0.8, 'faceVisibleFraction': 1.0, 'lowerBodyFraction': 1.0},
        'posture': {'torsoAngleStd': 0.5, 'correctionsPerMinute': 0, 'torsoAngleMeanAbs': 1},
        'sway': {'hipSwayStd': 0.0, 'walking': False},
        'head': {'jitter': 0.5, 'rollMeanAbs': 1, 'pitchStd': 1, 'rollStd': 1},
        'eyes': {'closedFraction': 0.0, 'longestClosureSeconds': 0.0},
    }
    if candidate in (MONITORING, ELEVATED, HIGH):
        base['sway'] = {'hipSwayStd': 0.09, 'walking': False}
    if candidate in (ELEVATED, HIGH):
        base['posture'] = {'torsoAngleStd': 12, 'correctionsPerMinute': 25, 'torsoAngleMeanAbs': 5}
    if candidate == HIGH:
        base['head'] = {'jitter': 9, 'rollMeanAbs': 20, 'pitchStd': 12, 'rollStd': 12}
        base['eyes'] = {'closedFraction': 0.5, 'longestClosureSeconds': 3.0}
    if candidate == INSUFFICIENT:
        base['quality'] = {'mean': 0.1, 'faceVisibleFraction': 0.0, 'lowerBodyFraction': 0.0}
    return base


def test_feature_fixtures_map_to_expected_candidates():
    for level in (NORMAL, MONITORING, ELEVATED, HIGH, INSUFFICIENT):
        assert assess(_features(level)).candidate == level


def _run(engine: RiskEngine, level: str, start: float, seconds: float, step: float = 1.0):
    out = None
    t = start
    while t < start + seconds:
        out = engine.update('Person-1', _features(level), T0 + timedelta(seconds=t))
        t += step
    return out, t


def test_status_requires_persistence_before_escalating():
    engine = RiskEngine()
    out, t = _run(engine, NORMAL, 0, 3)
    assert out['status'] == NORMAL
    # A 5-second burst of elevated evidence only reaches MONITORING.
    out, t = _run(engine, ELEVATED, t, 5)
    assert out['status'] == MONITORING
    assert out['episode'] is None
    out, t = _run(engine, ELEVATED, t, 5)
    assert out['status'] == ELEVATED
    assert out['episode']['active'] is True
    assert out['episode']['peakStatus'] == ELEVATED
    assert out['evidence']


def test_high_then_hysteresis_release_and_episode_end():
    engine = RiskEngine()
    out, t = _run(engine, HIGH, 0, 12)
    assert out['status'] == HIGH
    episode_id = out['episode']['id']
    # Brief return to normal does not drop the status (hysteresis).
    out, t = _run(engine, NORMAL, t, 5)
    assert out['status'] == HIGH
    out, t = _run(engine, NORMAL, t, 5)
    assert out['status'] == NORMAL
    assert out['episode']['id'] == episode_id
    assert out['episode']['active'] is False
    assert out['episode']['peakStatus'] == HIGH
    # A later escalation opens a new episode.
    out, t = _run(engine, HIGH, t, 12)
    assert out['episode']['id'] != episode_id
    assert out['episode']['active'] is True


def test_brief_occlusion_keeps_status_then_abstains():
    engine = RiskEngine()
    out, t = _run(engine, ELEVATED, 0, 10)
    assert out['status'] == ELEVATED
    out, t = _run(engine, INSUFFICIENT, t, 3)
    assert out['status'] == ELEVATED
    assert out['candidate'] == INSUFFICIENT
    out, t = _run(engine, INSUFFICIENT, t, 4)
    assert out['status'] == INSUFFICIENT
    assert out['confidence'] is None
    assert out['episode']['active'] is False


def test_engine_starts_insufficient_and_drops_missing_tracks():
    engine = RiskEngine()
    out = engine.update('Person-1', _features(INSUFFICIENT), T0)
    assert out['status'] == INSUFFICIENT
    assert out['modelVersion'] == 'visual-indicators-rules-v1'
    engine.drop_missing([])
    assert engine._tracks == {}


def test_coordination_needs_arm_motion():
    still = TemporalFeatureExtractor(10).compute(_history(
        30, lambda i: {'wrists': {'left': {'x': 0.4, 'y': 0.5}, 'right': None}},
    ))
    assert still['coordination'] is None
    jerky = TemporalFeatureExtractor(10).compute(_history(
        30,
        lambda i: {
            'wrists': {
                'left': {'x': 0.4 + (0.05 if i % 2 else -0.05), 'y': 0.5 + 0.01 * math.sin(i)},
                'right': None,
            },
        },
    ))
    assert jerky['coordination']['jerkRatio'] > 1.5


def test_walking_toward_camera_is_walking_not_standing_sway():
    # Body grows 0.35 -> 0.7 of frame height over 10 s with normal step-to-step hip oscillation.
    def approach(i):
        t = i * 0.2
        return {
            'body_height': 0.35 * math.exp(0.07 * t),
            'hip_x': 0.5 + 0.012 * math.sin(2 * math.pi * t / 1.1),
            'hip_y': 0.5 + 0.01 * t,
        }

    features = TemporalFeatureExtractor(10).compute(_history(50, approach))
    assert features['sway']['walking'] is True
    assert features['sway']['hipSwayStd'] < 0.02
    assert assess(features).groups['sway'] == 0.0


def test_standing_sway_toward_camera_person_still_counts():
    features = TemporalFeatureExtractor(10).compute(_history(
        50, lambda i: {'hip_x': 0.5 + 0.05 * math.sin(2 * math.pi * i * 0.2 / 3.0)},
    ))
    assert features['sway']['walking'] is False
    assert features['sway']['hipSwayStd'] > 0.03


def test_distant_person_has_no_sway_or_gait_signal():
    features = TemporalFeatureExtractor(10).compute(_history(
        50, lambda i: {'body_height': 0.12, 'hip_x': 0.5 + 0.03 * (-1) ** i},
    ))
    assert features['sway'] is None

