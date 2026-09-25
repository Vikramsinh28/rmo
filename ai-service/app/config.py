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


settings = Settings()
