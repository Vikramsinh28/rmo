from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np

from app.processing.pipeline import LYING_DOWN, NOT_ASSESSED, FrameProcessingPipeline
from app.processing.subject import SubjectSelector
from app.temporal.drowsiness import AWAKE, DROWSY, INSUFFICIENT, DrowsinessMonitor
from app.temporal.features import TemporalFeatureExtractor
from app.temporal.risk import INSUFFICIENT as RISK_INSUFFICIENT
from app.temporal.risk import assess
from app.tracking.models import BoundingBox, Detection, FeatureSnapshot, TrackedPerson

T0 = datetime(2026, 9, 28, 10, 0, tzinfo=timezone.utc)
BOX = BoundingBox(0.3, 0.1, 0.3, 0.85)


def _snapshot(i: int, dt: float = 0.5, eyes: float = 0.9, torso: float = 1.0,
              face_visible: bool = True, head_rise=None, head_x: float = 0.5,
              box_aspect: float = 0.6) -> FeatureSnapshot:
    head = {}
    if head_rise is not None:
        head = {
            'headRise': head_rise,
            'headTilt': None,
            'headPoint': {'x': head_x, 'y': 0.3},
            'shoulderWidth': 0.18,
        }
    return FeatureSnapshot(
        timestamp=T0 + timedelta(seconds=i * dt),
        bounding_box=BOX,
        face={
            'visible': face_visible,
            'headPose': {'pitch': 2.0, 'yaw': 1.0, 'roll': 1.0},
            'eyes': {'openProbability': eyes},
        },
        body={
            'visible': True,
            'lowerBodyVisible': True,
            'torsoAngle': torso,
            'shoulderAlignment': 0.5,
            'hipCenter': {'x': 0.5, 'y': 0.5},
            'bodyHeight': 0.6,
            'ankles': {'left': None, 'right': None},
            'keypoints': {'wrists': {'left': None, 'right': None}},
            'boxAspect': box_aspect,
            **head,
        },
        quality={'score': 0.8},
    )


def _person(track_id: str, box: BoundingBox) -> TrackedPerson:
    return TrackedPerson(track_id, box, 0.9, T0, T0, 10, 0)


# --- Subject selection -------------------------------------------------------------------

def test_largest_central_person_is_subject():
    selector = SubjectSelector()
    crew = _person('p1', BoundingBox(0.3, 0.2, 0.45, 0.8))
    bystander = _person('p4', BoundingBox(0.0, 0.6, 0.25, 0.3))
    assert selector.select([bystander, crew], ['p1', 'p4'], T0) == 'p1'


def test_subject_is_sticky_until_challenger_dominates_for_seconds():
    selector = SubjectSelector()
    small = BoundingBox(0.35, 0.3, 0.2, 0.4)
    big = BoundingBox(0.3, 0.1, 0.4, 0.85)
    assert selector.select([_person('a', small)], ['a'], T0) == 'a'
    # A much larger person appears: not switched immediately.
    for second in range(3):
        now = T0 + timedelta(seconds=second)
        assert selector.select([_person('a', small), _person('b', big)], ['a', 'b'], now) == 'a'
    now = T0 + timedelta(seconds=3.1)
    assert selector.select([_person('a', small), _person('b', big)], ['a', 'b'], now) == 'b'


def test_brief_dropout_keeps_subject():
    selector = SubjectSelector()
    crew = BoundingBox(0.3, 0.1, 0.4, 0.85)
    other = BoundingBox(0.0, 0.6, 0.2, 0.3)
    assert selector.select([_person('a', crew), _person('b', other)], ['a', 'b'], T0) == 'a'
    # Subject not detected this frame but still tracked.
    assert selector.select([_person('b', other)], ['a', 'b'], T0 + timedelta(seconds=1)) == 'a'
    # Subject gone from the tracker: the remaining person takes over.
    assert selector.select([_person('b', other)], ['b'], T0 + timedelta(seconds=2)) == 'b'


# --- Lying down --------------------------------------------------------------------------

def test_lying_person_is_a_notice_not_an_impairment_score():
    history = [_snapshot(i, dt=0.2, torso=85.0) for i in range(50)]
    features = TemporalFeatureExtractor(10).compute(history)
    assert features['lying']['lyingDown'] is True
    result = assess(features)
    assert result.candidate == RISK_INSUFFICIENT
    assert any('lying down' in item for item in result.limitations)


def test_leaning_seated_person_is_not_lying():
    history = [_snapshot(i, dt=0.2, torso=35.0) for i in range(50)]
    assert TemporalFeatureExtractor(10).compute(history)['lying']['lyingDown'] is False


def test_foreshortened_lying_person_counts_when_box_is_wide():
    # Camera looking down at a bed: torso reads ~49°, but the body box is wider than tall.
    wide = [_snapshot(i, dt=0.2, torso=49.0, box_aspect=1.2) for i in range(50)]
    tall = [_snapshot(i, dt=0.2, torso=49.0, box_aspect=0.7) for i in range(50)]
    assert TemporalFeatureExtractor(10).compute(wide)['lying']['lyingDown'] is True
    assert TemporalFeatureExtractor(10).compute(tall)['lying']['lyingDown'] is False


# --- Drowsiness --------------------------------------------------------------------------

