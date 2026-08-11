"""profile aspects: personality.md becomes a list of editable entries

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-08-11
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_profiles",
        sa.Column("aspects", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    # Existing prose profiles are left in personality_md. They are not
    # mechanically splittable into aspects - a paragraph is not a list - so
    # the next inference rebuild populates aspects properly rather than this
    # migration guessing at sentence boundaries.


def downgrade() -> None:
    op.drop_column("user_profiles", "aspects")
