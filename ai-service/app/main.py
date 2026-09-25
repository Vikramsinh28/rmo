from __future__ import annotations

import logging
from typing import Annotated, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.config import settings
from app.sessions import store

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
    return {
        'service': settings.service_name,
        'version': settings.service_version,
        'processing': {
            'frameExtraction': True,
            'faceIdentification': False,
            'fatigueDetection': False,
            'impairmentDetection': False,
            'behaviorMonitoring': False,
        },
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
