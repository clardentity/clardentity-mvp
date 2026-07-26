import json
import re
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.api.deps import get_conversation_for_user, get_current_user, require_workspace_member
from app.db.session import AsyncSessionLocal, get_db
from app.models import Citation, Conversation, Document, DocumentChunk, Message, User
from app.schemas.chat import (
    CitationOut,
    ConversationCreate,
    ConversationOut,
    MessageCreate,
    MessageOut,
)
from app.services.memory_service import (
    HISTORY_WINDOW,
    get_memory_summary,
    should_rebuild_memory,
)
from app.services.openai_client import stream_generation
from app.services.prompt_builder import (
    build_context_block,
    build_conversation_input,
    build_system_instructions,
)
from app.services.query_optimizer import optimize_query
from app.services.retrieval import RetrievedChunk, retrieve_chunks
from app.services.router import InvalidModeError, InvalidReasoningLensError, validate_mode, validate_reasoning_lens
from app.workers.rebuild_memory import rebuild_memory_task

router = APIRouter(prefix="/chat", tags=["chat"])


def _serialize_message(message: Message, citations: list[CitationOut]) -> MessageOut:
    return MessageOut(
        id=message.id,
        role=message.role,
        content=message.content,
        mode_used=message.mode_used,
        reasoning_lens=message.reasoning_lens,
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
    conversation = await get_conversation_for_user(db, conversation_id, current_user.id)
    return ConversationOut.model_validate(conversation)


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    conversation = await get_conversation_for_user(db, conversation_id, current_user.id)
    await db.delete(conversation)
    await db.commit()


@router.get("/{conversation_id}/messages", response_model=list[MessageOut])
async def list_messages(
    conversation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MessageOut]:
    await get_conversation_for_user(db, conversation_id, current_user.id)

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
    try:
        mode = validate_mode(payload.mode)
        reasoning_lens = validate_reasoning_lens(payload.reasoning_lens)
    except (InvalidModeError, InvalidReasoningLensError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    conversation = await get_conversation_for_user(db, conversation_id, current_user.id)

    history_rows = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc())
        .limit(HISTORY_WINDOW)
    )
    history = list(reversed(history_rows.scalars().all()))
    memory_summary = await get_memory_summary(db, conversation_id)

    db.add(
        Message(
            conversation_id=conversation_id,
            role="user",
            content=payload.content,
            mode_used=mode,
            reasoning_lens=reasoning_lens if mode == "thinking" else None,
        )
    )
    # Convenience pre-fill only (§7.2) — never read back as an automatic mode choice.
    conversation.default_mode = mode
    await db.commit()

    # §5.2 step 3: ambiguity detection/query rewrite for retrieval only —
    # `mode` and the persisted/displayed message are untouched by this.
    retrieval_query = await optimize_query(history, payload.content)
    chunks: list[RetrievedChunk] = await retrieve_chunks(db, conversation.workspace_id, retrieval_query, mode)

    instructions = build_system_instructions(mode, reasoning_lens)
    context_block = build_context_block(chunks)
    input_text = build_conversation_input(context_block, memory_summary, history, payload.content)

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
                reasoning_lens=reasoning_lens if mode == "thinking" else None,
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

            total_messages = await gen_db.scalar(
                select(func.count())
                .select_from(Message)
                .where(Message.conversation_id == conversation_id)
            )

        if should_rebuild_memory(total_messages or 0):
            rebuild_memory_task.delay(str(conversation_id))

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
