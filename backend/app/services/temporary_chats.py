"""Temporary chats: what goes with one, and when.

A temporary chat is an ordinary conversation in every way the chat itself can
see - it streams, checks claims, forks and regenerates like any other, which
is why it is stored like any other. What makes it temporary is everything
around it: it is left out of the recents list, search and the reuse of an
empty chat at sign-in; it neither reads nor feeds the profile; and it is
deleted when its owner leaves it.

"Leaves it" is the client's to say - it deletes the chat as it navigates away
(AppShell). A tab that is simply closed says nothing, so what is left over is
swept here once it has been idle for a day. There is no scheduler to run the
sweep, so it rides on traffic instead: every entry to the app (/bootstrap)
queues it as a background task, and starting a temporary chat runs it for
that user. Nobody can reach a stale one in the meantime: it is in no list,
and only its owner can open it by its URL.

Deleting one takes the files attached inside it (rows by cascade, stored
copies here) and the pictures drawn in it, since a chat that promises to be
gone should not leave its uploads behind in the workspace or in storage.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Conversation, Message, WorkspaceMember
from app.services import stored_files

#: How long an abandoned temporary chat may sit before it is swept.
IDLE_LIMIT = timedelta(hours=24)


async def discard(db: AsyncSession, conversation: Conversation) -> None:
    """Delete a conversation along with what was attached and drawn in it.

    Any conversation, not only a temporary one: an ordinary chat has no files
    of its own (its attachments belong to the workspace), but the pictures
    drawn in it are its alone. The stored copies are collected before the
    rows go and removed after the commit - see app/services/stored_files.py.
    """
    keys = await stored_files.keys_in_conversations(db, [conversation.id])

    await db.delete(conversation)
    await db.commit()

    await stored_files.remove(keys)


async def sweep_idle(db: AsyncSession, user_id: uuid.UUID | None = None) -> int:
    """Delete temporary chats that have been idle past the limit - this
    user's, or everyone's when no user is given. Returns how many went."""
    last_activity = (
        select(func.max(Message.created_at))
        .where(Message.conversation_id == Conversation.id)
        .correlate(Conversation)
        .scalar_subquery()
    )
    cutoff = datetime.now(UTC) - IDLE_LIMIT
    conditions = [
        Conversation.temporary.is_(True),
        func.coalesce(last_activity, Conversation.created_at) < cutoff,
    ]
    if user_id is not None:
        conditions.append(
            Conversation.workspace_id.in_(
                select(WorkspaceMember.workspace_id)
                .where(WorkspaceMember.user_id == user_id)
                .scalar_subquery()
            )
        )
    stale = (await db.execute(select(Conversation).where(*conditions))).scalars().all()
    for conversation in stale:
        await discard(db, conversation)
    return len(stale)
