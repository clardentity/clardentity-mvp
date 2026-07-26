from collections.abc import AsyncIterator
from typing import Literal, TypedDict

from openai import AsyncOpenAI

from app.core.config import settings

_client = AsyncOpenAI(api_key=settings.openai_api_key)


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
    *, instructions: str, input_text: str, model: str | None = None
) -> AsyncIterator[StreamEvent]:
    """Streams a Responses API generation, yielding text deltas followed by one
    final `done` event carrying the full text and token usage.
    """
    stream = await _client.responses.create(
        model=model or settings.openai_model,
        instructions=instructions,
        input=input_text,
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
