import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_workspace_member
from app.db.session import get_db
from app.models import Conversation, Message, User
from app.schemas.validation import ValidationOut
from app.services.claim_loader import load_claims_for_messages

router = APIRouter(prefix="/validation", tags=["validation"])


@router.get("/{message_id}", response_model=ValidationOut)
async def get_validation(
    message_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ValidationOut:
    message = await db.get(Message, message_id)
    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    conversation = await db.get(Conversation, message.conversation_id)
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    await require_workspace_member(db, conversation.workspace_id, current_user.id)

    claims_by_message = await load_claims_for_messages(db, [message_id])
    return ValidationOut(
        score=message.confidence_score,
        band=message.confidence_band,
        claims=claims_by_message.get(message_id, []),
    )