def _run(monitor: DrowsinessMonitor, eyes_at, seconds: float, dt: float = 0.5, **kwargs):
    history = []
    result = None
    for i in range(int(seconds / dt) + 1):
        history.append(_snapshot(i, dt=dt, eyes=eyes_at(i * dt), **kwargs))
        result = monitor.update('p1', history, history[-1].timestamp)
    return result


def test_eyes_closed_for_most_of_twenty_seconds_is_possible_drowsiness():
    result = _run(DrowsinessMonitor(), lambda t: 0.1, 20)
    assert result['status'] == DROWSY
    episode = result['episode']
    assert episode['kind'] == 'DROWSINESS'
    assert episode['peakStatus'] == 'ELEVATED_INDICATORS'
    assert episode['active'] is True
    assert 'Eyes closed' in episode['evidence'][0]


def test_needs_twelve_seconds_of_visible_eyes_before_judging():
    result = _run(DrowsinessMonitor(), lambda t: 0.1, 10)
    assert result['status'] == INSUFFICIENT
    assert result['episode'] is None


def test_normal_blinking_is_awake():
    result = _run(DrowsinessMonitor(), lambda t: 0.1 if int(t * 2) % 8 == 0 else 0.9, 30)
    assert result['status'] == AWAKE
    assert result['episode'] is None


def test_looking_down_briefly_is_not_drowsiness():
    # Eyes read as closed for 8 s (e.g. reading a form), then open again.
    result = _run(DrowsinessMonitor(), lambda t: 0.1 if 5 <= t < 13 else 0.9, 25)
    assert result['status'] == AWAKE


def test_drowsiness_releases_after_eyes_reopen_and_episode_ends():
    monitor = DrowsinessMonitor()
    result = _run(monitor, lambda t: 0.1 if t < 25 else 0.95, 60)
    assert result['status'] == AWAKE
    assert result['episode']['active'] is False
    assert result['episode']['endedAt'] is not None


def test_face_hidden_is_insufficient_not_awake():
    result = _run(DrowsinessMonitor(), lambda t: 0.1, 25, face_visible=False)
    assert result['status'] == INSUFFICIENT


def test_still_slumped_head_with_face_hidden_is_possible_drowsiness():
    # Head resting against the wall at shoulder height, face turned away (as in the live test).
    result = _run(DrowsinessMonitor(), lambda t: 0.9, 20, face_visible=False, head_rise=0.1)
    assert result['status'] == DROWSY
    assert result['headStill'] is True
    assert 'Head slumped' in result['episode']['evidence'][0]


def test_upright_head_is_awake():
    result = _run(DrowsinessMonitor(), lambda t: 0.9, 25, face_visible=False, head_rise=0.6)
    assert result['status'] == AWAKE


def test_low_head_while_moving_is_not_drowsiness():
    # Head low but moving around (e.g. searching a bag): not still, so no alert.
    monitor = DrowsinessMonitor()
    history = []
    result = None
    for i in range(50):
        history.append(_snapshot(
            i, face_visible=False, head_rise=0.1, head_x=0.3 if i % 2 else 0.7,
        ))
        result = monitor.update('p1', history, history[-1].timestamp)
    assert result['status'] == AWAKE
    assert result['headStill'] is False


# --- Pipeline ----------------------------------------------------------------------------

class _FixedDetector:
    provider_name = 'fixed'

    def __init__(self, boxes):
        self.boxes = boxes

    def detect(self, frame):
        return [Detection(f'c{i}', box, 0.9) for i, box in enumerate(self.boxes)]


class _CountingFace:
    provider_name = 'counting'

    def __init__(self):
        self.calls = 0

    def extract(self, frame, box, keypoints=None):
        self.calls += 1
        return {
            'visible': True,
            'quality': 0.8,
            'boundingBox': None,
            'headPose': {'pitch': 1.0, 'yaw': 1.0, 'roll': 1.0},
            'eyes': {'available': True, 'openProbability': 0.9},
            'mouth': {'available': False, 'openProbability': None},
            'landmarkAvailability': True,
            'signalsAvailable': ['faceVisible'],
        }

    def close(self):
        return None


def test_pipeline_assesses_only_the_subject_and_skips_face_mesh_for_others():
    from app.tracking.tracker import IoUPersonTracker

    crew = BoundingBox(0.3, 0.15, 0.45, 0.8)
    bystander = BoundingBox(0.0, 0.65, 0.22, 0.3)
    face = _CountingFace()
    pipeline = FrameProcessingPipeline(
        detector=_FixedDetector([crew, bystander]),
        tracker=IoUPersonTracker(),
        face_extractor=face,
    )
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    result = None
    for i in range(10):
        result = pipeline.process('s1', frame, timestamp=T0 + timedelta(seconds=i * 0.2))
    persons = {p['role']: p for p in result['persons']}
    assert set(persons) == {'subject', 'other'}
    assert result['subjectTrackId'] == persons['subject']['trackId']
    assert persons['other']['visualStatus'] == NOT_ASSESSED
    assert persons['other']['drowsiness'] is None
    assert persons['other']['face']['visible'] is False
    assert persons['subject']['visualStatus'] != NOT_ASSESSED
    assert persons['subject']['drowsiness'] is not None
    assert face.calls == 10  # one face-mesh call per frame, subject only
    assert LYING_DOWN not in persons['subject']['notices']
