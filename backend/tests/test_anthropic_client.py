"""The provider-shim behaviour, which is where a migration hides its bugs.

The model calls themselves are verified by hand against the live API (see the
schema sweep in the migration commit). What is testable here is the translation
layer: the two places where this provider's contract differs from the last
one's, and where getting it wrong fails silently rather than loudly.
"""

import pytest

from app.services import openai_client
from app.services.anthropic_client import (
    CircuitBreakerOpenError,
    _content_blocks,
    _portable_schema,
    is_provider_unavailable_error,
)


class TestPortableSchema:
    """Nullable enums. `{"type": ["string","null"], "enum": [...]}` is valid
    JSON Schema and was accepted before; here it is a 400. Two real schemas
    use it, and both gate a turn."""

    def test_nullable_enum_becomes_anyof(self):
        out = _portable_schema(
            {"type": ["string", "null"], "enum": ["knowing", "thinking", None]}
        )
        assert out == {
            "anyOf": [
                {"type": "string", "enum": ["knowing", "thinking"]},
                {"type": "null"},
            ]
        }

    def test_description_survives_the_rewrite(self):
        out = _portable_schema(
            {"type": ["string", "null"], "enum": ["a", None], "description": "why"}
        )
        assert out["description"] == "why"

    def test_plain_nullable_types_are_left_alone(self):
        # These are accepted as-is; rewriting them would be churn.
        node = {"type": ["string", "null"], "description": "free text"}
        assert _portable_schema(node) == node

    def test_plain_enums_are_left_alone(self):
        node = {"type": "string", "enum": ["a", "b"]}
        assert _portable_schema(node) == node

    def test_it_reaches_nested_properties_and_arrays(self):
        out = _portable_schema(
            {
                "type": "object",
                "properties": {
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "mode": {"type": ["string", "null"], "enum": ["x", None]}
                            },
                        },
                    }
                },
            }
        )
        deep = out["properties"]["items"]["items"]["properties"]["mode"]
        assert "anyOf" in deep, "nested nullable enum was not rewritten"


class TestContentBlocks:
    """Attachments. The frontend sends data URIs; this API wants media type and
    payload as separate fields."""

    PNG = "data:image/png;base64,iVBORw0KGgo="

    def test_no_images_stays_a_plain_string(self):
        assert _content_blocks("hello", None) == "hello"

    def test_an_image_becomes_a_base64_source_block(self):
        blocks = _content_blocks("what is this", [self.PNG])
        assert blocks[0] == {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": "iVBORw0KGgo=",
            },
        }
        # Text last: the question should follow what it is asking about.
        assert blocks[-1] == {"type": "text", "text": "what is this"}

    @pytest.mark.parametrize(
        "bad", ["https://example.com/a.png", "data:image/png,notbase64", "", "   "]
    )
    def test_an_unparseable_attachment_is_dropped_not_sent(self, bad):
        # Sending a malformed block 400s the whole request. One bad attachment
        # should not cost the user their turn.
        blocks = _content_blocks("q", [bad])
        assert blocks == [{"type": "text", "text": "q"}]

    def test_undecodable_base64_is_dropped(self):
        blocks = _content_blocks("q", ["data:image/png;base64,!!!not-base64!!!"])
        assert blocks == [{"type": "text", "text": "q"}]

    def test_good_attachments_survive_a_bad_one(self):
        blocks = _content_blocks("q", ["nonsense", self.PNG])
        assert len([b for b in blocks if b["type"] == "image"]) == 1


