"""message forking: parent_id + conversation active_leaf_id

Revision ID: f4a5b6c7d8e9
Revises: e3f4a5b6c7d8
Create Date: 2026-09-01
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f4a5b6c7d8e9"
down_revision = "e3f4a5b6c7d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column(
            "parent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index("ix_messages_parent_id", "messages", ["parent_id"])
    op.add_column(
        "conversations",
        sa.Column(
            "active_leaf_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("messages.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # Backfill: every existing conversation is a single straight line, so
    # reconstruct that as a tree (each message's parent is whichever message
    # preceded it) rather than leaving old conversations looking like a pile
    # of unrelated root messages once parent_id exists.
    op.execute(
        """
        WITH ordered AS (
            SELECT id, LAG(id) OVER (
                PARTITION BY conversation_id ORDER BY created_at, id
            ) AS prev_id
            FROM messages
        )
        UPDATE messages m
        SET parent_id = ordered.prev_id
        FROM ordered
        WHERE m.id = ordered.id AND ordered.prev_id IS NOT NULL
        """
    )
    op.execute(
        """
        UPDATE conversations c
        SET active_leaf_id = last_message.id
        FROM (
            SELECT DISTINCT ON (conversation_id) conversation_id, id
            FROM messages
            ORDER BY conversation_id, created_at DESC, id DESC
        ) AS last_message
        WHERE c.id = last_message.conversation_id
        """
    )


def downgrade() -> None:
    op.drop_column("conversations", "active_leaf_id")
    op.drop_index("ix_messages_parent_id", table_name="messages")
    op.drop_column("messages", "parent_id")
