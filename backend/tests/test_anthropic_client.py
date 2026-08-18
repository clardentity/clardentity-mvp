"""The provider-shim behaviour, which is where a migration hides its bugs.

The model calls themselves are verified by hand against the live API (see the
schema sweep in the migration commit). What is testable here is the translation
layer: the two places where this provider's contract differs from the last
one's, and where getting it wrong fails silently rather than loudly.
"""

import pytest

from app.services.anthropic_client import _content_blocks, _portable_schema


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
