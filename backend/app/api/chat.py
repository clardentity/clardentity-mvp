import json
import re
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.api.deps import get_current_user, require_workspace_member
from app.db.session import AsyncSessionLocal, get_db
from app.models import COGNITIVE_MODES, Citation, Conversation, Document, DocumentChunk, Message, User
from app.schemas.chat import (
    CitationOut,
    ConversationCreate,
    ConversationOut,
    MessageCreate,
    MessageOut,
)
from app.services.openai_client import stream_generation
from app.services.prompt_builder import (
    build_context_block,
    build_conversation_input,
    build_system_instructions,
)
from app.services.retrieval import RetrievedChunk, retrieve_chunks

router = APIRouter(prefix="/chat", tags=["chat"])

# Default 20 (SRS §13); Phase 5 formalizes short-term window + long-term summary.
HISTORY_WINDOW = 20


async def _get_conversation_for_user(
    db: AsyncSession, conversation_id: uuid.UUID, user_id: uuid.UUID
) -> Conversation:
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    await require_workspace_member(db, conversation.workspace_id, user_id)
    return conversation


def _serialize_message(message: Message, citations: list[CitationOut]) -> MessageOut:
    return MessageOut(
        id=message.id,
        role=message.role,
        content=message.content,
        mode_used=message.mode_used,
        confidence_score=message.confidence_score,
        confidence_band=message.confidence_band,
        avatar_expression=message.avatar_expression,
        avatar_gesture=message.avatar_gesture,
        created_at=message.created_at,
        citations=citations,
    )


async def _load_citations(
    db: AsyncSession, message_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[CitationOut]]:
    if not message_ids:
        return {}

    rows = await db.execute(
        select(Citation, Document.filename, DocumentChunk.content)
        .join(Document, Document.id == Citation.document_id)
        .outerjoin(DocumentChunk, DocumentChunk.id == Citation.chunk_id)
        .where(Citation.message_id.in_(message_ids))
        .order_by(Citation.marker)
    )

    result: dict[uuid.UUID, list[CitationOut]] = {}
    for citation, filename, chunk_content in rows.all():
        result.setdefault(citation.message_id, []).append(
            CitationOut(
                marker=citation.marker,
                document_id=citation.document_id,
                document_filename=filename,
                excerpt=(chunk_content or "")[:300],
                relevance_score=citation.relevance_score,
            )
        )
    return result


@router.post("/conversations", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    payload: ConversationCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    await require_workspace_member(db, payload.workspace_id, current_user.id)

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
    await require_workspace_member(db, workspace_id, current_user.id)

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
    messages = list(rows.scalars().all())
    citations_by_message = await _load_citations(db, [m.id for m in messages])
    return [_serialize_message(m, citations_by_message.get(m.id, [])) for m in messages]


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

    chunks: list[RetrievedChunk] = await retrieve_chunks(
        db, conversation.workspace_id, payload.content, payload.mode
    )

    instructions = build_system_instructions(payload.mode)
    context_block = build_context_block(chunks)
    input_text = build_conversation_input(context_block, history, payload.content)
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

        cited_markers = sorted({int(m) for m in re.findall(r"\[(\d+)\]", full_text)})
        cited_chunks = [
            (marker, chunks[marker - 1]) for marker in cited_markers if 0 < marker <= len(chunks)
        ]

        async with AsyncSessionLocal() as gen_db:
            assistant_message = Message(
                conversation_id=conversation_id,
                role="assistant",
                content=full_text,
                mode_used=mode,
            )
            gen_db.add(assistant_message)
            await gen_db.flush()

            for marker, rc in cited_chunks:
                gen_db.add(
                    Citation(
                        message_id=assistant_message.id,
                        document_id=rc.document.id,
                        chunk_id=rc.chunk.id,
                        source_type="document",
                        marker=marker,
                        relevance_score=rc.score,
                    )
                )

            await gen_db.commit()
            await gen_db.refresh(assistant_message)

        citations = [
            CitationOut(
                marker=marker,
                document_id=rc.document.id,
                document_filename=rc.document.filename,
                excerpt=rc.chunk.content[:300],
                relevance_score=rc.score,
            )
            for marker, rc in cited_chunks
        ]

        final_payload = {
            "message": _serialize_message(assistant_message, citations).model_dump(mode="json"),
            "claims": [],
            "confidence": None,
            "avatar_cue": None,
        }
        yield {"event": "final", "data": json.dumps(final_payload)}

    return EventSourceResponse(event_stream())
