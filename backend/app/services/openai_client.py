"""What is still OpenAI, and why.

Text generation moved to Claude (see anthropic_client.py) as the primary
path. Embeddings, transcription, speech and realtime never moved, because
Anthropic has no equivalent API for any of them:

  embeddings     - retrieval is pgvector over OpenAI embedding vectors. Moving
                   providers changes the vector dimension, which means
                   re-embedding every stored chunk behind a migration, not a
                   config change.
  transcription  - /audio/transcribe.
  speech         - "Listen to this answer".
  realtime       - the live call, which talks to OpenAI directly from the
                   browser (see api/realtime.py); its key never leaves the
                   server.

Text generation (stream_generation/generate_text/generate_structured) was
restored below, not because callers use this module directly - they don't,
they still import from anthropic_client.py - but as the fallback provider
that anthropic_client routes to automatically when Claude is unavailable
(credit exhausted, down, rate-limited). See the routing logic and
`_should_fallback` in anthropic_client.py.
"""

import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Literal, TypedDict

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


@_retry_openai
async def _create_response(**kwargs):
    return await _client.responses.create(**kwargs)


async def _resilient_call(fn, **kwargs):
    _circuit_breaker.before_call()
    try:
        result = await fn(**kwargs)
    except Exception:
        _circuit_breaker.record_failure()
        raise
    _circuit_breaker.record_success()
    return result


def _build_input(input_text: str, input_images: list[str] | None):
    """Images ride along as direct vision context for the turn only. Plain
    string input when there are none, a structured multimodal message when
    there are - mirrors what Claude's fallback caller already assembled from
    the same data URIs."""
    if not input_images:
        return input_text
    content: list[dict] = [{"type": "input_text", "text": input_text}]
    content += [{"type": "input_image", "image_url": img, "detail": "auto"} for img in input_images]
    return [{"role": "user", "content": content}]


def _generation_kwargs(
    model: str | None,
    instructions: str,
    input_text: str,
    input_images: list[str] | None = None,
    fast: bool = False,
) -> dict:
    resolved = model or (settings.openai_fast_model if fast else settings.openai_model)
    kwargs: dict = {
        "model": resolved,
        "instructions": instructions,
        "input": _build_input(input_text, input_images),
    }
    effort = settings.openai_reasoning_effort
    if effort and resolved.startswith(("gpt-5", "o1", "o3", "o4")):
        kwargs["reasoning"] = {"effort": effort}
    return kwargs


class DeltaEvent(TypedDict):
    type: Literal["delta"]
    text: str


class DoneEvent(TypedDict):
    type: Literal["done"]
    full_text: str
    input_tokens: int
    output_tokens: int


StreamEvent = DeltaEvent | DoneEvent


async def stream_generation(
    *,
    instructions: str,
    input_text: str,
    model: str | None = None,
    input_images: list[str] | None = None,
) -> AsyncIterator[StreamEvent]:
    """Fallback streaming path. Used only when Claude's own stream failed to
    open at all (see anthropic_client.stream_generation) - never mid-stream,
    since a generation already in flight cannot be handed to a second
    provider without duplicating text the user has already seen."""
    stream = await _resilient_call(
        _create_response,
        **_generation_kwargs(model, instructions, input_text, input_images),
        stream=True,
    )

    async for event in stream:
        if event.type == "response.output_text.delta":
            yield {"type": "delta", "text": event.delta}
        elif event.type == "response.completed":
            response = event.response
            usage = response.usage
            yield {
                "type": "done",
                "full_text": response.output_text,
                "input_tokens": usage.input_tokens if usage else 0,
                "output_tokens": usage.output_tokens if usage else 0,
            }
        elif event.type in ("response.failed", "error"):
            message = getattr(getattr(event, "response", None), "error", None) or getattr(
                event, "message", "OpenAI generation failed"
            )
            raise RuntimeError(str(message))


async def generate_text(
    *,
    instructions: str,
    input_text: str,
    model: str | None = None,
    fast: bool = False,
) -> str:
    """Fallback non-streaming path for short auxiliary generations."""
    response = await _resilient_call(
        _create_response,
        **_generation_kwargs(model, instructions, input_text, fast=fast),
        stream=False,
    )
    return response.output_text


class StructuredOutputError(RuntimeError):
    """The model returned something that isn't the requested object."""


async def generate_structured(
    *,
    instructions: str,
    input_text: str,
    schema: dict,
    schema_name: str,
    model: str | None = None,
    fast: bool = True,
    tools: list[dict] | None = None,
) -> dict:
    """Fallback structured path. `strict` requires the schema to name every
    property in `required` and set additionalProperties: false - the schemas
    in this codebase were written to satisfy exactly that before the Claude
    migration, so they're passed through unmodified here."""
    kwargs = _generation_kwargs(model, instructions, input_text, fast=fast)
    kwargs["text"] = {
        "format": {
            "type": "json_schema",
            "name": schema_name,
            "schema": schema,
            "strict": True,
        }
    }
    if tools:
        kwargs["tools"] = tools

    response = await _resilient_call(_create_response, **kwargs, stream=False)
    raw = response.output_text
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise StructuredOutputError(f"{schema_name}: not JSON: {raw[:200]}") from exc
    if not isinstance(parsed, dict):
        raise StructuredOutputError(f"{schema_name}: not an object: {raw[:200]}")
    return parsed


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
