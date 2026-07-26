import json
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.api.deps import get_current_user
from app.db.session import AsyncSessionLocal, get_db
from app.models import COGNITIVE_MODES, Conversation, Message, User, WorkspaceMember
from app.schemas.chat import ConversationCreate, ConversationOut, MessageCreate, MessageOut
from app.services.openai_client import stream_generation
from app.services.prompt_builder import build_conversation_input, build_system_instructions

router = APIRouter(prefix="/chat", tags=["chat"])

# Default 20 (SRS §13); Phase 5 formalizes short-term window + long-term summary.
HISTORY_WINDOW = 20


async def _require_workspace_member(
    db: AsyncSession, workspace_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    membership = await db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
        )
    )
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")


async def _get_conversation_for_user(
    db: AsyncSession, conversation_id: uuid.UUID, user_id: uuid.UUID
) -> Conversation:
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    await _require_workspace_member(db, conversation.workspace_id, user_id)
    return conversation


@router.post("/conversations", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    payload: ConversationCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    await _require_workspace_member(db, payload.workspace_id, current_user.id)

    conversation = Conversation(workspace_id=payload.workspace_id, title=payload.title)
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    return ConversationOut.model_validate(conversation)


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    workspace_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ConversationOut]:
    await _require_workspace_member(db, workspace_id, current_user.id)

    rows = await db.execute(
        select(Conversation)
        .where(Conversation.workspace_id == workspace_id)
        .order_by(Conversation.created_at.desc())
    )
    return [ConversationOut.model_validate(c) for c in rows.scalars().all()]


@router.get("/conversations/{conversation_id}", response_model=ConversationOut)
async def get_conversation(
    conversation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    conversation = await _get_conversation_for_user(db, conversation_id, current_user.id)
    return ConversationOut.model_validate(conversation)


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    conversation = await _get_conversation_for_user(db, conversation_id, current_user.id)
    await db.delete(conversation)
    await db.commit()


@router.get("/{conversation_id}/messages", response_model=list[MessageOut])
async def list_messages(
    conversation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MessageOut]:
    await _get_conversation_for_user(db, conversation_id, current_user.id)

    rows = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at)
    )
    return [MessageOut.model_validate(m) for m in rows.scalars().all()]


@router.post("/{conversation_id}/messages")
async def send_message(
    conversation_id: uuid.UUID,
    payload: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EventSourceResponse:
    # FR7: mode is mandatory and there is no auto-detection fallback — reject
    # with exactly 400, not Pydantic's default 422 for a missing field.
    if payload.mode not in COGNITIVE_MODES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="mode is required and must be one of: " + ", ".join(COGNITIVE_MODES),
        )

    conversation = await _get_conversation_for_user(db, conversation_id, current_user.id)

    history_rows = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc())
        .limit(HISTORY_WINDOW)
    )
    history = list(reversed(history_rows.scalars().all()))

    db.add(
        Message(
            conversation_id=conversation_id,
            role="user",
            content=payload.content,
            mode_used=payload.mode,
        )
    )
    # Convenience pre-fill only (§7.2) — never read back as an automatic mode choice.
    conversation.default_mode = payload.mode
    await db.commit()

    instructions = build_system_instructions(payload.mode)
    input_text = build_conversation_input(history, payload.content)
    mode = payload.mode

    async def event_stream() -> AsyncIterator[dict]:
        full_text = ""
        try:
            async for event in stream_generation(instructions=instructions, input_text=input_text):
                if event["type"] == "delta":
                    full_text += event["text"]
                    yield {"event": "delta", "data": json.dumps({"text": event["text"]})}
                elif event["type"] == "done":
                    full_text = event["full_text"]
        except Exception as exc:  # noqa: BLE001 - surfaced to the client as an SSE error event
            yield {"event": "error", "data": json.dumps({"detail": str(exc)})}
            return

        async with AsyncSessionLocal() as gen_db:
            assistant_message = Message(
                conversation_id=conversation_id,
                role="assistant",
                content=full_text,
                mode_used=mode,
            )
            gen_db.add(assistant_message)
            await gen_db.commit()
            await gen_db.refresh(assistant_message)

        final_payload = {
            "message": MessageOut.model_validate(assistant_message).model_dump(mode="json"),
            "claims": [],
            "confidence": None,
            "avatar_cue": None,
        }
        yield {"event": "final", "data": json.dumps(final_payload)}

    return EventSourceResponse(event_stream())
