import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.api.deps import get_conversation_for_user, get_current_user, require_workspace_member
from app.core.rate_limit import check_rate_limit
from app.db.session import AsyncSessionLocal, get_db
from app.models import AudioTranscript, Citation, Conversation, Message, MessageClaim, ClaimEvidence, User
from app.schemas.chat import (
    ClaimOut,
    ConversationCreate,
    ConversationOut,
    EvidenceOut,
    MessageCreate,
    MessageOut,
)
from app.services.admin_settings_service import get_all_settings
from app.services.avatar_cue_service import compute_avatar_cue
from app.services.claim_loader import load_claims_for_messages
from app.services.claim_parser import ClaimTagStripper, extract_claims, strip_claim_tags
from app.services.confidence_scoring import (
    ScoredClaim,
    ScoringWeights,
    build_scored_evidence,
    compute_claim_score,
    compute_message_score,
)
from app.services.decision_classifier import (
    NO_DECISION,
    DecisionClassification,
    build_bias_guidance,
    classify_decision,
)
from app.services.export_service import build_markdown_export, build_pdf_export
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
from app.services.profile_service import (
    get_profile,
    profile_prompt_block,
    should_rebuild as should_rebuild_profile,
)
from app.services.query_optimizer import optimize_query
from app.services.reflection_agent import reflect_and_revise
from app.services.retrieval import RetrievedChunk, retrieve_chunks
from app.services.router import InvalidModeError, InvalidReasoningLensError, validate_mode, validate_reasoning_lens
from app.services.taxonomy import describe_bias
from app.services.verification_agent import verify_claim
from app.workers.rebuild_memory import rebuild_memory_task
from app.workers.rebuild_profile import rebuild_profile_task

router = APIRouter(prefix="/chat", tags=["chat"])


_TITLE_MAX_CHARS = 70


def _derive_title(first_message: str) -> str:
    """A readable conversation title from its opening message.

    Deliberately not an LLM call: this runs on the first turn of every
    conversation, and a round-trip to name something the user just typed isn't
    worth the latency. Truncates on a word boundary.
    """
    text = " ".join(first_message.split())
    if len(text) <= _TITLE_MAX_CHARS:
        return text
    clipped = text[:_TITLE_MAX_CHARS].rsplit(" ", 1)[0].rstrip(",;:.-")
    return f"{clipped or text[:_TITLE_MAX_CHARS]}…"


def _serialize_message(message: Message, claims: list[ClaimOut]) -> MessageOut:
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
        claims=claims,
    )


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
    claims_by_message = await load_claims_for_messages(db, [m.id for m in messages])
    return [_serialize_message(m, claims_by_message.get(m.id, [])) for m in messages]


@router.get("/{conversation_id}/export")
async def export_conversation(
    conversation_id: uuid.UUID,
    format: Literal["markdown", "pdf"] = Query(default="markdown"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    # FR13: full turn history, per-claim citations, and confidence bands -
    # same serialization the chat UI already renders from.
    conversation = await get_conversation_for_user(db, conversation_id, current_user.id)

    rows = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at)
    )
    messages = list(rows.scalars().all())
    claims_by_message = await load_claims_for_messages(db, [m.id for m in messages])
    messages_out = [_serialize_message(m, claims_by_message.get(m.id, [])) for m in messages]

    filename_base = "".join(
        ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in (conversation.title or "conversation")
    ).strip("_") or "conversation"

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


