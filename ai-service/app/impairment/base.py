from __future__ import annotations

from abc import ABC, abstractmethod

from app.impairment.preprocess import PreprocessedFrame
from app.impairment.types import ImpairmentAnalysisResult


class ImpairmentDetector(ABC):
    """Pluggable impairment detector. Implementations must not claim alcohol confirmation."""

    provider_name: str = 'unknown'
    development_only: bool = True

    @abstractmethod
    def analyze(self, frame: PreprocessedFrame) -> ImpairmentAnalysisResult:
        raise NotImplementedError
