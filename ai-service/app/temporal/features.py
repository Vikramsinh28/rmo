from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.tracking.models import FeatureSnapshot

# Minimum samples for a signal group to count as evidence.
MIN_GROUP_SAMPLES = 6
EYES_CLOSED_BELOW = 0.35
POSTURE_CORRECTION_DEG = 8.0
WALKING_SPEED = 0.15  # body heights per second
WALKING_SCALE_RATE = 0.04  # |d ln(bodyHeight)/dt| per second — walking toward/away from camera
MIN_MOTION_BODY_HEIGHT = 0.2  # fraction of frame height; smaller bodies give noisy sway/gait
SWAY_SMOOTHING_SECONDS = 1.0  # removes step-to-step hip oscillation while walking
STEP_SEPARATION_HYSTERESIS = 0.02  # body heights
# Seated / upper-body view: hips visible in less than this fraction of the window.
UPPER_BODY_MAX_HIP_FRACTION = 0.3
MIN_SHOULDER_WIDTH = 0.08  # fraction of frame height; narrower shoulders are too far to measure
# Lying down: torso far from vertical for most of the window. A camera looking down at a
# bed foreshortens the angle, so a wide box with a clearly leaning torso also counts.
LYING_TORSO_DEG = 60.0
LYING_WIDE_TORSO_DEG = 45.0
LYING_MIN_FRACTION = 0.6


def _mean(values: Sequence[float]) -> float:
    return sum(values) / len(values)


def _std(values: Sequence[float]) -> float:
    if len(values) < 2:
        return 0.0
    mu = _mean(values)
    return math.sqrt(sum((v - mu) ** 2 for v in values) / len(values))


