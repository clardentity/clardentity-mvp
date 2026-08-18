import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ConversationMemory, Message
from app.services.anthropic_client import generate_text

# SRS §13 defaults.
HISTORY_WINDOW = 20
REBUILD_EVERY_N_TURNS = 15

_SUMMARY_INSTRUCTIONS = (
    "You maintain a rolling summary of an ongoing conversation for a system that "
    "cannot keep the full transcript in its prompt. Given the previous summary (if "
    "any) and the conversation turns since it was last updated, produce an updated "
    "summary. Capture key facts established, decisions made, and user preferences "
    "stated. Be concise - a few short paragraphs at most. Write the summary "
    "directly, with no preamble."
)


async def get_memory_summary(db: AsyncSession, conversation_id: uuid.UUID) -> str | None:
    memory = await db.scalar(
        select(ConversationMemory).where(ConversationMemory.conversation_id == conversation_id)
    )
    return memory.summary if memory else None


def should_rebuild_memory(message_count: int, rebuild_every: int = REBUILD_EVERY_N_TURNS) -> bool:
    # A "turn" is one user+assistant exchange (2 message rows). This is only
    # ever called right after a complete assistant reply is persisted, so
    # message_count is always even here - dividing first avoids the trigger
    # never firing when rebuild_every is odd (15) against an always-even count.
    turns = message_count // 2
    return turns > 0 and turns % rebuild_every == 0


async def rebuild_memory_summary(db: AsyncSession, conversation_id: uuid.UUID) -> str:
    """Regenerates the rolling summary from everything older than the
    short-term window, folded into whatever summary already existed. Called
    periodically (every §13 M turns) via Celery, and on-demand via
    POST /memory/{id}/rebuild.
    """
    memory = await db.scalar(
        select(ConversationMemory).where(ConversationMemory.conversation_id == conversation_id)
    )
    previous_summary = memory.summary if memory else None

    rows = await db.execute(
        select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at)
    )
    messages = list(rows.scalars().all())
    older_messages = messages[:-HISTORY_WINDOW] if len(messages) > HISTORY_WINDOW else messages

    if not older_messages:
        return previous_summary or ""

    turns_text = "\n".join(
        f"{'User' if m.role == 'user' else 'Assistant'}: {m.content}" for m in older_messages
    )
    input_parts = []
    if previous_summary:
        input_parts.append(f"PREVIOUS SUMMARY:\n{previous_summary}")
    input_parts.append(f"CONVERSATION TURNS:\n{turns_text}")

    summary = await generate_text(
        fast=True,
        instructions=_SUMMARY_INSTRUCTIONS, input_text="\n\n".join(input_parts)
    )

    if memory is None:
        memory = ConversationMemory(conversation_id=conversation_id, summary=summary)
        db.add(memory)
    else:
        memory.summary = summary

    await db.commit()
    return summary
