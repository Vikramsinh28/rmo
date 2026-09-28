from __future__ import annotations

import io
import os

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.impairment.factory import get_impairment_detector
from app.impairment.local import LocalImpairmentDetector
from app.impairment.mock import MockImpairmentDetector
from app.impairment.preprocess import validate_and_decode
from app.main import app


client = TestClient(app)
AUTH = {'Authorization': 'Bearer local-ai-service-token'}


def _jpeg_bytes(width: int = 64, height: int = 64, marker: str | None = None) -> bytes:
    image = Image.new('RGB', (width, height), color=(90, 100, 110))
    buffer = io.BytesIO()
    image.save(buffer, format='JPEG', quality=85)
    data = buffer.getvalue()
    if not marker:
        return data
    comment = f'POC_IMPAIRMENT:{marker}|'.encode('ascii')
    length = len(comment) + 2
    com = b'\xff\xfe' + length.to_bytes(2, 'big') + comment
    return data[:2] + com + data[2:]


def _png_bytes(width: int = 64, height: int = 64) -> bytes:
    image = Image.new('RGB', (width, height), color=(40, 50, 60))
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    return buffer.getvalue()


@pytest.fixture(autouse=True)
def _reset_env(monkeypatch):
    monkeypatch.setenv('IMPAIRMENT_DETECTOR_PROVIDER', 'mock')
    monkeypatch.delenv('MOCK_IMPAIRMENT_RESULT', raising=False)
    # Reload settings used by factory via env on Settings — recreate by patching settings fields.
    from app import config
    config.settings.impairment_detector_provider = 'mock'
    config.settings.mock_impairment_result = None
    config.settings.impairment_model_path = None
    config.settings.impairment_model_device = 'cpu'
    yield
    monkeypatch.delenv('MOCK_IMPAIRMENT_RESULT', raising=False)


def test_capabilities_expose_impairment_poc():
    caps = client.get('/capabilities')
    assert caps.status_code == 200
    body = caps.json()
    assert body['processing']['impairmentDetection'] is True
    assert body['processing']['faceIdentification'] is False
    assert body['impairmentPoc']['pocOnly'] is True
    assert body['impairmentPoc']['productionReady'] is False
    assert body['impairmentPoc']['provider'] == 'mock'


def test_analyze_requires_auth():
    denied = client.post(
        '/impairment/analyze',
        files={'frame': ('frame.jpg', _jpeg_bytes(), 'image/jpeg')},
    )
    assert denied.status_code == 401


def test_valid_clear_image():
    response = client.post(
        '/impairment/analyze',
        headers=AUTH,
        files={'frame': ('clear.jpg', _jpeg_bytes(), 'image/jpeg')},
    )
    assert response.status_code == 200
    body = response.json()
    assert body['success'] is True
    assert body['provider'] == 'mock'
    assert body['developmentOnly'] is True
    assert body['analysis']['status'] == 'NO_CLEAR_INDICATOR'
    assert body['analysis']['riskLevel'] == 'LOW'
    assert body['limitations']['doesNotConfirmAlcoholConsumption'] is True
    assert 'image' not in body
    assert 'raw' not in body
    dumped = str(body).lower()
    assert 'aws' not in dumped
    assert 'secret' not in dumped
    assert 'intoxicated' not in dumped
    assert 'alcohol detected' not in dumped


def test_mock_potential_impairment_marker():
    response = client.post(
        '/impairment/analyze',
        headers=AUTH,
        files={'frame': ('mock_potential.jpg', _jpeg_bytes(marker='potential'), 'image/jpeg')},
    )
    assert response.status_code == 200
    analysis = response.json()['analysis']
    assert analysis['status'] == 'POTENTIAL_IMPAIRMENT'
    assert analysis['riskLevel'] == 'MEDIUM'
    assert analysis['requiresHumanReview'] is True
    assert analysis['confidence'] == 0.78
    assert len(analysis['indicators']) >= 1


def test_mock_no_person_and_low_quality():
    no_person = client.post(
        '/impairment/analyze',
        headers=AUTH,
        files={'frame': ('no_person.jpg', _jpeg_bytes(marker='no_person'), 'image/jpeg')},
    )
    assert no_person.json()['analysis']['status'] == 'NO_PERSON_DETECTED'

    low = client.post(
        '/impairment/analyze',
        headers=AUTH,
        files={'frame': ('low_quality.jpg', _jpeg_bytes(marker='low_quality'), 'image/jpeg')},
    )
    assert low.json()['analysis']['status'] == 'INSUFFICIENT_QUALITY'


def test_env_override_mock_result(monkeypatch):
    monkeypatch.setenv('MOCK_IMPAIRMENT_RESULT', 'potential')
    response = client.post(
        '/impairment/analyze',
        headers=AUTH,
        files={'frame': ('any.jpg', _jpeg_bytes(), 'image/jpeg')},
    )
    assert response.json()['analysis']['status'] == 'POTENTIAL_IMPAIRMENT'


def test_invalid_empty_and_oversized(monkeypatch):
    empty = client.post(
        '/impairment/analyze',
        headers=AUTH,
        files={'frame': ('empty.jpg', b'', 'image/jpeg')},
    )
    assert empty.status_code == 400

    invalid = client.post(
        '/impairment/analyze',
        headers=AUTH,
        files={'frame': ('bad.bin', b'not-an-image', 'image/jpeg')},
    )
    assert invalid.status_code == 400

    from app import config
    config.settings.impairment_max_frame_bytes = 100
    huge = client.post(
        '/impairment/analyze',
        headers=AUTH,
        files={'frame': ('big.jpg', _jpeg_bytes(width=200, height=200), 'image/jpeg')},
    )
    assert huge.status_code == 413
    config.settings.impairment_max_frame_bytes = 2_000_000


