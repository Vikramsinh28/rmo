from __future__ import annotations

from app.impairment.base import ImpairmentDetector
from app.impairment.preprocess import PreprocessedFrame
from app.impairment.types import ImpairmentAnalysisResult, ImpairmentStatus, RiskLevel


class LocalImpairmentDetector(ImpairmentDetector):
    """
    Placeholder for a future validated local model.

    No pretrained impairment/alcohol model is shipped in this repository.
    Returning ANALYSIS_UNAVAILABLE avoids inventing scientific results.
    """

    provider_name = 'local-model'
    development_only = True

    def analyze(self, frame: PreprocessedFrame) -> ImpairmentAnalysisResult:
        _ = frame  # frame accepted; no model weights available
        return ImpairmentAnalysisResult(
            status=ImpairmentStatus.ANALYSIS_UNAVAILABLE,
            risk_level=RiskLevel.UNKNOWN,
            confidence=None,
            indicators=[
                'No validated local impairment model is configured. '
                'This POC does not invent medical or alcohol-consumption scores.',
            ],
            requires_human_review=False,
        )
