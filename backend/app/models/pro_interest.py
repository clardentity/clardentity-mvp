import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ProInterest(Base):
    """Someone reached for a paid model and asked to be told when it opens.

    Kept because the click is the only demand signal this app has: which of
    the three locked models people actually want is worth more than the count
    of people who wanted any of them.
    """

    __tablename__ = "pro_interest"
    __table_args__ = (
        # One row per person per model. Clicking twice is impatience, not a
        # second data point.
        UniqueConstraint("user_id", "requested_model", name="uq_pro_interest_user_model"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: Which locked model was clicked, or null if they opened the dialog another way.
    requested_model: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
