"""three new companion modes: mentoring, therapy, creative

Revision ID: a5b6c7d8e9f0
Revises: f4a5b6c7d8e9
Create Date: 2026-09-01
"""

from alembic import op

revision = "a5b6c7d8e9f0"
down_revision = "f4a5b6c7d8e9"
branch_labels = None
depends_on = None

_OLD_MODES = "('knowing', 'thinking', 'decision', 'learning')"
_NEW_MODES = (
    "('knowing', 'thinking', 'decision', 'learning', 'mentoring', 'therapy', 'creative')"
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
