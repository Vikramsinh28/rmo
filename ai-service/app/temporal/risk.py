from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple

MODEL_VERSION = 'visual-indicators-rules-v1'

NORMAL = 'NORMAL'
MONITORING = 'MONITORING'
ELEVATED = 'ELEVATED_INDICATORS'
HIGH = 'HIGH_INDICATORS'
INSUFFICIENT = 'INSUFFICIENT_EVIDENCE'

LEVELS = [NORMAL, MONITORING, ELEVATED, HIGH]
RANK = {name: index for index, name in enumerate(LEVELS)}

# Relative evidence weight per signal group (design §7).
GROUP_WEIGHTS: Dict[str, float] = {
    'gait': 0.30,
    'sway': 0.20,
    'posture': 0.20,
    'head': 0.10,
    'eyes': 0.10,
    'coordination': 0.10,
}
STRONG_GROUPS = {'gait', 'sway', 'posture'}
# Seated interview view (hips not visible): eyes, head and shoulder sway carry the evidence.
SEATED_WEIGHTS: Dict[str, float] = {
    'eyes': 0.30,
    'trunk': 0.25,
    'head': 0.25,
    'coordination': 0.20,
}
SEATED_STRONG_GROUPS = {'eyes', 'trunk'}
GROUP_ELEVATED = 0.6
GROUP_EVIDENCE = 0.4

# Seconds a candidate level must persist before the status escalates to it.
ESCALATE_AFTER = {MONITORING: 3.0, ELEVATED: 8.0, HIGH: 10.0}
# Seconds the candidate must stay below the current level before de-escalating.
RELEASE_AFTER = 8.0
# Seconds of continuous insufficient evidence before the status abstains.
ABSTAIN_AFTER = 5.0

MIN_WINDOW_SECONDS = 4.0
MIN_SAMPLES = 8
MIN_QUALITY = 0.35
MIN_AVAILABLE_WEIGHT = 0.25


def _ramp(value: Optional[float], low: float, high: float) -> float:
    if value is None:
        return 0.0
    return max(0.0, min(1.0, (value - low) / (high - low)))


def _posture(f: Dict[str, Any]) -> Tuple[float, str]:
    score = (
        0.5 * _ramp(f.get('torsoAngleStd'), 3.0, 10.0)
        + 0.3 * _ramp(f.get('correctionsPerMinute'), 6.0, 20.0)
        + 0.2 * _ramp(f.get('torsoAngleMeanAbs'), 8.0, 20.0)
    )
    return score, (
        f"Posture instability (torso variation {f.get('torsoAngleStd')}°, "
        f"{f.get('corrections')} abrupt corrections)"
    )


def _sway(f: Dict[str, Any]) -> Tuple[float, str]:
    score = _ramp(f.get('hipSwayStd'), 0.02, 0.07)
    context = 'while walking' if f.get('walking') else 'while standing'
    return score, f"Lateral sway {context} ({f.get('hipSwayStd')} body heights)"


def _gait(f: Dict[str, Any]) -> Optional[Tuple[float, str]]:
    if not f.get('walking') or f.get('stepIntervalCv') is None:
        return None
    symmetry = f.get('stepSymmetry')
    score = (
        0.5 * _ramp(f.get('stepIntervalCv'), 0.15, 0.45)
        + 0.25 * _ramp(None if symmetry is None else 1.0 - symmetry, 0.10, 0.35)
        + 0.25 * _ramp(f.get('pathDeviation'), 0.03, 0.12)
    )
    cv = f.get('stepIntervalCv') or 0.0
    return score, f"Irregular gait (step timing variation {round(cv * 100)}%)"


def _head(f: Dict[str, Any]) -> Tuple[float, str]:
    score = (
        0.5 * _ramp(f.get('jitter'), 2.0, 8.0)
        + 0.3 * _ramp(f.get('rollMeanAbs'), 8.0, 20.0)
        + 0.2 * _ramp(max(f.get('pitchStd') or 0.0, f.get('rollStd') or 0.0), 4.0, 12.0)
    )
    return score, f"Head instability (frame-to-frame movement {f.get('jitter')}°)"


def _eyes(f: Dict[str, Any]) -> Tuple[float, str]:
    score = (
        0.6 * _ramp(f.get('closedFraction'), 0.15, 0.50)
        + 0.4 * _ramp(f.get('longestClosureSeconds'), 0.8, 3.0)
    )
    closed = f.get('closedFraction') or 0.0
    return score, f"Prolonged eye closure ({round(closed * 100)}% of the time)"


def _coordination(f: Dict[str, Any]) -> Tuple[float, str]:
    return _ramp(f.get('jerkRatio'), 1.2, 2.5), 'Jerky arm movements / repeated corrections'


