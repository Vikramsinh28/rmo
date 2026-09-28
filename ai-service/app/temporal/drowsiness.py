from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.temporal.features import EYES_CLOSED_BELOW
from app.tracking.models import FeatureSnapshot

MODEL_VERSION = 'drowsiness-rules-v1'

DROWSY = 'POSSIBLE_DROWSINESS'
AWAKE = 'NONE'
INSUFFICIENT = 'INSUFFICIENT_EVIDENCE'

WINDOW_SECONDS = 20.0
# A signal must be seen across most of the window before it is judged.
MIN_COVERAGE_SECONDS = 12.0
MIN_SAMPLES = 10

# Eyes: closed for most of the window.
DROWSY_CLOSED_FRACTION = 0.7
AWAKE_CLOSED_FRACTION = 0.4

# Head slump (from body keypoints, so it works when the face is turned away): the head
# sits at shoulder height or lies on its side, and stays there without moving.
SLUMP_MAX_HEAD_RISE = 0.25  # shoulder widths above the shoulder line (upright ≈ 0.5–0.65)
SLUMP_MIN_HEAD_TILT = 35.0  # degrees from level
DROWSY_SLUMP_FRACTION = 0.8
AWAKE_SLUMP_FRACTION = 0.5
STILL_HEAD_MOTION = 0.2  # std of head position, in shoulder widths

ESCALATE_AFTER = 3.0
RELEASE_AFTER = 5.0
# Episode severity reuses the safety-event scale; the kind marks it as drowsiness.
EPISODE_SEVERITY = 'ELEVATED_INDICATORS'


