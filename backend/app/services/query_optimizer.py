import re

from app.models import Message
from app.services.anthropic_client import generate_text

# Words that make a message depend on what came before it. Anything without
# one of these is already a standalone query, and rewriting it costs a full
# model round-trip *before the first token can stream* - the single most
# expensive thing in the request, spent to hand retrieval back the same string.
_CONTEXT_DEPENDENT = re.compile(
    r"\b("
    r"it|its|it's|that|those|these|this|they|them|their|he|she|him|her|his|hers|"
    r"the same|above|earlier|previous|previously|before|instead|also|too|"
    r"one|ones|another|other|others|"
    r"why|why not|how come|what about|and|but|so"
    r")\b",
    re.IGNORECASE,
)

# Short messages are almost always follow-ups ("why?", "the second one",
# "go on") even when they dodge the vocabulary above.
_STANDALONE_MIN_WORDS = 6


def needs_rewriting(history: list[Message], message: str) -> bool:
    if not history:
        return False
    if len(message.split()) < _STANDALONE_MIN_WORDS:
        return True
    return bool(_CONTEXT_DEPENDENT.search(message))

_INSTRUCTIONS = (
    "You rewrite a user's latest chat message into a standalone search query for "
    "retrieving relevant context from a document store. Resolve pronouns and vague "
    "references (e.g. \"it\", \"that contract\", \"the deadline\") using the "
    "conversation history. If the message is already clear and standalone, return it "
    "unchanged. Respond with ONLY the rewritten query text - no explanation, no quotes."
)


async def optimize_query(history: list[Message], message: str) -> str:
    """§5.2 step 3 / reconciliation note: ambiguity detection and query
    rewriting only, purely to improve retrieval. This never touches `mode`,
    and the rewritten text is used only for the retrieval call below - the
    user's original message is still what's persisted and shown.

    Skipped entirely for messages that already read as standalone - see
    `needs_rewriting`. This call sits on the critical path before generation
    can start, so not making it is worth more than the marginal retrieval
    gain on a query that was already unambiguous.
    """
    if not needs_rewriting(history, message):
        return message

    recent = history[-6:]
    history_text = "\n".join(
        f"{'User' if m.role == 'user' else 'Assistant'}: {m.content}" for m in recent
    )
    input_text = f"CONVERSATION:\n{history_text}\n\nLATEST MESSAGE:\n{message}"

    try:
        rewritten = await generate_text(
            instructions=_INSTRUCTIONS, input_text=input_text, fast=True
        )
    except Exception:
        # Retrieval quality degrades gracefully to the raw message; this must
        # never block sending the chat message itself.
        return message

    return rewritten.strip() or message
