import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    password_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    oauth_provider: Mapped[str | None] = mapped_column(String, nullable=True)
    oauth_subject: Mapped[str | None] = mapped_column(String, nullable=True)
    display_name: Mapped[str | None] = mapped_column(String, nullable=True)
    # Not in the SRS §10 DDL verbatim, but needed to satisfy §15's "refresh tokens
    # rotated and revocable" without introducing a separate token-storage table:
    # bumping this invalidates every outstanding refresh token for the user.
    refresh_token_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    # Coarse sign-in location, refreshed periodically from the address they
    # connect from. City-level at finest; no coordinates and no stored IP. Used
    # only to pick regional defaults - see services/geolocation.py.
    location_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    location_country: Mapped[str | None] = mapped_column(String(2), nullable=True)
    location_timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # What this user calls their companion in each mode, keyed by mode id:
    # {"learning": "Nick", "knowing": "Gale"}. One row rather than a table
    # because it is at most four short strings and is always read whole with
    # the user. Absent keys mean "no name given", which is the default and
    # renders as the mode's own label.
    companion_names: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    location_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    workspace_memberships: Mapped[list["WorkspaceMember"]] = relationship(back_populates="user")
    profile: Mapped["UserProfile | None"] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )
