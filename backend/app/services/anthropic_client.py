"""Text generation, on Claude.

This is the model layer for everything the product *reasons* with: the streamed
answer, the auxiliary judgements (guidance, clarifier, claim verification,
reviews), and the structured decisions behind them. It replaced the OpenAI
Responses API wholesale.

What did NOT move, and could not
--------------------------------
Anthropic has no embeddings, speech-to-text, text-to-speech, or realtime
speech API. Retrieval (pgvector), audio transcription, "Listen to this answer",
and the live call therefore still run on OpenAI - see openai_client.py, which
now owns only those. Four of the five model surfaces this app uses stayed put;
the fifth is the one that mattered.

Three shape changes the caller does not see
-------------------------------------------
1. `temperature` is rejected by this model family (a 400, not a warning). The
   parameter survives in the signatures because admin settings can still set
   one, but it is dropped here rather than at every call site.
2. Structured output is `output_config.format`, and the schema is the whole
   contract - no separate `strict` flag, no name field.
3. `max_tokens` is required rather than optional, so every call now states its
   own ceiling instead of inheriting a service default.
"""

import base64
import json
import logging
import re
import time
from collections.abc import AsyncIterator
from typing import Literal, TypedDict

import anthropic
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import settings

logger = logging.getLogger("clardentity.anthropic")

_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

# An answer runs long; a judgement is a sentence or a small object. Sizing them
# apart keeps a runaway structured call from billing like an essay.
_ANSWER_MAX_TOKENS = 16000
_AUXILIARY_MAX_TOKENS = 4096

_DATA_URI = re.compile(r"^data:(?P<media_type>[^;,]+);base64,(?P<data>.+)$", re.DOTALL)


class CircuitBreakerOpenError(RuntimeError):
    pass