def _seconds(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds()


def _r(value: Optional[float], digits: int = 4) -> Optional[float]:
    return None if value is None else round(value, digits)


class TemporalFeatureExtractor:
    """
    Aggregates a person's recent FeatureSnapshot history into window-level features.

    Every group returns None when its inputs are not visible often enough, so the
    risk engine can abstain instead of scoring missing evidence as normal.
    """

    def __init__(self, window_seconds: float = 10.0) -> None:
        self.window_seconds = window_seconds

    def compute(self, history: List[FeatureSnapshot]) -> Dict[str, Any]:
        if not history:
            return self._empty()
        end = history[-1].timestamp
        window = [s for s in history if _seconds(s.timestamp, end) <= self.window_seconds]
        span = _seconds(window[0].timestamp, end) if len(window) > 1 else 0.0
        return {
            'windowSeconds': round(span, 2),
            'samples': len(window),
            'sampleRate': round(len(window) / span, 2) if span > 0 else None,
            'mode': self._mode(window),
            'lying': self._lying(window),
            'quality': self._quality(window),
            'posture': self._posture(window),
            'sway': self._sway(window),
            'gait': self._gait(window),
            'trunk': self._trunk(window),
            'head': self._head(window),
            'eyes': self._eyes(window),
            'coordination': self._coordination(window),
        }

    @staticmethod
    def _mode(window: List[FeatureSnapshot]) -> str:
        """'upper_body' when shoulders are seen but hips mostly are not (seated at a desk)."""
        n = len(window)
        hips = sum(1 for s in window if s.body.get('hipCenter')) / n
        shoulders = sum(1 for s in window if s.body.get('shoulderCenter')) / n
        if hips < UPPER_BODY_MAX_HIP_FRACTION and shoulders >= 0.5:
            return 'upper_body'
        return 'full_body'

    def lying(self, history: List[FeatureSnapshot]) -> Optional[Dict[str, Any]]:
        """Lying-down state over the recent window (used for people who are not assessed)."""
        if not history:
            return None
        end = history[-1].timestamp
        return self._lying([s for s in history if _seconds(s.timestamp, end) <= self.window_seconds])

    @staticmethod
    def _lying(window: List[FeatureSnapshot]) -> Optional[Dict[str, Any]]:
        samples = [
            (abs(s.body['torsoAngle']), s.body.get('boxAspect') or 0.0)
            for s in window
            if s.body.get('torsoAngle') is not None
        ]
        if len(samples) < MIN_GROUP_SAMPLES:
            return None
        lying = sum(
            1 for angle, box_aspect in samples
            if angle >= LYING_TORSO_DEG or (angle >= LYING_WIDE_TORSO_DEG and box_aspect >= 1.0)
        )
        fraction = lying / len(samples)
        return {
            'samples': len(samples),
            'lyingFraction': round(fraction, 3),
            'lyingDown': fraction >= LYING_MIN_FRACTION,
        }

    @staticmethod
    def _trunk(window: List[FeatureSnapshot]) -> Optional[Dict[str, Any]]:
        """Upper-body sway from shoulders: lateral shift in shoulder widths and sideways tilt."""
        series = [
            (s.body['shoulderCenter']['x'], s.body['shoulderWidth'], s.body.get('shoulderAlignment'))
            for s in window
            if s.body.get('shoulderCenter') and s.body.get('shoulderWidth')
        ]
        if len(series) < MIN_GROUP_SAMPLES:
            return None
        width = _mean([w for _, w, _ in series])
        if width < MIN_SHOULDER_WIDTH:
            return None
        xs = [x for x, _, _ in series]
        tilts = [t for _, _, t in series if t is not None]
        return {
            'samples': len(series),
            'shoulderSwayStd': _r(_std(xs) / width),
            'shoulderTiltStd': _r(_std(tilts), 2) if len(tilts) >= 2 else None,
            'shoulderTiltMeanAbs': _r(_mean([abs(t) for t in tilts]), 2) if tilts else None,
        }

    @staticmethod
    def _empty() -> Dict[str, Any]:
        return {
            'windowSeconds': 0.0,
            'samples': 0,
            'sampleRate': None,
            'mode': 'full_body',
            'lying': None,
            'quality': {
                'mean': None,
                'faceVisibleFraction': 0.0,
                'bodyVisibleFraction': 0.0,
                'lowerBodyFraction': 0.0,
                'gaitFraction': 0.0,
            },
            'posture': None,
            'sway': None,
            'gait': None,
            'trunk': None,
            'head': None,
            'eyes': None,
            'coordination': None,
        }

    @staticmethod
    def _quality(window: List[FeatureSnapshot]) -> Dict[str, Any]:
        n = len(window)
        scores = [s.quality.get('score') for s in window if s.quality.get('score') is not None]
        return {
            'mean': _r(_mean(scores), 3) if scores else None,
            'faceVisibleFraction': round(sum(1 for s in window if s.face.get('visible')) / n, 3),
            'bodyVisibleFraction': round(sum(1 for s in window if s.body.get('visible')) / n, 3),
            'lowerBodyFraction': round(
                sum(1 for s in window if s.body.get('lowerBodyVisible')) / n, 3,
            ),
            'gaitFraction': round(sum(1 for s in window if s.body.get('gaitAvailable')) / n, 3),
        }

    @staticmethod
    def _posture(window: List[FeatureSnapshot]) -> Optional[Dict[str, Any]]:
        series = [
            (s.timestamp, s.body['torsoAngle'], s.body.get('shoulderAlignment'))
            for s in window
            if s.body.get('torsoAngle') is not None
        ]
        if len(series) < MIN_GROUP_SAMPLES:
            return None
        angles = [a for _, a, _ in series]
        tilts = [t for _, _, t in series if t is not None]
        corrections = 0
        for (t0, a0, _), (t1, a1, _) in zip(series, series[1:]):
            if _seconds(t0, t1) <= 0.8 and abs(a1 - a0) >= POSTURE_CORRECTION_DEG:
                corrections += 1
        span = _seconds(series[0][0], series[-1][0])
        return {
            'samples': len(series),
            'torsoAngleStd': _r(_std(angles), 2),
            'torsoAngleMeanAbs': _r(_mean([abs(a) for a in angles]), 2),
            'shoulderTiltStd': _r(_std(tilts), 2) if len(tilts) >= 2 else None,
            'corrections': corrections,
            'correctionsPerMinute': _r(corrections * 60.0 / span, 2) if span > 0 else None,
        }

    @staticmethod
    def _hip_series(window: List[FeatureSnapshot]) -> List[Tuple[datetime, float, float, float]]:
        return [
            (s.timestamp, s.body['hipCenter']['x'], s.body['hipCenter']['y'], s.body['bodyHeight'])
            for s in window
            if s.body.get('hipCenter') and s.body.get('bodyHeight')
        ]

    def _sway(self, window: List[FeatureSnapshot]) -> Optional[Dict[str, Any]]:
        series = self._hip_series(window)
        if len(series) < MIN_GROUP_SAMPLES:
            return None
        scale = _mean([h for *_, h in series])
        if scale < MIN_MOTION_BODY_HEIGHT:
            return None
        xs = [x for _, x, _, _ in series]
        walking = self._is_walking(series)
        # While walking, sway is the residual around the smoothed walking path, not raw drift.
        if walking:
            deviation = self._path_deviation(self._smooth(series, SWAY_SMOOTHING_SECONDS))
            sway_std = deviation if deviation is not None else _std(xs) / scale
        else:
            sway_std = _std(xs) / scale
        return {
            'samples': len(series),
            'hipSwayStd': _r(sway_std),
            'hipRange': _r((max(xs) - min(xs)) / scale),
            'walking': walking,
        }

    @staticmethod
    def _is_walking(series: List[Tuple[datetime, float, float, float]]) -> bool:
        span = _seconds(series[0][0], series[-1][0])
        if span <= 0:
            return False
        scale = _mean([h for *_, h in series])
        dx = series[-1][1] - series[0][1]
        dy = series[-1][2] - series[0][2]
        if math.hypot(dx, dy) / scale / span >= WALKING_SPEED:
            return True
        quarter = max(1, len(series) // 4)
        first = _mean([h for *_, h in series[:quarter]])
        last = _mean([h for *_, h in series[-quarter:]])
        if first <= 1e-4 or last <= 1e-4:
            return False
        return abs(math.log(last / first)) / span >= WALKING_SCALE_RATE

    @staticmethod
    def _smooth(
        series: List[Tuple[datetime, float, float, float]],
        seconds: float,
    ) -> List[Tuple[datetime, float, float, float]]:
        half = seconds / 2.0
        smoothed = []
        for ts, _, _, h in series:
            near = [p for p in series if abs(_seconds(p[0], ts)) <= half]
            smoothed.append((
                ts,
                _mean([p[1] for p in near]),
                _mean([p[2] for p in near]),
                h,
            ))
        return smoothed

    @staticmethod
    def _path_deviation(series: List[Tuple[datetime, float, float, float]]) -> Optional[float]:
        """RMS distance of hip points from their principal (walking) line, in body heights."""
        pts = [(x, y) for _, x, y, _ in series]
        scale = _mean([h for *_, h in series])
        cx, cy = _mean([p[0] for p in pts]), _mean([p[1] for p in pts])
        sxx = _mean([(p[0] - cx) ** 2 for p in pts])
        syy = _mean([(p[1] - cy) ** 2 for p in pts])
        sxy = _mean([(p[0] - cx) * (p[1] - cy) for p in pts])
        theta = 0.5 * math.atan2(2 * sxy, sxx - syy)
        nx, ny = -math.sin(theta), math.cos(theta)
        residuals = [(p[0] - cx) * nx + (p[1] - cy) * ny for p in pts]
        if scale <= 1e-4:
            return None
        return math.sqrt(_mean([r * r for r in residuals])) / scale

    def _gait(self, window: List[FeatureSnapshot]) -> Optional[Dict[str, Any]]:
        samples = [
            s for s in window
            if s.body.get('gaitAvailable')
            and s.body.get('bodyHeight')
            and (s.body.get('ankles') or {}).get('left')
            and (s.body.get('ankles') or {}).get('right')
        ]
        if len(samples) < MIN_GROUP_SAMPLES:
            return None
        if _mean([s.body['bodyHeight'] for s in samples]) < MIN_MOTION_BODY_HEIGHT:
            return None
        hips = self._hip_series(samples)
        walking = len(hips) >= MIN_GROUP_SAMPLES and self._is_walking(hips)
        result: Dict[str, Any] = {
            'samples': len(samples),
            'walking': walking,
            'stepCount': 0,
            'stepIntervalCv': None,
            'stepSymmetry': None,
            'pathDeviation': None,
        }
        if not walking:
            return result

        # Steps: sign changes of left-right ankle separation (with hysteresis).
        separation = [
            (
                s.timestamp,
                (s.body['ankles']['left']['x'] - s.body['ankles']['right']['x'])
                / s.body['bodyHeight'],
            )
            for s in samples
        ]
        centre = _mean([v for _, v in separation])
        crossings: List[datetime] = []
        sign = 0
        for ts, value in separation:
            offset = value - centre
            if offset > STEP_SEPARATION_HYSTERESIS and sign <= 0:
                if sign < 0:
                    crossings.append(ts)
                sign = 1
            elif offset < -STEP_SEPARATION_HYSTERESIS and sign >= 0:
                if sign > 0:
                    crossings.append(ts)
                sign = -1
        intervals = [_seconds(a, b) for a, b in zip(crossings, crossings[1:])]
        result['stepCount'] = len(crossings)
        result['pathDeviation'] = _r(self._path_deviation(hips))
        if len(intervals) >= 3:
            mean_interval = _mean(intervals)
            if mean_interval > 0:
                result['stepIntervalCv'] = _r(_std(intervals) / mean_interval)
            odd, even = intervals[0::2], intervals[1::2]
            if odd and even:
                a, b = _mean(odd), _mean(even)
                result['stepSymmetry'] = _r(1.0 - abs(a - b) / (a + b)) if a + b > 0 else None
        return result

    @staticmethod
    def _head(window: List[FeatureSnapshot]) -> Optional[Dict[str, Any]]:
        poses = [
            (s.timestamp, s.face['headPose'])
            for s in window
            if s.face.get('visible')
            and (s.face.get('headPose') or {}).get('pitch') is not None
        ]
        if len(poses) < MIN_GROUP_SAMPLES:
            return None
        pitch = [p['pitch'] for _, p in poses]
        yaw = [p['yaw'] for _, p in poses]
        roll = [p['roll'] for _, p in poses]
        jitter = [
            abs(b['pitch'] - a['pitch']) + abs(b['roll'] - a['roll'])
            for (ta, a), (tb, b) in zip(poses, poses[1:])
            if _seconds(ta, tb) <= 0.8
        ]
        return {
            'samples': len(poses),
            'pitchStd': _r(_std(pitch), 2),
            'yawStd': _r(_std(yaw), 2),
            'rollStd': _r(_std(roll), 2),
            'rollMeanAbs': _r(_mean([abs(r) for r in roll]), 2),
            'pitchMean': _r(_mean(pitch), 2),
            'jitter': _r(_mean(jitter), 2) if jitter else None,
        }

    @staticmethod
    def _eyes(window: List[FeatureSnapshot]) -> Optional[Dict[str, Any]]:
        series = [
            (s.timestamp, s.face['eyes']['openProbability'])
            for s in window
            if s.face.get('visible')
            and (s.face.get('eyes') or {}).get('openProbability') is not None
        ]
        if len(series) < MIN_GROUP_SAMPLES:
            return None
        values = [v for _, v in series]
        longest = 0.0
        run_start: Optional[datetime] = None
        for ts, value in series:
            if value < EYES_CLOSED_BELOW:
                run_start = run_start or ts
                longest = max(longest, _seconds(run_start, ts))
            else:
                run_start = None
        return {
            'samples': len(series),
            'openMean': _r(_mean(values), 3),
            'closedFraction': _r(sum(1 for v in values if v < EYES_CLOSED_BELOW) / len(values), 3),
            'longestClosureSeconds': _r(longest, 2),
        }

    @staticmethod
    def _coordination(window: List[FeatureSnapshot]) -> Optional[Dict[str, Any]]:
        """Arm-movement jerkiness: mean |second difference| / mean |first difference| of wrists."""
        ratios: List[float] = []
        samples = 0
        for side in ('left', 'right'):
            points = [
                ((s.body.get('keypoints') or {}).get('wrists') or {}).get(side)
                for s in window
            ]
            track = [(p['x'], p['y']) for p in points if p]
            if len(track) < MIN_GROUP_SAMPLES:
                continue
            samples = max(samples, len(track))
            first = [
                math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(track, track[1:])
            ]
            second = [
                math.hypot(c[0] - 2 * b[0] + a[0], c[1] - 2 * b[1] + a[1])
                for a, b, c in zip(track, track[1:], track[2:])
            ]
            motion = _mean(first)
            if motion < 0.003:  # arms essentially still: no coordination evidence
                continue
            ratios.append(_mean(second) / motion)
        if not ratios:
            return None
        return {'samples': samples, 'jerkRatio': _r(max(ratios), 3)}
