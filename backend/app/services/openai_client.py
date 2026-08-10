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
async def _create_response(**kwargs):
    return await _client.responses.create(**kwargs)


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


def _build_input(input_text: str, input_images: list[str] | None):
    """§12.2: images ride along as direct vision context for the turn only.
    Plain string input when there are none (unchanged, lowest-risk path);
    a structured multimodal message when there are.
    """
    if not input_images:
        return input_text
    content: list[dict] = [{"type": "input_text", "text": input_text}]
    content += [{"type": "input_image", "image_url": img, "detail": "auto"} for img in input_images]
    return [{"role": "user", "content": content}]


def _generation_kwargs(
    model: str | None,
    temperature: float | None,
    instructions: str,
    input_text: str,
    input_images: list[str] | None = None,
) -> dict:
    kwargs: dict = {
        "model": model or settings.openai_model,
        "instructions": instructions,
        "input": _build_input(input_text, input_images),
    }
    # Some model families reject `temperature` entirely, so it's only sent
    # when an admin has explicitly set one (see admin_settings_service).
    if temperature is not None:
        kwargs["temperature"] = temperature
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
    temperature: float | None = None,
    input_images: list[str] | None = None,
) -> AsyncIterator[StreamEvent]:
    """Streams a Responses API generation, yielding text deltas followed by one
    final `done` event carrying the full text and token usage. Retry/circuit
    breaking applies to establishing the stream (the part that can fail on
    network/rate-limit/auth errors) - once tokens start arriving there's
    nothing sensible to "retry" without restarting the whole generation.
    """
    stream = await _resilient_call(
        _create_response,
        **_generation_kwargs(model, temperature, instructions, input_text, input_images),
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
    *, instructions: str, input_text: str, model: str | None = None, temperature: float | None = None
) -> str:
    """Single non-streaming Responses API call, for short auxiliary generations
    (query rewriting, memory summarization) that need one final string, not a
    token-by-token stream to a client.
    """
    response = await _resilient_call(
        _create_response,
        **_generation_kwargs(model, temperature, instructions, input_text),
        stream=False,
    )
    return response.output_text


async def generate_with_web_search(
    *,
    instructions: str,
    input_text: str,
    model: str | None = None,
) -> str:
    """A generation that can search the web before answering.

    The Responses API runs the tool itself and hands back the finished text,
    so from here it is the same shape as `generate_text` - the difference is
    that the model can go and look something up first. No temperature: search
    grounding wants the least creative reading of what it found.
    """
    kwargs = _generation_kwargs(model, None, instructions, input_text)
    kwargs["tools"] = [{"type": "web_search"}]
    response = await _resilient_call(_create_response, **kwargs, stream=False)
    return response.output_text


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
