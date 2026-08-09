from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # OpenAI
    openai_api_key: str
    openai_model: str = "gpt-5"
    openai_embedding_model: str = "text-embedding-3-small"
    openai_stt_model: str = "whisper-1"
    openai_tts_model: str = "tts-1"
    openai_tts_voice: str = "alloy"

    # Database
    database_url: str

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # S3-compatible storage
    s3_endpoint: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "clardentity-dev"
    s3_region: str = "us-east-1"

    # Auth
    jwt_secret: str
    jwt_access_token_expire_minutes: int = 15
    jwt_refresh_token_expire_days: int = 30
    google_client_id: str | None = None
    google_client_secret: str | None = None

    # Email (Resend). Unset disables sending entirely - registration must work
    # without an email provider configured.
    resend_api_key: str | None = None
    email_from: str = "Clardentity <onboarding@resend.dev>"
    # Where the welcome email's call to action points.
    app_url: str = "http://localhost:3000"

    # Misc
    backend_cors_origins: str = "http://localhost:3000"
    max_upload_size_mb: int = 25

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.backend_cors_origins.split(",") if origin.strip()]


settings = Settings()  # type: ignore[call-arg]
