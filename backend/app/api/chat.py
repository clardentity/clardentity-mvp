import asyncio
import base64
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.api.deps import get_conversation_for_user, get_current_user, require_workspace_member
from app.core.config import settings
from app.core.rate_limit import check_rate_limit
from app.db.session import AsyncSessionLocal, get_db
from app.models import AudioTranscript, Citation, Conversation, Document, Message, MessageClaim, ClaimEvidence, User
from app.schemas.chat import (
    ActiveLeafIn,
    CallTranscript,
    ClaimOut,
    ConversationCreate,
    ConversationMove,
    ConversationOut,
    EvidenceOut,
    ExportFileIn,
    FeedbackIn,
    MessageCreate,
    MessageOut,
)
from app.services.admin_settings_service import get_all_settings
from app.services.avatar_cue_service import compute_avatar_cue
from app.services.claim_loader import load_claims_for_messages
from app.services.claim_parser import (
    ClaimTagStripper,
    CruxSplitter,
    extract_claims,
    extract_crux,
    split_leading_sentence,
    strip_claim_tags,
)
from app.services.companion_names import name_for
from app.services.conversation_title import name_conversation
from app.services.document_ingestion import build_chunks, file_type_of, unsupported_reason
from app.services.geolocation import location_prompt_line
from app.services.decision_review import review_decisions
from app.services.thinking_review import review_thinking
from app.services.guidance import MAX_CONTEXT_ROUNDS, propose_guidance
from app.services.output_cleanup import clean_output
from app.services.confidence_scoring import (
    ScoredClaim,
    ScoringWeights,
    build_scored_evidence,
    compute_claim_score,
    compute_message_score,
    rescore_after_reconciliation,
)
from app.services.devils_advocate import generate_counterfactual
from app.services.decision_classifier import (
    NO_DECISION,
    DecisionClassification,
    build_bias_guidance,
    classify_decision,
)
from app.services.export_service import build_markdown_export, build_pdf_export
from app.services.office_export import MEDIA_TYPES, export_file as build_office_export
from app.services.message_tree import (
    active_path,
    descendants,
    latest_leaf,
    resolve_parent_id,
    siblings,
)
from app.services.memory_service import (
    HISTORY_WINDOW,
    get_memory_summary,
    should_rebuild_memory,
)
from app.services.anthropic_client import is_provider_unavailable_error, stream_generation
from app.services.prompt_builder import (
    build_context_block,
    build_conversation_input,
    build_system_instructions,
)
from app.services.profile_service import (
    get_profile,
    profile_prompt_block,
    should_rebuild as should_rebuild_profile,
)
from app.services.query_optimizer import optimize_query
from app.services.search_planner import SearchPlan, needs_live_data, plan_searches
from app.services.reflection_agent import reflect_and_revise
from app.services.retrieval import RetrievedChunk, retrieve_chunks
from app.services.storage import upload_file
from app.services.router import InvalidModeError, InvalidReasoningLensError, validate_mode, validate_reasoning_lens
from app.services.taxonomy import describe_bias
from app.services.verification_agent import reconcile_gray_area, verify_claim
from app.services.web_research import WebSource, gather_context, research_claim, tavily_available
from app.workers.rebuild_memory import rebuild_memory_task
from app.workers.rebuild_profile import rebuild_profile_task

logger = logging.getLogger("clardentity.chat")

router = APIRouter(prefix="/chat", tags=["chat"])


_TITLE_MAX_CHARS = 38
_TITLE_MAX_WORDS = 6

# Unsupported claims are researched concurrently, one agent each. Was two,
# which left the rest of a six-claim answer labelled as if nobody had looked
# - "0 of 6 claims backed by a source" on a textbook account of Indian
# independence. Six covers nearly every answer whole; each agent runs at most
# two search+judge rounds (web_research.MAX_ROUNDS), and they all share the
# deadline below, so the worst case is bounded in both calls and time.
_MAX_RESEARCHED_CLAIMS = 6

# How long the answer waits for the speculative web search that runs when
# the workspace has nothing to say. Measured 2026-09-16: 19 of the 25 seconds
# a user waited before the first token were this one call. Past the budget
# the answer goes ahead without web context; the per-claim research after
# the answer still finds and attaches sources, so what's lost is inline
# markers in the first draft, not the checking.
_PRE_SEARCH_BUDGET_SECONDS = 10.0

# The whole per-claim research phase, however many agents are in it.
#
# Measured 2026-09-16: a search round is 5-20s depending on the day and the
# tool, a supervisor round ~3s, so a claim that takes two rounds to settle
# costs 20-40s. This runs after the answer is on screen and the composer is
# live - the reader sees "Checking claims" under a finished answer - so the
# trade is a longer wait for the verdict against claims left unchecked, and
# unchecked claims were the complaint ("0 of 6 backed by a source" on a
# textbook history answer). Agents run concurrently, so this is a wall-clock
# cap on the phase, not a per-claim one.
_RESEARCH_DEADLINE_SECONDS = 45.0
# How long a finished answer waits for the verdict box (Decision-making /
# Thought coach) before going out without it. The box normally lands well
# before the last token; this is for the short answer that beats it, so the
# box still fills the slot the client is holding rather than dropping in
# above an answer already being read.
_REVIEW_GRACE_SECONDS = 4.0
# How much of an attached file goes in front of the model as-is this turn.
# Twelve chunks is ~8k tokens - a whole short document, the opening of a
# long one. The rest is in the workspace like any upload: retrieval finds
# the relevant parts of it for this question and for every later one.
_ATTACHMENT_CONTEXT_CHUNKS = 12


async def _ingest_attachments(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    attachments: list,
) -> list[RetrievedChunk]:
    """A document attached to a message becomes a workspace document - stored,
    chunked, embedded, committed - and its opening chunks are returned to go
    in front of the model for this turn. Rows have to exist before the turn
    starts: the answer's citations point at chunk rows by id.

    Images are not documents and are left alone here. A file that cannot be
    read is a 400 before anything streams, so the composer can say why."""
    documents = [a for a in attachments if a.type == "document"]
    if not documents:
        return []
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    leading: list[RetrievedChunk] = []
    for attachment in documents:
        filename = attachment.filename or "attachment"
        file_type = file_type_of(filename)
        if (reason := unsupported_reason(file_type)) is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{filename}: {reason}")
        data = attachment.data
        if data.startswith("data:"):
            data = data.split(",", 1)[-1]
        try:
            file_bytes = base64.b64decode(data, validate=False)
        except (ValueError, TypeError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{filename} could not be read") from exc
        if len(file_bytes) > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{filename} exceeds the {settings.max_upload_size_mb}MB limit",
            )
        document = Document(
            workspace_id=workspace_id,
            filename=filename,
            file_type=file_type,
            status="processing",
            uploaded_by=user_id,
        )
        db.add(document)
        await db.flush()
        try:
            chunks = await build_chunks(document.id, file_bytes, file_type)
        except Exception as exc:  # noqa: BLE001 - a corrupt file is the user's to fix
            logger.warning("attachment %s could not be parsed: %s", filename, exc)
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{filename} could not be read - is the file intact?",
            ) from exc
        if not chunks:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{filename} has no readable text",
            )
        # Kept in storage like an upload, so it can be opened and deleted
        # from the workspace later. Storage being down is not a reason to
        # refuse the question: the text is already in hand.
        try:
            storage_key = f"{workspace_id}/{document.id}/{filename}"
            await asyncio.to_thread(upload_file, storage_key, file_bytes, attachment.mime_type)
            document.storage_path = storage_key
        except Exception as exc:  # noqa: BLE001
            logger.warning("attachment %s not stored: %s", filename, exc)
        for chunk in chunks:
            db.add(chunk)
        document.status = "processed"
        await db.commit()
        leading.extend(
            RetrievedChunk(chunk=chunk, document=document, score=1.0)
            for chunk in chunks[:_ATTACHMENT_CONTEXT_CHUNKS]
        )
    return leading

# Openers that carry no information about the subject. Stripped so the title
# starts on the actual topic - "Hi, what's the difference between X and Y"
# should be filed under the difference, not under the greeting.
_TITLE_FILLER_PREFIXES = (
    "hi", "hey", "hello", "ok", "okay", "so", "well", "please", "quick question",
    "i was wondering", "i wanted to ask", "can you", "could you", "would you",
    "i'd like to know", "i want to know", "tell me", "let's say", "lets say",
)


