"""coarse sign-in location on the user

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-08-13
"""

from alembic import op
import sqlalchemy as sa

revision = "b8c9d0e1f2a3"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A human-readable label rather than coordinates: nothing here needs to be
    # finer than "which country's rules apply", and storing less is the whole
    # design. The originating IP is deliberately not among these columns.
    op.add_column("users", sa.Column("location_label", sa.String(length=120), nullable=True))
    op.add_column("users", sa.Column("location_country", sa.String(length=2), nullable=True))
    op.add_column("users", sa.Column("location_timezone", sa.String(length=64), nullable=True))
    op.add_column(
        "users", sa.Column("location_updated_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("users", "location_updated_at")
    op.drop_column("users", "location_timezone")
    op.drop_column("users", "location_country")
    op.drop_column("users", "location_label")
