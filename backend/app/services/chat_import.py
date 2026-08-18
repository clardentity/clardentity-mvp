"""Reading a user's history out of another assistant's export.

There is no API for this and there is not going to be one: none of the three
providers expose chat history to third parties, and MCP runs the other way -
it lets an assistant call your tools, not you read its transcripts. What all
three do offer is a free, user-initiated data export, which is a better
primitive anyway: the user asks their own provider for their own data and
hands us the file. Nothing is scraped and no credentials are involved.

Only the user's own messages are read. The other assistant's replies are
skipped entirely - they are that model's words, they are the bulk of the file,
and what the profile needs is evidence of how *this person* thinks and what
they keep returning to.

The three formats have nothing in common, so this sniffs rather than asks. It
is deliberately forgiving: an export format that shifts under us should lose
some messages, not reject the file.
"""

import json
import logging
import re
from dataclasses import dataclass

logger = logging.getLogger(__name__)

MAX_MESSAGES = 400
_MAX_CHARS_PER_MESSAGE = 600
# Openers that survive in every export and say nothing about the person.
_NOISE = re.compile(r"^(hi|hey|hello|thanks|thank you|ok|okay|yes|no|continue|go on)\W*$", re.I)


@dataclass
class ImportedHistory:
    source: str
    messages: list[str]
    conversations: int

    @property
    def text(self) -> str:
        return "\n".join(f"- {m}" for m in self.messages)


class UnreadableExport(ValueError):
    """The file parsed as JSON but matched no known export shape."""


def _clean(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split())
    if not text or _NOISE.match(text):
        return None
    return text[:_MAX_CHARS_PER_MESSAGE]


def _parse_chatgpt(data: list) -> tuple[list[str], int]:
    """conversations.json: each conversation holds a `mapping` of nodes, and a
    node's message has author.role and content.parts."""
    messages: list[str] = []
    conversations = 0
    for conversation in data:
        mapping = conversation.get("mapping")
        if not isinstance(mapping, dict):
            continue
        conversations += 1
        # Node order in the mapping is not conversation order, but for profile
        # evidence the set matters more than the sequence.
        for node in mapping.values():
            message = (node or {}).get("message") or {}
            if ((message.get("author") or {}).get("role")) != "user":
                continue
            parts = (message.get("content") or {}).get("parts") or []
            for part in parts:
                # Newer exports allow non-string parts (images, audio refs).
                cleaned = _clean(part if isinstance(part, str) else None)
                if cleaned:
                    messages.append(cleaned)
    return messages, conversations


def _parse_claude(data: list) -> tuple[list[str], int]:
    """Claude's export: conversations with `chat_messages`, sender human/assistant.
    `text` is the older shape; newer files carry a `content` block list."""
    messages: list[str] = []
    conversations = 0
    for conversation in data:
        chat = conversation.get("chat_messages")
        if not isinstance(chat, list):
            continue
        conversations += 1
        for message in chat:
            if (message or {}).get("sender") != "human":
                continue
            cleaned = _clean(message.get("text"))
            if cleaned:
                messages.append(cleaned)
                continue
            for block in message.get("content") or []:
                if isinstance(block, dict) and block.get("type") == "text":
                    cleaned = _clean(block.get("text"))
                    if cleaned:
                        messages.append(cleaned)
    return messages, conversations


def _parse_gemini(data: list) -> tuple[list[str], int]:
    """Google Takeout MyActivity: flat records whose title is the prompt,
    prefixed with the activity verb ("Prompted ...")."""
    messages: list[str] = []
    for record in data:
        if not isinstance(record, dict):
            continue
        title = record.get("title")
        if not isinstance(title, str):
            continue
        # "Prompted" is the English label; other locales differ, so the prefix
        # is stripped when present and the title used as-is when not.
        stripped = re.sub(r"^(Prompted|Asked|Searched for)\s+", "", title).strip()
        cleaned = _clean(stripped)
        if cleaned:
            messages.append(cleaned)
    # Takeout is one flat activity log, not a set of conversations.
    return messages, 0


def _looks_like(data: list, key: str) -> bool:
    return any(isinstance(item, dict) and key in item for item in data[:50])


def parse_export(raw: bytes) -> ImportedHistory:
    """Sniff the format and pull out the user's own messages.

    Raises UnreadableExport for anything unrecognised, which the endpoint
    turns into a message naming the three files we can read.
    """
    try:
        data = json.loads(raw)
    except Exception as exc:
        raise UnreadableExport("That file isn't valid JSON.") from exc

    # Takeout sometimes wraps the log in an object.
    if isinstance(data, dict):
        for key in ("conversations", "activities", "items"):
            if isinstance(data.get(key), list):
                data = data[key]
                break

    if not isinstance(data, list) or not data:
        raise UnreadableExport("That file doesn't contain a chat list.")

    if _looks_like(data, "mapping"):
        source, (messages, conversations) = "ChatGPT", _parse_chatgpt(data)
    elif _looks_like(data, "chat_messages"):
        source, (messages, conversations) = "Claude", _parse_claude(data)
    elif _looks_like(data, "title"):
        source, (messages, conversations) = "Gemini", _parse_gemini(data)
    else:
        raise UnreadableExport("That doesn't look like a ChatGPT, Claude or Gemini export.")

    if not messages:
        raise UnreadableExport("No messages of your own were found in that file.")

    # Keep the most recent, which for these formats is the tail. A profile
    # wants who they are now, and the whole file can be tens of megabytes.
    trimmed = messages[-MAX_MESSAGES:]
    return ImportedHistory(source=source, messages=trimmed, conversations=conversations)
