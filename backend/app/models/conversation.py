import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

COGNITIVE_MODES = (
    "rapid",
    "knowing",
    "thinking",
    "decision",
    "learning",
    "mentoring",
    "therapy",
    "creative",
)


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (
        CheckConstraint(
            f"default_mode IN {COGNITIVE_MODES}", name="ck_conversations_default_mode"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    # Convenience pre-fill only (SRS §7.2) - every message still carries its own
    # explicit `mode_used`; this is never used as an automatic fallback.
    default_mode: Mapped[str | None] = mapped_column(String, nullable=True)
    # The tip of the branch currently shown. Walking `parent_id` back from
    # here (see app/services/message_tree.py) is "the conversation" a user
    # sees - editing or regenerating moves this pointer to a new sibling
    # rather than deleting the rows after it. Null only for a conversation
    # with no messages yet. SET NULL rather than CASCADE: a message being
    # deleted shouldn't take the whole conversation row down with it.
    active_leaf_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.created_at",
        # Disambiguates against active_leaf_id, the other FK now linking
        # these two tables - this relationship is only ever "every message in
        # this conversation", never "the one message active_leaf_id points
        # to".
        foreign_keys="Message.conversation_id",
    )
