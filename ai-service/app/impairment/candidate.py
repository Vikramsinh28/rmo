from __future__ import annotations

import statistics
from typing import Optional, Tuple

from PIL import ImageStat

from app.config import settings
from app.impairment.base import ImpairmentDetector
from app.impairment.preprocess import PreprocessedFrame
from app.impairment.types import ImpairmentAnalysisResult, ImpairmentStatus, RiskLevel


class CandidateImpairmentDetector(ImpairmentDetector):
    """
    Phase 9B candidate adapter.

    Runs lightweight technical probes (image quality / signal richness) using
    Pillow only. It does NOT claim alcohol consumption or intoxication.

    Without a validated impairment model at IMPAIRMENT_MODEL_PATH, the
    analysis status is ANALYSIS_UNAVAILABLE (or quality/no-person gates).
    Confidence is always null — we do not invent scores.
    """

    provider_name = 'candidate-model'
    development_only = True

    def __init__(self) -> None:
        self.device = (settings.impairment_model_device or 'cpu').strip().lower()
        self.timeout_ms = max(int(settings.impairment_model_timeout_ms or 5000), 1)
        self.model_path = (settings.impairment_model_path or '').strip() or None
        self.model_loaded = False
        self.model_load_error: Optional[str] = None
        self._attempt_model_load()

    def _attempt_model_load(self) -> None:
        if not self.model_path:
            self.model_load_error = 'IMPAIRMENT_MODEL_PATH is not configured'
            return
        # No validated impairment weights are shipped in this repository.
        # Refusing to load arbitrary files prevents unsafe "pretend model" behavior.
        self.model_loaded = False
        self.model_load_error = (
            'No validated impairment model is bundled. '
            f'Path configured ({self.model_path}) but loading unverified weights is disabled.'
        )

    def analyze(self, frame: PreprocessedFrame) -> ImpairmentAnalysisResult:
        quality, person_signal, indicators = self._technical_probe(frame)

        if quality == 'insufficient':
            return ImpairmentAnalysisResult(
                status=ImpairmentStatus.INSUFFICIENT_QUALITY,
                risk_level=RiskLevel.UNKNOWN,
                confidence=None,
                indicators=indicators,
                requires_human_review=False,
            )

        if person_signal == 'absent':
            return ImpairmentAnalysisResult(
                status=ImpairmentStatus.NO_PERSON_DETECTED,
                risk_level=RiskLevel.UNKNOWN,
                confidence=None,
                indicators=indicators + [
                    'technical probe: low spatial signal (possible empty / uniform frame)',
                ],
                requires_human_review=False,
            )

        # Validated impairment inference is not available.
        note = self.model_load_error or 'No validated impairment model configured'
        return ImpairmentAnalysisResult(
            status=ImpairmentStatus.ANALYSIS_UNAVAILABLE,
            risk_level=RiskLevel.UNKNOWN,
            confidence=None,
            indicators=indicators + [
                note,
                'Candidate probe measures image/technical readiness only; '
                'it is not an alcohol or intoxication detector.',
            ],
            requires_human_review=False,
        )

    def _technical_probe(
        self,
        frame: PreprocessedFrame,
    ) -> Tuple[str, str, list[str]]:
        """Pillow-only quality / signal probes. Not biometric identity analysis."""
        from io import BytesIO

        from PIL import Image

        indicators: list[str] = [
            f'technical_probe:device={self.device}',
            f'technical_probe:size={frame.width}x{frame.height}',
        ]
        with Image.open(BytesIO(frame.image_bytes)) as image:
            rgb = image.convert('RGB')
            stat = ImageStat.Stat(rgb)
            mean_luma = sum(stat.mean) / 3.0
            # Approximate contrast via channel stdev average.
            contrast = sum(stat.stddev) / 3.0 if stat.stddev else 0.0
            extrema = rgb.getextrema()
            # extrema is ((rmin,rmax),(gmin,gmax),(bmin,bmax))
            dynamic = max(ch[1] - ch[0] for ch in extrema)

        indicators.append(f'technical_probe:mean_luma={mean_luma:.1f}')
        indicators.append(f'technical_probe:contrast={contrast:.1f}')

        # Mid-tone but nearly flat → treat as no-person technical case first.
        if 30 <= mean_luma <= 220 and contrast < 14 and dynamic < 25:
            return 'ok', 'absent', indicators

        if mean_luma < 18 or mean_luma > 245 or contrast < 8 or dynamic < 12:
            return 'insufficient', 'unknown', indicators + [
                'technical probe: insufficient lighting/contrast for reliable analysis',
            ]

        return 'ok', 'present', indicators
