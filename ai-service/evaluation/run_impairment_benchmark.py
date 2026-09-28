from __future__ import annotations

import argparse
import json
import resource
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from app.config import settings
from app.impairment.factory import get_impairment_detector
from app.impairment.preprocess import validate_and_decode
from evaluation.dataset import RESULTS_DIR, dataset_disclaimer, ensure_dirs, load_samples
from evaluation.environment import detect_environment
from evaluation.metrics import compute_classification_metrics, summarize_latencies


def _rss_mb() -> float:
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # macOS reports bytes; Linux reports kilobytes.
    if usage > 10_000_000:
        return round(usage / (1024 * 1024), 2)
    return round(usage / 1024, 2)


def run_benchmark(provider_override: str | None = None) -> Dict[str, Any]:
    ensure_dirs()
    if provider_override:
        settings.impairment_detector_provider = provider_override

    detector = get_impairment_detector()
    samples = load_samples()
    rows: List[dict] = []
    latencies: List[float] = []
    failures = 0
    quality_failures = 0
    y_true: List[str] = []
    y_pred: List[str] = []

    started = datetime.now(timezone.utc).isoformat()
    rss_before = _rss_mb()

    for sample in samples:
        raw = sample.path.read_bytes()
        t0 = time.perf_counter()
        try:
            frame = validate_and_decode(raw)
            preprocess_ms = (time.perf_counter() - t0) * 1000
            t1 = time.perf_counter()
            result = detector.analyze(frame)
            inference_ms = (time.perf_counter() - t1) * 1000
            total_ms = (time.perf_counter() - t0) * 1000
            status = result.status.value
            if status == 'INSUFFICIENT_QUALITY':
                quality_failures += 1
            row = {
                'sampleId': sample.sample_id,
                'status': status,
                'riskLevel': result.risk_level.value,
                'confidence': result.confidence,
                'requiresHumanReview': result.requires_human_review,
                'indicatorCount': len(result.indicators),
                'preprocessLatencyMs': round(preprocess_ms, 3),
                'inferenceLatencyMs': round(inference_ms, 3),
                'totalLatencyMs': round(total_ms, 3),
                'expectedStatus': sample.expected_status,
                'scenario': sample.scenario,
            }
            latencies.append(total_ms)
            if sample.expected_status:
                y_true.append(sample.expected_status)
                y_pred.append(status)
        except Exception as exc:  # noqa: BLE001
            failures += 1
            row = {
                'sampleId': sample.sample_id,
                'status': 'FAILURE',
                'error': type(exc).__name__,
                'expectedStatus': sample.expected_status,
                'scenario': sample.scenario,
            }
        rows.append(row)
        # Discard frame bytes promptly.
        del raw

    rss_after = _rss_mb()
    latency_summary = summarize_latencies(latencies)
    classification = None
    technical_matches = 0
    technical_total = 0
    disclaimer = dataset_disclaimer()
    if disclaimer.get('containsImpairmentGroundTruth'):
        classification = compute_classification_metrics(
            y_true,
            y_pred,
            positive='POTENTIAL_IMPAIRMENT',
        )
    else:
        # Technical expectedStatus matching is reported separately — not clinical accuracy.
        technical_matches = sum(
            1 for r in rows
            if r.get('expectedStatus') and r.get('status') == r.get('expectedStatus')
        )
        technical_total = sum(1 for r in rows if r.get('expectedStatus'))

    report: Dict[str, Any] = {
        'model': detector.provider_name,
        'provider': detector.provider_name,
        'developmentOnly': detector.development_only,
        'timestamp': started,
        'completedAt': datetime.now(timezone.utc).isoformat(),
        'sampleCount': len(samples),
        'failures': failures,
        'qualityFailures': quality_failures,
        'imagesPerSecond': (
            round(len(latencies) / (sum(latencies) / 1000.0), 3) if latencies else None
        ),
        **latency_summary,
        'memory': {
            'rssBeforeMb': rss_before,
            'rssAfterMb': rss_after,
            'rssDeltaMb': round(rss_after - rss_before, 2),
        },
        'environment': detect_environment(),
        'dataset': disclaimer,
        'classificationMetrics': classification,
        'technicalExpectationMatch': {
            'matched': technical_matches if not disclaimer.get('containsImpairmentGroundTruth') else None,
            'totalWithExpectation': technical_total if not disclaimer.get('containsImpairmentGroundTruth') else None,
            'note': (
                'Technical expectedStatus checks validate pipeline gates only. '
                'Not alcohol-consumption accuracy.'
            ),
        },
        'limitations': {
            'singleFrameOnly': True,
            'doesNotConfirmAlcoholConsumption': True,
            'doesNotConfirmIntoxication': True,
            'requiresHumanVerification': True,
            'noValidatedImpairmentModelBundled': True,
        },
        'samples': rows,
    }
    return report


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Phase 9B impairment candidate benchmark (offline, non-clinical).',
    )
    parser.add_argument(
        '--provider',
        default=None,
        help='Override IMPAIRMENT_DETECTOR_PROVIDER (mock|local-model|candidate-model)',
    )
    parser.add_argument(
        '--out',
        default=str(RESULTS_DIR / 'latest.json'),
        help='Output JSON path',
    )
    args = parser.parse_args()
    report = run_benchmark(provider_override=args.provider)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote {out_path}')
    print(
        json.dumps(
            {
                'provider': report['provider'],
                'sampleCount': report['sampleCount'],
                'averageLatencyMs': report['averageLatencyMs'],
                'p95LatencyMs': report['p95LatencyMs'],
                'failures': report['failures'],
                'qualityFailures': report['qualityFailures'],
                'classificationMetrics': report['classificationMetrics'],
            },
            indent=2,
        ),
    )


if __name__ == '__main__':
    main()
