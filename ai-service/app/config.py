from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    service_name: str = 'rmo-ai-service'
    service_version: str = '0.1.0'
    ai_service_token: str = 'local-ai-service-token'
    ai_frame_interval_ms: int = 200
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
    ai_tracking_provider: str = 'yolo'  # yolo | hog | mock (yolo falls back to hog)
    ai_tracking_window_seconds: int = 30
    ai_tracking_max_lost_frames: int = 15
    ai_tracking_iou_threshold: float = 0.3
    ai_tracking_max_history: int = 300
    # Phase 12 — pose model, ByteTrack and face mesh.
    ai_tracker_provider: str = 'bytetrack'  # bytetrack | iou (bytetrack falls back to iou)
    ai_pose_model: str = 'models/yolo11n-pose.pt'
    ai_pose_device: str = 'cpu'
    ai_pose_image_size: int = 640
    # 0 = min(4, cpu count). Ultralytics forces OMP_NUM_THREADS=1 on import.
    ai_pose_threads: int = 0
    ai_pose_min_confidence: float = 0.35
    ai_keypoint_min_confidence: float = 0.5
    ai_face_provider: str = 'mediapipe'  # mediapipe | haar (mediapipe falls back to haar)
    ai_face_landmarker_model: str = 'models/face_landmarker.task'
    # Phase 13 — temporal features + rule-based visual-indicator risk engine.
    ai_risk_enabled: bool = True
    ai_risk_window_seconds: float = 10.0
    ai_risk_eval_interval_ms: int = 1000
    # Sustained eye closure on the interview subject → "Possible drowsiness".
    ai_drowsiness_enabled: bool = True


settings = Settings()