def _trunk(f: Dict[str, Any]) -> Tuple[float, str]:
    score = (
        0.6 * _ramp(f.get('shoulderSwayStd'), 0.05, 0.15)
        + 0.25 * _ramp(f.get('shoulderTiltStd'), 3.0, 10.0)
        + 0.15 * _ramp(f.get('shoulderTiltMeanAbs'), 6.0, 15.0)
    )
    return score, (
        f"Upper-body sway while seated ({f.get('shoulderSwayStd')} shoulder widths, "
        f"shoulder tilt variation {f.get('shoulderTiltStd')}°)"
    )


SCORERS: Dict[str, Callable[[Dict[str, Any]], Optional[Tuple[float, str]]]] = {
    'gait': _gait,
    'sway': _sway,
    'posture': _posture,
    'trunk': _trunk,
    'head': _head,
    'eyes': _eyes,
    'coordination': _coordination,
}


@dataclass
class Assessment:
    """Instantaneous (un-smoothed) assessment of one feature window."""

    candidate: str
    score: Optional[float]
    confidence: Optional[float]
    groups: Dict[str, Optional[float]]
    evidence: List[str]
    limitations: List[str]
    mode: str = 'full_body'


def assess(features: Dict[str, Any]) -> Assessment:
    quality = features.get('quality') or {}
    seated = features.get('mode') == 'upper_body'
    weights = SEATED_WEIGHTS if seated else GROUP_WEIGHTS
    strong_groups = SEATED_STRONG_GROUPS if seated else STRONG_GROUPS
    mode = 'upper_body' if seated else 'full_body'
    limitations: List[str] = []
    if quality.get('faceVisibleFraction', 0.0) < 0.3:
        limitations.append('Face not visible')
    if not seated and quality.get('lowerBodyFraction', 0.0) < 0.3:
        limitations.append('Lower body not visible — gait unavailable')
    mean_quality = quality.get('mean')
    if mean_quality is not None and mean_quality < MIN_QUALITY:
        limitations.append('Low video quality')

    groups: Dict[str, Optional[float]] = {}
    texts: Dict[str, str] = {}
    for name, scorer in SCORERS.items():
        if name not in weights:
            continue
        group_features = features.get(name)
        scored = scorer(group_features) if group_features else None
        if scored is None:
            groups[name] = None
            continue
        groups[name] = round(scored[0], 3)
        texts[name] = scored[1]

    available = {name: s for name, s in groups.items() if s is not None}
    available_weight = sum(weights[name] for name in available)

    insufficient = (
        features.get('samples', 0) < MIN_SAMPLES
        or (features.get('windowSeconds') or 0.0) < MIN_WINDOW_SECONDS
        or mean_quality is None
        or mean_quality < MIN_QUALITY
        or available_weight < MIN_AVAILABLE_WEIGHT
    )
    if insufficient:
        if available_weight < MIN_AVAILABLE_WEIGHT:
            limitations.append('Too few visible signals')
        return Assessment(INSUFFICIENT, None, None, groups, [], limitations, mode)

    score = sum(weights[name] * s for name, s in available.items()) / available_weight
    elevated = [name for name, s in available.items() if s >= GROUP_ELEVATED]
    if score >= 0.7 and len(elevated) >= 2 and strong_groups & set(elevated):
        candidate = HIGH
    elif score >= 0.5 and len(elevated) >= 2:
        candidate = ELEVATED
    elif score >= 0.3 or elevated:
        candidate = MONITORING
    else:
        candidate = NORMAL

    coverage = min(1.0, available_weight / 0.6)
    reliability = min(1.0, mean_quality / 0.7)
    duration = min(1.0, (features.get('windowSeconds') or 0.0) / 10.0)
    confidence = round(coverage * reliability * duration, 3)

    ranked = sorted(available.items(), key=lambda item: item[1], reverse=True)
    evidence = [texts[name] for name, s in ranked if s >= GROUP_EVIDENCE]
    return Assessment(candidate, round(score, 3), confidence, groups, evidence, limitations, mode)


@dataclass
class Episode:
    id: str
    started_at: datetime
    peak_status: str
    peak_score: float
    peak_confidence: float
    evidence: List[str]
    groups: Dict[str, Optional[float]]
    features: Dict[str, Any]
    ended_at: Optional[datetime] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'active': self.ended_at is None,
            'startedAt': self.started_at.isoformat(),
            'endedAt': self.ended_at.isoformat() if self.ended_at else None,
            'peakStatus': self.peak_status,
            'peakScore': self.peak_score,
            'peakConfidence': self.peak_confidence,
            'evidence': self.evidence,
            'groups': self.groups,
            'features': self.features,
        }


