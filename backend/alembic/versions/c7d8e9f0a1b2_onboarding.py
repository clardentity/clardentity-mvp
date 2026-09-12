"""first-run onboarding: completion stamp on users, answers on profiles

Revision ID: c7d8e9f0a1b2
Revises: b6c7d8e9f0a1
Create Date: 2026-09-12

Nullable on purpose: every account that exists when this lands has NULL,
which the app reads as "has not been onboarded" - so shipping this is also
the one-time reset that puts the welcome questions and the coachmark tour
in front of everyone, existing accounts included.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c7d8e9f0a1b2"
down_revision = "b6c7d8e9f0a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("onboarding_completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "user_profiles",
        sa.Column("onboarding_answers", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user_profiles", "onboarding_answers")
    op.drop_column("users", "onboarding_completed_at")
