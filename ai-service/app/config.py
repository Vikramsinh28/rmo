from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    service_name: str = 'rmo-ai-service'
    service_version: str = '0.1.0'
    ai_service_token: str = 'local-ai-service-token'
    ai_frame_interval_ms: int = 1000
    ai_max_frame_bytes: int = 512_000
    ai_dev_test_stream: bool = False
    ai_session_idle_timeout_sec: int = 120
    # Phase 9A — impairment POC. Default mock. Never invent a medical model.
    impairment_detector_provider: str = 'mock'
    impairment_max_frame_bytes: int = 2_000_000
    mock_impairment_result: Optional[str] = None
    # Phase 9B — optional candidate model (server-side only; never from HTTP client).
    impairment_model_path: Optional[str] = None
    impairment_model_device: str = 'cpu'
    impairment_model_timeout_ms: int = 5000
    # Phase 10 — person tracking / visual feature pipeline (no AWS, no impairment classifier).
    ai_tracking_enabled: bool = True
    ai_tracking_provider: str = 'hog'  # hog | mock
    ai_tracking_window_seconds: int = 30
    ai_tracking_max_lost_frames: int = 15
    ai_tracking_iou_threshold: float = 0.3


settings = Settings()
