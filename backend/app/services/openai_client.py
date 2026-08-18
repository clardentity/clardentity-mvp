"""What is still OpenAI, and why.

Text generation moved to Claude (see anthropic_client.py). These four did not,
because Anthropic has no equivalent API for any of them:

  embeddings     - retrieval is pgvector over OpenAI embedding vectors. Moving
                   providers changes the vector dimension, which means
                   re-embedding every stored chunk behind a migration, not a
                   config change.
  transcription  - /audio/transcribe.
  speech         - "Listen to this answer".
  realtime       - the live call, which talks to OpenAI directly from the
                   browser (see api/realtime.py); its key never leaves the
                   server.

So this file is now a narrow adapter for the capabilities Claude does not
offer, not the model layer.
"""

import logging
import time
from typing import TypedDict

from openai import AsyncOpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import settings

logger = logging.getLogger("clardentity.openai")

_client = AsyncOpenAI(api_key=settings.openai_api_key)


class CircuitBreakerOpenError(RuntimeError):
    pass


class _CircuitBreaker:
    """§14 resilience: short-circuits calls after repeated failures instead
    of letting every request queue up retries against a service that's
    already down. Half-opens after the cooldown to test recovery.
    """

    def __init__(self, failure_threshold: int = 5, cooldown_seconds: float = 30.0) -> None:
        self.failure_threshold = failure_threshold
        self.cooldown_seconds = cooldown_seconds
        self._consecutive_failures = 0
        self._opened_at: float | None = None

    def before_call(self) -> None:
        if self._opened_at is None:
            return
        if time.monotonic() - self._opened_at < self.cooldown_seconds:
            raise CircuitBreakerOpenError(
                "OpenAI circuit breaker is open (too many recent failures) - try again shortly"
            )
        self._opened_at = None  # cooldown elapsed, allow a half-open trial

    def record_success(self) -> None:
        self._consecutive_failures = 0
        self._opened_at = None

    def record_failure(self) -> None:
        self._consecutive_failures += 1
        if self._consecutive_failures >= self.failure_threshold and self._opened_at is None:
            self._opened_at = time.monotonic()
            logger.error(
                "OpenAI circuit breaker opened after %d consecutive failures",
                self._consecutive_failures,
            )


_circuit_breaker = _CircuitBreaker()

# Max 3 attempts, exponential backoff, per §14.
_retry_openai = retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    reraise=True,
)


@_retry_openai
async def _create_embeddings(**kwargs):
    return await _client.embeddings.create(**kwargs)


async def _resilient_call(fn, **kwargs):
    _circuit_breaker.before_call()
    try:
        result = await fn(**kwargs)
    except Exception:
        _circuit_breaker.record_failure()
        raise
    _circuit_breaker.record_success()
    return result


_EMBEDDING_BATCH_SIZE = 100


async def embed_text(text: str, model: str | None = None) -> list[float]:
    result = await _resilient_call(
        _create_embeddings, model=model or settings.openai_embedding_model, input=text
    )
    return result.data[0].embedding


async def embed_texts(texts: list[str], model: str | None = None) -> list[list[float]]:
    embeddings: list[list[float]] = []
    for i in range(0, len(texts), _EMBEDDING_BATCH_SIZE):
        batch = texts[i : i + _EMBEDDING_BATCH_SIZE]
        result = await _resilient_call(
            _create_embeddings, model=model or settings.openai_embedding_model, input=batch
        )
        embeddings.extend(item.embedding for item in result.data)
    return embeddings


@_retry_openai
async def _create_transcription(**kwargs):
    return await _client.audio.transcriptions.create(**kwargs)


@_retry_openai
async def _create_speech(**kwargs):
    return await _client.audio.speech.create(**kwargs)


class TranscriptionResult(TypedDict):
    transcript: str
    duration_seconds: float | None


async def transcribe_audio(
    file_bytes: bytes, filename: str, model: str | None = None
) -> TranscriptionResult:
    """§12.1: forwards recorded/uploaded audio to OpenAI's speech-to-text
    endpoint. verbose_json gets us duration alongside the transcript in one
    call, matching the /audio/transcribe response shape (§11.4).
    """
    result = await _resilient_call(
        _create_transcription,
        file=(filename, file_bytes),
        model=model or settings.openai_stt_model,
        response_format="verbose_json",
    )
    return {"transcript": result.text, "duration_seconds": getattr(result, "duration", None)}


async def generate_speech(text: str, voice: str | None = None, model: str | None = None) -> bytes:
    """§12.1: on-demand TTS for an assistant response (not generated by
    default, to save cost). Returns raw mp3 bytes.
    """
    response = await _resilient_call(
        _create_speech,
        input=text,
        model=model or settings.openai_tts_model,
        voice=voice or settings.openai_tts_voice,
        response_format="mp3",
    )
    return response.content