def test_png_supported():
    response = client.post(
        '/impairment/analyze',
        headers=AUTH,
        files={'frame': ('frame.png', _png_bytes(), 'image/png')},
    )
    assert response.status_code == 200
    assert response.json()['success'] is True


def test_provider_selection_local_unavailable(monkeypatch):
    from app import config
    config.settings.impairment_detector_provider = 'local-model'
    detector = get_impairment_detector()
    assert isinstance(detector, LocalImpairmentDetector)

    response = client.post(
        '/impairment/analyze',
        headers=AUTH,
        files={'frame': ('frame.jpg', _jpeg_bytes(), 'image/jpeg')},
    )
    assert response.status_code == 200
    body = response.json()
    assert body['provider'] == 'local-model'
    assert body['analysis']['status'] == 'ANALYSIS_UNAVAILABLE'
    assert body['analysis']['confidence'] is None


def test_preprocess_rejects_tiny_image():
    with pytest.raises(Exception):
        validate_and_decode(_jpeg_bytes(width=8, height=8))


def test_mock_detector_unit():
    detector = MockImpairmentDetector()
    frame = validate_and_decode(_jpeg_bytes(marker='clear'))
    result = detector.analyze(frame)
    assert result.status.value == 'NO_CLEAR_INDICATOR'


def test_response_has_no_persisted_path_fields():
    body = client.post(
        '/impairment/analyze',
        headers=AUTH,
        files={'frame': ('frame.jpg', _jpeg_bytes(), 'image/jpeg')},
    ).json()
    blob = str(body)
    assert 'uploads' not in blob
    assert 'public/' not in blob
    assert '/tmp' not in blob


def _pattern_jpeg(kind: str = 'gradient') -> bytes:
    from PIL import ImageDraw

    image = Image.new('RGB', (96, 96), color=(0, 0, 0))
    draw = ImageDraw.Draw(image)
    if kind == 'gradient':
        for x in range(96):
            shade = int(40 + (180 * x / 95))
            draw.line([(x, 0), (x, 96)], fill=(shade, shade // 2, 120))
        draw.ellipse((24, 24, 72, 72), fill=(180, 140, 120))
    elif kind == 'dark':
        draw.rectangle((0, 0, 96, 96), fill=(8, 8, 10))
    elif kind == 'flat':
        draw.rectangle((0, 0, 96, 96), fill=(120, 120, 120))
    buffer = io.BytesIO()
    image.save(buffer, format='JPEG', quality=85)
    return buffer.getvalue()


def test_provider_selection_candidate_unavailable_without_model():
    from app import config
    from app.impairment.candidate import CandidateImpairmentDetector

    config.settings.impairment_detector_provider = 'candidate-model'
    config.settings.impairment_model_path = None
    detector = get_impairment_detector()
    assert isinstance(detector, CandidateImpairmentDetector)

    response = client.post(
        '/impairment/analyze',
        headers=AUTH,
        files={'frame': ('signal.jpg', _pattern_jpeg('gradient'), 'image/jpeg')},
    )
    assert response.status_code == 200
    body = response.json()
    assert body['provider'] == 'candidate-model'
    assert body['developmentOnly'] is True
    assert body['analysis']['status'] == 'ANALYSIS_UNAVAILABLE'
    assert body['analysis']['confidence'] is None
    assert body['analysis']['requiresHumanReview'] is False
    blob = str(body).lower()
    assert 'alcohol detected' not in blob
    assert 'intoxicated' not in blob
    assert 'secret' not in blob


def test_candidate_quality_and_no_person_gates():
    from app import config

    config.settings.impairment_detector_provider = 'candidate-model'
    dark = client.post(
        '/impairment/analyze',
        headers=AUTH,
        files={'frame': ('dark.jpg', _pattern_jpeg('dark'), 'image/jpeg')},
    )
    assert dark.json()['analysis']['status'] == 'INSUFFICIENT_QUALITY'
    assert dark.json()['analysis']['confidence'] is None

    flat = client.post(
        '/impairment/analyze',
        headers=AUTH,
        files={'frame': ('flat.jpg', _pattern_jpeg('flat'), 'image/jpeg')},
    )
    assert flat.json()['analysis']['status'] == 'NO_PERSON_DETECTED'


def test_candidate_refuses_unverified_model_path():
    from app import config
    from app.impairment.candidate import CandidateImpairmentDetector

    config.settings.impairment_model_path = '/tmp/not-a-real-model.pt'
    detector = CandidateImpairmentDetector()
    assert detector.model_loaded is False
    frame = validate_and_decode(_pattern_jpeg('gradient'))
    result = detector.analyze(frame)
    assert result.status.value == 'ANALYSIS_UNAVAILABLE'
    assert result.confidence is None


def test_benchmark_runner_smoke():
    from evaluation.run_impairment_benchmark import run_benchmark

    report = run_benchmark(provider_override='candidate-model')
    assert report['provider'] == 'candidate-model'
    assert report['sampleCount'] >= 5
    assert report['classificationMetrics'] is None
    assert report['dataset']['containsImpairmentGroundTruth'] is False
    assert report['limitations']['doesNotConfirmAlcoholConsumption'] is True
    assert report['averageLatencyMs'] is not None
    assert 'secret' not in str(report).lower()


def test_mock_provider_remains_functional_after_9b():
    from app import config

    config.settings.impairment_detector_provider = 'mock'
    response = client.post(
        '/impairment/analyze',
        headers=AUTH,
        files={'frame': ('clear.jpg', _jpeg_bytes(marker='clear'), 'image/jpeg')},
    )
    assert response.status_code == 200
    assert response.json()['provider'] == 'mock'
    assert response.json()['analysis']['status'] == 'NO_CLEAR_INDICATOR'
