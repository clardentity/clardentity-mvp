"""per-mode companion nicknames

Revision ID: c1d2e3f4a5b6
Revises: f2a3b4c5d6e7
Create Date: 2026-08-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c1d2e3f4a5b6"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable with no server default: "never named a companion" and "named
    # none of them" are the same state, and an empty object would make every
    # existing row look like a deliberate choice.
    op.add_column(
        "users",
        sa.Column("companion_names", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "companion_names")