@router.post("/{conversation_id}/messages")
async def send_message(
    conversation_id: uuid.UUID,
    payload: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EventSourceResponse:
    await check_rate_limit(f"chat:send:{current_user.id}", max_requests=20, window_seconds=60)

    # FR7: mode is mandatory and there is no auto-detection fallback — reject
    # with exactly 400, not Pydantic's default 422 for a missing field.
    try:
        mode = validate_mode(payload.mode)
        reasoning_lens = validate_reasoning_lens(payload.reasoning_lens)
    except (InvalidModeError, InvalidReasoningLensError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    conversation = await get_conversation_for_user(db, conversation_id, current_user.id)
    admin_settings = await get_all_settings(db)

    history_rows = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc())
        .limit(HISTORY_WINDOW)
    )
    history = list(reversed(history_rows.scalars().all()))
    memory_summary = await get_memory_summary(db, conversation_id)

    user_message = Message(
        conversation_id=conversation_id,
        role="user",
        content=payload.content,
        mode_used=mode,
        reasoning_lens=reasoning_lens if mode == "thinking" else None,
    )
    db.add(user_message)
    await db.flush()

    if payload.audio_duration_seconds is not None:
        # §12.1: links the transcribed turn back to its audio metadata.
        # The raw clip itself isn't persisted in MVP - only what's needed to
        # satisfy the audio_transcripts record (transcript + duration).
        db.add(
            AudioTranscript(
                message_id=user_message.id,
                transcript=payload.content,
                duration_seconds=payload.audio_duration_seconds,
            )
        )

    # Convenience pre-fill only (§7.2) — never read back as an automatic mode choice.
    conversation.default_mode = mode

    # Title the conversation from its opening question. Without this every row
    # in the workspace list reads "Untitled conversation", which is
    # indistinguishable from the conversation not having been saved at all.
    if conversation.title is None and not history:
        conversation.title = _derive_title(payload.content)

    await db.commit()

    flags = admin_settings.get("feature_flags") or {}

    # §5.2 step 3: ambiguity detection/query rewrite for retrieval only —
    # `mode` and the persisted/displayed message are untouched by this.
    # Decision classification runs alongside it: it picks a *bias domain* only,
    # and never influences which cognitive mode is in play (§7.2).
    async def _classify() -> DecisionClassification:
        if not flags.get("bias_screening_enabled", True):
            return NO_DECISION
        return await classify_decision(payload.content)

    retrieval_query, decision = await asyncio.gather(
        optimize_query(history, payload.content), _classify()
    )
    chunks: list[RetrievedChunk] = await retrieve_chunks(
        db, conversation.workspace_id, retrieval_query, mode, top_k=admin_settings["retrieval_top_k"]
    )

    bias_category_id = decision.bias_category_id
    # The proactive watch-list is Decision mode's job; other modes still get
    # domain-scoped screening, they just aren't told to editorialise about it.
    bias_guidance = build_bias_guidance(decision) if mode == "decision" else None
    profile_block = profile_prompt_block(await get_profile(db, current_user.id))
    instructions = build_system_instructions(
        mode, reasoning_lens, bias_guidance, profile_block
    )
    context_block = build_context_block(chunks)
    input_text = build_conversation_input(context_block, memory_summary, history, payload.content)
    scoring_weights = ScoringWeights.from_settings(admin_settings["scoring_weights"])
    gesture_map = admin_settings["avatar_gesture_map"]

    input_images: list[str] = []
    if flags.get("image_input_enabled", True):
        for attachment in payload.attachments:
            data = attachment.data
            if not data.startswith("data:"):
                data = f"data:{attachment.mime_type};base64,{data}"
            input_images.append(data)
    gen_model = admin_settings.get("openai_model")
    gen_temperature = admin_settings.get("openai_temperature")

    async def event_stream() -> AsyncIterator[dict]:
        full_text = ""
        stripper = ClaimTagStripper()
        try:
            async for event in stream_generation(
                instructions=instructions,
                input_text=input_text,
                model=gen_model,
                temperature=gen_temperature,
                input_images=input_images,
            ):
                if event["type"] == "delta":
                    full_text += event["text"]
                    visible = stripper.feed(event["text"])
                    if visible:
                        yield {"event": "delta", "data": json.dumps({"text": visible})}
                elif event["type"] == "done":
                    full_text = event["full_text"]
        except Exception as exc:  # noqa: BLE001 - surfaced to the client as an SSE error event
            yield {"event": "error", "data": json.dumps({"detail": str(exc)})}
            return

        # §9.1 step 2: Reflection Agent may revise the draft before it's
        # scored/persisted. The (rare) visible effect is that the streamed
        # draft and the final displayed message differ slightly — the
        # existing streaming→final swap in the client already handles this.
        final_text, _was_revised = await reflect_and_revise(mode, full_text)

        parsed_claims = extract_claims(final_text)

        # §9.1 step 3: per-claim, per-evidence verification + cognitive-bias
        # screening, run concurrently across claims. `bias_category_id` scopes
        # the screening vocabulary to the domain this conversation is about.
        claim_marker_lists = [
            [m for m in sorted(set(c.citation_markers)) if 0 < m <= len(chunks)]
            for c in parsed_claims
        ]
        verifications = await asyncio.gather(
            *(
                verify_claim(
                    claim.claim_text,
                    [chunks[m - 1].chunk.content for m in markers],
                    bias_category_id=bias_category_id,
                )
                for claim, markers in zip(parsed_claims, claim_marker_lists)
            )
        )

        scored_claims: list[ScoredClaim] = []
        for claim, markers, verification in zip(parsed_claims, claim_marker_lists, verifications):
            evidence = build_scored_evidence(markers, chunks, verification.evidence)
            claim_score, entailment_label = compute_claim_score(evidence)
            scored_claims.append(
                ScoredClaim(
                    claim_index=claim.claim_index,
                    claim_text=claim.claim_text,
                    claim_score=claim_score,
                    entailment_label=entailment_label,
                    distortion_flag=verification.distortion_flag,
                    distortion_explanation=verification.distortion_explanation,
                    bias_category=verification.bias_category,
                    evidence=evidence,
                )
            )

        message_score = compute_message_score(scored_claims, scoring_weights)
        # strip_claim_tags preserves the model's own formatting/whitespace
        # between claims exactly, matching what streaming already showed —
        # rejoining claim_text pieces with an artificial separator would
        # flatten lists/paragraphs and visibly reflow the message on finalize.
        display_text = strip_claim_tags(final_text)
        # §8.4: computed once confidence scoring completes; a distortion flag
        # overrides the expression to "concerned" regardless of the band.
        avatar_cue = compute_avatar_cue(
            mode, message_score.band, message_score.distortion_penalty_applied, gesture_map
        )

        async with AsyncSessionLocal() as gen_db:
            assistant_message = Message(
                conversation_id=conversation_id,
                role="assistant",
                content=display_text,
                mode_used=mode,
                reasoning_lens=reasoning_lens if mode == "thinking" else None,
                confidence_score=message_score.score,
                confidence_band=message_score.band,
                distortion_penalty_applied=message_score.distortion_penalty_applied,
                avatar_expression=avatar_cue.expression,
                avatar_gesture=avatar_cue.gesture,
            )
            gen_db.add(assistant_message)
            await gen_db.flush()

            # One `citations` row per unique marker actually cited anywhere
            # in the message (Phase 4 table, still the FK target for
            # claim_evidence below).
            all_markers = sorted({e.citation_marker for c in scored_claims for e in c.evidence})
            marker_to_citation_id: dict[int, uuid.UUID] = {}
            for marker in all_markers:
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

            for c in scored_claims:
                claim_row = MessageClaim(
                    message_id=assistant_message.id,
                    claim_index=c.claim_index,
                    claim_text=c.claim_text,
                    claim_score=c.claim_score,
                    entailment_label=c.entailment_label,
                    distortion_flag=c.distortion_flag,
                    distortion_explanation=c.distortion_explanation,
                    bias_category=c.bias_category,
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
                claim_text=c.claim_text,
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
                    )
                    for e in c.evidence
                ],
            )
            for c in scored_claims
        ]

        final_payload = {
            "message": _serialize_message(assistant_message, claims_out).model_dump(mode="json"),
            "claims": [c.model_dump(mode="json") for c in claims_out],
            "confidence": {"score": message_score.score, "band": message_score.band},
            "avatar_cue": {"expression": avatar_cue.expression, "gesture": avatar_cue.gesture},
        }
        yield {"event": "final", "data": json.dumps(final_payload)}

    return EventSourceResponse(event_stream())
