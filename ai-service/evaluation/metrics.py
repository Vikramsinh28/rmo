from __future__ import annotations

from typing import Iterable, List, Optional


def percentile(sorted_values: List[float], p: float) -> Optional[float]:
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return round(sorted_values[0], 3)
    rank = (len(sorted_values) - 1) * (p / 100.0)
    low = int(rank)
    high = min(low + 1, len(sorted_values) - 1)
    weight = rank - low
    value = sorted_values[low] * (1 - weight) + sorted_values[high] * weight
    return round(value, 3)


def summarize_latencies(latencies_ms: Iterable[float]) -> dict:
    values = sorted(float(v) for v in latencies_ms)
    if not values:
        return {
            'averageLatencyMs': None,
            'p50LatencyMs': None,
            'p95LatencyMs': None,
            'minLatencyMs': None,
            'maxLatencyMs': None,
        }
    return {
        'averageLatencyMs': round(sum(values) / len(values), 3),
        'p50LatencyMs': percentile(values, 50),
        'p95LatencyMs': percentile(values, 95),
        'minLatencyMs': round(values[0], 3),
        'maxLatencyMs': round(values[-1], 3),
    }


def compute_classification_metrics(y_true: List[str], y_pred: List[str], positive: str) -> Optional[dict]:
    """
    Compute precision/recall/F1 only when legitimate ground-truth labels exist.
    Returns None if labels are missing or not impairment-oriented.
    """
    if not y_true or len(y_true) != len(y_pred):
        return None
    # Refuse fabricated alcohol labels — only allow explicit, declared evaluation labels.
    allowed = {
        'NO_CLEAR_INDICATOR',
        'POTENTIAL_IMPAIRMENT',
        'INSUFFICIENT_QUALITY',
        'NO_PERSON_DETECTED',
        'ANALYSIS_UNAVAILABLE',
    }
    if any(label not in allowed for label in y_true):
        return None

    tp = fp = tn = fn = 0
    for truth, pred in zip(y_true, y_pred):
        truth_pos = truth == positive
        pred_pos = pred == positive
        if truth_pos and pred_pos:
            tp += 1
        elif not truth_pos and pred_pos:
            fp += 1
        elif truth_pos and not pred_pos:
            fn += 1
        else:
            tn += 1

    precision = tp / (tp + fp) if (tp + fp) else None
    recall = tp / (tp + fn) if (tp + fn) else None
    if precision is None or recall is None or (precision + recall) == 0:
        f1 = None
    else:
        f1 = 2 * precision * recall / (precision + recall)

    return {
        'positiveClass': positive,
        'precision': round(precision, 4) if precision is not None else None,
        'recall': round(recall, 4) if recall is not None else None,
        'f1': round(f1, 4) if f1 is not None else None,
        'falsePositiveRate': round(fp / (fp + tn), 4) if (fp + tn) else None,
        'falseNegativeRate': round(fn / (fn + tp), 4) if (fn + tp) else None,
        'confusionMatrix': {'tp': tp, 'fp': fp, 'tn': tn, 'fn': fn},
        'note': (
            'Metrics are technical classification vs declared evaluation labels only. '
            'They do not measure alcohol-consumption detection accuracy.'
        ),
    }
