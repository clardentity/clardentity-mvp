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
    # Measured against this account on 2026-08-10, streaming the same prompt:
    #   gpt-5                        6.87s to first token,  7.80s total
    #   gpt-5-mini    (low effort)   1.95s to first token,  4.73s total
    #   gpt-5.4-mini  (low effort)   0.98s to first token,  1.91s total
    # gpt-5 spends most of that budget reasoning before emitting anything,
    # which is the worst possible shape for a streaming chat UI - the user
    # watches a blank box for seven seconds and concludes streaming is broken.
    openai_model: str = "gpt-5.4-mini"
    # Classification, query rewriting, verification, supervision. Each is a
    # short structured judgement, none of them is the answer, and all of them
    # sit between the user and something they're waiting for.
    openai_fast_model: str = "gpt-5.4-nano"
    # gpt-5 family are reasoning models; effort is the single biggest lever on
    # latency. "low" still reasons, it just doesn't deliberate.
    openai_reasoning_effort: str = "low"
    openai_embedding_model: str = "text-embedding-3-small"

    # Claude powers everything the product reasons with. OpenAI is retained
    # above only for embeddings, transcription, speech and the realtime call -
    # Anthropic has no equivalent of any of those.
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-opus-5"
    # Auxiliary judgements (guidance, clarifier, verification, reviews) run on
    # this one. Every one of them sits between the user and something they are
    # waiting for - the mode and context gates block the answer outright - so
    # the tier is chosen for latency, on the owner's instruction rather than as
    # a cost saving taken unilaterally. The streamed answer itself stays on the
    # model above.
    anthropic_fast_model: str = "claude-sonnet-5"
    # Depth and spend per call. "low" preserves the latency posture the
    # previous provider was tuned to; blank leaves the model's own default.
    anthropic_effort: str = "low"
    openai_stt_model: str = "whisper-1"
    openai_tts_model: str = "tts-1"
    openai_tts_voice: str = "alloy"
    # Live call. A speech-to-speech model, separate from the text pipeline
    # above: a call cannot afford a retrieve-verify-score round trip between
    # turns, so it trades the citation machinery for latency a conversation
    # can survive.
    openai_realtime_model: str = "gpt-realtime-2.1"
    openai_realtime_voice: str = "marin"

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
