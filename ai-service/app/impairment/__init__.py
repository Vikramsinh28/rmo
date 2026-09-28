"""Phase 9A — potential impairment detection POC (pluggable detectors)."""

from app.impairment.factory import get_impairment_detector
from app.impairment.types import ImpairmentAnalysisResult

__all__ = ['get_impairment_detector', 'ImpairmentAnalysisResult']

