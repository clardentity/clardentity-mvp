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
    default_mode: Literal["knowing", "thinking", "decision", "learning"] | None = None


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
    type: Literal["image"] = "image"
    data: str
    mime_type: str = "image/jpeg"


class MessageCreate(BaseModel):
    content: str = Field(min_length=1)
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
    #: {"question": str, "options": [str, ...]} when the answer needs something
    #: from the user before it can be better. Null on most turns.
    clarifier: dict | None = None
    claims: list[ClaimOut] = []

    model_config = {"from_attributes": True}
