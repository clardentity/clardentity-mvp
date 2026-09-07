"""message crux text (the model's leading one-sentence bottom line)

Revision ID: b6c7d8e9f0a1
Revises: a5b6c7d8e9f0
Create Date: 2026-09-03
"""

from alembic import op
import sqlalchemy as sa

revision = "b6c7d8e9f0a1"
down_revision = "a5b6c7d8e9f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("crux_text", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("messages", "crux_text")
