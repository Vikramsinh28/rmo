from __future__ import annotations

import os

from app.impairment.base import ImpairmentDetector
from app.impairment.preprocess import PreprocessedFrame
from app.impairment.types import ImpairmentAnalysisResult, ImpairmentStatus, RiskLevel


class MockImpairmentDetector(ImpairmentDetector):
    """
    Deterministic DEVELOPMENT-ONLY detector.

    Resolves fixtures via:
      1. MOCK_IMPAIRMENT_RESULT env (potential|clear|no_person|low_quality|unavailable)
      2. Embedded marker in image bytes: POC_IMPAIRMENT:<key>|
      3. Default: NO_CLEAR_INDICATOR

    This is NOT an alcohol detector.
    """

    provider_name = 'mock'
    development_only = True

    def analyze(self, frame: PreprocessedFrame) -> ImpairmentAnalysisResult:
        key = self._resolve_key(frame)
        if key == 'potential':
            return ImpairmentAnalysisResult(
                status=ImpairmentStatus.POTENTIAL_IMPAIRMENT,
                risk_level=RiskLevel.MEDIUM,
                confidence=0.78,
                indicators=[
                    'possible reduced eye openness (mock fixture)',
                    'possible unusual head pose (mock fixture)',
                ],
                requires_human_review=True,
            )
        if key == 'no_person':
            return ImpairmentAnalysisResult(
                status=ImpairmentStatus.NO_PERSON_DETECTED,
                risk_level=RiskLevel.UNKNOWN,
                confidence=None,
                indicators=['no person visible in frame (mock fixture)'],
                requires_human_review=False,
            )
        if key == 'low_quality':
            return ImpairmentAnalysisResult(
                status=ImpairmentStatus.INSUFFICIENT_QUALITY,
                risk_level=RiskLevel.UNKNOWN,
                confidence=None,
                indicators=['image quality insufficient for analysis (mock fixture)'],
                requires_human_review=False,
            )
        if key == 'unavailable':
            return ImpairmentAnalysisResult(
                status=ImpairmentStatus.ANALYSIS_UNAVAILABLE,
                risk_level=RiskLevel.UNKNOWN,
                confidence=None,
                indicators=['mock detector forced unavailable'],
                requires_human_review=False,
            )
        return ImpairmentAnalysisResult(
            status=ImpairmentStatus.NO_CLEAR_INDICATOR,
            risk_level=RiskLevel.LOW,
            confidence=None,
            indicators=[],
            requires_human_review=False,
        )

    def _resolve_key(self, frame: PreprocessedFrame) -> str:
        env_key = (os.environ.get('MOCK_IMPAIRMENT_RESULT') or '').strip().lower()
        if env_key in {'potential', 'clear', 'no_person', 'low_quality', 'unavailable'}:
            return env_key
        text = frame.image_bytes.decode('latin1', errors='ignore')
        for key in ('potential', 'no_person', 'low_quality', 'unavailable', 'clear'):
            if f'POC_IMPAIRMENT:{key}|' in text:
                return key
        return 'clear'
