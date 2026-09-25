from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional

from app.config import settings

logger = logging.getLogger('rmo-ai-service')


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class SessionState:
    job_id: int
    call_id: int
    division_id: int
    lobby_id: int
    status: str = 'STARTING'
    frames_received: int = 0
    frames_processed: int = 0
    last_frame_at: Optional[datetime] = None
    started_at: datetime = field(default_factory=utc_now)
    stopped_at: Optional[datetime] = None
    last_accepted_at: Optional[datetime] = None
    error_message: Optional[str] = None
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def snapshot(self) -> dict:
        with self._lock:
            elapsed = max((utc_now() - self.started_at).total_seconds(), 0.001)
            fps = self.frames_processed / elapsed if self.status == 'RUNNING' else 0.0
            return {
                'jobId': self.job_id,
                'callId': self.call_id,
                'divisionId': self.division_id,
                'lobbyId': self.lobby_id,
                'status': self.status,
                'framesReceived': self.frames_received,
                'framesProcessed': self.frames_processed,
                'lastFrameAt': self.last_frame_at.isoformat() if self.last_frame_at else None,
                'processingFps': round(fps, 3),
                'startedAt': self.started_at.isoformat(),
                'stoppedAt': self.stopped_at.isoformat() if self.stopped_at else None,
                'errorMessage': self.error_message,
            }


class SessionStore:
    def __init__(self) -> None:
        self._sessions: Dict[int, SessionState] = {}
        self._lock = threading.Lock()
        self._test_thread: Optional[threading.Thread] = None
        self._stop_test = threading.Event()

    def start(self, job_id: int, call_id: int, division_id: int, lobby_id: int) -> SessionState:
        with self._lock:
            existing = self._sessions.get(job_id)
            if existing and existing.status in {'STARTING', 'RUNNING'}:
                return existing
            session = SessionState(
                job_id=job_id,
                call_id=call_id,
                division_id=division_id,
                lobby_id=lobby_id,
                status='RUNNING',
            )
            self._sessions[job_id] = session
            logger.info(
                'AI_SESSION_STARTED jobId=%s callId=%s divisionId=%s lobbyId=%s',
                job_id,
                call_id,
                division_id,
                lobby_id,
            )
            if settings.ai_dev_test_stream:
                self._ensure_test_stream()
            return session

    def stop(self, job_id: int) -> Optional[SessionState]:
        with self._lock:
            session = self._sessions.get(job_id)
            if not session:
                return None
            if session.status in {'STOPPED', 'STOPPING'}:
                return session
            session.status = 'STOPPING'
            session.status = 'STOPPED'
            session.stopped_at = utc_now()
            logger.info('AI_SESSION_STOPPED jobId=%s callId=%s', job_id, session.call_id)
            return session

    def get(self, job_id: int) -> Optional[SessionState]:
        with self._lock:
            return self._sessions.get(job_id)

    def ingest_frame(self, job_id: int, payload: bytes) -> SessionState:
        session = self.get(job_id)
        if not session:
            raise KeyError('session_not_found')
        with session._lock:
            if session.status != 'RUNNING':
                raise RuntimeError('session_not_running')
            if len(payload) > settings.ai_max_frame_bytes:
                raise ValueError('frame_too_large')
            now = utc_now()
            session.frames_received += 1
            interval = max(settings.ai_frame_interval_ms, 1) / 1000.0
            accept = (
                session.last_accepted_at is None
                or (now - session.last_accepted_at).total_seconds() >= interval
            )
            if accept:
                session.last_accepted_at = now
                session.frames_processed += 1
                session.last_frame_at = now
                if session.frames_processed == 1 or session.frames_processed % 5 == 0:
                    logger.info(
                        'AI_FRAME_PROCESSED jobId=%s callId=%s framesReceived=%s '
                        'framesProcessed=%s bytes=%s',
                        job_id,
                        session.call_id,
                        session.frames_received,
                        session.frames_processed,
                        len(payload),
                    )
            # Frame bytes are discarded after counting — no inference in Phase 6.
            return session

    def mark_error(self, job_id: int, message: str) -> None:
        session = self.get(job_id)
        if not session:
            return
        with session._lock:
            session.status = 'ERROR'
            session.error_message = message
            session.stopped_at = utc_now()
            logger.error('AI_FRAME_PROCESSING_ERROR jobId=%s message=%s', job_id, message)

    def active_count(self) -> int:
        with self._lock:
            return sum(1 for item in self._sessions.values() if item.status == 'RUNNING')

    def _ensure_test_stream(self) -> None:
        if self._test_thread and self._test_thread.is_alive():
            return
        self._stop_test.clear()
        self._test_thread = threading.Thread(target=self._run_test_stream, daemon=True)
        self._test_thread.start()
        logger.info('AI_STREAM_CONNECTED source=dev-test-stream')

    def _run_test_stream(self) -> None:
        """DEVELOPMENT ONLY — synthesizes tiny JPEG-like payloads without a camera."""
        interval = max(settings.ai_frame_interval_ms, 1) / 1000.0
        # Minimal JPEG SOI/EOI markers; not a real image decoder path.
        fake = b'\xff\xd8\xff\xd9'
        while not self._stop_test.is_set():
            with self._lock:
                running = [s for s in self._sessions.values() if s.status == 'RUNNING']
            for session in running:
                try:
                    self.ingest_frame(session.job_id, fake)
                except Exception as exc:  # noqa: BLE001
                    self.mark_error(session.job_id, str(exc))
            time.sleep(interval)


store = SessionStore()
