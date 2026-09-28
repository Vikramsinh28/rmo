from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import numpy as np

from app.config import settings
from app.features.face_features import get_face_extractor
from app.features.movement_features import MovementFeatureExtractor
from app.features.pose_features import PoseFeatureExtractor
from app.features.quality import QualityEngine
from app.identity.resolver import IdentityResolver, UnknownIdentityResolver
from app.processing.subject import SubjectSelector
from app.temporal.drowsiness import DrowsinessMonitor
from app.temporal.features import TemporalFeatureExtractor
from app.temporal.risk import INSUFFICIENT, MODEL_VERSION, RiskEngine
from app.tracking.detector import PersonDetector, get_person_detector
from app.tracking.state import RollingPersonStateStore
from app.tracking.tracker import PersonTracker, get_person_tracker


NOT_ASSESSED = 'NOT_ASSESSED'
LYING_DOWN = 'LYING_DOWN'
_FACE_SKIPPED: Dict[str, Any] = {
    'visible': False,
    'quality': None,
    'boundingBox': None,
    'headPose': {'pitch': None, 'yaw': None, 'roll': None},
    'eyes': {'available': False, 'openProbability': None},
    'mouth': {'available': False, 'openProbability': None},
    'landmarkAvailability': False,
    'signalsAvailable': [],
}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class FrameProcessingPipeline:
    """
    Detect → track → features → rolling state.

    No AWS. No impairment classification. Identity defaults to UNKNOWN.
    """

    def __init__(
        self,
        detector: Optional[PersonDetector] = None,
        tracker: Optional[PersonTracker] = None,
        state: Optional[RollingPersonStateStore] = None,
        identity_resolver: Optional[IdentityResolver] = None,
        face_extractor=None,
    ) -> None:
        self.detector = detector or get_person_detector()
        self.tracker = tracker or get_person_tracker()
        self.state = state or RollingPersonStateStore()
        self.identity = identity_resolver or UnknownIdentityResolver()
        self.face = face_extractor or get_face_extractor()
        self.pose = PoseFeatureExtractor()
        self.movement = MovementFeatureExtractor()
        self.quality = QualityEngine()
        self.temporal = TemporalFeatureExtractor(window_seconds=settings.ai_risk_window_seconds)
        self.risk = RiskEngine()
        self.drowsiness = DrowsinessMonitor()
        self.subject = SubjectSelector()
        self._analysis_cache: Dict[str, Dict[str, Any]] = {}
        self._evaluated_at: Dict[str, datetime] = {}

    def reset(self) -> None:
        self.tracker.reset()
        self.state.reset()
        self.risk.reset()
        self.drowsiness.reset()
        self.subject.reset()
        self._analysis_cache.clear()
        self._evaluated_at.clear()

    def _analyse(self, track_id: str, history: list, now: datetime, is_subject: bool) -> Dict[str, Any]:
        """Risk + drowsiness for the interview subject; only the lying check for anyone else."""
        cached = self._analysis_cache.get(track_id)
        last = self._evaluated_at.get(track_id)
        interval = settings.ai_risk_eval_interval_ms / 1000.0
        fresh = (
            cached is not None
            and cached['subject'] == is_subject
            and last is not None
            and (now - last).total_seconds() < interval
        )
        if fresh:
            return cached

        if is_subject:
            features = self.temporal.compute(history)
            lying = features.get('lying')
            if settings.ai_risk_enabled:
                risk = self.risk.update(track_id, features, now)
                risk['features'] = features
            else:
                risk = {'status': INSUFFICIENT, 'confidence': None, 'modelVersion': MODEL_VERSION}
            drowsiness = (
                self.drowsiness.update(track_id, history, now)
                if settings.ai_drowsiness_enabled else None
            )
        else:
            # Leaving the subject role ends any open episode for this track.
            self.risk.forget(track_id)
            self.drowsiness.forget(track_id)
            lying = self.temporal.lying(history)
            risk = {
                'status': NOT_ASSESSED,
                'confidence': None,
                'episode': None,
                'limitations': ['Not the interview subject — visual indicators not assessed'],
                'modelVersion': MODEL_VERSION,
            }
            drowsiness = None

        result = {
            'subject': is_subject,
            'risk': risk,
            'drowsiness': drowsiness,
            'notices': [LYING_DOWN] if (lying or {}).get('lyingDown') else [],
        }
        self._analysis_cache[track_id] = result
        self._evaluated_at[track_id] = now
        return result

    def close(self) -> None:
        self.reset()
        self.face.close()

    def process(
        self,
        session_id: str,
        frame_bgr: np.ndarray,
        timestamp: Optional[datetime] = None,
        raw_bytes: Optional[bytes] = None,
    ) -> Dict[str, Any]:
        now = timestamp or _utc_now()
        if hasattr(self.detector, 'set_raw_hint'):
            self.detector.set_raw_hint(raw_bytes)
        detections = self.detector.detect(frame_bgr)
        tracked = self.tracker.update(detections, now)
        active_ids = [item.track_id for item in tracked]
        # Keep state for temporarily lost tracks until tracker drops them.
        retained = list({*active_ids, *self.tracker.known_track_ids()})
        self.state.drop_missing(retained)
        self.risk.drop_missing(retained)
        self.drowsiness.drop_missing(retained)
        for track_id in list(self._analysis_cache):
            if track_id not in retained:
                self._analysis_cache.pop(track_id, None)
                self._evaluated_at.pop(track_id, None)

        persons: List[dict] = []
        frame_stats = self.quality.frame_stats(frame_bgr) if tracked else None
        aspect = frame_bgr.shape[1] / frame_bgr.shape[0] if frame_bgr.shape[0] else 1.0
        subject_id = self.subject.select(tracked, retained, now, aspect)
        for person in tracked:
            is_subject = person.track_id == subject_id
            existing = self.state.get(person.track_id)
            history = existing.history if existing else []
            # Face mesh is the costliest step; only the interview subject needs it.
            face = (
                self.face.extract(frame_bgr, person.bounding_box, person.keypoints)
                if is_subject else dict(_FACE_SKIPPED)
            )
            pose = self.pose.extract(person.bounding_box, person.keypoints, aspect=aspect)
            movement = self.movement.extract(
                history,
                person.bounding_box,
                lower_body_visible=bool(pose.get('lowerBodyVisible')),
                gait_available=bool(pose.get('gaitAvailable')),
                current_pose=pose,
            )
            quality = self.quality.assess(
                frame_bgr,
                person.bounding_box,
                face_visible=bool(face.get('visible')),
                body_visible=bool(pose.get('visible')),
                lower_body_visible=bool(pose.get('lowerBodyVisible')),
                face_quality=face.get('quality'),
                frame_stats=frame_stats,
            )
            identity = self.identity.resolve(person, frame_bgr, existing).to_dict()
            rollup = self.state.upsert(
                person,
                face=face,
                pose=pose,
                movement=movement,
                quality=quality,
                identity=identity,
                timestamp=now,
            )
            analysis = self._analyse(person.track_id, rollup.history, now, is_subject)
            risk = analysis['risk']
            # Quality suppresses displayed identity confidence (still null in Phase 10).
            identity_confidence = rollup.identity_confidence
            if identity_confidence is not None and quality.get('score', 1) < 0.4:
                identity_confidence = round(identity_confidence * float(quality['score']), 4)

            persons.append({
                'trackId': person.track_id,
                'role': 'subject' if is_subject else 'other',
                'notices': analysis['notices'],
                'identity': {
                    'status': rollup.identity.get('status', 'UNKNOWN'),
                    'displayName': rollup.identity.get('displayName'),
                    'userId': rollup.identity.get('userId'),
                    'confidence': identity_confidence,
                },
                'tracking': {
                    'confidence': round(person.tracking_confidence, 4),
                    'ageFrames': person.age_frames,
                    'boundingBox': person.bounding_box.to_dict(),
                },
                'face': {
                    'visible': face.get('visible'),
                    'quality': face.get('quality'),
                    'boundingBox': face.get('boundingBox'),
                    'headPose': face.get('headPose'),
                    'eyes': face.get('eyes'),
                    'mouth': face.get('mouth'),
                    'landmarkAvailability': face.get('landmarkAvailability'),
                    'signalsAvailable': face.get('signalsAvailable', []),
                },
                'body': {
                    'visible': pose.get('visible'),
                    'lowerBodyVisible': pose.get('lowerBodyVisible'),
                    'gaitAvailable': pose.get('gaitAvailable'),
                    'bodyVisibility': pose.get('bodyVisibility'),
                    'keypointCoverage': pose.get('keypointCoverage'),
                    'torsoAngle': pose.get('torsoAngle'),
                    'shoulderAlignment': pose.get('shoulderAlignment'),
                    'keypoints': pose.get('keypoints'),
                    'source': pose.get('source'),
                    'signalsAvailable': pose.get('signalsAvailable', []),
                },
                'movement': movement,
                'quality': {
                    'score': quality.get('score'),
                    'faceVisible': quality.get('faceVisible'),
                    'bodyVisible': quality.get('bodyVisible'),
                    'lowerBodyVisible': quality.get('lowerBodyVisible'),
                },
                # Visual-indicator status stays separate from identity confidence.
                'impairment': risk,
                'visualStatus': risk['status'],
                'drowsiness': analysis['drowsiness'],
                'historyLength': len(rollup.history),
            })

        return {
            'sessionId': str(session_id),
            'timestamp': now.isoformat(),
            'detector': self.detector.provider_name,
            'tracker': getattr(self.tracker, 'provider_name', 'unknown'),
            'faceProvider': getattr(self.face, 'provider_name', 'unknown'),
            'personCount': len(persons),
            'subjectTrackId': subject_id,
            'persons': persons,
            'trackingWindowSeconds': settings.ai_tracking_window_seconds,
            'awsCalls': 0,
            'riskModelVersion': MODEL_VERSION,
            'limitations': {
                'noContinuousRekognition': True,
                'noImpairmentClassifier': True,
                'ruleBasedVisualIndicators': True,
                'identityDefaultUnknown': True,
                'doesNotConfirmAlcoholConsumption': True,
            },
        }


# One pipeline per AI session (job id).
_pipelines: Dict[int, FrameProcessingPipeline] = {}


def get_session_pipeline(job_id: int) -> FrameProcessingPipeline:
    pipeline = _pipelines.get(job_id)
    if pipeline is None:
        pipeline = FrameProcessingPipeline()
        _pipelines[job_id] = pipeline
    return pipeline


def drop_session_pipeline(job_id: int) -> None:
    pipeline = _pipelines.pop(job_id, None)
    if pipeline:
        pipeline.close()
