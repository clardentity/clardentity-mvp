"""A name for a conversation, from its first exchange.

The sidebar used to show the opening message, cut to six words - so a
question that began "Tabulate the comparison between..." was filed under
"Tabulate the comparison betw…", and a row of these read like a list of
prompts, not of chats. The smallest model writes a three-to-four-word label
from the question and the gist of the answer, the way a person would name a
document: what it is about, not what was typed. Runs once per conversation,
after the first answer is on screen, off the critical path.
"""

import logging
import re

from app.core.config import settings
from app.services.anthropic_client import cached, generate_text

logger = logging.getLogger("clardentity.conversation_title")

_MAX_WORDS = 5
_MAX_CHARS = 48

_INSTRUCTIONS = (
    "Name this conversation for a sidebar: three or four words, at most five, "
    "saying what it is about - the subject, not the request. 'AKS vs EKS "
    "comparison', 'Kuari Pass trek operators', 'Payyannur weather tomorrow', "
    "'Causes of India's independence'. No quotes, no trailing full stop, no "
    "words like 'question', 'query', 'discussion' or 'chat', no leading verb "
    "such as 'Tabulate' or 'Compare' unless the subject is the act itself. "
    "Reply with the name only."
)


def _tidy(raw: str, fallback: str) -> str:
    text = " ".join(raw.strip().strip('"\'`').split())
    text = re.sub(r"[.:!?]+$", "", text).strip()
    if not text:
        return fallback
    words = text.split()
    if len(words) > _MAX_WORDS:
        text = " ".join(words[:_MAX_WORDS])
    return text[:_MAX_CHARS].rstrip(" ,;-")


async def name_conversation(question: str, gist: str | None, fallback: str) -> str:
    """Never raises: on any failure the caller keeps `fallback` (the derived
    placeholder that was already on the row)."""
    input_text = f"QUESTION:\n{question[:600]}"
    if gist:
        input_text += f"\n\nGIST OF THE ANSWER:\n{gist[:400]}"
    try:
        raw = await generate_text(
            instructions=cached(_INSTRUCTIONS),
            input_text=input_text,
            model=settings.anthropic_rapid_model,
            fast=True,
        )
    except Exception:  # noqa: BLE001 - a name is a nicety
        logger.warning("conversation naming failed", exc_info=True)
        return fallback
    return _tidy(raw, fallback)
