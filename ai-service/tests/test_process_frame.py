from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app import config
from app.main import app
from app.processing.pipeline import FrameProcessingPipeline, drop_session_pipeline
from app.sessions import store
from app.tracking.detector import MockPersonDetector
from app.tracking.state import RollingPersonStateStore
from app.tracking.tracker import IoUPersonTracker


client = TestClient(app)
AUTH = {'Authorization': 'Bearer local-ai-service-token'}


def _jpeg_with_marker(marker: str, size=(160, 160)) -> bytes:
    image = Image.new('RGB', size, (50, 50, 50))
    draw = ImageDraw.Draw(image)
    draw.rectangle((30, 20, 130, 140), fill=(190, 150, 130))
    buffer = io.BytesIO()
    image.save(buffer, format='JPEG', quality=85)
    data = buffer.getvalue()
    comment = marker.encode('ascii')
    length = len(comment) + 2
    com = b'\xff\xfe' + length.to_bytes(2, 'big') + comment
    return data[:2] + com + data[2:]


@pytest.fixture(autouse=True)
def _tracking_mock(monkeypatch):
    monkeypatch.setenv('AI_TRACKING_PROVIDER', 'mock')
    config.settings.ai_tracking_provider = 'mock'
    config.settings.ai_tracking_enabled = True
    config.settings.ai_tracking_max_lost_frames = 3
    config.settings.ai_tracking_window_seconds = 30
    for job_id in list(getattr(store, '_sessions', {}).keys()):
        store.stop(job_id)
    # Clear leftover pipelines
    for job_id in [1, 2, 7, 99]:
        drop_session_pipeline(job_id)
    yield
    for job_id in list(store._sessions.keys()):
        store.stop(job_id)


def _start(job_id: int = 99):
    started = client.post(
        '/sessions/start',
        headers=AUTH,
        json={'jobId': job_id, 'callId': 1, 'divisionId': 2, 'lobbyId': 3},
    )
    assert started.status_code == 200
    # Replace pipeline with mock detector explicitly.
    from app.processing import pipeline as pipeline_mod

    pipeline_mod._pipelines[job_id] = FrameProcessingPipeline(
        detector=MockPersonDetector(),
        tracker=IoUPersonTracker(max_lost_frames=3),
        state=RollingPersonStateStore(window_seconds=30),
    )
    return job_id


def test_process_frame_auth_and_invalid():
    denied = client.post(
        '/sessions/1/process-frame',
        files={'frame': ('f.jpg', _jpeg_with_marker('POC_PERSON:one|'), 'image/jpeg')},
    )
    assert denied.status_code == 401

    job_id = _start(7)
    empty = client.post(
        f'/sessions/{job_id}/process-frame',
        headers=AUTH,
        files={'frame': ('f.jpg', b'', 'image/jpeg')},
    )
    assert empty.status_code in {400, 422}


def test_process_frame_no_person_and_one_person():
    job_id = _start(11)
    none = client.post(
        f'/sessions/{job_id}/process-frame',
        headers=AUTH,
        files={'frame': ('f.jpg', _jpeg_with_marker('POC_PERSON:none|'), 'image/jpeg')},
    )
    assert none.status_code == 200
    body = none.json()
    assert body['personCount'] == 0
    assert body['awsCalls'] == 0
    assert body['limitations']['noContinuousRekognition'] is True

    one = client.post(
        f'/sessions/{job_id}/process-frame',
        headers=AUTH,
        files={'frame': ('f.jpg', _jpeg_with_marker('POC_PERSON:one|'), 'image/jpeg')},
    )
    assert one.status_code == 200
    person = one.json()['persons'][0]
    assert person['trackId'].startswith('Person-')
    assert person['identity']['status'] == 'UNKNOWN'
    assert person['identity']['confidence'] is None
    assert person['impairment']['status'] == 'INSUFFICIENT_EVIDENCE'
    assert person['impairment']['confidence'] is None
    assert person['visualStatus'] == 'INSUFFICIENT_EVIDENCE'
    assert 'alcohol' not in str(person).lower()


def test_process_frame_multiple_and_movement():
    job_id = _start(12)
    two = client.post(
        f'/sessions/{job_id}/process-frame',
        headers=AUTH,
        files={'frame': ('f.jpg', _jpeg_with_marker('POC_PERSON:two|'), 'image/jpeg')},
    )
    assert two.json()['personCount'] == 2

    moved = client.post(
        f'/sessions/{job_id}/process-frame',
        headers=AUTH,
        files={
            'frame': (
                'f.jpg',
                _jpeg_with_marker('POC_PERSON:0.17,0.20,0.25,0.55|POC_PERSON:0.57,0.22,0.25,0.52|'),
                'image/jpeg',
            ),
        },
    )
    assert moved.status_code == 200
    assert moved.json()['personCount'] == 2


def test_frames_endpoint_embeds_tracking():
    job_id = _start(13)
    frame = client.post(
        f'/sessions/{job_id}/frames',
        headers=AUTH,
        content=_jpeg_with_marker('POC_PERSON:one|'),
    )
    assert frame.status_code == 200
    body = frame.json()
    assert 'persons' in body
    status = client.get(f'/sessions/{job_id}/status', headers=AUTH)
    assert status.status_code == 200
    assert status.json().get('personCount', 0) >= 0


def test_bounded_rolling_history():
    from datetime import datetime, timezone

    from app.tracking.models import BoundingBox, TrackedPerson

    state = RollingPersonStateStore(window_seconds=1)
    tracked = TrackedPerson(
        track_id='Person-1',
        bounding_box=BoundingBox(0.3, 0.2, 0.2, 0.5),
        tracking_confidence=0.9,
        first_seen_at=datetime.now(timezone.utc),
        last_seen_at=datetime.now(timezone.utc),
        age_frames=1,
        lost_frames=0,
    )
    for _ in range(5):
        state.upsert(
            tracked,
            face={'visible': False},
            pose={'visible': True, 'lowerBodyVisible': False, 'gaitAvailable': False},
            movement={},
            quality={'score': 0.5},
            identity={'status': 'UNKNOWN', 'confidence': None},
        )
    person = state.get('Person-1')
    assert person is not None
    assert len(person.history) <= 120


def test_capabilities_include_tracking():
    caps = client.get('/capabilities').json()
    assert caps['processing']['personTracking'] is True
    assert caps['tracking']['continuousRekognition'] is False
    assert caps['tracking']['impairmentClassifier'] is False