def _seconds(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds()


def _mean(values: List[float]) -> float:
    return sum(values) / len(values)


def _std(values: List[float]) -> float:
    mu = _mean(values)
    return math.sqrt(sum((v - mu) ** 2 for v in values) / len(values))


def _eye_features(window: List[FeatureSnapshot]) -> Optional[Dict[str, Any]]:
    series = [
        (s.timestamp, s.face['eyes']['openProbability'])
        for s in window
        if s.face.get('visible')
        and (s.face.get('eyes') or {}).get('openProbability') is not None
    ]
    if len(series) < MIN_SAMPLES or _seconds(series[0][0], series[-1][0]) < MIN_COVERAGE_SECONDS:
        return None
    closed = [v < EYES_CLOSED_BELOW for _, v in series]
    longest = 0.0
    run_start: Optional[datetime] = None
    for (ts, _), is_closed in zip(series, closed):
        if is_closed:
            run_start = run_start or ts
            longest = max(longest, _seconds(run_start, ts))
        else:
            run_start = None
    return {
        'samples': len(series),
        'windowSeconds': round(_seconds(series[0][0], series[-1][0]), 2),
        'closedFraction': round(sum(closed) / len(closed), 3),
        'longestClosureSeconds': round(longest, 2),
    }


def _slump_features(window: List[FeatureSnapshot]) -> Optional[Dict[str, Any]]:
    series = [
        (s.timestamp, s.body.get('headRise'), s.body.get('headTilt'),
         s.body['headPoint'], s.body['shoulderWidth'])
        for s in window
        if s.body.get('headPoint') and s.body.get('shoulderWidth')
        and (s.body.get('headRise') is not None or s.body.get('headTilt') is not None)
    ]
    if len(series) < MIN_SAMPLES or _seconds(series[0][0], series[-1][0]) < MIN_COVERAGE_SECONDS:
        return None
    slumped = [
        (rise is not None and rise < SLUMP_MAX_HEAD_RISE)
        or (tilt is not None and tilt >= SLUMP_MIN_HEAD_TILT)
        for _, rise, tilt, _, _ in series
    ]
    width = _mean([w for *_, w in series])
    motion = math.hypot(
        _std([p['x'] for _, _, _, p, _ in series]),
        _std([p['y'] for _, _, _, p, _ in series]),
    ) / width if width > 1e-4 else None
    rises = [rise for _, rise, _, _, _ in series if rise is not None]
    return {
        'samples': len(series),
        'windowSeconds': round(_seconds(series[0][0], series[-1][0]), 2),
        'slumpedFraction': round(sum(slumped) / len(slumped), 3),
        'headRiseMean': round(_mean(rises), 3) if rises else None,
        'headMotion': round(motion, 3) if motion is not None else None,
        'still': motion is not None and motion < STILL_HEAD_MOTION,
    }


def _evidence(features: Dict[str, Any]) -> List[str]:
    items = []
    eyes = features.get('eyes')
    if eyes and eyes['closedFraction'] >= DROWSY_CLOSED_FRACTION:
        items.append(
            f"Eyes closed {round(eyes['closedFraction'] * 100)}% of the last "
            f"{round(eyes['windowSeconds'])} s (longest closure {eyes['longestClosureSeconds']} s)"
        )
    slump = features.get('slump')
    if slump and slump['still'] and slump['slumpedFraction'] >= DROWSY_SLUMP_FRACTION:
        items.append(
            f"Head slumped and still {round(slump['slumpedFraction'] * 100)}% of the last "
            f"{round(slump['windowSeconds'])} s"
        )
    return items


def _peak(features: Dict[str, Any]) -> float:
    eyes = (features.get('eyes') or {}).get('closedFraction') or 0.0
    slump = features.get('slump') or {}
    slumped = (slump.get('slumpedFraction') or 0.0) if slump.get('still') else 0.0
    return max(eyes, slumped)


@dataclass
class _Episode:
    id: str
    started_at: datetime
    peak: float
    peak_confidence: float
    features: Dict[str, Any]
    ended_at: Optional[datetime] = None

    def to_dict(self) -> Dict[str, Any]:
        eyes = (self.features.get('eyes') or {}).get('closedFraction')
        slump = (self.features.get('slump') or {}).get('slumpedFraction')
        return {
            'id': self.id,
            'kind': 'DROWSINESS',
            'active': self.ended_at is None,
            'startedAt': self.started_at.isoformat(),
            'endedAt': self.ended_at.isoformat() if self.ended_at else None,
            'peakStatus': EPISODE_SEVERITY,
            'peakScore': round(self.peak, 3),
            'peakConfidence': round(self.peak_confidence, 3),
            'evidence': _evidence(self.features) or ['Sustained eye closure or slumped head'],
            'groups': {'eyes': eyes, 'headSlump': slump},
            'features': self.features,
        }


@dataclass
class _TrackState:
    status: str = INSUFFICIENT
    since: Optional[datetime] = None
    candidate_since: Optional[datetime] = None
    below_since: Optional[datetime] = None
    episode_count: int = 0
    episode: Optional[_Episode] = None


class DrowsinessMonitor:
    """
    Sustained eye closure, or a still slumped head → "Possible drowsiness".

    Separate from the visual-indicator (intoxication) engine: one strong signal held
    long enough is enough here, because sleeping on duty matters regardless of cause.
    """

    def __init__(self) -> None:
        self._tracks: Dict[str, _TrackState] = {}

    def reset(self) -> None:
        self._tracks.clear()

    def forget(self, track_id: str) -> None:
        self._tracks.pop(track_id, None)

    def drop_missing(self, track_ids: List[str]) -> None:
        keep = set(track_ids)
        for track_id in list(self._tracks):
            if track_id not in keep:
                del self._tracks[track_id]

    @staticmethod
    def window_features(history: List[FeatureSnapshot]) -> Optional[Dict[str, Any]]:
        if not history:
            return None
        end = history[-1].timestamp
        window = [s for s in history if _seconds(s.timestamp, end) <= WINDOW_SECONDS]
        eyes = _eye_features(window)
        slump = _slump_features(window)
        if eyes is None and slump is None:
            return None
        qualities = [s.quality.get('score') for s in window if s.quality.get('score') is not None]
        spans = [part['windowSeconds'] for part in (eyes, slump) if part]
        return {
            'eyes': eyes,
            'slump': slump,
            'windowSeconds': max(spans),
            'quality': round(_mean(qualities), 3) if qualities else None,
        }

    @staticmethod
    def _drowsy(features: Dict[str, Any]) -> bool:
        return bool(_evidence(features))

    @staticmethod
    def _awake(features: Dict[str, Any]) -> bool:
        eyes = features.get('eyes')
        slump = features.get('slump')
        eyes_open = eyes is None or eyes['closedFraction'] < AWAKE_CLOSED_FRACTION
        head_up = slump is None or not slump['still'] or slump['slumpedFraction'] < AWAKE_SLUMP_FRACTION
        return eyes_open and head_up

    def update(self, track_id: str, history: List[FeatureSnapshot], now: datetime) -> Dict[str, Any]:
        state = self._tracks.setdefault(track_id, _TrackState(since=now))
        features = self.window_features(history)

        if features is None:
            state.candidate_since = None
            if state.status == DROWSY:
                state.below_since = state.below_since or now
                if (now - state.below_since).total_seconds() < RELEASE_AFTER:
                    self._track_episode(track_id, state, features, now)
                    return self._present(state, features)
                state.below_since = None
            self._set(state, INSUFFICIENT, now)
        elif self._drowsy(features):
            state.below_since = None
            state.candidate_since = state.candidate_since or now
            if (now - state.candidate_since).total_seconds() >= ESCALATE_AFTER:
                self._set(state, DROWSY, now)
        else:
            state.candidate_since = None
            if state.status != DROWSY:
                self._set(state, AWAKE, now)
            elif not self._awake(features):
                state.below_since = None
            else:
                state.below_since = state.below_since or now
                if (now - state.below_since).total_seconds() >= RELEASE_AFTER:
                    state.below_since = None
                    self._set(state, AWAKE, now)

        self._track_episode(track_id, state, features, now)
        return self._present(state, features)

    @staticmethod
    def _present(state: _TrackState, features: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        eyes = (features or {}).get('eyes') or {}
        slump = (features or {}).get('slump') or {}
        return {
            'status': state.status,
            'since': state.since.isoformat() if state.since else None,
            'closedFraction': eyes.get('closedFraction'),
            'longestClosureSeconds': eyes.get('longestClosureSeconds'),
            'slumpedFraction': slump.get('slumpedFraction'),
            'headStill': slump.get('still'),
            'episode': state.episode.to_dict() if state.episode else None,
            'modelVersion': MODEL_VERSION,
        }

    @staticmethod
    def _set(state: _TrackState, status: str, now: datetime) -> None:
        if status != state.status:
            state.status = status
            state.since = now

    @staticmethod
    def _track_episode(
        track_id: str,
        state: _TrackState,
        features: Optional[Dict[str, Any]],
        now: datetime,
    ) -> None:
        drowsy = state.status == DROWSY
        episode = state.episode
        if drowsy and (episode is None or episode.ended_at is not None):
            state.episode_count += 1
            state.episode = _Episode(
                id=f'{track_id}-d{state.episode_count}',
                started_at=now,
                peak=_peak(features or {}),
                peak_confidence=_confidence(features),
                features=dict(features or {}),
            )
        elif drowsy and episode is not None and features and _peak(features) > episode.peak:
            episode.peak = _peak(features)
            episode.peak_confidence = _confidence(features)
            episode.features = dict(features)
        elif not drowsy and episode is not None and episode.ended_at is None:
            episode.ended_at = now


def _confidence(features: Optional[Dict[str, Any]]) -> float:
    if not features:
        return 0.0
    coverage = min(1.0, (features.get('windowSeconds') or 0.0) / WINDOW_SECONDS)
    reliability = min(1.0, (features.get('quality') or 0.0) / 0.7)
    return round(coverage * reliability, 3)
