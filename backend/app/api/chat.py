import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.api.deps import get_conversation_for_user, get_current_user, require_workspace_member
from app.core.rate_limit import check_rate_limit
from app.db.session import AsyncSessionLocal, get_db
from app.models import AudioTranscript, Citation, Conversation, Message, MessageClaim, ClaimEvidence, User
from app.schemas.chat import (
    CallTranscript,
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
from app.services.clarifier import propose_clarifier
from app.services.geolocation import location_prompt_line
from app.services.decision_review import review_decisions
from app.services.guidance import propose_guidance
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
from app.services.verification_agent import reconcile_gray_area, verify_claim
from app.services.web_research import WebSource, gather_context, research_claim
from app.workers.rebuild_memory import rebuild_memory_task
from app.workers.rebuild_profile import rebuild_profile_task

router = APIRouter(prefix="/chat", tags=["chat"])


_TITLE_MAX_CHARS = 38
_TITLE_MAX_WORDS = 6

# Unsupported claims are researched concurrently, one agent each, but each
# agent still runs up to three search+judge rounds. Capping keeps a
# ten-unsupported-claim answer from making thirty search calls; the first
# couple are the informative ones anyway.
_MAX_RESEARCHED_CLAIMS = 2

# The whole per-claim research phase, however many agents are in it.
#
# Measured 2026-08-10: a search round is ~8s and a supervisor round ~3s, so a
# claim that takes two rounds to settle costs ~27s on its own. Generation is
# ~3s and validation ~3s, which leaves about this much before the 30-second
# end-to-end budget is gone. Agents run concurrently, so this is a wall-clock
# cap on the phase, not a per-claim one.
_RESEARCH_DEADLINE_SECONDS = 20.0

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
        return "Conversation"

    text = text[0].upper() + text[1:]
    return f"{text}…" if truncated else text


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
        counterfactual_content=message.counterfactual_content,
        clarifier=message.clarifier,
        guidance=message.guidance,
        decision_review=message.decision_review,
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
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Couldn't produce the comparison: {exc}",
        ) from exc

    message.counterfactual_content = text
    await db.commit()
    return {"counterfactual_content": text}


