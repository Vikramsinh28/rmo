from __future__ import annotations

import logging
from typing import Annotated, Optional

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field

from app.config import settings
from app.impairment.factory import get_impairment_detector, impairment_capability_payload
from app.impairment.preprocess import validate_and_decode
from app.impairment.types import utc_now_iso
from app.sessions import store
from app.temporal.risk import MODEL_VERSION

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(name)s %(message)s',
)
logger = logging.getLogger('rmo-ai-service')

app = FastAPI(title='RMO AI Service', version=settings.service_version)


class StartBody(BaseModel):
    jobId: int = Field(..., ge=1)
    callId: int = Field(..., ge=1)
    divisionId: int = Field(..., ge=1)
    lobbyId: int = Field(..., ge=1)


def require_token(authorization: Annotated[Optional[str], Header()] = None) -> None:
    expected = f'Bearer {settings.ai_service_token}'
    if not authorization or authorization != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Unauthorized')


@app.get('/health')
def health() -> dict:
    return {'status': 'ok', 'service': settings.service_name}


@app.get('/ready')
def ready() -> dict:
    return {
        'status': 'ready',
        'service': settings.service_name,
        'activeSessions': store.active_count(),
        'frameIntervalMs': settings.ai_frame_interval_ms,
        'devTestStream': settings.ai_dev_test_stream,
    }


@app.get('/capabilities')
def capabilities() -> dict:
    impairment = impairment_capability_payload()
    return {
        'service': settings.service_name,
        'version': settings.service_version,
        'processing': {
            'frameExtraction': True,
            'personTracking': True,
            'faceIdentification': False,
            'fatigueDetection': False,
            # POC flag — not production-ready impairment / alcohol detection.
            'impairmentDetection': impairment['enabled'],
            'behaviorMonitoring': False,
        },
        'tracking': {
            'enabled': settings.ai_tracking_enabled,
            'provider': settings.ai_tracking_provider,
            'tracker': settings.ai_tracker_provider,
            'faceProvider': settings.ai_face_provider,
            'poseModel': settings.ai_pose_model,
            'frameIntervalMs': settings.ai_frame_interval_ms,
            'visualIndicatorEngine': MODEL_VERSION if settings.ai_risk_enabled else None,
            'riskWindowSeconds': settings.ai_risk_window_seconds,
            'windowSeconds': settings.ai_tracking_window_seconds,
            'continuousRekognition': False,
            'impairmentClassifier': False,
        },
        'impairmentPoc': impairment,
    }


@app.get('/status')
def status_all(_: None = Depends(require_token)) -> dict:
    return {
        'service': settings.service_name,
        'activeSessions': store.active_count(),
    }


@app.get('/sessions/{job_id}/status')
def session_status(job_id: int, _: None = Depends(require_token)) -> dict:
    session = store.get(job_id)
    if not session:
        raise HTTPException(status_code=404, detail='Session not found')
    return session.snapshot()


@app.post('/sessions/start')
def start_session(body: StartBody, _: None = Depends(require_token)) -> dict:
    session = store.start(body.jobId, body.callId, body.divisionId, body.lobbyId)
    return session.snapshot()


@app.post('/sessions/{job_id}/stop')
def stop_session(job_id: int, _: None = Depends(require_token)) -> dict:
    session = store.stop(job_id)
    if not session:
        raise HTTPException(status_code=404, detail='Session not found')
    return session.snapshot()


@app.post('/sessions/{job_id}/frames')
async def ingest_frame(
    job_id: int,
    request: Request,
    _: None = Depends(require_token),
) -> dict:
    payload = await request.body()
    if not payload:
        raise HTTPException(status_code=400, detail='Empty frame')
    try:
        session = store.ingest_frame(job_id, payload)
    except KeyError:
        raise HTTPException(status_code=404, detail='Session not found') from None
    except RuntimeError:
        raise HTTPException(status_code=409, detail='Session is not running') from None
    except ValueError:
        raise HTTPException(status_code=413, detail='Frame too large') from None
    except Exception as exc:  # noqa: BLE001
        store.mark_error(job_id, 'frame_ingest_failed')
        logger.exception('AI_FRAME_PROCESSING_ERROR jobId=%s', job_id)
        raise HTTPException(status_code=500, detail='Frame processing failed') from exc
    return session.snapshot()


