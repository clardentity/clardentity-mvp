"""Parsing another assistant's data export.

Three formats with nothing in common, all of which have changed shape at
least once. The parser sniffs rather than asks and is deliberately forgiving:
losing some messages is an acceptable outcome, rejecting the file is not.
"""

import json

import pytest

from app.services.chat_import import UnreadableExport, parse_export


def as_bytes(obj) -> bytes:
    return json.dumps(obj).encode()


CHATGPT = as_bytes(
    [
        {
            "title": "Learning Spanish",
            "mapping": {
                "a": {"message": {"author": {"role": "system"}, "content": {"parts": [""]}}},
                "b": {
                    "message": {
                        "author": {"role": "user"},
                        "content": {"parts": ["I want to learn Spanish for travel"]},
                    }
                },
                "c": {
                    "message": {
                        "author": {"role": "assistant"},
                        "content": {"parts": ["Here is a plan you should follow..."]},
                    }
                },
                "d": {
                    "message": {
                        "author": {"role": "user"},
                        "content": {"parts": ["thanks"]},  # noise, dropped
                    }
                },
            },
        }
    ]
)

CLAUDE = as_bytes(
    [
        {
            "name": "Refactoring",
            "chat_messages": [
                {"sender": "human", "text": "How should I structure a FastAPI project?"},
                {"sender": "assistant", "text": "You could use a layered layout..."},
                {
                    "sender": "human",
                    "content": [{"type": "text", "text": "What about background jobs?"}],
                },
            ],
        }
    ]
)

GEMINI = as_bytes(
    [
        {"header": "Gemini Apps", "title": "Prompted How do I bake sourdough", "time": "2026-01-01"},
        {"header": "Gemini Apps", "title": "Prompted Explain gradient descent", "time": "2026-01-02"},
    ]
)


class TestChatGPT:
    def test_reads_only_the_users_own_messages(self):
        result = parse_export(CHATGPT)
        assert result.source == "ChatGPT"
        assert "I want to learn Spanish for travel" in result.messages
        # The assistant's reply is that model's words, not evidence about the
        # person, and is the bulk of the file.
        assert not any("plan you should follow" in m for m in result.messages)

    def test_counts_conversations(self):
        assert parse_export(CHATGPT).conversations == 1

    def test_drops_contentless_openers(self):
        assert "thanks" not in parse_export(CHATGPT).messages

    def test_survives_non_string_parts(self):
        # Newer exports put images and audio refs in `parts`.
        payload = as_bytes(
            [
                {
                    "mapping": {
                        "a": {
                            "message": {
                                "author": {"role": "user"},
                                "content": {"parts": [{"asset_pointer": "file-1"}, "real question"]},
                            }
                        }
                    }
                }
            ]
        )
        assert parse_export(payload).messages == ["real question"]


class TestClaude:
    def test_reads_both_the_old_and_new_message_shapes(self):
        result = parse_export(CLAUDE)
        assert result.source == "Claude"
        assert "How should I structure a FastAPI project?" in result.messages
        assert "What about background jobs?" in result.messages

    def test_skips_the_assistant(self):
        assert not any("layered layout" in m for m in parse_export(CLAUDE).messages)


class TestGemini:
    def test_strips_the_activity_verb(self):
        result = parse_export(GEMINI)
        assert result.source == "Gemini"
        assert "How do I bake sourdough" in result.messages
        assert not any(m.startswith("Prompted") for m in result.messages)

    def test_unwraps_a_takeout_object(self):
        wrapped = as_bytes({"activities": json.loads(GEMINI)})
        assert parse_export(wrapped).source == "Gemini"


class TestRejections:
    @pytest.mark.parametrize(
        "payload,fragment",
        [
            (b"not json at all", "valid JSON"),
            (as_bytes([]), "chat list"),
            (as_bytes({"nothing": "useful"}), "chat list"),
            (as_bytes([{"unrecognised": 1}]), "ChatGPT, Claude or Gemini"),
        ],
    )
    def test_names_the_problem(self, payload, fragment):
        with pytest.raises(UnreadableExport) as exc:
            parse_export(payload)
        assert fragment in str(exc.value)

    def test_rejects_an_export_with_no_user_messages(self):
        assistant_only = as_bytes(
            [{"chat_messages": [{"sender": "assistant", "text": "Only my words here."}]}]
        )
        with pytest.raises(UnreadableExport) as exc:
            parse_export(assistant_only)
        assert "your own" in str(exc.value)


class TestVolume:
    def test_caps_the_number_of_messages_kept(self):
        from app.services.chat_import import MAX_MESSAGES

        huge = as_bytes(
            [
                {
                    "chat_messages": [
                        {"sender": "human", "text": f"question number {i}"} for i in range(1200)
                    ]
                }
            ]
        )
        result = parse_export(huge)
        assert len(result.messages) == MAX_MESSAGES
        # Keeps the most recent: a profile wants who they are now.
        assert "question number 1199" in result.messages[-1]

    def test_truncates_a_single_enormous_message(self):
        payload = as_bytes([{"chat_messages": [{"sender": "human", "text": "x" * 5000}]}])
        assert len(parse_export(payload).messages[0]) <= 600