class _CircuitBreaker:
    """§14 resilience: short-circuits calls after repeated failures instead of
    letting every request queue up retries against a service already down.
    Half-opens after the cooldown to test recovery.
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
                "Model circuit breaker is open (too many recent failures) - try again shortly"
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
                "model circuit breaker opened after %d consecutive failures",
                self._consecutive_failures,
            )


_circuit_breaker = _CircuitBreaker()

_retry_model = retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    reraise=True,
)


@_retry_model
async def _create_message(**kwargs):
    return await _client.messages.create(**kwargs)


async def _resilient_call(fn, **kwargs):
    _circuit_breaker.before_call()
    try:
        result = await fn(**kwargs)
    except Exception:
        _circuit_breaker.record_failure()
        raise
    _circuit_breaker.record_success()
    return result


def _content_blocks(input_text: str, input_images: list[str] | None) -> list | str:
    """§12.2: images ride along as vision context for this turn only.

    The frontend sends data URIs. This API wants the media type and the base64
    payload as separate fields, so an image that does not parse is dropped
    rather than sent as a malformed block - one unreadable attachment should
    not cost the user their whole turn.
    """
    if not input_images:
        return input_text
    blocks: list[dict] = []
    for image in input_images:
        match = _DATA_URI.match(image.strip())
        if not match:
            logger.warning("dropping attachment that is not a base64 data URI")
            continue
        payload = match.group("data")
        try:
            base64.b64decode(payload, validate=True)
        except Exception:
            logger.warning("dropping attachment with undecodable base64")
            continue
        blocks.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": match.group("media_type"),
                    "data": payload,
                },
            }
        )
    blocks.append({"type": "text", "text": input_text})
    return blocks


def _base_kwargs(
    model: str | None,
    instructions: str,
    input_text: str,
    input_images: list[str] | None = None,
    effort: str | None = None,
    max_tokens: int = _AUXILIARY_MAX_TOKENS,
) -> dict:
    kwargs: dict = {
        "model": model or settings.anthropic_model,
        "max_tokens": max_tokens,
        "system": instructions,
        "messages": [{"role": "user", "content": _content_blocks(input_text, input_images)}],
    }
    # Effort is the depth-and-spend dial that replaced reasoning effort. Left
    # on the model's own default when unset rather than guessed at.
    resolved_effort = effort or settings.anthropic_effort
    if resolved_effort:
        kwargs["output_config"] = {"effort": resolved_effort}
    return kwargs


def _drop_temperature(temperature: float | None) -> None:
    # Sampling parameters are rejected outright by this model family. Admin
    # settings can still carry one from the previous provider, so it is dropped
    # here - once, with a log line - rather than 400-ing the user's turn.
    if temperature is not None:
        logger.info("ignoring temperature=%s: not supported by this model", temperature)


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
    """Streams the answer, yielding text deltas then one `done` event carrying
    the full text and token usage.

    Retry and circuit breaking cover establishing the stream - the part that
    fails on network, rate-limit or auth errors. Once tokens are arriving there
    is nothing sensible to retry without restarting the whole generation.
    """
    _drop_temperature(temperature)
    kwargs = _base_kwargs(
        model, instructions, input_text, input_images, max_tokens=_ANSWER_MAX_TOKENS
    )

    _circuit_breaker.before_call()
    try:
        async with _client.messages.stream(**kwargs) as stream:
            _circuit_breaker.record_success()
            async for text in stream.text_stream:
                yield {"type": "delta", "text": text}
            final = await stream.get_final_message()
    except Exception:
        _circuit_breaker.record_failure()
        raise

    yield {
        "type": "done",
        "full_text": "".join(b.text for b in final.content if b.type == "text"),
        "input_tokens": final.usage.input_tokens or 0,
        "output_tokens": final.usage.output_tokens or 0,
    }


async def generate_text(
    *,
    instructions: str,
    input_text: str,
    model: str | None = None,
    temperature: float | None = None,
    fast: bool = False,
) -> str:
    """One non-streaming call for short auxiliary generations (query rewriting,
    memory summarisation) that need a final string rather than a stream.

    `fast=True` routes to the auxiliary model. These calls are judgements about
    text, not the text itself - classifying a query, scoring an excerpt, naming
    a bias - and each one sits between the user and something they are waiting
    for.
    """
    _drop_temperature(temperature)
    response = await _resilient_call(
        _create_message,
        **_base_kwargs(
            model or (settings.anthropic_fast_model if fast else None),
            instructions,
            input_text,
        ),
    )
    return "".join(b.text for b in response.content if b.type == "text")


def _portable_schema(node):
    """Rewrite nullable enums into the form this API's validator accepts.

    `{"type": ["string", "null"], "enum": [...]}` is valid JSON Schema and was
    accepted by the previous provider; here it is a 400 ("Enum value 'knowing'
    does not match declared type"). The equivalent `anyOf` form is accepted.

    Done here rather than in the ten schema literals because it is a dialect
    difference between providers, not a decision about the data - a schema
    should describe what the field is, not which vendor is reading it.
    """
    if isinstance(node, list):
        return [_portable_schema(item) for item in node]
    if not isinstance(node, dict):
        return node

    out = {key: _portable_schema(value) for key, value in node.items()}
    types, enum = out.get("type"), out.get("enum")
    if isinstance(types, list) and "null" in types and isinstance(enum, list):
        concrete = [t for t in types if t != "null"]
        values = [v for v in enum if v is not None]
        rebuilt = {
            "anyOf": [
                {"type": concrete[0] if len(concrete) == 1 else concrete, "enum": values},
                {"type": "null"},
            ]
        }
        if "description" in out:
            rebuilt["description"] = out["description"]
        return rebuilt
    return out


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
    """A call whose answer is an object, not prose.

    Every internal step that needs a *decision* rather than a paragraph -
    classify this, score that, is a question needed - once asked for JSON in
    the prompt and parsed it back with a regex, code-fence stripping and a
    silent fallback to `{}`. The API enforces the shape instead, so a malformed
    response stops being a thing that happens.

    `schema_name` is retained for call-site readability and logging; this API
    keys off the schema itself, so there is nothing to send it as.
    """
    kwargs = _base_kwargs(
        model or (settings.anthropic_fast_model if fast else None),
        instructions,
        input_text,
    )
    kwargs["output_config"] = {
        **kwargs.get("output_config", {}),
        "format": {"type": "json_schema", "schema": _portable_schema(schema)},
    }
    if tools:
        kwargs["tools"] = tools

    response = await _resilient_call(_create_message, **kwargs)

    # A refusal is a successful HTTP call with no usable content. Left to the
    # caller's own error path, it would surface as an empty-object parse and
    # read like a bug in the feature rather than a declined request.
    if response.stop_reason == "refusal":
        raise StructuredOutputError(f"{schema_name}: declined by the model")

    raw = "".join(b.text for b in response.content if b.type == "text")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise StructuredOutputError(f"{schema_name}: not JSON: {raw[:200]}") from exc
    if not isinstance(parsed, dict):
        raise StructuredOutputError(f"{schema_name}: not an object: {raw[:200]}")
    return parsed