@app.post('/sessions/{job_id}/process-frame')
async def process_frame(
    job_id: int,
    _: None = Depends(require_token),
    frame: UploadFile = File(...),
) -> dict:
    """
    Phase 10 — person tracking + visual features for one frame.

    No AWS Rekognition. No impairment classification.
    Identity defaults to UNKNOWN. Frame bytes are discarded.
    """
    from app.processing.decode import decode_image_bgr
    from app.processing.pipeline import get_session_pipeline
    from app.sessions import utc_now as session_utc_now

    session = store.get(job_id)
    if not session:
        raise HTTPException(status_code=404, detail='Session not found')
    if session.status != 'RUNNING':
        raise HTTPException(status_code=409, detail='Session is not running')

    raw = await frame.read()
    if len(raw) > settings.ai_max_frame_bytes:
        raise HTTPException(status_code=413, detail='Frame too large')
    try:
        image = decode_image_bgr(raw)
        result = get_session_pipeline(job_id).process(str(job_id), image, raw_bytes=raw)
        with session._lock:
            session.latest_tracking = result
            session.frames_received += 1
            session.frames_processed += 1
            session.last_frame_at = session_utc_now()
        return result
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception('AI_PROCESS_FRAME_FAILED jobId=%s liveCallAffected=false', job_id)
        raise HTTPException(status_code=500, detail='Frame processing failed') from exc
    finally:
        raw = b''


@app.post('/impairment/analyze')
async def analyze_impairment(
    _: None = Depends(require_token),
    frame: UploadFile = File(...),
) -> dict:
    """
    Phase 9A POC — single-frame potential impairment indicator analysis.

    Does NOT confirm alcohol consumption or intoxication.
    Does NOT integrate with live WebRTC sessions.
    Image bytes are discarded after analysis.
    """
    raw = await frame.read()
    content_type = (frame.content_type or '').lower()
    if content_type and content_type not in {
        'image/jpeg',
        'image/jpg',
        'image/png',
        'application/octet-stream',
    }:
        raise HTTPException(status_code=400, detail='INVALID_IMAGE')

    preprocessed = validate_and_decode(raw)
    detector = get_impairment_detector()
    logger.info(
        'IMPAIRMENT_ANALYZE_REQUESTED provider=%s bytes=%s width=%s height=%s',
        detector.provider_name,
        preprocessed.byte_length,
        preprocessed.width,
        preprocessed.height,
    )
    try:
        analysis = detector.analyze(preprocessed)
        payload = {
            'success': True,
            'analysis': analysis.to_dict(),
            'provider': detector.provider_name,
            'developmentOnly': detector.development_only,
            'analyzedAt': utc_now_iso(),
            'limitations': {
                'singleFrameOnly': True,
                'pocOnly': True,
                'doesNotConfirmAlcoholConsumption': True,
                'doesNotConfirmIntoxication': True,
                'requiresHumanVerification': True,
            },
        }
        logger.info(
            'IMPAIRMENT_ANALYZE_COMPLETED provider=%s status=%s risk=%s review=%s',
            detector.provider_name,
            analysis.status.value,
            analysis.risk_level.value,
            analysis.requires_human_review,
        )
        return payload
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception('IMPAIRMENT_ANALYZE_FAILED provider=%s', detector.provider_name)
        raise HTTPException(
            status_code=503,
            detail='ANALYSIS_UNAVAILABLE',
        ) from exc
    finally:
        # Discard temporary image references; never persist POC frames.
        raw = b''
        preprocessed = None
