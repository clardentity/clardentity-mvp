import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.conversation import COGNITIVE_MODES

CONFIDENCE_BANDS = ("Likely Fact", "Plausible", "Needs Verification")
ENTAILMENT_LABELS = ("full", "partial", "none", "unsupported")
EVIDENCE_ENTAILMENT_LABELS = ("full", "partial", "none")
# The two SRS §9.4 reasoning distortions. These are no longer the whole
# vocabulary for `message_claims.distortion_flag` - see app/services/taxonomy.py,
# which folds them in alongside the cognitive-bias catalogue.
DISTORTION_FLAGS = ("wishful_thinking", "magical_thinking")


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint("role IN ('user','assistant','system')", name="ck_messages_role"),
        CheckConstraint(f"mode_used IN {COGNITIVE_MODES}", name="ck_messages_mode_used"),
        CheckConstraint(
            f"confidence_band IS NULL OR confidence_band IN {CONFIDENCE_BANDS}",
            name="ck_messages_confidence_band",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    mode_used: Mapped[str] = mapped_column(String, nullable=False)
    reasoning_lens: Mapped[str | None] = mapped_column(String, nullable=True)
    confidence_score: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    confidence_band: Mapped[str | None] = mapped_column(String, nullable=True)
    distortion_penalty_applied: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    avatar_expression: Mapped[str | None] = mapped_column(String, nullable=True)
    avatar_gesture: Mapped[str | None] = mapped_column(String, nullable=True)
    # The same question answered with the bias guardrails off - the version
    # that argues its side and leaves out what would weaken it. Generated on
    # request, not per message: it costs a full second generation, and most
    # answers are never compared. Cached here once produced.
    counterfactual_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_usage: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")
    claims: Mapped[list["MessageClaim"]] = relationship(
        back_populates="message", cascade="all, delete-orphan", order_by="MessageClaim.claim_index"
    )
    citations: Mapped[list["Citation"]] = relationship(back_populates="message", cascade="all, delete-orphan")


class MessageClaim(Base):
    __tablename__ = "message_claims"
    # `distortion_flag` holds a cognitive-bias id from app/services/taxonomy.py
    # (~437 entries, including the two SRS reasoning distortions). Intentionally
    # no CHECK constraint: the vocabulary is application data that grows without
    # a migration, and taxonomy.resolve_bias() drops anything outside it before
    # it reaches the database.
    __table_args__ = (
        CheckConstraint(
            f"entailment_label IS NULL OR entailment_label IN {ENTAILMENT_LABELS}",
            name="ck_message_claims_entailment_label",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    claim_index: Mapped[int] = mapped_column(Integer, nullable=False)
    claim_text: Mapped[str] = mapped_column(Text, nullable=False)
    claim_score: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    entailment_label: Mapped[str | None] = mapped_column(String, nullable=True)
    distortion_flag: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    distortion_explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    # One of the 10 everyday-scenario domains the detected bias belongs to;
    # null for the two SRS reasoning distortions, which are not categorised.
    bias_category: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    message: Mapped["Message"] = relationship(back_populates="claims")
    evidence: Mapped[list["ClaimEvidence"]] = relationship(
        back_populates="claim", cascade="all, delete-orphan"
    )


class ClaimEvidence(Base):
    __tablename__ = "claim_evidence"
    __table_args__ = (
        CheckConstraint(
            f"entailment_label IS NULL OR entailment_label IN {EVIDENCE_ENTAILMENT_LABELS}",
            name="ck_claim_evidence_entailment_label",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    claim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("message_claims.id", ondelete="CASCADE"), nullable=False, index=True
    )
    citation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("citations.id", ondelete="SET NULL"), nullable=True
    )
    support_score: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    relevance_score: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    entailment_label: Mapped[str | None] = mapped_column(String, nullable=True)
    source_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    claim: Mapped["MessageClaim"] = relationship(back_populates="evidence")
    citation: Mapped["Citation | None"] = relationship()


class Citation(Base):
    __tablename__ = "citations"
    __table_args__ = (
        CheckConstraint("source_type IN ('document','web')", name="ck_citations_source_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("messages.id", ondelete="CASCADE"), nullable=False
    )
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=True
    )
    chunk_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("document_chunks.id", ondelete="CASCADE"), nullable=True
    )
    source_type: Mapped[str] = mapped_column(String, nullable=False, default="document")
    marker: Mapped[int | None] = mapped_column(Integer, nullable=True)
    relevance_score: Mapped[float | None] = mapped_column(Numeric, nullable=True)

    # Set only when source_type == 'web'. A web result has no document and no
    # chunk to point at, so the source is the link itself, and the supervisor's
    # judgement of it travels with the citation rather than being recomputed.
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    credibility_score: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    credibility_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    message: Mapped["Message"] = relationship(back_populates="citations")


class AudioTranscript(Base):
    __tablename__ = "audio_transcripts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("messages.id", ondelete="CASCADE"), nullable=False
    )
    storage_path: Mapped[str | None] = mapped_column(String, nullable=True)
    transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Numeric, nullable=True)
