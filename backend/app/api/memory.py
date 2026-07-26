import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_conversation_for_user, get_current_user
from app.db.session import get_db
from app.models import ConversationMemory, User
from app.schemas.memory import MemoryOut
from app.services.memory_service import rebuild_memory_summary

router = APIRouter(prefix="/memory", tags=["memory"])


@router.get("/{conversation_id}", response_model=MemoryOut)
async def get_memory(
    conversation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MemoryOut:
    await get_conversation_for_user(db, conversation_id, current_user.id)

    memory = await db.scalar(
        select(ConversationMemory).where(ConversationMemory.conversation_id == conversation_id)
    )
    if memory is None:
        return MemoryOut(summary=None, last_updated=None)
    return MemoryOut(summary=memory.summary, last_updated=memory.updated_at)


@router.post("/{conversation_id}/rebuild", response_model=MemoryOut)
async def rebuild_memory(
    conversation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MemoryOut:
    await get_conversation_for_user(db, conversation_id, current_user.id)

    summary = await rebuild_memory_summary(db, conversation_id)

    memory = await db.scalar(
        select(ConversationMemory).where(ConversationMemory.conversation_id == conversation_id)
    )
    return MemoryOut(summary=summary, last_updated=memory.updated_at if memory else None)
