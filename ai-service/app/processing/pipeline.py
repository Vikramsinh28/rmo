from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import numpy as np

from app.config import settings
from app.features.face_features import FaceFeatureExtractor
from app.features.movement_features import MovementFeatureExtractor
from app.features.pose_features import PoseFeatureExtractor
from app.features.quality import QualityEngine
from app.identity.resolver import IdentityResolver, UnknownIdentityResolver
from app.tracking.detector import PersonDetector, get_person_detector
from app.tracking.state import RollingPersonStateStore
from app.tracking.tracker import IoUPersonTracker, PersonTracker


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
    ) -> None:
        self.detector = detector or get_person_detector()
        self.tracker = tracker or IoUPersonTracker()
        self.state = state or RollingPersonStateStore()
        self.identity = identity_resolver or UnknownIdentityResolver()
        self.face = FaceFeatureExtractor()
        self.pose = PoseFeatureExtractor()
        self.movement = MovementFeatureExtractor()
        self.quality = QualityEngine()

    def reset(self) -> None:
        self.tracker.reset()
        self.state.reset()

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
        tracker_ids = active_ids + [
            t.track_id for t in getattr(self.tracker, '_tracks', {}).values()
            if t.track_id not in active_ids
        ]
        self.state.drop_missing(list({*tracker_ids}))

        persons: List[dict] = []
        for person in tracked:
            existing = self.state.get(person.track_id)
            history = existing.history if existing else []
            face = self.face.extract(frame_bgr, person.bounding_box)
            pose = self.pose.extract(person.bounding_box)
            movement = self.movement.extract(
                history,
                person.bounding_box,
                lower_body_visible=bool(pose.get('lowerBodyVisible')),
                gait_available=bool(pose.get('gaitAvailable')),
            )
            quality = self.quality.assess(
                frame_bgr,
                person.bounding_box,
                face_visible=bool(face.get('visible')),
                body_visible=bool(pose.get('visible')),
                lower_body_visible=bool(pose.get('lowerBodyVisible')),
                face_quality=face.get('quality'),
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
            # Quality suppresses displayed identity confidence (still null in Phase 10).
            identity_confidence = rollup.identity_confidence
            if identity_confidence is not None and quality.get('score', 1) < 0.4:
                identity_confidence = round(identity_confidence * float(quality['score']), 4)

            persons.append({
                'trackId': person.track_id,
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
                    'signalsAvailable': pose.get('signalsAvailable', []),
                },
                'movement': movement,
                'quality': {
                    'score': quality.get('score'),
                    'faceVisible': quality.get('faceVisible'),
                    'bodyVisible': quality.get('bodyVisible'),
                    'lowerBodyVisible': quality.get('lowerBodyVisible'),
                },
                'impairment': {
                    # Phase 10: no classifier. Identity and impairment stay separate.
                    'status': 'INSUFFICIENT_EVIDENCE',
                    'confidence': None,
                },
                'visualStatus': 'INSUFFICIENT_EVIDENCE',
                'historyLength': len(rollup.history),
            })

        return {
            'sessionId': str(session_id),
            'timestamp': now.isoformat(),
            'detector': self.detector.provider_name,
            'personCount': len(persons),
            'persons': persons,
            'trackingWindowSeconds': settings.ai_tracking_window_seconds,
            'awsCalls': 0,
            'limitations': {
                'noContinuousRekognition': True,
                'noImpairmentClassifier': True,
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
        pipeline.reset()
