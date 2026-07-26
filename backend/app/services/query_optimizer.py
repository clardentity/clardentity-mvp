from app.models import Message
from app.services.openai_client import generate_text

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
    """
    if not history:
        return message

    recent = history[-6:]
    history_text = "\n".join(
        f"{'User' if m.role == 'user' else 'Assistant'}: {m.content}" for m in recent
    )
    input_text = f"CONVERSATION:\n{history_text}\n\nLATEST MESSAGE:\n{message}"

    try:
        rewritten = await generate_text(instructions=_INSTRUCTIONS, input_text=input_text)
    except Exception:
        # Retrieval quality degrades gracefully to the raw message; this must
        # never block sending the chat message itself.
        return message

    return rewritten.strip() or message
