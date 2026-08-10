"""devil's-advocate variant + web sources for citations

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-08-10
"""

from alembic import op
import sqlalchemy as sa

revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("counterfactual_content", sa.Text(), nullable=True))

    # Citations could only ever point at a document chunk. A web result has no
    # chunk and no document, so both FKs become nullable and the source is
    # described by url/title instead.
    op.add_column("citations", sa.Column("url", sa.Text(), nullable=True))
    op.add_column("citations", sa.Column("title", sa.Text(), nullable=True))
    op.add_column(
        "citations",
        sa.Column("credibility_score", sa.Numeric(), nullable=True),
    )
    op.add_column("citations", sa.Column("credibility_note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("citations", "credibility_note")
    op.drop_column("citations", "credibility_score")
    op.drop_column("citations", "title")
    op.drop_column("citations", "url")
    op.drop_column("messages", "counterfactual_content")
