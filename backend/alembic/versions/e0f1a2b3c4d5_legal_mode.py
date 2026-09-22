"""legal mode: plain-language orientation before professional advice

Revision ID: e0f1a2b3c4d5
Revises: d8e9f0a1b2c3
Create Date: 2026-09-22
"""

from alembic import op

revision = "e0f1a2b3c4d5"
down_revision = "d8e9f0a1b2c3"
branch_labels = None
depends_on = None

_OLD_MODES = (
    "('rapid', 'knowing', 'thinking', 'decision', 'learning', 'mentoring', 'therapy', "
    "'creative')"
)
_NEW_MODES = (
    "('rapid', 'knowing', 'thinking', 'decision', 'learning', 'mentoring', 'therapy', "
    "'creative', 'legal')"
)


def _swap(modes: str) -> None:
    op.drop_constraint("ck_conversations_default_mode", "conversations", type_="check")
    op.create_check_constraint(
        "ck_conversations_default_mode", "conversations", f"default_mode IN {modes}"
    )
    op.drop_constraint("ck_messages_mode_used", "messages", type_="check")
    op.create_check_constraint("ck_messages_mode_used", "messages", f"mode_used IN {modes}")


def upgrade() -> None:
    _swap(_NEW_MODES)


def downgrade() -> None:
    _swap(_OLD_MODES)
