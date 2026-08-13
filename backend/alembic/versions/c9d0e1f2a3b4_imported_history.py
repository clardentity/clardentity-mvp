"""imported history from another assistant's export

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-08-13
"""

from alembic import op
import sqlalchemy as sa

revision = "c9d0e1f2a3b4"
down_revision = "b8c9d0e1f2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The user's own messages only, already filtered - not the raw export.
    op.add_column("user_profiles", sa.Column("imported_context", sa.Text(), nullable=True))
    op.add_column("user_profiles", sa.Column("imported_source", sa.String(length=32), nullable=True))
    op.add_column(
        "user_profiles", sa.Column("imported_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("user_profiles", "imported_at")
    op.drop_column("user_profiles", "imported_source")
    op.drop_column("user_profiles", "imported_context")