def _derive_title(first_message: str) -> str:
    """A short label for a conversation, from its opening message.

    Deliberately not an LLM call: this runs on the first turn of every
    conversation, and a round-trip to name something the user just typed isn't
    worth the latency.

    It is a label in a sidebar, not a summary - so it is cut hard, to a few
    words. A title long enough to need truncating in the UI tells you nothing
    the truncation didn't already hide.
    """
    text = " ".join(first_message.split())

    # Peel greetings off one at a time: "Hi, so I was wondering..." has three.
    changed = True
    while changed:
        changed = False
        lowered = text.lower()
        for prefix in _TITLE_FILLER_PREFIXES:
            if lowered.startswith(prefix):
                rest = text[len(prefix) :].lstrip(" ,:-\u2013\u2014")
                # Only if something survives; "Hi" alone is still the title.
                if rest:
                    text = rest
                    changed = True
                    break

    words = text.split()
    truncated = len(words) > _TITLE_MAX_WORDS
    words = words[:_TITLE_MAX_WORDS]
    text = " ".join(words)

    if len(text) > _TITLE_MAX_CHARS:
        text = text[:_TITLE_MAX_CHARS].rsplit(" ", 1)[0] or text[:_TITLE_MAX_CHARS]
        truncated = True

    text = text.rstrip(" ,;:.-\u2013\u2014")
    if not text:
        return "Chat"

    text = text[0].upper() + text[1:]
    return f"{text}…" if truncated else text


def _serialize_message(
    message: Message,
    claims: list[ClaimOut],
    sibling_index: int = 0,
    sibling_count: int = 1,
    sibling_ids: list[uuid.UUID] | None = None,
) -> MessageOut:
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
        counterfactual_content=message.counterfactual_content,
        crux_text=message.crux_text,
        clarifier=message.clarifier,
        guidance=message.guidance,
        decision_review=message.decision_review,
        thinking_review=message.thinking_review,
        feedback=message.feedback,
        parent_id=message.parent_id,
        sibling_index=sibling_index,
        sibling_count=sibling_count,
        sibling_ids=sibling_ids or [message.id],
        claims=claims,
    )