@router.delete(
    "/{conversation_id}/messages/{message_id}/onwards",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def rewind_conversation(
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Delete a message and everything after it.

    What "edit" and "regenerate" actually are. A conversation is a sequence
    the model is re-fed on every turn, so changing a message in the middle
    without dropping what followed would leave answers on screen that were
    replies to something no longer said. Rewinding to the edit point and
    re-asking is the only version of this that stays coherent.

    Claims, evidence and citations hang off `messages` with ON DELETE CASCADE,
    so removing the rows is the whole operation.
    """
    conversation = await get_conversation_for_user(db, conversation_id, current_user.id)

    target = await db.get(Message, message_id)
    if target is None or target.conversation_id != conversation.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    # Ordered by creation time rather than id: ids are random UUIDs, so ">"
    # on them means nothing. Ties on the same timestamp are impossible in
    # practice (user and assistant rows are written in separate transactions)
    # but the id comparison keeps the boundary deterministic if they happen.
    await db.execute(
        delete(Message).where(
            Message.conversation_id == conversation.id,
            or_(
                Message.created_at > target.created_at,
                and_(Message.created_at == target.created_at, Message.id == target.id),
            ),
        )
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{conversation_id}/messages")
async def send_message(
    conversation_id: uuid.UUID,
    payload: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EventSourceResponse:
    await check_rate_limit(f"chat:send:{current_user.id}", max_requests=20, window_seconds=60)

    # FR7: mode is mandatory and there is no auto-detection fallback - reject
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

    # Convenience pre-fill only (§7.2) - never read back as an automatic mode choice.
    conversation.default_mode = mode

    # Title the conversation from its opening question. Without this every row
    # in the workspace list reads "Untitled conversation", which is
    # indistinguishable from the conversation not having been saved at all.
    if conversation.title is None and not history:
        conversation.title = _derive_title(payload.content)

    await db.commit()

    flags = admin_settings.get("feature_flags") or {}

    # §5.2 step 3: ambiguity detection/query rewrite for retrieval only -
    # `mode` and the persisted/displayed message are untouched by this.
    # Decision classification picks a *bias domain* only, and never influences
    # which cognitive mode is in play (§7.2).
    async def _classify() -> DecisionClassification:
        if not flags.get("bias_screening_enabled", True):
            return NO_DECISION
        return await classify_decision(payload.content)

    # Only Decision mode needs the classification *before* generating, because
    # only it puts a bias watch-list in the prompt. Every other mode uses it
    # after the fact, to scope the screening vocabulary during verification -
    # so it runs alongside the generation instead of delaying its first token.
    decision_task = asyncio.create_task(_classify())
    decision: DecisionClassification = NO_DECISION
    if mode == "decision":
        decision = await decision_task

    retrieval_query = await optimize_query(history, payload.content)

    # Documents first, always: a user's own documents are the thing they
    # trusted enough to upload, and a search result is not. But *finding out*
    # whether the documents have anything is a database round-trip, and
    # waiting for that answer before starting a search adds the whole search
    # latency on top. So both go at once and the loser is discarded.
    web_enabled = flags.get("web_search_enabled", True)
    web_task = (
        asyncio.create_task(gather_context(retrieval_query)) if web_enabled else None
    )
    chunks: list[RetrievedChunk] = await retrieve_chunks(
        db, conversation.workspace_id, retrieval_query, mode, top_k=admin_settings["retrieval_top_k"]
    )

    web_sources: list[WebSource] = []
    if web_task is not None:
        if chunks:
            web_task.cancel()
        else:
            try:
                web_sources = await web_task
            except (asyncio.CancelledError, Exception):  # noqa: B014 - degrade, never fail
                web_sources = []

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
        mode, reasoning_lens, bias_guidance, profile_block
    )
    context_block = build_context_block(chunks, web_sources)
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
            decision_task.cancel()
            yield {"event": "error", "data": json.dumps({"detail": str(exc)})}
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
        draft_display_text = clean_output(strip_claim_tags(full_text))

        async with AsyncSessionLocal() as answer_db:
            assistant_message = Message(
                conversation_id=conversation_id,
                role="assistant",
                content=draft_display_text,
                mode_used=mode,
                reasoning_lens=reasoning_lens if mode == "thinking" else None,
            )
            answer_db.add(assistant_message)
            await answer_db.commit()
            await answer_db.refresh(assistant_message)
            assistant_message_id = assistant_message.id
            answer_payload = _serialize_message(assistant_message, []).model_dump(mode="json")

        yield {"event": "answer", "data": json.dumps({"message": answer_payload})}
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

        reflection_task = asyncio.create_task(reflect_and_revise(mode, full_text))
        # Its own call, with its own schema, run alongside everything else.
        # Folding it into the answer generation is what made the model ask in
        # prose as well as in the block.
        clarifier_task = asyncio.create_task(
            propose_clarifier(payload.content, draft_display_text)
        )
        # Looks only at the question and the chosen mode, so it does not wait
        # on the answer - it is in this fan-out purely so its latency lands
        # inside the post-answer window rather than after it.
        guidance_task = asyncio.create_task(propose_guidance(payload.content, mode))
        # Decision mode only: judging options nobody listed is a call spent to
        # return null.
        review_task = (
            asyncio.create_task(review_decisions(payload.content, bias_category_id))
            if mode == "decision"
            else None
        )
        counterfactual_task = (
            asyncio.create_task(generate_counterfactual(draft_display_text))
            if draft_display_text
            else None
        )

        try:
            decision_result = await decision_task
        except Exception:  # noqa: BLE001 - screening scope degrades, nothing fails
            decision_result = NO_DECISION
        bias_category_id = decision_result.bias_category_id

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
        research_notes: list[str] = []
        if web_enabled:
            targets = [i for i, ev in enumerate(evidence_by_claim) if not ev][
                :_MAX_RESEARCHED_CLAIMS
            ]
            if targets:
                # A deadline, not a hope. Each agent can run three
                # search-and-judge rounds, and three rounds against a slow
                # search is most of the end-to-end budget on its own. Whatever
                # has come back when the clock runs out is what gets used;
                # claims still unsupported stay unsupported, which is a true
                # statement either way.
                try:
                    results = await asyncio.wait_for(
                        asyncio.gather(
                            *(research_claim(parsed_claims[i].claim_text) for i in targets),
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

        scored_claims: list[ScoredClaim] = []
        for claim, markers, verification, evidence in zip(
            parsed_claims, claim_marker_lists, verifications, evidence_by_claim
        ):
            claim_score, entailment_label = compute_claim_score(
                evidence, distorted=bool(verification.distortion_flag)
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
        try:
            final_text, _was_revised = await reflection_task
        except Exception:  # noqa: BLE001 - a failed critique keeps the draft
            final_text = full_text
        counterfactual_text: str | None = None
        if counterfactual_task is not None:
            try:
                counterfactual_text = await counterfactual_task
            except Exception:  # noqa: BLE001 - the comparison is optional
                counterfactual_text = None

        # strip_claim_tags preserves the model's own formatting/whitespace
        # between claims exactly, matching what streaming already showed -
        # rejoining claim_text pieces with an artificial separator would
        # flatten lists/paragraphs and visibly reflow the message on finalize.
        clarifier = await clarifier_task
        guidance = await guidance_task
        decision_review = await review_task if review_task else None
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
            assistant_message.counterfactual_content = (
                clean_output(counterfactual_text) if counterfactual_text else None
            )
            assistant_message.clarifier = clarifier
            assistant_message.guidance = guidance
            assistant_message.decision_review = decision_review
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
                        source_type=e.source_type,
                        url=e.url,
                        credibility_score=e.credibility_score,
                        credibility_note=e.credibility_note,
                    )
                    for e in c.evidence
                ],
            )
            for c in scored_claims
        ]

        final_payload = {
            "message": _serialize_message(assistant_message, claims_out).model_dump(mode="json"),
            # Ships with the answer so the Devil's Draft opens instantly.
            "counterfactual_content": counterfactual_text,
            "clarifier": clarifier,
            "guidance": guidance,
            "decision_review": decision_review,
            # Only present when the search agent came back empty-handed; it is
            # the difference between "nothing supports this" and "nothing was
            # looked for".
            "research_notes": research_notes,
            "claims": [c.model_dump(mode="json") for c in claims_out],
            "confidence": {"score": message_score.score, "band": message_score.band},
            "avatar_cue": {"expression": avatar_cue.expression, "gesture": avatar_cue.gesture},
        }
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