class _FakeAPIError(Exception):
    """Stands in for anthropic/openai SDK exceptions, both of which carry a
    `status_code` attribute the same way."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class TestIsProviderUnavailableError:
    """What chat.py shows the user when a generation fails: this decides
    whether it's the generic 'reached today's limit' sentence (both Claude
    and its OpenAI fallback are unavailable) or a plain 'something went
    wrong' - never the raw exception, which can name a vendor or quote a
    credit-balance message."""

    def test_this_modules_own_circuit_breaker_counts(self):
        assert is_provider_unavailable_error(CircuitBreakerOpenError("open"))

    def test_the_fallback_providers_circuit_breaker_also_counts(self):
        # A distinct class, defined in openai_client.py - opened on OpenAI's
        # own repeated failures, not Claude's.
        assert is_provider_unavailable_error(openai_client.CircuitBreakerOpenError("open"))

    @pytest.mark.parametrize("status", [401, 403, 429, 500, 502, 503, 529])
    def test_availability_status_codes_count(self, status):
        assert is_provider_unavailable_error(_FakeAPIError("boom", status_code=status))

    def test_anthropic_credit_exhaustion_counts(self):
        exc = _FakeAPIError("Your credit balance is too low", status_code=400)
        assert is_provider_unavailable_error(exc)

    def test_openai_quota_exhaustion_counts(self):
        exc = _FakeAPIError("You exceeded your current quota", status_code=400)
        assert is_provider_unavailable_error(exc)
        exc2 = _FakeAPIError("insufficient_quota", status_code=400)
        assert is_provider_unavailable_error(exc2)

    def test_an_ordinary_bad_request_does_not_count(self):
        # A 400 caused by our own request shape is a bug to surface, not an
        # outage to soften into "try again later".
        exc = _FakeAPIError("Invalid schema: missing required field", status_code=400)
        assert not is_provider_unavailable_error(exc)

    def test_a_plain_bug_does_not_count(self):
        assert not is_provider_unavailable_error(ValueError("not json"))


class TestFallbackToolTranslation:
    """web_research describes the search tool in Claude's shape. When a call
    falls back to OpenAI that shape is a 400 there, which web_research
    swallows into "no sources" - every claim scores zero and the answer is
    labelled fabricated, with nothing in the response to say why. The
    fallback client has to speak its own provider's names."""

    @pytest.mark.asyncio
    async def test_claudes_search_tool_becomes_this_apis_search_tool(self, monkeypatch):
        from app.services import web_research

        seen: dict = {}

        async def fake_resilient_call(fn, **kwargs):
            seen.update(kwargs)

            class _Resp:
                output_text = '{"sources": []}'

            return _Resp()

        monkeypatch.setattr(openai_client, "_resilient_call", fake_resilient_call)
        await openai_client.generate_structured(
            instructions="x",
            input_text="y",
            schema={"type": "object", "properties": {}, "required": [], "additionalProperties": False},
            schema_name="web_sources",
            tools=[web_research._WEB_SEARCH_TOOL],
        )
        assert seen["tools"] == [{"type": "web_search_preview"}]

    def test_other_tools_pass_through_untouched(self):
        fn_tool = {"type": "function", "name": "lookup", "parameters": {}}
        assert openai_client._translate_tool(fn_tool) is fn_tool


class TestSpendCapFallsBack:
    """The account's own monthly spend cap arrives as a 400 with its own
    wording. It has to hand over to the fallback like an empty balance does,
    and it must not be retried - a cap does not lift on the third attempt."""

    def test_the_monthly_cap_wording_counts_as_unavailable(self):
        exc = _FakeAPIError(
            "You have reached your specified API usage limits. You will regain access "
            "on 2026-10-01 at 00:00 UTC.",
            status_code=400,
        )
        assert is_provider_unavailable_error(exc)

    def test_client_errors_are_not_retried_but_transient_ones_are(self):
        from app.services import anthropic_client, openai_client

        cap = _FakeAPIError("reached your specified API usage limits", status_code=400)
        assert not anthropic_client._worth_retrying(cap)
        assert not openai_client._worth_retrying(cap)
        for status in (429, 500, 529, None):
            assert anthropic_client._worth_retrying(_FakeAPIError("x", status_code=status))

    def test_cancellation_is_never_retried(self):
        import asyncio

        from app.services import anthropic_client, openai_client

        # A cancelled in-flight call (the pre-answer search over its budget)
        # must stay cancelled, not be re-issued by the retry wrapper.
        assert not anthropic_client._worth_retrying(asyncio.CancelledError())
        assert not openai_client._worth_retrying(asyncio.CancelledError())
