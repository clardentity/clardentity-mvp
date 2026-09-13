"""rapid mode: the fastest useful answer, no gates, no verification

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-09-13
"""

from alembic import op

revision = "d8e9f0a1b2c3"
down_revision = "c7d8e9f0a1b2"
branch_labels = None
depends_on = None

_OLD_MODES = (
    "('knowing', 'thinking', 'decision', 'learning', 'mentoring', 'therapy', 'creative')"
)
_NEW_MODES = (
    "('rapid', 'knowing', 'thinking', 'decision', 'learning', 'mentoring', 'therapy', "
    "'creative')"
)


def upgrade() -> None:
    op.drop_constraint("ck_conversations_default_mode", "conversations", type_="check")
    op.create_check_constraint(
        "ck_conversations_default_mode", "conversations", f"default_mode IN {_NEW_MODES}"
    )
    op.drop_constraint("ck_messages_mode_used", "messages", type_="check")
    op.create_check_constraint(
        "ck_messages_mode_used", "messages", f"mode_used IN {_NEW_MODES}"
    )


def downgrade() -> None:
    op.drop_constraint("ck_messages_mode_used", "messages", type_="check")
    op.create_check_constraint(
        "ck_messages_mode_used", "messages", f"mode_used IN {_OLD_MODES}"
    )
    op.drop_constraint("ck_conversations_default_mode", "conversations", type_="check")
    op.create_check_constraint(
        "ck_conversations_default_mode", "conversations", f"default_mode IN {_OLD_MODES}"
    )