@dataclass
class TrackRiskState:
    status: str = INSUFFICIENT
    status_since: Optional[datetime] = None
    held_since: Dict[str, Optional[datetime]] = field(
        default_factory=lambda: {level: None for level in LEVELS},
    )
    below_since: Optional[datetime] = None
    insufficient_since: Optional[datetime] = None
    episode_count: int = 0
    episode: Optional[Episode] = None
    last: Optional[Assessment] = None


class RiskEngine:
    """
    Per-track visual-indicator status with persistence and hysteresis (design §9, §11).

    Output states are product states, not medical or legal determinations.
    """

    def __init__(self) -> None:
        self._tracks: Dict[str, TrackRiskState] = {}

    def reset(self) -> None:
        self._tracks.clear()

    def drop_missing(self, track_ids: List[str]) -> None:
        keep = set(track_ids)
        for track_id in list(self._tracks):
            if track_id not in keep:
                del self._tracks[track_id]

    def update(self, track_id: str, features: Dict[str, Any], now: datetime) -> Dict[str, Any]:
        state = self._tracks.setdefault(track_id, TrackRiskState(status_since=now))
        result = assess(features)
        state.last = result
        previous = state.status

        if result.candidate == INSUFFICIENT:
            state.insufficient_since = state.insufficient_since or now
            for level in LEVELS:
                state.held_since[level] = None
            if (now - state.insufficient_since).total_seconds() >= ABSTAIN_AFTER:
                self._set_status(state, INSUFFICIENT, now)
        else:
            state.insufficient_since = None
            rank = RANK[result.candidate]
            for level in LEVELS:
                if RANK[level] <= rank:
                    state.held_since[level] = state.held_since[level] or now
                else:
                    state.held_since[level] = None
            reached = NORMAL
            for level in LEVELS[1:]:
                since = state.held_since[level]
                if since and (now - since).total_seconds() >= ESCALATE_AFTER[level]:
                    reached = level
            if state.status == INSUFFICIENT:
                self._set_status(state, reached, now)
            elif RANK[reached] >= RANK[state.status]:
                state.below_since = None
                self._set_status(state, reached, now)
            else:
                if rank < RANK[state.status]:
                    state.below_since = state.below_since or now
                    if (now - state.below_since).total_seconds() >= RELEASE_AFTER:
                        state.below_since = None
                        self._set_status(state, max(reached, result.candidate, key=RANK.get), now)
                else:
                    state.below_since = None

        self._track_episode(track_id, state, previous, result, features, now)
        return self._present(state, result)

    @staticmethod
    def _set_status(state: TrackRiskState, status: str, now: datetime) -> None:
        if status != state.status:
            state.status = status
            state.status_since = now

    @staticmethod
    def _is_alert(status: str) -> bool:
        return status in (ELEVATED, HIGH)

    def _track_episode(
        self,
        track_id: str,
        state: TrackRiskState,
        previous: str,
        result: Assessment,
        features: Dict[str, Any],
        now: datetime,
    ) -> None:
        alert = self._is_alert(state.status)
        episode = state.episode
        if alert and (episode is None or episode.ended_at is not None):
            state.episode_count += 1
            state.episode = Episode(
                id=f'{track_id}-e{state.episode_count}',
                started_at=now,
                peak_status=state.status,
                peak_score=result.score or 0.0,
                peak_confidence=result.confidence or 0.0,
                evidence=list(result.evidence),
                groups=dict(result.groups),
                features=features,
            )
        elif alert and episode is not None:
            higher = RANK[state.status] > RANK[episode.peak_status]
            stronger = (result.score or 0.0) > episode.peak_score
            if higher or (state.status == episode.peak_status and stronger):
                episode.peak_status = state.status
                episode.peak_score = result.score or episode.peak_score
                episode.peak_confidence = result.confidence or episode.peak_confidence
                episode.evidence = list(result.evidence) or episode.evidence
                episode.groups = dict(result.groups)
                episode.features = features
        elif not alert and episode is not None and episode.ended_at is None:
            episode.ended_at = now

    @staticmethod
    def _present(state: TrackRiskState, result: Assessment) -> Dict[str, Any]:
        status = state.status
        abstained = status == INSUFFICIENT
        return {
            'status': status,
            'candidate': result.candidate,
            'score': None if abstained else result.score,
            'confidence': None if abstained else result.confidence,
            'since': state.status_since.isoformat() if state.status_since else None,
            'evidence': [] if abstained else result.evidence,
            'limitations': result.limitations,
            'groups': result.groups,
            'mode': result.mode,
            'episode': state.episode.to_dict() if state.episode else None,
            'modelVersion': MODEL_VERSION,
        }
