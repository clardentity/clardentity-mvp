import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ConversationCreate(BaseModel):
    workspace_id: uuid.UUID
    title: str | None = None
    # Optional, and only ever a starting point: the caller can pick a different
    # mode on the very first message. Lets a "start in Decision" entry point
    # carry that choice into the conversation instead of dropping it at the
    # door. Literal rather than str so a typo is a 422, not a check-constraint
    # violation at commit time.
    default_mode: (
        Literal[
            "rapid",
            "knowing",
            "thinking",
            "decision",
            "learning",
            "mentoring",
            "therapy",
            "creative",
        ]
        | None
    ) = None


class ConversationMove(BaseModel):
    """Re-file a conversation under another workspace the caller belongs to.
    Its messages, citations and claims travel with it untouched - they are
    history - but from here on retrieval reads the new workspace's
    attachments."""

    workspace_id: uuid.UUID


class ConversationOut(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    title: str | None
    default_mode: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageAttachment(BaseModel):
    # §12.2: images ride along in the same turn as direct vision context -
    # not chunked/embedded for RAG in MVP. `data` is base64 (no data-URI
    # prefix required; added server-side if missing).
    #
    # A document (PDF, Word, Excel, PowerPoint, text) is different: it is
    # ingested into the workspace like an upload - stored, chunked, embedded
    # - and its opening chunks are put in front of the model for this turn,
    # so the answer can cite it and later turns can retrieve it.
    type: Literal["image", "document"] = "image"
    data: str
    mime_type: str = "image/jpeg"
    filename: str | None = None


class MessageCreate(BaseModel):
    # Required unless `regenerate_of` is set - enforced in the router so a
    # missing/blank content on a real send is a 400 with a specific message,
    # not Pydantic's generic 422.
    content: str = ""
    # Intentionally not required at the Pydantic level (see FR7): the router
    # validates this explicitly so a missing/invalid mode returns exactly 400,
    # not FastAPI's default 422 for a missing field.
    mode: str | None = None
    # §7.5: optional, Thinking mode only, entirely user-driven - never inferred.
    reasoning_lens: str | None = None
    attachments: list[MessageAttachment] = []
    # §12.1: set when `content` came from /audio/transcribe, so the turn can
    # still be linked to an audio_transcripts row.
    audio_duration_seconds: float | None = None
    # Set by the client when re-sending after a mode suggestion, whichever way
    # the user answered it. Suppresses the pre-answer check so the same
    # question cannot be stopped twice - and so choosing "stay in this mode"
    # is respected rather than re-argued.
    mode_confirmed: bool = False
    # Set by the client when re-sending after a refined-phrasing suggestion,
    # whichever way the user answered it - asking it as worded or keeping
    # their original. Suppresses the pre-answer check so the same suggestion
    # cannot be stopped twice.
    refined_confirmed: bool = False
    # Set by the client when re-sending after a clarifying-options prompt,
    # whichever way the user answered it - tapped an option, typed something
    # else, or skipped. Suppresses the pre-answer check so the same prompt
    # cannot be stopped twice.
    clarifying_confirmed: bool = False
    # Set when re-sending after the pre-answer "why" because the user asked
    # for the answer anyway (the "Answer without this" skip) - a hard stop,
    # regardless of how many rounds have run. Answering a round instead
    # advances `context_rounds`, not this flag: the gate may still have one
    # more genuine question worth asking (see guidance.MAX_CONTEXT_ROUNDS),
    # and skipping is the only way to cut it off early.
    context_acknowledged: bool = False
    # How many context-gate rounds have already been answered for this turn.
    # 0 on a fresh message. The client increments it each time it resends
    # after answering (not skipping) a context_question, so the gate can cap
    # itself at MAX_CONTEXT_ROUNDS instead of interrogating indefinitely.
    context_rounds: int = Field(default=0, ge=0, le=10)
    # Fork point for the new user message this call creates - an explicit
    # ancestor to attach it to instead of "wherever the conversation
    # currently is" (Conversation.active_leaf_id). Editing a message resends
    # with this set to the edited message's own parent, so the edit becomes
    # a sibling rather than deleting everything that came after it.
    parent_id: uuid.UUID | None = None
    # Set instead of real content to produce an alternate answer to an
    # EXISTING assistant message, attached as its sibling. `content`, `mode`,
    # `reasoning_lens` and the pre-answer gates are all ignored on this path -
    # the question was already asked and settled the first time this answer
    # was generated, so regenerating never re-asks it.
    regenerate_of: uuid.UUID | None = None


class EvidenceOut(BaseModel):
    citation_marker: int
    # Null for a web source. `document_filename` then carries the page title,
    # so a caller that only wants a label needs no branch, and `url` is the
    # field that distinguishes the two.
    document_id: uuid.UUID | None = None
    document_filename: str
    excerpt: str
    support_score: float | None
    relevance_score: float | None
    entailment_label: str | None
    source_type: str = "document"
    url: str | None = None
    #: The supervisor's 0-1 judgement of the source, and one line saying why.
    credibility_score: float | None = None
    credibility_note: str | None = None


class ClaimOut(BaseModel):
    claim_index: int
    claim_text: str
    claim_score: float | None
    entailment_label: str | None
    # `distortion_flag` is the detected bias's taxonomy id. The name/definition
    # travel with it so the client can render "Anchoring Bias" and explain what
    # that means without shipping the whole 437-entry catalogue to the browser.
    distortion_flag: str | None
    distortion_explanation: str | None
    bias_name: str | None = None
    bias_definition: str | None = None
    bias_category: str | None = None
    bias_category_name: str | None = None
    # Set only when this claim landed in the gray_area tier and got a second,
    # blind reconciliation pass (see verification_agent.reconcile_gray_area).
    # `dynamic` means that pass judged it genuinely developing rather than
    # simply hard to verify - there is no scheduled re-check behind it, just
    # a signal that the tier is provisional.
    reconciliation_note: str | None = None
    dynamic: bool = False
    evidence: list[EvidenceOut] = []


class MessageOut(BaseModel):
    id: uuid.UUID
    role: str
    content: str | None
    mode_used: str
    reasoning_lens: str | None
    confidence_score: float | None
    confidence_band: str | None
    avatar_expression: str | None
    avatar_gesture: str | None
    created_at: datetime
    #: The Devil's Draft, produced alongside the answer. Present on reload too,
    #: so the comparison stays instant after a refresh.
    counterfactual_content: str | None = None
    #: The model's own one-sentence bottom line, shown above the folded
    #: answer. Null for messages generated before this shipped.
    crux_text: str | None = None
    #: {"question": str, "options": [str, ...]} when the answer needs something
    #: from the user before it can be better. Null on most turns.
    clarifier: dict | None = None
    #: {"suggested_mode", "mode_reason", "refined_question", "refinement_reason"}
    #: Null on most turns - see services/guidance.py.
    guidance: dict | None = None
    #: Decision mode only. Per-option verdicts on the options the user listed,
    #: plus an alternative when all of them are compromised. Null otherwise.
    decision_review: dict | None = None
    #: Thinking mode only. Sound vs biased ways of reasoning about the
    #: question, shown instead of claims and evidence.
    thinking_review: dict | None = None
    #: {"rating": "up"|"down"|None, "comment": str|None}. Null until the user
    #: reacts to this answer - see FeedbackIn.
    feedback: dict | None = None
    #: Null for the very first message(s) of a conversation. Editing resends
    #: with this as the new sibling's `parent_id` - see MessageCreate.
    parent_id: uuid.UUID | None = None
    #: This message's position among its siblings (0-based) and how many
    #: there are - the fork switcher's "< 2/3 >". 1 when there's nothing to
    #: switch between, which is most messages.
    sibling_index: int = 0
    sibling_count: int = 1
    #: Every sibling's id, oldest first (this message's id included) - what
    #: the fork switcher's arrows actually navigate between, via PUT
    #: .../active-leaf. A single-item list when there's nothing to switch to.
    sibling_ids: list[uuid.UUID] = []
    claims: list[ClaimOut] = []

    model_config = {"from_attributes": True}


class ExportFileIn(BaseModel):
    format: Literal["docx", "pptx", "xlsx"]


class ActiveLeafIn(BaseModel):
    #: Any message in the tree - typically a sibling reached via the fork
    #: switcher's arrows. The branch shown becomes that message's own most
    #: recent leaf, so reopening a branch resumes wherever it last left off.
    message_id: uuid.UUID


class FeedbackIn(BaseModel):
    rating: Literal["up", "down"] | None = None
    #: The "other" box. Optional and independent of rating - a comment can
    #: stand on its own, and a rating doesn't require one.
    comment: str | None = Field(default=None, max_length=2000)


class CallTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class CallTranscript(BaseModel):
    """What was said on a live call, saved after it ends.

    Turns arrive already transcribed by the realtime session. They are stored
    unscored - a call runs outside the retrieval and verification pipeline, so
    there are no claims, no citations and no confidence band to attach.
    """

    mode: str
    turns: list[CallTurn] = Field(min_length=1, max_length=200)
