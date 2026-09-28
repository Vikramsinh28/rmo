from __future__ import annotations

from app.config import settings
from app.impairment.base import ImpairmentDetector
from app.impairment.candidate import CandidateImpairmentDetector
from app.impairment.local import LocalImpairmentDetector
from app.impairment.mock import MockImpairmentDetector


def get_impairment_detector() -> ImpairmentDetector:
    provider = (settings.impairment_detector_provider or 'mock').strip().lower()
    if provider in {'candidate', 'candidate-model'}:
        return CandidateImpairmentDetector()
    if provider in {'local', 'local-model'}:
        return LocalImpairmentDetector()
    return MockImpairmentDetector()


def impairment_capability_payload() -> dict:
    detector = get_impairment_detector()
    is_mock = detector.provider_name == 'mock'
    is_candidate = detector.provider_name == 'candidate-model'
    # Mock can emit deterministic POC statuses; candidate/local do not claim impairment.
    available = is_mock
    if is_mock:
        mode = 'poc_mock'
        note_extra = 'Mock detector active (development only).'
    elif is_candidate:
        mode = 'candidate_probe'
        note_extra = (
            'Candidate technical probe only. No validated impairment/alcohol model. '
            'Analysis returns ANALYSIS_UNAVAILABLE unless quality/no-person gates fire.'
        )
    else:
        mode = 'unavailable'
        note_extra = 'No validated model configured.'

    return {
        'enabled': True if available else False,
        'pocOnly': True,
        'productionReady': False,
        'provider': detector.provider_name,
        'developmentOnly': detector.development_only,
        'mode': mode,
        'phase': '9B' if is_candidate else '9A',
        'note': (
            'Potential impairment indicators only; '
            'does not confirm alcohol consumption or intoxication. '
            + note_extra
        ),
    }
