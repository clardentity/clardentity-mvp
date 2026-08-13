"""per-turn guidance: better-suited mode + sharper phrasing

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-08-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "a7b8c9d0e1f2"
down_revision = "f6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable with no default: null means "nothing worth suggesting", which
    # is the common case and wants no row-rewrite on an existing table.
    op.add_column(
        "messages",
        sa.Column("guidance", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("messages", "guidance")