@router.post("/conversations", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    payload: ConversationCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    await require_workspace_member(db, payload.workspace_id, current_user.id)

    conversation = Conversation(
        workspace_id=payload.workspace_id,
        title=payload.title,
        default_mode=payload.default_mode,
    )
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

    # Ordered by last activity, not creation: the sidebar shows the newest
    # twelve, and a chat started last week and continued today used to stay
    # at last week's position - off the list, "vanished" as far as the
    # person continuing it could tell. An empty chat counts from creation.
    last_activity = (
        select(func.max(Message.created_at))
        .where(Message.conversation_id == Conversation.id)
        .correlate(Conversation)
        .scalar_subquery()
    )
    rows = await db.execute(
        select(Conversation, func.coalesce(last_activity, Conversation.created_at).label("last_activity"))
        .where(Conversation.workspace_id == workspace_id)
        .order_by(func.coalesce(last_activity, Conversation.created_at).desc())
    )
    return [
        ConversationOut.model_validate(c, from_attributes=True).model_copy(update={"last_activity_at": at})
        for c, at in rows.all()
    ]


@router.get("/conversations/{conversation_id}", response_model=ConversationOut)
async def get_conversation(
    conversation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    conversation = await get_conversation_for_user(db, conversation_id, current_user.id)
    return ConversationOut.model_validate(conversation)


@router.patch("/conversations/{conversation_id}", response_model=ConversationOut)
async def move_conversation(
    conversation_id: uuid.UUID,
    payload: ConversationMove,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConversationOut:
    """Move a chat to another workspace. Membership of both sides is required;
    the destination check is the same one creating a chat there would pass."""
    conversation = await get_conversation_for_user(db, conversation_id, current_user.id)
    await require_workspace_member(db, payload.workspace_id, current_user.id)
    conversation.workspace_id = payload.workspace_id
    await db.commit()
    await db.refresh(conversation)
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


async def _all_messages(db: AsyncSession, conversation_id: uuid.UUID) -> list[Message]:
    rows = await db.execute(select(Message).where(Message.conversation_id == conversation_id))
    return list(rows.scalars().all())


async def _serialize_active_path(
    db: AsyncSession, conversation: Conversation, all_messages: list[Message]
) -> list[MessageOut]:
    """The path a user actually sees, each message annotated with where it
    sits among its siblings so the client can draw a "< 2/3 >" fork switcher
    wherever there's more than one."""
    path = active_path(all_messages, conversation.active_leaf_id)
    claims_by_message = await load_claims_for_messages(db, [m.id for m in path])
    result = []
    for m in path:
        group = siblings(all_messages, m)
        result.append(
            _serialize_message(
                m,
                claims_by_message.get(m.id, []),
                sibling_index=group.index(m),
                sibling_count=len(group),
                sibling_ids=[s.id for s in group],
            )
        )
    return result


@router.get("/{conversation_id}/messages", response_model=list[MessageOut])
async def list_messages(
    conversation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MessageOut]:
    conversation = await get_conversation_for_user(db, conversation_id, current_user.id)
    all_messages = await _all_messages(db, conversation_id)
    return await _serialize_active_path(db, conversation, all_messages)


@router.get("/{conversation_id}/export")
async def export_conversation(
    conversation_id: uuid.UUID,
    format: Literal["markdown", "pdf"] = Query(default="markdown"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    # FR13: full turn history, per-claim citations, and confidence bands -
    # same serialization the chat UI already renders from, and the same
    # active branch only - an abandoned regenerate/edit was never really
    # part of the answer, so it doesn't belong in the record of it either.
    conversation = await get_conversation_for_user(db, conversation_id, current_user.id)
    all_messages = await _all_messages(db, conversation_id)
    messages_out = await _serialize_active_path(db, conversation, all_messages)

    filename_base = "".join(
        ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in (conversation.title or "chat")
    ).strip("_") or "chat"

    if format == "markdown":
        content = build_markdown_export(conversation.title, messages_out)
        return Response(
            content=content,
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="{filename_base}.md"'},
        )

    pdf_bytes = build_pdf_export(conversation.title, messages_out)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename_base}.pdf"'},
    )


@router.post("/{conversation_id}/messages/{message_id}/devils-advocate")
async def devils_advocate(
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """The same answer with the bias guardrails off, for side-by-side reading.

    Generated on demand rather than with every message: it is a second full
    generation, and most answers are never compared. Cached on the row once
    produced, so opening the comparison a second time is free.
    """
    await check_rate_limit(
        f"chat:devils-advocate:{current_user.id}", max_requests=20, window_seconds=300
    )
    conversation = await get_conversation_for_user(db, conversation_id, current_user.id)

    message = await db.get(Message, message_id)
    if message is None or message.conversation_id != conversation.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    if message.role != "assistant" or not message.content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only an assistant answer can be re-argued",
        )

    if message.counterfactual_content:
        return {"counterfactual_content": message.counterfactual_content}

    claim_rows = await db.execute(
        select(MessageClaim.distortion_flag, MessageClaim.bias_category).where(
            MessageClaim.message_id == message.id,
            MessageClaim.distortion_flag.isnot(None),
        )
    )
    flagged = [(row[0], row[1]) for row in claim_rows.all()]

    try:
        text = await generate_counterfactual(message.content, flagged)
    except Exception as exc:  # noqa: BLE001 - a comparison failing must not 500 the chat
        # Same rule as the main answer path: the raw exception never reaches
        # the client. It can name a vendor or quote a credit-balance message
        # from whichever provider failed, and interpolating it straight into
        # `detail` (as this used to) said exactly that to the user instead.
        logger.error("devil's advocate generation failed", exc_info=True)
        detail = (
            "You've reached today's limit for responses. Please try again in a "
            "little while."
            if is_provider_unavailable_error(exc)
            else "Couldn't produce the comparison. Please try again."
        )
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail) from exc

    message.counterfactual_content = text
    await db.commit()
    return {"counterfactual_content": text}


@router.post("/{conversation_id}/messages/{message_id}/export-file")
async def export_file(
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    payload: ExportFileIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Creative mode's "save as a file": turns one answer into an actual
    Word document, slide deck, or spreadsheet, generated fresh on every
    request and streamed straight back - see office_export.py for why
    nothing is persisted server-side.
    """
    await check_rate_limit(
        f"chat:export-file:{current_user.id}", max_requests=10, window_seconds=300
    )
    conversation = await get_conversation_for_user(db, conversation_id, current_user.id)

    message = await db.get(Message, message_id)
    if message is None or message.conversation_id != conversation.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    if message.role != "assistant" or not message.content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only an assistant answer can be exported to a file",
        )

    try:
        file_bytes, filename = await build_office_export(message.content, payload.format)
    except Exception as exc:  # noqa: BLE001 - same rule as the other generation endpoints
        logger.error("office file export failed", exc_info=True)
        detail = (
            "You've reached today's limit for responses. Please try again in a "
            "little while."
            if is_provider_unavailable_error(exc)
            else "Couldn't generate the file. Please try again."
        )
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail) from exc

    return Response(
        content=file_bytes,
        media_type=MEDIA_TYPES[payload.format],
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.put("/{conversation_id}/messages/{message_id}/feedback")
async def set_message_feedback(
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    payload: FeedbackIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Thumbs up/down plus an optional free-text comment on one answer.

    Set, not appended: this is one person's current verdict on one message,
    not a thread, so a changed mind overwrites rather than accumulates. Both
    fields are independent - a comment alone with no rating is a valid thing
    to leave, and vice versa - so an empty body clears whichever wasn't sent
    the way any other partial update would.
    """
    await check_rate_limit(f"chat:feedback:{current_user.id}", max_requests=30, window_seconds=60)
    conversation = await get_conversation_for_user(db, conversation_id, current_user.id)

    message = await db.get(Message, message_id)
    if message is None or message.conversation_id != conversation.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    if message.role != "assistant":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Feedback only applies to an answer, not your own message",
        )

    feedback = {"rating": payload.rating, "comment": payload.comment}
    message.feedback = feedback
    await db.commit()
    return {"feedback": feedback}


@router.put("/{conversation_id}/active-leaf")
async def set_active_branch(
    conversation_id: uuid.UUID,
    payload: ActiveLeafIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Switch which branch is shown, without generating or deleting anything.

    `message_id` is any message in the tree - typically a sibling reached via
    the fork switcher's arrows. The branch shown becomes that message's own
    most recently created leaf, so reopening a branch resumes wherever it
    last left off rather than snapping back to its very first reply.
    """
    conversation = await get_conversation_for_user(db, conversation_id, current_user.id)
    all_messages = await _all_messages(db, conversation_id)
    target = next((m for m in all_messages if m.id == payload.message_id), None)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    conversation.active_leaf_id = latest_leaf(all_messages, target.id)
    await db.commit()
    return {"active_leaf_id": str(conversation.active_leaf_id)}


@router.delete("/{conversation_id}/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Permanently remove a message and everything that followed it, so the
    conversation can continue fresh from an earlier point.

    Unlike edit/regenerate - which only ever add a sibling and move the leaf
    pointer - this actually deletes rows. `messages.parent_id` is
    `ON DELETE CASCADE`, so the database removes the whole descendant
    subtree (and each row's own claims/citations/audio transcript) on its
    own; the only thing that needs explicit handling here is
    `active_leaf_id`, which is `ON DELETE SET NULL` and would otherwise leave
    the conversation looking empty rather than landing back on whatever's
    left. Sibling branches at or above the deleted message are untouched -
    the cascade only follows `parent_id` downward from the target.
    """
    conversation = await get_conversation_for_user(db, conversation_id, current_user.id)
    all_messages = await _all_messages(db, conversation_id)
    target = next((m for m in all_messages if m.id == message_id), None)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    doomed_ids = {m.id for m in descendants(all_messages, target.id)}
    doomed_ids.add(target.id)

    if conversation.active_leaf_id in doomed_ids:
        remaining = [m for m in all_messages if m.id not in doomed_ids]
        if target.parent_id is not None:
            # Land back on whatever's left of the parent's branch - a
            # sibling of the deleted message if one exists, otherwise the
            # parent itself.
            conversation.active_leaf_id = latest_leaf(remaining, target.parent_id)
        else:
            # The whole root branch was deleted. Fall back to another
            # remaining root's own latest leaf, newest first - the same
            # "show the newest branch" default a fresh conversation load
            # already uses - or None if nothing is left at all.
            other_roots = [m for m in remaining if m.parent_id is None]
            conversation.active_leaf_id = (
                latest_leaf(remaining, max(other_roots, key=lambda m: m.created_at).id)
                if other_roots
                else None
            )

    await db.delete(target)
    await db.commit()


# Work that outlives the turn's stream (a late Devil's Draft) needs a strong
# reference or the event loop may collect the task mid-flight.
_background: set[asyncio.Task] = set()


def _in_background(coro) -> None:
    task = asyncio.create_task(coro)
    _background.add(task)
    task.add_done_callback(_background.discard)


async def _store_title(conversation_id: uuid.UUID, pending: "asyncio.Task[str]", placeholder: str) -> None:
    try:
        title = await pending
    except Exception:  # noqa: BLE001 - the placeholder stays
        return
    if not title or title == placeholder:
        return
    async with AsyncSessionLocal() as db:
        conversation = await db.get(Conversation, conversation_id)
        # Only over the placeholder it was meant to replace - never over a
        # name the user has since given it.
        if conversation is not None and conversation.title == placeholder:
            conversation.title = title
            await db.commit()


async def _settle_title(
    conversation_id: uuid.UUID,
    pending: "asyncio.Task[str] | None",
    placeholder: str,
    wait_seconds: float,
) -> str | None:
    """The new name if it lands within `wait_seconds` (written to the row
    here, sent with the final event by the caller); otherwise it is written
    in the background when it does, and the client learns it on reload."""
    if pending is None:
        return None
    try:
        title = await asyncio.wait_for(asyncio.shield(pending), timeout=wait_seconds)
    except asyncio.TimeoutError:
        _in_background(_store_title(conversation_id, pending, placeholder))
        return None
    except Exception:  # noqa: BLE001
        return None
    if not title or title == placeholder:
        return None
    async with AsyncSessionLocal() as db:
        conversation = await db.get(Conversation, conversation_id)
        if conversation is not None and conversation.title == placeholder:
            conversation.title = title
            await db.commit()
        else:
            return None
    return title


async def _store_counterfactual(message_id: uuid.UUID, pending: "asyncio.Task[str | None]") -> None:
    try:
        text = await pending
    except Exception:  # noqa: BLE001 - optional, and already logged where it ran
        return
    if not text:
        return
    async with AsyncSessionLocal() as db:
        message = await db.get(Message, message_id)
        if message is not None and not message.counterfactual_content:
            message.counterfactual_content = clean_output(text)
            await db.commit()


@router.post("/{conversation_id}/messages")
async def send_message(
    conversation_id: uuid.UUID,
    payload: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EventSourceResponse:
    await check_rate_limit(f"chat:send:{current_user.id}", max_requests=20, window_seconds=60)

    # Phase timings, one line per turn at INFO - what "the response time is
    # high" gets measured against, without a profiler on production.
    t_start = time.monotonic()
    marks: list[str] = []

    def mark(phase: str) -> None:
        marks.append(f"{phase}={time.monotonic() - t_start:.1f}s")

    conversation = await get_conversation_for_user(db, conversation_id, current_user.id)
    admin_settings = await get_all_settings(db)
    all_messages = await _all_messages(db, conversation_id)

    # Two shapes of request share everything past this point - retrieval,
    # generation, scoring, persistence - and differ only in how they got
    # their mode/content/parent and whether the pre-answer gates run at all.
    regenerate_target: Message | None = None
    user_message: Message | None = None
    # Snapshotted right after the row is flushed, before the commit below
    # expires its attributes - the client's optimistic copy of this same
    # message carries a local placeholder id, and needs the real one back
    # to ever address this row again (e.g. to delete it).
    user_message_payload: dict | None = None
    guidance: dict | None = None
    # Set only on the regenerate path, to the existing question's own id -
    # kept separate from `effective_parent_id` below, which on this path
    # means something else (how far back `history` reaches), not what the
    # new answer attaches to. Conflating the two here previously attached a
    # regenerated answer as a sibling of the QUESTION rather than a sibling
    # of the old ANSWER - one level too high in the tree.
    regenerate_answer_parent_id: uuid.UUID | None = None
    # Set on a conversation's first turn: once the answer is in, the small
    # model names the chat from the exchange, replacing the derived
    # placeholder. Off the critical path; joins the final event when ready.
    naming_turn = False

    flags = admin_settings.get("feature_flags") or {}
    # Rapid mode answers from what it knows and what the workspace holds -
    # the search is the slowest thing on this path and its results would go
    # unchecked anyway.
    web_enabled = bool(flags.get("web_search_enabled", True))

    async def _plan(history: list[Message], message: str, mode: str) -> SearchPlan:
        """Which searches to run, and what to ask the document store. The
        planner is a fast model call; where the web is not going to be
        searched at all (search off, or a quick answer to something that
        isn't time-sensitive) the cheaper retrieval rewrite is enough."""
        if web_enabled and mode != "rapid":
            plan = await plan_searches(history, message)
            mark("plan")
            return plan
        if web_enabled and needs_live_data(message):
            # The quick answer gets one search, for the question as typed -
            # no planner call in front of it; a weather or price question
            # already is its own search query.
            return SearchPlan(retrieval_query=message, queries=[message])
        return SearchPlan(retrieval_query=await optimize_query(history, message), queries=[])

    async def _prefetch(
        plan_task: "asyncio.Task[SearchPlan]", mode: str
    ) -> tuple[str, list[RetrievedChunk], "asyncio.Task[list[WebSource]] | None", float]:
        """Retrieval and the speculative web search, started the moment the
        retrieval query exists - alongside the pre-answer gates, not after
        them. Measured 2026-09-16: run in sequence, the gate call, the
        query rewrite and the search stacked to 25s before the first token.
        A gate that then stops the turn wastes the search, which is cheap
        next to making every answer wait for it. Its own DB session: the
        request session is busy writing the user's message meanwhile, and an
        AsyncSession is not for concurrent use.

        Documents first, always: a user's own documents are the thing they
        trusted enough to upload, and a search result is not. But *finding
        out* whether the documents have anything is a database round-trip,
        and waiting for that answer before starting a search adds the whole
        search latency on top. So both go at once and the loser is
        discarded (by the caller)."""
        plan = await plan_task
        mark("plan-ready")
        query = plan.retrieval_query
        web_task = (
            asyncio.create_task(gather_context(plan.queries))
            if web_enabled and plan.queries
            else None
        )
        started = time.monotonic()
        try:
            async with AsyncSessionLocal() as rdb:
                chunks: list[RetrievedChunk] = await retrieve_chunks(
                    rdb, conversation.workspace_id, query, mode,
                    top_k=admin_settings["retrieval_top_k"],
                )
        except BaseException:
            if web_task is not None:
                web_task.cancel()
            raise
        mark("chunks")
        return query, chunks, web_task, started

    def _abandon(prefetch: "asyncio.Task") -> None:
        """A gate stopped the turn: nothing prefetched will be used."""
        if prefetch.done():
            if not prefetch.cancelled() and prefetch.exception() is None:
                web_task = prefetch.result()[2]
                if web_task is not None:
                    web_task.cancel()
        else:
            prefetch.cancel()

    if payload.regenerate_of is not None:
        # An alternate answer to a question already asked and settled - never
        # a new question, so none of the pre-answer gates apply a second
        # time. The new answer attaches as a sibling of the old one, under
        # the SAME parent user message; no new user row is created.
        regenerate_target = next(
            (m for m in all_messages if m.id == payload.regenerate_of), None
        )
        if regenerate_target is None or regenerate_target.role != "assistant":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
        parent_message = next(
            (m for m in all_messages if m.id == regenerate_target.parent_id), None
        )
        if parent_message is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This answer has no question to regenerate against",
            )
        try:
            mode = validate_mode(parent_message.mode_used)
        except InvalidModeError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        reasoning_lens = parent_message.reasoning_lens
        effective_content = parent_message.content or ""
        attached_chunks: list[RetrievedChunk] = []
        regenerate_answer_parent_id = parent_message.id
        # `history` is everything BEFORE the question being re-answered - the
        # same context the original answer was generated against - so this
        # walks the path ending at the question's own parent, one level
        # further back than where the new answer itself attaches.
        history = active_path(all_messages, parent_message.parent_id)[-HISTORY_WINDOW:]
        plan_task = asyncio.create_task(_plan(history, effective_content, mode))
        prefetch_task = asyncio.create_task(_prefetch(plan_task, mode))
        memory_summary = await get_memory_summary(db, conversation_id)
    else:
        # FR7: mode is mandatory and there is no auto-detection fallback -
        # reject with exactly 400, not Pydantic's default 422 for a missing
        # field.
        try:
            mode = validate_mode(payload.mode)
            reasoning_lens = validate_reasoning_lens(payload.reasoning_lens)
        except (InvalidModeError, InvalidReasoningLensError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        if not payload.content.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="content required")

        effective_content = payload.content
        # Where this message attaches. Normally "wherever the conversation
        # currently is" - but editing resends with an explicit parent_id (the
        # edited message's own parent), so the edit becomes a new sibling
        # instead of destroying everything that came after it. See
        # resolve_parent_id for why this isn't just `payload.parent_id or
        # active_leaf_id` - editing the first message of a conversation needs
        # an explicit override to root (None), which looks identical to "no
        # override" unless the two are told apart some other way.
        parent_id_given = "parent_id" in payload.model_fields_set
        effective_parent_id = resolve_parent_id(
            payload.model_fields_set, payload.parent_id, conversation.active_leaf_id
        )
        if (
            parent_id_given
            and payload.parent_id is not None
            and not any(m.id == payload.parent_id for m in all_messages)
        ):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

        # Started here rather than awaited here: its latency overlaps the
        # history and memory reads below, so the pre-answer check is close to
        # free. Rapid mode skips it outright: every gate it can raise -
        # sharpen the wording, pick an option, add context, switch mode - is
        # a round trip before the answer, and the user chose this mode to
        # not have those. They get the answer to the question as asked.
        # History first: the gates need it. Judged on the newest message
        # alone they re-asked, on a follow-up, what the conversation had
        # already established two turns earlier.
        history = active_path(all_messages, effective_parent_id)[-HISTORY_WINDOW:]
        guidance_task = (
            None if mode == "rapid"
            else asyncio.create_task(
                propose_guidance(
                    effective_content,
                    mode,
                    [(m.role, m.content or "") for m in history],
                )
            )
        )
        # The search plan depends on nothing the gates decide, so it runs
        # alongside them rather than after, and the searches it names start
        # the moment it lands.
        plan_task = asyncio.create_task(_plan(history, effective_content, mode))
        prefetch_task = asyncio.create_task(_prefetch(plan_task, mode))
        memory_summary = await get_memory_summary(db, conversation_id)

        # The mode nudge has to happen *before* generating, not after: a
        # question answered in the wrong mode has already had its claims
        # extracted, its evidence gathered and its score computed against the
        # wrong standard, and offering to switch underneath that asks the
        # reader to discard work they can see. It only reads the question and
        # the chosen mode, so it needs nothing from retrieval and runs while
        # the history and memory load.
        guidance = await guidance_task if guidance_task is not None else None
        mark("gates")

        # One question back, at most, before answering. The client embeds
        # each answered gate into the message ("(Clardentity asked: ...)"),
        # so its presence means the user has already been stopped once for
        # this question and answered. The three gates about the question
        # itself - sharpen the wording, pick an option, add context - must
        # not then take turns: seen in the wild as options, then a mode
        # suggestion, then a context question, then "did you mean", four
        # round trips for one question. Only the mode suggestion may still
        # follow, and only once (mode_confirmed).
        answered_a_gate = "(Clardentity asked:" in effective_content

        # Sharpening the phrasing comes before either of the checks below -
        # judging whether more context or a different mode is needed against
        # a question that's still genuinely unclear is itself unreliable, so
        # this resolves first. Persists nothing, same as the two gates below:
        # the message is not saved and no answer is generated.
        if (
            not payload.refined_confirmed
            and not answered_a_gate
            and guidance
            and guidance.get("refined_question")
        ):
            suggestion = {
                "refined_question": guidance["refined_question"],
                "refinement_reason": guidance.get("refinement_reason"),
            }

            async def refined_gate() -> AsyncIterator[dict]:
                yield {"event": "refined_question", "data": json.dumps(suggestion)}

            _abandon(prefetch_task)
            return EventSourceResponse(refined_gate())

        # Same reasoning as the gate above, for the sibling case: the wording
        # isn't ambiguous enough for one best rewrite, but the missing piece
        # has a short, enumerable set of likely answers - worth a tap instead
        # of either guessing or opening a free-text box. Also resolves before
        # context/mode, for the same reason: both are about the wording, not
        # about the user's situation or the chosen mode.
        if (
            not payload.clarifying_confirmed
            and not answered_a_gate
            and guidance
            and guidance.get("clarifying_options")
        ):
            suggestion = {
                "question": guidance.get("clarifying_question"),
                "options": guidance["clarifying_options"],
            }

            async def clarifying_gate() -> AsyncIterator[dict]:
                yield {"event": "clarifying_options", "data": json.dumps(suggestion)}

            _abandon(prefetch_task)
            return EventSourceResponse(clarifying_gate())

        # Asking why comes before suggesting a mode, and before answering.
        # The order is the point: a question like "I want to divorce my wife"
        # has no useful answer until the reasons are on the table, and an
        # answer written without them is advice fitted to a situation we
        # invented. Stopping here costs one round trip; retracting a
        # confident answer costs the user's trust in every answer after it.
        #
        # Persists nothing, exactly like the mode gate below - the message is
        # not saved and no answer is generated, so the transcript never shows
        # a question with nothing under it. Can fire more than once per turn
        # (see MAX_CONTEXT_ROUNDS): each round's guidance call sees the
        # accumulated content, prior questions and all, so it naturally stops
        # asking once enough is on the table - the round cap only guards the
        # case where it doesn't.
        if (
            not payload.context_acknowledged
            and not answered_a_gate
            and payload.context_rounds < MAX_CONTEXT_ROUNDS
            and guidance
            and guidance.get("context_question")
        ):

            async def context_gate() -> AsyncIterator[dict]:
                yield {
                    "event": "context_question",
                    "data": json.dumps({"question": guidance["context_question"]}),
                }

            _abandon(prefetch_task)
            return EventSourceResponse(context_gate())

        if not payload.mode_confirmed and guidance and guidance.get("suggested_mode"):
            # Nothing is persisted on this path. The user message is not
            # saved, no answer is generated, and the turn is exactly where it
            # was - so picking "stay" costs one round trip and picking
            # "switch" costs the same, rather than leaving a dangling
            # question with no answer under it in the transcript.
            suggestion = {
                "suggested_mode": guidance["suggested_mode"],
                "mode_reason": guidance.get("mode_reason"),
            }

            async def mode_gate() -> AsyncIterator[dict]:
                yield {"event": "mode_suggestion", "data": json.dumps(suggestion)}

            _abandon(prefetch_task)
            return EventSourceResponse(mode_gate())

        # Past the gates, so a question that gets stopped and re-sent with the
        # same files does not ingest them twice. Named in the turn, so the
        # thread shows what was sent and the model knows what it was given.
        attached_chunks = await _ingest_attachments(
            db, conversation.workspace_id, current_user.id, payload.attachments
        )
        if attached_chunks:
            names = ", ".join(dict.fromkeys(rc.document.filename for rc in attached_chunks))
            effective_content = f"{effective_content}\n\n(Attached: {names})"

        user_message = Message(
            conversation_id=conversation_id,
            role="user",
            content=effective_content,
            mode_used=mode,
            reasoning_lens=reasoning_lens if mode == "thinking" else None,
            parent_id=effective_parent_id,
        )
        db.add(user_message)
        # asyncpg's RETURNING support means flush() alone already pulls
        # created_at (a server-side default) back onto the object - no
        # explicit refresh() needed before this is safe to serialize.
        await db.flush()
        user_message_payload = _serialize_message(user_message, []).model_dump(mode="json")

        if payload.audio_duration_seconds is not None:
            # §12.1: links the transcribed turn back to its audio metadata.
            # The raw clip itself isn't persisted in MVP - only what's needed
            # to satisfy the audio_transcripts record (transcript + duration).
            db.add(
                AudioTranscript(
                    message_id=user_message.id,
                    transcript=effective_content,
                    duration_seconds=payload.audio_duration_seconds,
                )
            )

        # Convenience pre-fill only (§7.2) - never read back as an automatic
        # mode choice. The quick path is not a choice anyone made - it is the
        # "Quick answer" button pressed during a slow answer - so it must not
        # become what the chat reopens in.
        if mode != "rapid":
            conversation.default_mode = mode

        # Title the conversation from its opening question. Without this
        # every row in the workspace list reads "Untitled chat", which is
        # indistinguishable from the conversation not having been saved at
        # all.
        if conversation.title is None and not history:
            conversation.title = _derive_title(effective_content)
            # Placeholder: the first answer names it properly (see below).
            naming_turn = True

        # The user's turn is the leaf now, independent of whether an answer
        # ever lands - a page reload mid-generation should show the question
        # that was asked, not silently revert to wherever the branch was
        # before.
        conversation.active_leaf_id = user_message.id
        await db.commit()

    # The parent every downstream write (assistant message, citations, the
    # active-leaf pointer once it exists) attaches to: the user message just
    # created, or - on a regenerate, where none was - the existing question
    # being answered again.
    assistant_parent_id = (
        user_message.id if user_message is not None else regenerate_answer_parent_id
    )

    # §5.2 step 3: ambiguity detection/query rewrite for retrieval only -
    # `mode` and the persisted/displayed message are untouched by this.
    # Decision classification picks a *bias domain* only, and never influences
    # which cognitive mode is in play (§7.2).
    async def _classify() -> DecisionClassification:
        # Rapid mode runs no verification, so there is nothing to scope.
        if not flags.get("bias_screening_enabled", True) or mode == "rapid":
            return NO_DECISION
        return await classify_decision(effective_content)

    # Only Decision mode needs the classification *before* generating, because
    # only it puts a bias watch-list in the prompt. Every other mode uses it
    # after the fact, to scope the screening vocabulary during verification -
    # so it runs alongside the generation instead of delaying its first token.
    decision_task = asyncio.create_task(_classify())
    decision: DecisionClassification = NO_DECISION
    if mode == "decision":
        decision = await decision_task

    # The verdict box - "One decision that's correct..." in Decision mode,
    # "How to think about this" in Thought coach - reads only the question,
    # so it need not wait for the answer. It used to run in the post-answer
    # fan-out and drop into the top of the bubble several seconds after the
    # gist and journey were already on screen, which read as the wrong
    # order. Started here, before generation, and sent the moment it lands
    # (see the `review` event in the stream), it is the first thing shown -
    # the client's Option 2: box, gist, journey. Thought coach pays for the
    # classification it needs here rather than later; it has been running
    # since before the gates and is normally done.
    review_task: "asyncio.Task[dict | None] | None" = None
    thinking_task: "asyncio.Task[dict | None] | None" = None
    if mode in ("decision", "thinking"):
        try:
            early_decision = await decision_task
        except Exception:  # noqa: BLE001 - screening scope degrades, nothing fails
            early_decision = NO_DECISION
        if mode == "decision":
            review_task = asyncio.create_task(
                review_decisions(effective_content, early_decision.bias_category_id)
            )
        else:
            thinking_task = asyncio.create_task(
                review_thinking(effective_content, early_decision.bias_category_id)
            )

    # Started alongside the gates above; by now it has usually finished the
    # retrieval and is some way into the search.
    retrieval_query, chunks, web_task, search_started = await prefetch_task
    if attached_chunks:
        # The attachment's opening leads the context; retrieval may add
        # later parts of the same file, deduplicated by chunk.
        seen = {rc.chunk.id for rc in attached_chunks}
        chunks = attached_chunks + [rc for rc in chunks if rc.chunk.id not in seen]
    mark("retrieval")

    # The proactive watch-list is Decision mode's job; other modes still get
    # domain-scoped screening, they just aren't told to editorialise about it.
    bias_guidance = build_bias_guidance(decision) if mode == "decision" else None
    profile_block = profile_prompt_block(await get_profile(db, current_user.id))
    # Appended rather than folded into the profile: the profile is inferred
    # from what the user wrote, this is inferred from where they connected
    # from, and the two deserve different amounts of trust.
    location_line = location_prompt_line(
        current_user.location_label, current_user.location_timezone
    )
    if location_line:
        profile_block = f"{profile_block}\n\n{location_line}" if profile_block else location_line
    instructions = build_system_instructions(
        mode,
        reasoning_lens,
        bias_guidance,
        profile_block,
        companion_name=name_for(current_user.companion_names, mode),
    )
    scoring_weights = ScoringWeights.from_settings(admin_settings["scoring_weights"])
    gesture_map = admin_settings["avatar_gesture_map"]

    input_images: list[str] = []
    if flags.get("image_input_enabled", True):
        for attachment in payload.attachments:
            if attachment.type != "image":
                continue
            data = attachment.data
            if not data.startswith("data:"):
                data = f"data:{attachment.mime_type};base64,{data}"
            input_images.append(data)
    gen_model = admin_settings.get("openai_model")
    # Which model writes the answer, by mode (an explicit admin override still
    # wins): the smallest for the quick answer, the fast one for the modes
    # whose quality gate is verification rather than deliberation, the
    # flagship for the reasoning-heavy rest. See config for the measurements.
    if not gen_model:
        if mode == "rapid":
            gen_model = settings.anthropic_rapid_model
        elif mode in {m.strip() for m in settings.fast_generation_modes.split(",") if m.strip()}:
            gen_model = settings.anthropic_fast_model
    gen_temperature = admin_settings.get("openai_temperature")

    async def event_stream() -> AsyncIterator[dict]:
        full_text = ""
        stripper = ClaimTagStripper()
        crux_splitter = CruxSplitter()

        # The verdict box, sent once, the first moment it is ready - checked
        # before the first token and between tokens, so it goes out ahead
        # of the gist when it can (it usually can: ~3s against ~5s).
        review_sent = False

        def review_event() -> dict | None:
            nonlocal review_sent
            if review_sent:
                return None
            pending = review_task or thinking_task
            if pending is None or not pending.done():
                return None
            review_sent = True
            try:
                result = pending.result()
            except Exception:  # noqa: BLE001 - the box is optional
                return None
            if not result:
                return None
            key = "decision_review" if review_task is not None else "thinking_review"
            return {"event": "review", "data": json.dumps({key: result})}

        # An early warning the client acts on: this answer is going to be a
        # long one, so offer the quick way out now rather than after a fixed
        # wait. The tell is that nothing in the workspace matched and the
        # only search available is the model's own tool, which takes 5-20s
        # a round; with a search API in place the pre-search is a couple of
        # seconds and the first token isn't far behind, so no warning (the
        # client still shows the button on its own after a fixed wait).
        # Quick answers themselves never warn; there is nothing quicker.
        if mode != "rapid" and not chunks and web_task is not None and not tavily_available():
            yield {
                "event": "status",
                "data": json.dumps(
                    {"phase": "slow", "label": "This one will take a little longer"}
                ),
            }

        # The wait for the web search happens here, inside the stream, so the
        # warning above reaches the client before it rather than after.
        web_sources: list[WebSource] = []
        # A pre-search that missed its budget is not thrown away: it keeps
        # running while the answer streams, and whatever it brings back seeds
        # the per-claim research afterwards (see research_claim's `seed`).
        late_search: asyncio.Task[list[WebSource]] | None = None
        if web_task is not None:
            if chunks:
                web_task.cancel()
            else:
                # The budget counts from when the search started, not from now.
                remaining = max(
                    0.0, _PRE_SEARCH_BUDGET_SECONDS - (time.monotonic() - search_started)
                )
                try:
                    web_sources = await asyncio.wait_for(
                        asyncio.shield(web_task), timeout=remaining
                    )
                except asyncio.TimeoutError:
                    logger.info("web pre-search over budget; answering without web context")
                    web_sources = []
                    late_search = web_task
                except (asyncio.CancelledError, Exception):  # noqa: B014 - degrade, never fail
                    web_sources = []
        context_block = build_context_block(chunks, web_sources)
        input_text = build_conversation_input(
            context_block, memory_summary, history, effective_content
        )
        mark("context")

        # Named phases, so the wait says what is being waited on. Silence for
        # eight seconds and "Weighing sources" for eight seconds are the same
        # eight seconds, and only one of them reads as progress.
        yield {
            "event": "status",
            "data": json.dumps(
                {"phase": "reading", "label": "Reading your documents"}
                if chunks
                else {"phase": "searching", "label": "Searching the web"}
                if web_sources
                else {"phase": "thinking", "label": "Cogitating"}
            ),
        }

        # Sent first if it is already in hand; otherwise the client holds its
        # slot at the top of the bubble and it fills in when it lands (the
        # review is a ~10s judgement; the gist must not wait on it).
        early = review_event()
        if early:
            mark("review")
            yield early

        try:
            async for event in stream_generation(
                instructions=instructions,
                input_text=input_text,
                model=gen_model,
                temperature=gen_temperature,
                input_images=input_images,
            ):
                if event["type"] == "delta":
                    late = review_event()
                    if late:
                        mark("review")
                        yield late
                    full_text += event["text"]
                    # The leading one-sentence crux goes out as its own event
                    # the moment it closes, and never as body text - the
                    # client shows it as the first thing, above a body that
                    # streams in behind a fold. See CruxSplitter.
                    crux_now, passthrough = crux_splitter.feed(event["text"])
                    if crux_now:
                        mark("crux")
                        yield {"event": "crux", "data": json.dumps({"text": clean_output(crux_now)})}
                    visible = stripper.feed(passthrough) if passthrough else ""
                    if visible:
                        yield {"event": "delta", "data": json.dumps({"text": visible})}
                elif event["type"] == "done":
                    full_text = event["full_text"]
            tail = stripper.feed(crux_splitter.flush())
            if tail:
                yield {"event": "delta", "data": json.dumps({"text": tail})}
        except Exception as exc:  # noqa: BLE001 - surfaced to the client as an SSE error event
            decision_task.cancel()
            # The raw exception never reaches the client: it can name a
            # vendor, quote a credit-balance message, or otherwise say things
            # the identity rules forbid the model itself from saying. Logged
            # here, in full, for us; the client gets one of two fixed,
            # vendor-silent sentences. `is_provider_unavailable_error` is the
            # same test that drives the Claude<->OpenAI fallback in
            # anthropic_client.py - by the time either exception reaches
            # here, both providers have already been tried and failed.
            logger.error("chat generation failed", exc_info=True)
            detail = (
                "You've reached today's limit for responses. Please try again in a "
                "little while."
                if is_provider_unavailable_error(exc)
                else "Something went wrong generating a response. Please try again."
            )
            yield {"event": "error", "data": json.dumps({"detail": detail})}
            return

        # ------------------------------------------------------------------
        # The answer is done. Everything below it - reflection, verification,
        # scoring - is *about* the answer, and used to run before the client
        # was told anything, which left the composer disabled for as long as
        # the whole validation pipeline took. So the draft is persisted and
        # announced here, and the analysis lands afterwards as an update.
        #
        # Persisting first also means a follow-up question sent during that
        # window sees this turn in its history, rather than a hole where the
        # assistant's reply should be.
        # ------------------------------------------------------------------
        # Pulled off the front before anything else touches full_text, so
        # every downstream consumer - the draft, reflection, claim
        # extraction, the counterfactual - works from crux-free text and
        # none of them can reintroduce or duplicate it.
        mark("generated")
        crux_text, full_text = extract_crux(full_text)
        if crux_text is None:
            # The model sometimes skips the <crux> wrapper (the fast model
            # in particular). Every brief asks for the bottom line first, so
            # the first sentence is it - and without a gist there is no
            # gist card and no fold, and the answer lands as a wall of text
            # in an order nobody asked for.
            crux_text, full_text = split_leading_sentence(full_text)
            if crux_text is None:
                logger.warning("no gist could be derived; answer opens with: %r", full_text[:160])
        draft_display_text = clean_output(strip_claim_tags(full_text))

        async with AsyncSessionLocal() as answer_db:
            assistant_message = Message(
                conversation_id=conversation_id,
                role="assistant",
                content=draft_display_text,
                mode_used=mode,
                reasoning_lens=reasoning_lens if mode == "thinking" else None,
                parent_id=assistant_parent_id,
                # Written now, not in the finalize block: the "answer" event
                # is built from this row, and the client swaps its streaming
                # bubble for that payload - so a crux missing here vanished
                # from the screen for the whole claim-checking wait and came
                # back with "final". A reload in that window lost it too.
                crux_text=clean_output(crux_text) if crux_text else None,
            )
            answer_db.add(assistant_message)
            await answer_db.flush()
            # Same session, same commit: the branch pointer and the message it
            # points to land together, so a reload can never see one without
            # the other.
            await answer_db.execute(
                update(Conversation)
                .where(Conversation.id == conversation_id)
                .values(active_leaf_id=assistant_message.id)
            )
            await answer_db.commit()
            await answer_db.refresh(assistant_message)
            assistant_message_id = assistant_message.id
            answer_payload = _serialize_message(assistant_message, []).model_dump(mode="json")

        # A short answer can finish before the box does; give it a moment so
        # the two arrive in the order they are shown.
        pending_review = review_task or thinking_task
        if pending_review is not None and not review_sent:
            await asyncio.wait({pending_review}, timeout=_REVIEW_GRACE_SECONDS)
            late = review_event()
            if late:
                mark("review")
                yield late

        yield {
            "event": "answer",
            "data": json.dumps({"message": answer_payload, "user_message": user_message_payload}),
        }

        title_task: "asyncio.Task[str] | None" = (
            asyncio.create_task(
                name_conversation(effective_content, crux_text, conversation.title or "")
            )
            if naming_turn
            else None
        )

        if mode == "rapid":
            # That was the whole job. No reflection, no claims, no evidence,
            # no score, no counterfactual - the answer ships as drafted, with
            # no verdict attached, and says so by carrying none. The client
            # shows no confidence badge for a message with no band, so the
            # absence reads as "not checked", not as a low score.
            decision_task.cancel()
            avatar_cue = compute_avatar_cue(mode, None, False, gesture_map)
            async with AsyncSessionLocal() as gen_db:
                assistant_message = await gen_db.get(Message, assistant_message_id)
                assistant_message.avatar_expression = avatar_cue.expression
                assistant_message.avatar_gesture = avatar_cue.gesture
                await gen_db.commit()
                await gen_db.refresh(assistant_message)
                total_messages = await gen_db.scalar(
                    select(func.count())
                    .select_from(Message)
                    .where(Message.conversation_id == conversation_id)
                )
            if should_rebuild_memory(total_messages or 0):
                rebuild_memory_task.delay(str(conversation_id))
            async with AsyncSessionLocal() as profile_db:
                if await should_rebuild_profile(profile_db, current_user.id):
                    rebuild_profile_task.delay(str(current_user.id))
            new_title = await _settle_title(
                conversation_id, title_task, conversation.title or "", wait_seconds=1.2
            )
            mark("final")
            logger.info("turn timing mode=%s claims=0 %s", mode, " ".join(marks))
            yield {
                "event": "final",
                "data": json.dumps(
                    {
                        "message": _serialize_message(assistant_message, []).model_dump(mode="json"),
                        "conversation_title": new_title,
                        "counterfactual_content": None,
                        "decision_review": None,
                        "thinking_review": None,
                        "research_notes": [],
                        "claims": [],
                        "confidence": {"score": None, "band": None},
                        "avatar_cue": {
                            "expression": avatar_cue.expression,
                            "gesture": avatar_cue.gesture,
                        },
                    }
                ),
            }
            return

        yield {
            "event": "status",
            "data": json.dumps({"phase": "validating", "label": "Weighing the evidence"}),
        }

        # ------------------------------------------------------------------
        # Everything left is independent of everything else left, so it all
        # goes at once. Serially this was reflection, then classification,
        # then verification, then the counterfactual - four round-trips
        # stacked end to end for no reason other than the order they were
        # written in.
        #
        # Claim verification runs against the *draft's* claims rather than
        # waiting for reflection to finish. Reflection is explicitly
        # instructed to preserve the claim structure and only improve the
        # prose inside it, and a revision that changes the claim count is
        # discarded - so the claims being scored are the claims that ship.
        # ------------------------------------------------------------------
        parsed_claims = extract_claims(full_text)

        # The critique-and-rewrite pass is for reasoning: a Thinking chain
        # or a Decision case reads better for it. A Knowing answer is a set
        # of checked facts - the check *is* its quality gate - and the pass
        # cost 4-6s at the end of every turn, after which the text a reader
        # had already read swapped under them for the revised one.
        reflection_task = (
            asyncio.create_task(reflect_and_revise(mode, full_text))
            if mode != "knowing"
            else None
        )
        # `decision_task` has been running since earlier in this function, so
        # awaiting it here is normally immediate - not a new blocking call.
        # It has to happen before review_task/thinking_task below, which need
        # its result: both take bias_category_id as a plain argument, so
        # Python needs a value the moment the coroutine is constructed, not
        # merely by the time it runs.
        try:
            decision_result = await decision_task
        except Exception:  # noqa: BLE001 - screening scope degrades, nothing fails
            decision_result = NO_DECISION
        bias_category_id = decision_result.bias_category_id

        counterfactual_task = (
            asyncio.create_task(generate_counterfactual(draft_display_text))
            if draft_display_text
            else None
        )

        # Markers 1..len(chunks) are documents; anything above continues into
        # the web sources, in the order build_context_block numbered them.
        # `live_sources` grows below as per-claim research finds more, and the
        # marker arithmetic follows it.
        live_sources: list[WebSource] = list(web_sources)

        def source_excerpt(marker: int) -> str:
            if marker <= len(chunks):
                return chunks[marker - 1].chunk.content
            return live_sources[marker - len(chunks) - 1].excerpt

        def valid_markers(raw: list[int]) -> list[int]:
            limit = len(chunks) + len(live_sources)
            return [m for m in sorted(set(raw)) if 0 < m <= limit]

        # §9.1 step 3: per-claim, per-evidence verification + cognitive-bias
        # screening, run concurrently across claims. `bias_category_id` scopes
        # the screening vocabulary to the domain this conversation is about.
        claim_marker_lists = [valid_markers(c.citation_markers) for c in parsed_claims]
        verifications = await asyncio.gather(
            *(
                verify_claim(
                    claim.claim_text,
                    [source_excerpt(m) for m in markers],
                    bias_category_id=bias_category_id,
                )
                for claim, markers in zip(parsed_claims, claim_marker_lists)
            )
        )

        evidence_by_claim = [
            build_scored_evidence(markers, chunks, v.evidence, live_sources)
            for markers, v in zip(claim_marker_lists, verifications)
        ]

        # A claim nothing supports is where the search agent earns its keep:
        # the answer already exists, so there is a specific proposition to go
        # and check rather than a vague topic. Every such claim is researched
        # at once - one agent per claim - because they have nothing to do with
        # each other and running them in sequence made a three-unsupported-claim
        # answer take three times as long for no benefit.
        #
        # Except a claim the model wrote as its own opinion: there is nothing
        # to go and check by design (see prompt_builder's opinion framing),
        # so searching for it would spend a call finding something irrelevant
        # to attach - and if it succeeded, that evidence would fight with
        # compute_claim_score's opinion tier over what the claim actually is.
        research_notes: list[str] = []
        if web_enabled:
            targets = [
                i
                for i, ev in enumerate(evidence_by_claim)
                if not ev and not parsed_claims[i].is_opinion
            ][:_MAX_RESEARCHED_CLAIMS]
            if targets:
                # The pre-answer search, if it finished late: its sources
                # are judged against every unsupported claim first, before
                # any new search is spent.
                seed: list[WebSource] | None = None
                if late_search is not None:
                    try:
                        seed = await asyncio.wait_for(asyncio.shield(late_search), timeout=5.0)
                    except (asyncio.TimeoutError, asyncio.CancelledError, Exception):  # noqa: B014
                        seed = None
                # A deadline, not a hope. Each agent can run two
                # search-and-judge rounds, and rounds against a slow search
                # are most of the end-to-end budget on their own. Whatever
                # has come back when the clock runs out is what gets used;
                # claims still unsupported stay unsupported, which is a true
                # statement either way.
                try:
                    results = await asyncio.wait_for(
                        asyncio.gather(
                            *(
                                research_claim(parsed_claims[i].claim_text, seed=seed)
                                for i in targets
                            ),
                            return_exceptions=True,
                        ),
                        timeout=_RESEARCH_DEADLINE_SECONDS,
                    )
                except asyncio.TimeoutError:
                    research_notes.append(
                        "Ran out of time checking this against outside sources."
                    )
                    results = [None] * len(targets)
                # Marker assignment is serial even though the searches weren't:
                # every claim's sources need a distinct block of marker numbers
                # in `live_sources`, and handing them out concurrently would
                # interleave them.
                recheck: list[tuple[int, list[int]]] = []
                for i, research in zip(targets, results):
                    if research is None:
                        continue
                    if isinstance(research, BaseException) or not research.succeeded:
                        if not isinstance(research, BaseException):
                            # Say what was tried. "Unsupported after three
                            # searches" is a stronger statement than
                            # "unsupported because nobody looked", and the
                            # reader should be able to tell which they got.
                            research_notes.extend(research.trail)
                        continue
                    first_marker = len(chunks) + len(live_sources) + 1
                    live_sources.extend(research.sources)
                    recheck.append(
                        (i, list(range(first_marker, first_marker + len(research.sources))))
                    )

                if recheck:
                    rechecked = await asyncio.gather(
                        *(
                            verify_claim(
                                parsed_claims[i].claim_text,
                                [source_excerpt(m) for m in found],
                                bias_category_id=bias_category_id,
                            )
                            for i, found in recheck
                        )
                    )
                    for (i, found), v in zip(recheck, rechecked):
                        claim_marker_lists[i] = found
                        evidence_by_claim[i] = build_scored_evidence(
                            found, chunks, v.evidence, live_sources
                        )

        mark("verified")
        scored_claims: list[ScoredClaim] = []
        for claim, markers, verification, evidence in zip(
            parsed_claims, claim_marker_lists, verifications, evidence_by_claim
        ):
            claim_score, entailment_label = compute_claim_score(
                evidence,
                distorted=bool(verification.distortion_flag),
                opinion=claim.is_opinion,
            )
            scored_claims.append(
                ScoredClaim(
                    claim_index=claim.claim_index,
                    claim_text=clean_output(claim.claim_text),
                    claim_score=claim_score,
                    entailment_label=entailment_label,
                    distortion_flag=verification.distortion_flag,
                    distortion_explanation=verification.distortion_explanation,
                    bias_category=verification.bias_category,
                    evidence=evidence,
                )
            )

        # Veracity framework "Targeted Blind Sampling": claims that landed in
        # the gray_area tier get one independent second look, run concurrently
        # since they have nothing to do with each other. The second pass never
        # sees the tier we just assigned, so it can't just rubber-stamp it.
        gray_area_indices = [
            i for i, c in enumerate(scored_claims) if c.entailment_label == "gray_area"
        ]
        if gray_area_indices:
            reconciliations = await asyncio.gather(
                *(
                    reconcile_gray_area(
                        scored_claims[i].claim_text,
                        [source_excerpt(m) for m in claim_marker_lists[i]],
                    )
                    for i in gray_area_indices
                ),
                return_exceptions=True,
            )
            for i, result in zip(gray_area_indices, reconciliations):
                if isinstance(result, BaseException):
                    continue
                c = scored_claims[i]
                c.reconciliation_note = result.note
                c.dynamic = result.dynamic
                # A blind pass that recognizes a spoofed/deepfake-shaped premise
                # or an accurate claim buried in informal phrasing overrules the
                # first-pass number - the reconciliation matrix treats both as
                # cases the first pass got wrong, not cases it was merely unsure
                # about. "genuinely_developing" leaves the score untouched; it
                # confirms gray_area rather than correcting it.
                #
                # Re-derived from the evidence rather than clamped: clamping a
                # 41-80 score to max(.,81) or min(.,40) produced exactly 81 and
                # exactly 40 every single time, which read as a measurement and
                # was a constant.
                rescored = rescore_after_reconciliation(c.evidence, result.pattern)
                if rescored is not None:
                    c.claim_score, c.entailment_label = rescored

        message_score = compute_message_score(scored_claims, scoring_weights)

        # Both were launched before verification started, so by now they are
        # either done or nearly so - the await costs whatever is left, not the
        # whole call.
        final_text = full_text
        if reflection_task is not None:
            try:
                final_text, _was_revised = await reflection_task
            except Exception:  # noqa: BLE001 - a failed critique keeps the draft
                final_text = full_text
        # The Devil's Draft is not waited for. It is a whole second answer
        # written by the fast model - as long as the verification it ran
        # alongside, often longer - and it was the last thing the verdict
        # waited on. If it has landed, it ships with the verdict; if not, it
        # is written to the row when it does, and a reader who flips before
        # then gets it on demand from the devils-advocate endpoint (which
        # generates on a miss anyway).
        counterfactual_text: str | None = None
        if counterfactual_task is not None:
            if counterfactual_task.done():
                try:
                    counterfactual_text = counterfactual_task.result()
                except Exception:  # noqa: BLE001 - the comparison is optional
                    counterfactual_text = None
            else:
                _in_background(_store_counterfactual(assistant_message_id, counterfactual_task))

        # strip_claim_tags preserves the model's own formatting/whitespace
        # between claims exactly, matching what streaming already showed -
        # rejoining claim_text pieces with an artificial separator would
        # flatten lists/paragraphs and visibly reflow the message on finalize.
        decision_review = await review_task if review_task else None
        thinking_review = await thinking_task if thinking_task else None
        display_text = clean_output(strip_claim_tags(final_text))
        # §8.4: computed once confidence scoring completes; a distortion flag
        # overrides the expression to "concerned" regardless of the band.
        avatar_cue = compute_avatar_cue(
            mode, message_score.band, message_score.distortion_penalty_applied, gesture_map
        )

        async with AsyncSessionLocal() as gen_db:
            # The row already exists - it was written the moment the answer
            # finished streaming. This fills in everything the analysis
            # produced, and rewrites the text only if reflection changed it.
            assistant_message = await gen_db.get(Message, assistant_message_id)
            assistant_message.content = display_text
            assistant_message.confidence_score = message_score.score
            assistant_message.confidence_band = message_score.band
            assistant_message.distortion_penalty_applied = message_score.distortion_penalty_applied
            assistant_message.avatar_expression = avatar_cue.expression
            assistant_message.avatar_gesture = avatar_cue.gesture
            # Written now, not when someone clicks. Producing it on demand
            # meant a five-second wait behind a button whose whole appeal is
            # an instant side-by-side.
            if counterfactual_text:
                assistant_message.counterfactual_content = clean_output(counterfactual_text)
            assistant_message.decision_review = decision_review
            assistant_message.thinking_review = thinking_review
            await gen_db.flush()

            # One `citations` row per unique marker actually cited anywhere
            # in the message (Phase 4 table, still the FK target for
            # claim_evidence below).
            all_markers = sorted({e.citation_marker for c in scored_claims for e in c.evidence})
            marker_to_citation_id: dict[int, uuid.UUID] = {}
            for marker in all_markers:
                if marker > len(chunks):
                    source = live_sources[marker - len(chunks) - 1]
                    citation = Citation(
                        message_id=assistant_message.id,
                        source_type="web",
                        marker=marker,
                        url=source.url,
                        title=source.title,
                        relevance_score=source.credibility_score,
                        credibility_score=source.credibility_score,
                        credibility_note=source.credibility_note,
                    )
                else:
                    rc = chunks[marker - 1]
                    citation = Citation(
                        message_id=assistant_message.id,
                        document_id=rc.document.id,
                        chunk_id=rc.chunk.id,
                        source_type="document",
                        marker=marker,
                        relevance_score=rc.score,
                    )
                gen_db.add(citation)
                await gen_db.flush()
                marker_to_citation_id[marker] = citation.id

            # The claim rows carry the sentence *as it ships*, not as drafted.
            # Verification ran on the draft's claims, but reflection may have
            # reworded the prose - it keeps the claim count (or is discarded),
            # so the i-th shipped claim is the i-th scored one. Storing the
            # draft wording left the client unable to find an opinion claim
            # in the text it was rendering, so opinions went unmarked.
            shipped = extract_claims(final_text)
            shipped_text = (
                [clean_output(s.claim_text) for s in shipped]
                if len(shipped) == len(scored_claims)
                else [c.claim_text for c in scored_claims]
            )

            for c, text_as_shipped in zip(scored_claims, shipped_text):
                claim_row = MessageClaim(
                    message_id=assistant_message.id,
                    claim_index=c.claim_index,
                    claim_text=text_as_shipped,
                    claim_score=c.claim_score,
                    entailment_label=c.entailment_label,
                    distortion_flag=c.distortion_flag,
                    distortion_explanation=c.distortion_explanation,
                    bias_category=c.bias_category,
                    reconciliation_note=c.reconciliation_note,
                    dynamic=c.dynamic,
                )
                gen_db.add(claim_row)
                await gen_db.flush()

                for e in c.evidence:
                    gen_db.add(
                        ClaimEvidence(
                            claim_id=claim_row.id,
                            citation_id=marker_to_citation_id.get(e.citation_marker),
                            support_score=e.support_score,
                            relevance_score=e.relevance_score,
                            entailment_label=e.entailment_label,
                            source_excerpt=e.excerpt,
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

        # The long-term profile spans every conversation, so it's refreshed on
        # its own cadence rather than per-conversation. Checked in the
        # generation session because `db` is closed by this point.
        async with AsyncSessionLocal() as profile_db:
            if await should_rebuild_profile(profile_db, current_user.id):
                rebuild_profile_task.delay(str(current_user.id))

        claims_out = [
            ClaimOut(
                claim_index=c.claim_index,
                # Same as-shipped wording the rows were stored with, so the
                # live "final" event and a later reload agree.
                claim_text=text_as_shipped,
                claim_score=c.claim_score,
                entailment_label=c.entailment_label,
                distortion_flag=c.distortion_flag,
                distortion_explanation=c.distortion_explanation,
                **describe_bias(c.distortion_flag, c.bias_category),
                evidence=[
                    EvidenceOut(
                        citation_marker=e.citation_marker,
                        document_id=e.document_id,
                        document_filename=e.document_filename,
                        excerpt=e.excerpt,
                        support_score=e.support_score,
                        relevance_score=e.relevance_score,
                        entailment_label=e.entailment_label,
                        source_type=e.source_type,
                        url=e.url,
                        credibility_score=e.credibility_score,
                        credibility_note=e.credibility_note,
                    )
                    for e in c.evidence
                ],
            )
            for c, text_as_shipped in zip(scored_claims, shipped_text)
        ]

        new_title = await _settle_title(
            conversation_id, title_task, conversation.title or "", wait_seconds=2.0
        )
        final_payload = {
            "message": _serialize_message(assistant_message, claims_out).model_dump(mode="json"),
            # Set on the first turn once the small model has named the chat.
            "conversation_title": new_title,
            # Ships with the answer so the Devil's Draft opens instantly.
            "counterfactual_content": counterfactual_text,
            "decision_review": decision_review,
            "thinking_review": thinking_review,
            # Only present when the search agent came back empty-handed; it is
            # the difference between "nothing supports this" and "nothing was
            # looked for".
            "research_notes": research_notes,
            "claims": [c.model_dump(mode="json") for c in claims_out],
            "confidence": {"score": message_score.score, "band": message_score.band},
            "avatar_cue": {"expression": avatar_cue.expression, "gesture": avatar_cue.gesture},
        }
        mark("final")
        logger.info("turn timing mode=%s claims=%d %s", mode, len(scored_claims), " ".join(marks))
        yield {"event": "final", "data": json.dumps(final_payload)}

    return EventSourceResponse(event_stream())


@router.post(
    "/{conversation_id}/call-transcript",
    response_model=list[MessageOut],
    status_code=status.HTTP_201_CREATED,
)
async def save_call_transcript(
    conversation_id: uuid.UUID,
    payload: CallTranscript,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MessageOut]:
    """Write a finished call into the conversation.

    Saved unscored and said so plainly elsewhere in the UI: a call runs outside
    retrieval and verification because those take seconds, which is fine behind
    a streaming answer and fatal between spoken turns. So these rows carry no
    claims, no citations and no confidence band - the alternative was letting
    the call vanish when it ended, which loses the one thing the user actually
    said out loud.
    """
    conversation = await get_conversation_for_user(db, conversation_id, current_user.id)
    # Same 400-not-422 contract as the send endpoint; uncaught this surfaced
    # as a 500 on a request the caller could have fixed.
    try:
        mode = validate_mode(payload.mode)
    except InvalidModeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    saved: list[Message] = []
    for turn in payload.turns:
        message = Message(
            conversation_id=conversation.id,
            role=turn.role,
            content=clean_output(turn.content),
            mode_used=mode,
        )
        db.add(message)
        saved.append(message)

    await db.commit()
    for message in saved:
        await db.refresh(message)

    return [_serialize_message(m, []) for m in saved]
