import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class UserProfile(Base):
    """A long-lived, evolving picture of one user.

    Built by inference from their own conversations and documents, never from
    an onboarding interrogation. `personality_md` is the human-readable
    artifact the user can read and edit; `roles` is the structured
    25-role classification behind it.
    """

    __tablename__ = "user_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # The generated profile document. Kept because it is what inference
    # produces and what the prompt reads, but no longer the editing surface -
    # see `aspects`.
    personality_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The same picture as a list of separate, editable facts:
    #   [{"id": "...", "label": "Work", "value": "...", "source": "inferred"}]
    #
    # A single Markdown blob was readable but not *correctable*: fixing one
    # wrong sentence meant editing a document, and once edited by hand the
    # whole thing froze against future inference. Aspects are individually
    # removable and individually add-able, so a wrong one can be deleted
    # without discarding the rest.
    aspects: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # [{"role_id": "sibling", "qualifiers": {"gender": ["brother"]}, "evidence": "..."}]
    roles: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # Set when the user edits the profile by hand: inference then stops
    # overwriting it, so a correction isn't silently undone on the next rebuild.
    user_edited: Mapped[bool] = mapped_column(
        default=False, nullable=False, server_default="false"
    )
    # How many of the user's messages the current profile was built from, so a
    # rebuild only runs once enough new material has accumulated.
    messages_at_last_build: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="profile")
